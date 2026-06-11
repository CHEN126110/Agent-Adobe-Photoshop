/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-image-read-disposable.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-image-read-disposable.md');
const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function asJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function rpc(method, params = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() + Math.random(), method, params })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${endpoint}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method} failed: ${asJson(payload.error)}`);
  }
  return payload.result;
}

function parseToolResult(result) {
  const text = result?.content?.[0]?.text || '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function callTool(name, args = {}) {
  return parseToolResult(await rpc('tools/call', {
    name,
    arguments: args
  }));
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop MCP Manual-Risky Image Read Disposable Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Plugin connected: ${report.systemStatus?.pluginConnected ? 'yes' : 'no'}`);
  lines.push(`- Disposable document: ${report.disposableDocument?.name || 'n/a'}`);
  lines.push('');
  lines.push('## Setup');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.setup, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Scenarios');
  lines.push('');
  for (const scenario of report.scenarios) {
    lines.push(`### ${scenario.name}`);
    lines.push('');
    lines.push(`- Expected: ${scenario.expected}`);
    lines.push(`- Outcome: ${scenario.outcome}`);
    if (scenario.notes) {
      lines.push(`- Notes: ${scenario.notes}`);
    }
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(scenario.payload, null, 2));
    lines.push('```');
    lines.push('');
  }
  if (report.cleanup) {
    lines.push('## Cleanup');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(report.cleanup, null, 2));
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}

function isSuccess(payload) {
  return payload?.success === true;
}

function hasPositiveBounds(payload) {
  const bounds = payload?.data?.bounds;
  return bounds && typeof bounds.width === 'number' && bounds.width > 0 && typeof bounds.height === 'number' && bounds.height > 0;
}

