#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const executor = read('src/renderer/services/tool-executor.service.ts');
  const block = read('src/renderer/components/message/blocks/ToolResultBlock.tsx');
  const parser = read('src/renderer/components/message/parser.ts');
  const logger = read('src/renderer/services/tool-logger.ts');

  assert(
    !executor.includes('textParts.push(`[${toolName}] 结果:\\n${JSON.stringify(result, null, 2)}`)'),
    'processToolResults must not append full JSON result into model context'
  );
  assert(
    executor.includes('summarizeToolResultForModel(result)'),
    'processToolResults should use safe model summary'
  );
  assert(
    !block.includes('JSON.stringify(value, null, 2)'),
    'ToolResultBlock must not render raw object JSON in normal UI'
  );
  assert(
    block.includes('结构化结果已隐藏') && block.includes('对象数据已隐藏'),
    'ToolResultBlock should hide structured/raw object results'
  );
  assert(
    parser.includes("typeof data.acceptance?.summaryText === 'string'") &&
      parser.includes("if (key === 'acceptance') continue;"),
    'message parser should expose acceptance summary and skip raw acceptance object'
  );
  assert(
    logger.includes('参数摘要') && !logger.includes('JSON.stringify(call.params).substring'),
    'debug report should show redacted parameter summary instead of raw params'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'model context uses summarized tool results',
      'normal tool result UI hides raw structured data',
      'parser exposes acceptance summary only',
      'debug report uses parameter summary'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
