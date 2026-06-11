/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const UXP_ROOT = path.resolve(ROOT, '..', 'DesignEcho-UXP');
const REGISTRY_PATH = path.join(UXP_ROOT, 'src', 'tools', 'registry.ts');
const OUT_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(OUT_DIR, 'photoshop-mcp-inventory.json');
const MD_OUT = path.join(OUT_DIR, 'photoshop-mcp-inventory.md');
const ENDPOINT = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const RUNTIME_SMOKE = process.argv.includes('--runtime-smoke');

async function rpc(method, params = {}) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${ENDPOINT}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method} failed: ${JSON.stringify(payload.error)}`);
  }

  return payload.result;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function jsonText(result) {
  const text = result?.content?.[0]?.text;
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

function parseImports(registryText) {
  const imports = new Map();
  const importRegex = /import\s*\{([\s\S]*?)\}\s*from\s*['"](.+?)['"];?/g;
  let match;
  while ((match = importRegex.exec(registryText))) {
    const names = match[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    for (const name of names) {
      imports.set(name, match[2]);
    }
  }
  return imports;
}

function parseRegisteredClasses(registryText) {
  const classes = [];
  const registerRegex = /this\.register\(\s*new\s+([A-Za-z0-9_]+)\s*\(/g;
  let match;
  while ((match = registerRegex.exec(registryText))) {
    classes.push(match[1]);
  }

  const assignedInstances = new Map();
  const assignRegex = /this\.([A-Za-z0-9_]+)\s*=\s*new\s+([A-Za-z0-9_]+)\s*\(/g;
  while ((match = assignRegex.exec(registryText))) {
    assignedInstances.set(match[1], match[2]);
  }

  const registerVarRegex = /this\.register\(\s*this\.([A-Za-z0-9_]+)\s*\)/g;
  while ((match = registerVarRegex.exec(registryText))) {
    const className = assignedInstances.get(match[1]);
    if (className) {
      classes.push(className);
    }
  }

  return Array.from(new Set(classes));
}

function resolveModulePath(importPath, fromFile = REGISTRY_PATH) {
  const base = path.resolve(path.dirname(fromFile), importPath);
  const candidates = [
    `${base}.ts`,
    path.join(base, 'index.ts')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function extractClassBlock(fileText, className) {
  const classRegex = new RegExp(
    `export\\s+class\\s+${className}\\b[\\s\\S]*?(?=\\nexport\\s+class\\s+|\\nexport\\s+\\{|$)`
  );
  const match = fileText.match(classRegex);
  return match ? match[0] : null;
}

function extractToolName(classBlock) {
  if (!classBlock) {
    return null;
  }

  const direct = classBlock.match(/readonly\s+name\s*=\s*['"]([^'"]+)['"]/);
  if (direct) {
    return direct[1];
  }

  const plain = classBlock.match(/\bname\s*=\s*['"]([^'"]+)['"]/);
  if (plain) {
    return plain[1];
  }

  const getter = classBlock.match(/get\s+name\s*\(\)\s*:\s*[A-Za-z0-9_<>\[\]\s|]+?\{\s*return\s*['"]([^'"]+)['"]/);
  if (getter) {
    return getter[1];
  }

  const schema = classBlock.match(/schema\s*:\s*ToolSchema\s*=\s*\{[\s\S]*?name\s*:\s*['"]([^'"]+)['"]/);
  if (schema) {
    return schema[1];
  }

  return null;
}

function resolveReExportTarget(modulePath, className) {
  if (!fs.existsSync(modulePath)) {
    return modulePath;
  }

  const fileText = readUtf8(modulePath);
  const reExportRegex = /export\s*\{([\s\S]*?)\}\s*from\s*['"](.+?)['"];?/g;
  let match;
  while ((match = reExportRegex.exec(fileText))) {
    const names = match[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.split(/\s+as\s+/i)[0].trim());
    if (names.includes(className)) {
      return resolveModulePath(match[2], modulePath);
    }
  }

  return modulePath;
}

function detectPopupRisk(classBlock) {
  if (!classBlock) {
    return 'unknown';
  }

  if (/alert\s*\(/.test(classBlock) || /showAlert/i.test(classBlock)) {
    return 'explicit-alert';
  }

  const hasBatchPlay = /batchPlay\s*\(/.test(classBlock);
  const hasDontDisplay = /dialogOptions\s*:\s*['"]dontDisplay['"]/.test(classBlock);
  const hasExecuteAsModal = /executeAsModal\s*\(/.test(classBlock);

  if (hasBatchPlay && !hasDontDisplay) {
    return 'possible-dialog';
  }

  if (hasExecuteAsModal || hasBatchPlay) {
    return 'modal-safe';
  }

  return 'low';
}

function classifySourceFile(filePath) {
  const rel = path.relative(path.join(UXP_ROOT, 'src', 'tools'), filePath).replace(/\\/g, '/');
  const category = rel.split('/')[0] || 'unknown';
  return { category, relativePath: rel };
}

async function getHostSummary() {
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    clientInfo: { name: 'audit-photoshop-mcp', version: '1.0.0' }
  });
  const tools = await rpc('tools/list');
  const resources = await rpc('resources/list');
  const prompts = await rpc('prompts/list');
  const systemStatus = jsonText(await rpc('tools/call', { name: 'system.status', arguments: {} }));
  const connectionStatus = jsonText(
    await rpc('tools/call', { name: 'photoshop.connection_status', arguments: {} })
  );
  const runtimeTools = jsonText(
    await rpc('tools/call', { name: 'photoshop.tools.list', arguments: {} })
  );

  return {
    initialize: init,
    hostTools: Array.isArray(tools?.tools) ? tools.tools : [],
    resources: Array.isArray(resources?.resources) ? resources.resources : [],
    prompts: Array.isArray(prompts?.prompts) ? prompts.prompts : [],
    systemStatus,
    connectionStatus,
    runtimeTools: Array.isArray(runtimeTools?.tools) ? runtimeTools.tools : []
  };
}

async function runRuntimeSmoke(runtimeNames) {
  const allowlist = [
    'getDocumentInfo',
    'listDocuments',
    'diagnoseState'
  ].filter((name) => runtimeNames.has(name));

  const results = [];
  for (const name of allowlist) {
    try {
      const result = await rpc('tools/call', {
        name: 'photoshop.tools.call',
        arguments: { name, arguments: {} }
      });
      const parsed = jsonText(result);
      results.push({
        name,
        status: 'ok',
        detail: parsed?.error || null
      });
    } catch (error) {
      results.push({
        name,
        status: 'error',
        detail: error?.message || String(error)
      });
    }
  }
  return results;
}

function buildInventory(hostSummary) {
  const registryText = readUtf8(REGISTRY_PATH);
  const imports = parseImports(registryText);
  const registeredClasses = parseRegisteredClasses(registryText);
  const runtimeToolMap = new Map(
    hostSummary.runtimeTools.map((tool) => [tool.name, tool])
  );

  const entries = [];
  for (const className of registeredClasses) {
    const importPath = imports.get(className);
    const initialModulePath = importPath ? resolveModulePath(importPath) : null;
    const modulePath = initialModulePath ? resolveReExportTarget(initialModulePath, className) : null;
    const exists = modulePath ? fs.existsSync(modulePath) : false;
    const fileText = exists ? readUtf8(modulePath) : null;
    const classBlock = exists ? extractClassBlock(fileText, className) : null;
    const toolName = extractToolName(classBlock);
    const meta = modulePath ? classifySourceFile(modulePath) : { category: 'unknown', relativePath: null };
    const runtimeTool = toolName ? runtimeToolMap.get(toolName) : null;

    entries.push({
      className,
      toolName,
      category: meta.category,
      sourceFile: meta.relativePath,
      sourceResolved: modulePath,
      importPath: importPath || null,
      sourceExists: exists,
      runtimeExposed: Boolean(runtimeTool),
      runtimeDescription: runtimeTool?.description || null,
      inputSchemaRequired: runtimeTool?.inputSchema?.required || [],
      popupRisk: detectPopupRisk(classBlock),
      issues: [
        ...(importPath ? [] : ['missing_import']),
        ...(exists ? [] : ['missing_source_file']),
        ...(toolName ? [] : ['missing_tool_name']),
        ...(toolName && runtimeTool ? [] : toolName ? ['missing_in_runtime'] : [])
      ]
    });
  }

  const sourceNames = new Set(entries.map((item) => item.toolName).filter(Boolean));
  const runtimeOnly = hostSummary.runtimeTools
    .filter((tool) => !sourceNames.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description || null
    }));

  return {
    entries,
    runtimeOnly,
    missingInRuntime: entries.filter((item) => item.toolName && !item.runtimeExposed),
    brokenSource: entries.filter((item) => item.issues.length > 0)
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop MCP Inventory');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Mode: ${report.mode}`);
  lines.push(`- Host tools: ${report.hostTools.length}`);
  lines.push(`- Photoshop runtime tools: ${report.runtimeTools.length}`);
  lines.push(`- Registry entries: ${report.inventory.entries.length}`);
  lines.push(`- Missing in runtime: ${report.inventory.missingInRuntime.length}`);
  lines.push(`- Runtime-only tools: ${report.inventory.runtimeOnly.length}`);
  lines.push(`- Photoshop connected: ${report.connectionStatus?.connected === true ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- Default mode is static inventory plus safe host preflight.');
  lines.push('- No bulk runtime tool execution is performed by default.');
  lines.push('- Use `--runtime-smoke` only on a disposable Photoshop session.');
  lines.push('');

  if (report.runtimeSmoke.length) {
    lines.push('## Runtime Smoke');
    lines.push('');
    lines.push('| Tool | Status | Detail |');
    lines.push('|---|---|---|');
    for (const item of report.runtimeSmoke) {
      lines.push(`| ${item.name} | ${item.status} | ${String(item.detail || '').replace(/\|/g, '\\|')} |`);
    }
    lines.push('');
  }

  lines.push('## Missing In Runtime');
  lines.push('');
  if (!report.inventory.missingInRuntime.length) {
    lines.push('- None');
  } else {
    for (const item of report.inventory.missingInRuntime) {
      lines.push(`- \`${item.toolName}\` from \`${item.sourceFile}\``);
    }
  }
  lines.push('');

  lines.push('## Runtime Only');
  lines.push('');
  if (!report.inventory.runtimeOnly.length) {
    lines.push('- None');
  } else {
    for (const item of report.inventory.runtimeOnly) {
      lines.push(`- \`${item.name}\``);
    }
  }
  lines.push('');

  lines.push('## Tool Table');
  lines.push('');
  lines.push('| Tool | Category | Runtime | Popup Risk | Issues | Source |');
  lines.push('|---|---|---|---|---|---|');
  for (const item of report.inventory.entries.sort((a, b) => String(a.toolName).localeCompare(String(b.toolName)))) {
    lines.push(
      `| ${item.toolName || item.className} | ${item.category} | ${item.runtimeExposed ? 'yes' : 'no'} | ${item.popupRisk} | ${item.issues.join(', ') || ''} | ${item.sourceFile || ''} |`
    );
  }
  lines.push('');

  return lines.join('\n');
}

async function main() {
  ensureDir(OUT_DIR);

  const hostSummary = await getHostSummary();
  const inventory = buildInventory(hostSummary);
  const runtimeSmoke = RUNTIME_SMOKE
    ? await runRuntimeSmoke(new Set(hostSummary.runtimeTools.map((tool) => tool.name)))
    : [];

  const report = {
    generatedAt: new Date().toISOString(),
    mode: RUNTIME_SMOKE ? 'static+runtime-smoke' : 'static-only',
    endpoint: ENDPOINT,
    hostTools: hostSummary.hostTools,
    resources: hostSummary.resources,
    prompts: hostSummary.prompts,
    systemStatus: hostSummary.systemStatus,
    connectionStatus: hostSummary.connectionStatus,
    runtimeTools: hostSummary.runtimeTools,
    inventory,
    runtimeSmoke
  };

  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync(MD_OUT, renderMarkdown(report));

  console.log(`Wrote ${JSON_OUT}`);
  console.log(`Wrote ${MD_OUT}`);
  console.log(`Photoshop connected: ${report.connectionStatus?.connected === true}`);
  console.log(`Runtime tools: ${report.runtimeTools.length}`);
  console.log(`Missing in runtime: ${report.inventory.missingInRuntime.length}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
