#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const agentSourcePath = path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts');
const uxpSourcePath = path.resolve(__dirname, '..', '..', 'DesignEcho-UXP', 'src', 'tools', 'layout', 'sku-layout-tool.ts');

const agentSource = fs.readFileSync(agentSourcePath, 'utf8');
const uxpSource = fs.readFileSync(uxpSourcePath, 'utf8');

assert(
  agentSource.includes('resolveProjectSkuSourceDocument'),
  'SKU executor should resolve the SKU source through a project-first policy'
);
assert(
  !agentSource.includes('let skuDoc = docsResult?.documents?.find((d: any) => matchesSkuDocument(d, skuKeyword));'),
  'SKU executor must not pick an opened SKU document before checking the current project'
);
assert(
  agentSource.includes('pickBestProjectSkuSourceFile'),
  'SKU executor should score project PSD/PSB candidates before falling back to opened documents'
);
assert(
  agentSource.includes('skuDocName: skuDocName'),
  'SKU executor should pass the resolved SKU document name into skuLayout'
);
assert(
  agentSource.includes('templateDocName: templateDoc.name'),
  'SKU executor should pass the resolved combo template document name into skuLayout'
);
assert(
  agentSource.includes('templateDocName: noteTemplateDoc.name'),
  'SKU executor should pass the resolved note template document name into skuLayout'
);
assert(
  agentSource.includes('SKU 执行计划已确认'),
  'SKU executor should emit a visible execution plan before running Photoshop mutations'
);
assert(
  uxpSource.includes('skuDocName: params.skuDocName') &&
    uxpSource.includes('templateDocName: params.templateDocName'),
  'UXP skuLayout action should forward explicit document names to execution code'
);
assert(
  uxpSource.includes('config.skuDocName') &&
    uxpSource.includes('config.templateDocName'),
  'UXP SKU note/combo execution should honor explicit SKU and template documents'
);

console.log('[smoke-sku-project-source-policy] pass');
