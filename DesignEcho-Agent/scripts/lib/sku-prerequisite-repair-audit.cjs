'use strict';

const fs = require('fs');
const path = require('path');

function auditSkuPrerequisiteRepairBehavior(input) {
  const root = input.root;
  const executorText = String(input.executorText || '');
  const policyPath = path.join(root, 'src', 'shared', 'sku-prerequisite-repair-policy.ts');
  const violations = [];
  const { resolveSkuPrerequisiteRepairPolicy } = require(policyPath);

  const fullPolicy = resolveSkuPrerequisiteRepairPolicy('full', false, {});
  const onlyJpgProjectFiles = ['商品正面.jpg', '商品侧面.jpeg'];
  const photoshopDocuments = [];
  const hasExistingSkuSource = [
    ...onlyJpgProjectFiles,
    ...photoshopDocuments.map((document) => String(document.name || ''))
  ].some((fileName) => /\.(?:psd|psb)$/i.test(fileName));
  const fullMissingSourceStatus = hasExistingSkuSource
    ? 'reuse_existing_sku_source'
    : fullPolicy.missingSourceStatus;

  if (!fullPolicy.searchExistingSourceFirst) {
    violations.push('sku-prerequisite-repair:full-does-not-search-existing-source-first');
  }
  if (!fullPolicy.allowSourcePreparationWhenMissing) {
    violations.push('sku-prerequisite-repair:full-jpg-only-project-cannot-prepare-source');
  }
  if (!fullPolicy.allowTemplatePreparationWhenMissing) {
    violations.push('sku-prerequisite-repair:full-cannot-prepare-missing-template');
  }
  if (fullMissingSourceStatus === 'blocked_missing_sku_source_file') {
    violations.push('sku-prerequisite-repair:full-jpg-only-project-returned-missing-source-block');
  }

  const inspectPolicy = resolveSkuPrerequisiteRepairPolicy('inspect', false, {
    sourcePreparation: true,
    templatePreparation: true
  });
  if (
    inspectPolicy.allowSourcePreparationWhenMissing
    || inspectPolicy.allowTemplatePreparationWhenMissing
    || inspectPolicy.missingSourceStatus !== 'blocked_missing_sku_source_file'
  ) {
    violations.push('sku-prerequisite-repair:inspect-mode-escalated-to-write');
  }

  const explicitlyDisabledPolicy = resolveSkuPrerequisiteRepairPolicy('full', false, {
    sourcePreparation: false,
    templatePreparation: false
  });
  if (
    explicitlyDisabledPolicy.allowSourcePreparationWhenMissing
    || explicitlyDisabledPolicy.allowTemplatePreparationWhenMissing
    || explicitlyDisabledPolicy.missingSourceStatus !== 'blocked_missing_sku_source_file'
  ) {
    violations.push('sku-prerequisite-repair:explicit-disable-did-not-fail-closed');
  }

  const existingOnlyPolicy = resolveSkuPrerequisiteRepairPolicy('full', true, {});
  if (existingOnlyPolicy.allowSourcePreparationWhenMissing) {
    violations.push('sku-prerequisite-repair:prefer-existing-regenerated-missing-source');
  }

  const resolverStart = executorText.indexOf('const resolveProjectSkuSourceDocument = async');
  const resolverEnd = executorText.indexOf('// 2. 查找 SKU 文件', resolverStart);
  const resolverText = resolverStart >= 0 && resolverEnd > resolverStart
    ? executorText.slice(resolverStart, resolverEnd)
    : '';
  const resolveCallIndex = executorText.indexOf('await resolveProjectSkuSourceDocument()');
  const preparationPlanIndex = executorText.indexOf('buildSkuCardSourcePreparationPlan({', resolveCallIndex);

  if (!executorText.includes("resolveSkuPrerequisiteRepairPolicy(")) {
    violations.push('sku-prerequisite-repair:executor-policy-not-wired');
  }
  if (!resolverText.includes("safeToolCall('searchProjectResources'")) {
    violations.push('sku-prerequisite-repair:executor-does-not-search-project-source');
  }
  if (
    resolveCallIndex < 0
    || preparationPlanIndex < 0
    || resolveCallIndex >= preparationPlanIndex
  ) {
    violations.push('sku-prerequisite-repair:source-preparation-precedes-existing-source-resolution');
  }
  if (
    executorText.includes('existing SKU source will be regenerated from project images')
    || executorText.includes('ignoredExistingSkuDoc')
  ) {
    violations.push('sku-prerequisite-repair:executor-still-discards-existing-source');
  }
  if (!executorText.includes('status: skuPrerequisiteRepairPolicy.missingSourceStatus')) {
    violations.push('sku-prerequisite-repair:missing-source-result-not-bound-to-policy');
  }

  return violations;
}

module.exports = {
  auditSkuPrerequisiteRepairBehavior
};
