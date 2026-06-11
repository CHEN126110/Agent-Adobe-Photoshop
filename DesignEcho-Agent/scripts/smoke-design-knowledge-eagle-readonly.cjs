#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const {
  EAGLE_READONLY_TOOL_NAMES,
  buildEagleMcpToolCallBody,
  isEagleReadonlyKnowledgePayloadSafe,
  normalizeEagleReadonlyKnowledgeResults
} = require('../src/shared/eagle-readonly-knowledge.ts');

const {
  EagleReadonlyKnowledgeService
} = require('../src/main/services/eagle-readonly-knowledge-service.ts');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} should include ${needle}`);
}

function assertNoRawImagePayload(value, label) {
  const text = JSON.stringify(value);
  const forbidden = [
    'data:image',
    '"base64"',
    '"imageBase64"',
    '"rawImage"',
    '"rawImages"',
    '"buffer"',
    '"bytes"'
  ];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} should not expose raw image payloads: ${found.join(', ')}`, value);
}

function assertNoWriteTool(value, label) {
  const text = JSON.stringify(value);
  const writeTools = [
    'item_update',
    'item_add',
    'item_move_to_trash',
    'item_add_tags',
    'item_remove_tags',
    'item_add_to_folders',
    'item_remove_from_folders',
    'folder_create',
    'folder_update',
    'tag_update',
    'tag_merge',
    'tag_group_create',
    'tag_group_update',
    'tag_group_delete'
  ];
  const found = writeTools.filter((tool) => text.includes(tool));
  assert(found.length === 0, `${label} should not include Eagle write tools: ${found.join(', ')}`, value);
}

function sampleItems() {
  return [
    {
      id: 'eagle-item-1',
      name: 'sock-card-reference.jpg',
      ext: 'jpg',
      tags: ['socks', 'sku-card', 'clean-shadow'],
      folders: ['folder-a'],
      width: 1600,
      height: 1200,
      annotation: 'Five-color socks SKU card with clean spacing and natural soft shadow.',
      filePath: 'D:/Eagle/library/sock-card-reference.jpg',
      thumbnailPath: 'D:/Eagle/library/.thumb/sock-card-reference.jpg',
      url: 'https://example.com/reference',
      star: 5,
      score: 0.91,
      imageBase64: 'data:image/png;base64,should-not-leak'
    }
  ];
}