async function main() {
  ensureDir(TMP_DIR);

  const systemStatus = await callTool('system.status', {});
  if (!systemStatus?.pluginConnected) {
    throw new Error('Photoshop UXP plugin is not connected');
  }

  const stamp = Date.now();
  const docName = `MCP-ImageRead-Smoke-${stamp}`;
  const setup = {};
  let createdDoc = null;
  let createdRectangle = null;

  try {
    createdDoc = await callTool('photoshop.tools.call', {
      name: 'createDocument',
      arguments: {
        width: 320,
        height: 240,
        name: docName,
        backgroundColor: 'white'
      }
    });
    setup.createDocument = createdDoc;
    if (!isSuccess(createdDoc) || typeof createdDoc?.documentId !== 'number') {
      throw new Error(`createDocument failed contract check: ${asJson(createdDoc)}`);
    }

    createdRectangle = await callTool('photoshop.tools.call', {
      name: 'createRectangle',
      arguments: {
        x: 40,
        y: 50,
        width: 160,
        height: 100,
        fillColorHex: '#6FA2D8',
        name: 'Image Read Smoke Rectangle'
      }
    });
    setup.createRectangle = createdRectangle;
    if (!isSuccess(createdRectangle) || typeof createdRectangle?.layerId !== 'number') {
      throw new Error(`createRectangle failed contract check: ${asJson(createdRectangle)}`);
    }

    const optimizedLayer = await callTool('photoshop.tools.call', {
      name: 'getOptimizedImage',
      arguments: {
        layerId: createdRectangle.layerId,
        maxSize: 256,
        quality: 80,
        includeAlpha: true
      }
    });
    setup.getOptimizedImageLayer = optimizedLayer;
    if (!isSuccess(optimizedLayer) || typeof optimizedLayer?.width !== 'number' || optimizedLayer.width <= 0 || typeof optimizedLayer?.height !== 'number' || optimizedLayer.height <= 0 || (!optimizedLayer?.jpegData && !optimizedLayer?.alphaData)) {
      throw new Error(`getOptimizedImage (layer mode) failed contract check: ${asJson(optimizedLayer)}`);
    }

    const optimizedBoundary = await callTool('photoshop.tools.call', {
      name: 'getOptimizedImage',
      arguments: {
        boundary: { left: 20, top: 20, right: 260, bottom: 220 },
        maxSize: 256,
        includeAlpha: false
      }
    });
    setup.getOptimizedImageBoundary = optimizedBoundary;
    if (!isSuccess(optimizedBoundary) || typeof optimizedBoundary?.width !== 'number' || optimizedBoundary.width <= 0 || typeof optimizedBoundary?.height !== 'number' || optimizedBoundary.height <= 0 || !optimizedBoundary?.jpegData) {
      throw new Error(`getOptimizedImage (boundary mode) failed contract check: ${asJson(optimizedBoundary)}`);
    }

    const mattingImage = await callTool('photoshop.tools.call', {
      name: 'getMattingImage',
      arguments: {
        layerId: createdRectangle.layerId,
        maxSize: 256,
        outputFormat: 'raw'
      }
    });
    setup.getMattingImage = mattingImage;
    if (!isSuccess(mattingImage) || typeof mattingImage?.width !== 'number' || mattingImage.width <= 0 || typeof mattingImage?.height !== 'number' || mattingImage.height <= 0 || typeof mattingImage?.imageData !== 'string') {
      throw new Error(`getMattingImage failed contract check: ${asJson(mattingImage)}`);
    }

    const subjectAlpha = await callTool('photoshop.tools.call', {
      name: 'getSubjectBounds',
      arguments: {
        layerId: createdRectangle.layerId,
        method: 'alpha'
      }
    });
    setup.getSubjectBoundsAlpha = subjectAlpha;
    if (!isSuccess(subjectAlpha) || !hasPositiveBounds(subjectAlpha)) {
      throw new Error(`getSubjectBounds (alpha) failed contract check: ${asJson(subjectAlpha)}`);
    }

    const subjectSmart = await callTool('photoshop.tools.call', {
      name: 'getSubjectBounds',
      arguments: {
        layerId: createdRectangle.layerId,
        method: 'smart'
      }
    });
    setup.getSubjectBoundsSmart = subjectSmart;
    if (!isSuccess(subjectSmart) || !hasPositiveBounds(subjectSmart)) {
      throw new Error(`getSubjectBounds (smart) failed contract check: ${asJson(subjectSmart)}`);
    }

    const scenarios = [
      {
        name: 'get-optimized-image-layer-contract',
        expected: 'getOptimizedImage should support explicit layerId mode and return image payload plus dimensions',
        outcome: 'pass',
        payload: optimizedLayer
      },
      {
        name: 'get-optimized-image-boundary-contract',
        expected: 'getOptimizedImage should support boundary/document-wide mode without explicit layerId',
        outcome: 'pass',
        payload: optimizedBoundary
      },
      {
        name: 'get-matting-image-contract',
        expected: 'getMattingImage should support layer mode and return imageData plus dimensions',
        outcome: 'pass',
        payload: mattingImage
      },
      {
        name: 'get-subject-bounds-alpha-contract',
        expected: 'getSubjectBounds alpha mode should return positive bounds for an explicit layerId',
        outcome: 'pass',
        payload: subjectAlpha
      },
      {
        name: 'get-subject-bounds-smart-contract',
        expected: 'getSubjectBounds smart mode should return positive bounds for an explicit layerId',
        outcome: 'pass',
        payload: subjectSmart
      }
    ];

    const report = {
      generatedAt: new Date().toISOString(),
      endpoint,
      systemStatus,
      disposableDocument: createdDoc,
      setup,
      scenarios
    };

    fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
    fs.writeFileSync(MD_OUT, renderMarkdown(report));

    console.log(`Wrote ${JSON_OUT}`);
    console.log(`Wrote ${MD_OUT}`);
    console.log(JSON.stringify({
      connected: systemStatus?.pluginConnected === true,
      scenarios: scenarios.map(item => ({ name: item.name, outcome: item.outcome }))
    }, null, 2));
  } finally {
    if (createdDoc?.documentId) {
      const cleanup = await callTool('photoshop.tools.call', {
        name: 'closeDocument',
        arguments: { documentId: createdDoc.documentId, save: false }
      }).catch(error => ({ success: false, error: error?.message || String(error) }));
      try {
        const existing = fs.existsSync(JSON_OUT)
          ? JSON.parse(fs.readFileSync(JSON_OUT, 'utf8'))
          : {
              generatedAt: new Date().toISOString(),
              endpoint,
              systemStatus,
              disposableDocument: createdDoc,
              setup,
              scenarios: []
            };
        existing.cleanup = cleanup;
        fs.writeFileSync(JSON_OUT, JSON.stringify(existing, null, 2));
        fs.writeFileSync(MD_OUT, renderMarkdown(existing));
      } catch {
        // best effort only
      }
    }
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
