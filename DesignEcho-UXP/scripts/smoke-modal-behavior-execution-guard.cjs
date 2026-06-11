#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const guardedFiles = [
  'src/core/jsx-bridge.ts',
  'src/tools/image/get-subject-bounds.ts',
  'src/tools/layout/move-layer.ts',
  'src/tools/layout/sku-layout-tool.ts',
  'src/tools/layout/template-tool.ts'
];

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function main() {
  const checked = [];

  for (const relativePath of guardedFiles) {
    const source = read(relativePath);
    assert(
      source.includes('executeAsModal'),
      `${relativePath} should stay covered by executeAsModal modal-scope guard`
    );
    if (relativePath === 'src/tools/layout/move-layer.ts') {
      assert(
        source.includes('translateLayer') && source.includes('.translate('),
        `${relativePath} should use DOM layer.translate instead of Photoshop native move`
      );
      assert(
        !/_obj:\s*['"]move['"]/.test(source),
        `${relativePath} must not send Photoshop native move because it can trigger availability popups`
      );
      checked.push(relativePath);
      continue;
    }
    assert(
      source.includes('synchronousExecution: true'),
      `${relativePath} should use synchronous batchPlay execution inside executeAsModal`
    );
    assert(
      source.includes("dialogOptions: 'dontDisplay'"),
      `${relativePath} should suppress Photoshop native dialogs at descriptor level`
    );
    assert(
      !source.includes("modalBehavior: 'execute'") && !source.includes('modalBehavior: "execute"'),
      `${relativePath} must not pass modalBehavior execute inside executeAsModal batchPlay calls`
    );
    assert(
      !source.includes("modalBehavior: 'fail'") && !source.includes('modalBehavior: "fail"'),
      `${relativePath} must not pass modalBehavior fail inside executeAsModal batchPlay calls`
    );
    checked.push(relativePath);
  }

  console.log(JSON.stringify({
    success: true,
    checked,
    checks: [
      'guarded Photoshop tools avoid nested modalBehavior inside executeAsModal',
      'guarded Photoshop tools keep synchronous batchPlay execution',
      'guarded Photoshop tools suppress native dialogs at descriptor level'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    error: error && error.message ? error.message : String(error),
    details: error && error.details ? error.details : undefined
  }, null, 2));
  process.exit(1);
}