async function run() {
  const normalized = normalizeEagleReadonlyKnowledgeResults(
    {
      query: 'socks sku card clean shadow',
      limit: 5
    },
    sampleItems(),
    {
      nowIso: '2026-05-27T00:00:00.000Z',
      sourceTool: 'item_query'
    }
  );

  assert(normalized.results.length === 1, 'Eagle item should normalize into one knowledge result', normalized);
  const item = normalized.results[0];
  assert(item.sourceType === 'eagle_library', 'Eagle knowledge should use eagle_library source type', item);
  assert(item.evidenceLevel === 'local_case', 'Eagle item is a local case, not a generated claim', item);
  assert(item.allowedUses.includes('prompt_context'), 'Eagle item should be usable as prompt context', item);
  assert(item.allowedUses.includes('user_reference'), 'Eagle item should be usable as user reference', item);
  assert(!item.allowedUses.includes('direct_photoshop_action'), 'Eagle item must not become a direct Photoshop action', item);
  assert(item.tags.includes('eagle'), 'Eagle provider tag should be preserved', item);
  assert(item.tags.includes('sku-card'), 'Eagle item tags should be preserved', item);
  assert(item.evidence.some((line) => line.includes('eagle-item-1')), 'Eagle item id should be visible as evidence', item);
  assert(normalized.providerSummary.eagleLibrary === 1, 'provider summary should count Eagle library results', normalized.providerSummary);
  assert(normalized.boundaries.readonly === true, 'connector boundary should be readonly', normalized.boundaries);
  assert(normalized.boundaries.doesNotReturnRawImages === true, 'connector boundary should redact raw image data', normalized.boundaries);
  assert(isEagleReadonlyKnowledgePayloadSafe(normalized), 'normalized payload should pass raw image safety check', normalized);
  assertNoRawImagePayload(normalized, 'normalized Eagle knowledge');

  const allowedBody = buildEagleMcpToolCallBody('item_query', { query: 'socks' });
  assert(allowedBody.tool === 'item_query', 'read-only tool call should preserve tool name', allowedBody);
  assertNoWriteTool(allowedBody, 'read-only tool call body');

  for (const tool of ['get_app_info', 'item_query', 'item_get', 'item_get_selected', 'item_count', 'folder_get', 'tag_get', 'tag_count', 'tag_group_get', 'ai_search_status', 'ai_search_by_text', 'ai_search_by_item']) {
    assert(EAGLE_READONLY_TOOL_NAMES.includes(tool), `read-only tool allowlist should include ${tool}`);
  }
  for (const tool of ['item_update', 'item_add', 'folder_create', 'tag_merge']) {
    let threw = false;
    try {
      buildEagleMcpToolCallBody(tool, {});
    } catch {
      threw = true;
    }
    assert(threw, `write tool should be rejected: ${tool}`);
  }

  const calls = [];
  const fakeFetch = async (_url, init) => {
    const body = JSON.parse(String(init.body || '{}'));
    calls.push(body.tool);
    if (body.tool === 'ai_search_status') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: { status: 'not_installed', ready: false } })
      };
    }
    if (body.tool === 'item_query') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: sampleItems() })
      };
    }
    throw new Error(`unexpected Eagle tool call ${body.tool}`);
  };

  const service = await EagleReadonlyKnowledgeService.search(
    {
      query: 'socks sku card',
      limit: 2,
      preferAiSearch: true
    },
    {
      settings: {
        enabled: true,
        endpoint: 'http://127.0.0.1:41596'
      },
      fetchImpl: fakeFetch
    }
  );

  assert(calls.includes('ai_search_status'), 'service should check AI Search readiness before semantic search', calls);
  assert(calls.includes('item_query'), 'service should fall back to read-only item_query when AI Search is unavailable', calls);
  assertNoWriteTool(calls, 'service call sequence');
  assert(service.status === 'ok', 'service should return ok when fallback search succeeds', service);
  assert(service.results.length === 1, 'service should return normalized Eagle result', service);
  assert(service.warnings.some((line) => line.includes('AI Search')), 'fallback should explain AI Search boundary', service.warnings);
  assertNoRawImagePayload(service, 'service Eagle knowledge');

  const unavailable = await EagleReadonlyKnowledgeService.search(
    {
      query: 'socks sku card',
      limit: 2
    },
    {
      settings: {
        enabled: true,
        endpoint: 'http://127.0.0.1:41596'
      },
      fetchImpl: async () => {
        throw new Error('connection refused');
      }
    }
  );
  assert(unavailable.status === 'unavailable', 'Eagle connection failure should be explicit unavailable status', unavailable);
  assert(unavailable.results.length === 0, 'unavailable Eagle connector must not fabricate knowledge', unavailable);
  assert(unavailable.warnings.some((line) => line.includes('Eagle')), 'unavailable result should name Eagle connector', unavailable.warnings);

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-knowledge:eagle-readonly'], 'package script should expose Eagle readonly smoke');

  const preload = read('src/main/preload.ts');
  assertIncludes(preload, 'searchEagleReadonlyKnowledge', 'preload Eagle readonly bridge');
  assertIncludes(preload, 'designKnowledge:searchEagleReadonly', 'preload Eagle readonly IPC channel');

  const types = read('src/renderer/types.d.ts');
  assertIncludes(types, 'searchEagleReadonlyKnowledge', 'renderer type declaration');
  assertIncludes(types, 'eagle_library', 'renderer type should expose Eagle source type');

  const handlerIndex = read('src/main/ipc-handlers/index.ts');
  assertIncludes(handlerIndex, 'registerEagleKnowledgeHandlers', 'IPC setup');

  const handler = read('src/main/ipc-handlers/eagle-knowledge-handlers.ts');
  assertIncludes(handler, 'designKnowledge:searchEagleReadonly', 'Eagle knowledge IPC handler');
  assertNoWriteTool(handler, 'Eagle knowledge IPC handler');

  const boundaries = read('scripts/report-change-boundaries.cjs');
  assertIncludes(boundaries, 'smoke:design-knowledge:eagle-readonly', 'change boundary validation');
  assertIncludes(boundaries, 'eagle-readonly-knowledge', 'change boundary matcher');

  return {
    success: true,
    checks: [
      'Eagle items normalize into canonical design knowledge results',
      'Eagle source is read-only local_case evidence and never a direct Photoshop action',
      'raw image/base64 payloads are redacted from knowledge results',
      'Eagle write tools are rejected by the connector allowlist',
      'AI Search is optional and falls back to item_query without failing the task',
      'Eagle unavailable status does not fabricate knowledge',
      'IPC, preload, renderer types, package script and change boundary are wired'
    ]
  };
}

run()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
