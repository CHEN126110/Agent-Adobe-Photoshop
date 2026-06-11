const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts'),
  'utf8'
);

assert(source.includes("const resultStatus = !hasProcessedSizes ? 'failed' : hasWarnings ? 'partial' : 'completed';"), 'SKU executor must classify completed/partial/failed status');
assert(source.includes('partial: resultStatus ==='), 'SKU executor must expose partial flag');
assert(source.includes('warnings: allCopyErrors'), 'SKU executor must expose warning details');
assert(source.includes('success: processedSizes.length > 0'), 'SKU executor must preserve existing success criterion for UI compatibility');

console.log('[smoke-sku-result-status] pass');
