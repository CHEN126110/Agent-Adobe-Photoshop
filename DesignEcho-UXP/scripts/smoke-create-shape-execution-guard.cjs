#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'tools', 'canvas', 'create-shape.ts');

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function main() {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert(
    source.includes('createToolFailureResult'),
    'create-shape tools should return normalized tool failures'
  );
  assert(
    !source.includes('error instanceof Error ? error.message'),
    'create-shape tools should not expose raw Error.message as the whole tool error'
  );
  assert(
    !source.includes("], { commandName: 'DesignEcho:"),
    'create-shape batchPlay calls should not use commandName-only options'
  );
  assert(
    !source.includes("modalBehavior: 'fail'"),
    'create-shape batchPlay calls should not use modalBehavior fail inside executeAsModal'
  );
  assert(
    source.includes('synchronousExecution: true'),
    'create-shape batchPlay calls should run synchronously inside executeAsModal'
  );
  assert(
    source.includes("dialogOptions: 'dontDisplay'"),
    'create-shape batchPlay descriptors should suppress Photoshop action dialogs'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'create-shape tools use normalized failures',
      'create-shape batchPlay calls are executeAsModal-safe and no-dialog'
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
