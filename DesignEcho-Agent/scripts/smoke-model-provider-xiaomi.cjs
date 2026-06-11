#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const {
  XIAOMI_MODELS,
  OPENROUTER_MODELS,
  ALL_MODELS,
  getModelById
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'config', 'models.config.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const official = getModelById('xiaomi-mimo-v2.5-pro');
  const officialOmniV25 = getModelById('xiaomi-mimo-v2.5');
  const officialLegacy = getModelById('xiaomi-mimo-v2-pro');
  const officialLegacyOmni = getModelById('xiaomi-mimo-v2-omni');
  const openrouter = getModelById('openrouter-mimo-v2.5-pro');
  const openrouterOmniV25 = getModelById('openrouter-mimo-v2.5');
  const openrouterLegacy = getModelById('openrouter-mimo-v2-pro');

  assert(official, 'missing xiaomi-mimo-v2.5-pro');
  assert(official.provider === 'xiaomi', 'xiaomi-mimo-v2.5-pro provider must be xiaomi');
  assert(official.requiredApiKey === 'xiaomi', 'xiaomi-mimo-v2.5-pro must require xiaomi API key');
  assert(official.apiModelId === 'mimo-v2.5-pro', `unexpected official apiModelId: ${official.apiModelId}`);
  assert(official.supportsToolUse === true, 'xiaomi-mimo-v2.5-pro should support tool use');
  assert(official.recommended === true, 'xiaomi-mimo-v2.5-pro should be recommended');

  assert(officialOmniV25, 'missing xiaomi-mimo-v2.5');
  assert(officialOmniV25.provider === 'xiaomi', 'xiaomi-mimo-v2.5 provider must be xiaomi');
  assert(officialOmniV25.requiredApiKey === 'xiaomi', 'xiaomi-mimo-v2.5 must require xiaomi API key');
  assert(officialOmniV25.apiModelId === 'mimo-v2.5', `unexpected official MiMo V2.5 apiModelId: ${officialOmniV25.apiModelId}`);
  assert(officialOmniV25.supportsVision === true, 'xiaomi-mimo-v2.5 should be available for visual analysis');
  assert(officialOmniV25.supportsToolUse === true, 'xiaomi-mimo-v2.5 should support tool use');
  assert(officialOmniV25.recommended === true, 'xiaomi-mimo-v2.5 should be recommended');

  assert(officialLegacy, 'legacy xiaomi-mimo-v2-pro should remain available for saved configs');
  assert(officialLegacy.apiModelId === 'mimo-v2-pro', 'legacy xiaomi-mimo-v2-pro apiModelId changed unexpectedly');
  assert(officialLegacy.recommended !== true, 'legacy xiaomi-mimo-v2-pro should not be recommended');
  assert(officialLegacyOmni, 'legacy xiaomi-mimo-v2-omni should remain available for saved configs');
  assert(officialLegacyOmni.apiModelId === 'mimo-v2-omni', 'legacy xiaomi-mimo-v2-omni apiModelId changed unexpectedly');

  assert(openrouter, 'missing openrouter-mimo-v2.5-pro');
  assert(openrouter.provider === 'openrouter', 'openrouter-mimo-v2.5-pro provider must be openrouter');
  assert(openrouter.apiModelId === 'xiaomi/mimo-v2.5-pro', `unexpected OpenRouter apiModelId: ${openrouter.apiModelId}`);

  assert(openrouterOmniV25, 'missing openrouter-mimo-v2.5');
  assert(openrouterOmniV25.provider === 'openrouter', 'openrouter-mimo-v2.5 provider must be openrouter');
  assert(openrouterOmniV25.apiModelId === 'xiaomi/mimo-v2.5', `unexpected OpenRouter MiMo V2.5 apiModelId: ${openrouterOmniV25.apiModelId}`);
  assert(openrouterOmniV25.supportsVision === true, 'openrouter-mimo-v2.5 should be available for visual analysis');

  assert(openrouterLegacy, 'legacy openrouter-mimo-v2-pro should remain available for saved configs');
  assert(openrouterLegacy.apiModelId === 'xiaomi/mimo-v2-pro', 'legacy OpenRouter MiMo V2 Pro apiModelId changed unexpectedly');

  const allIds = ALL_MODELS.map((model) => model.id);
  assert(new Set(allIds).size === allIds.length, 'model ids must be unique');
  assert(XIAOMI_MODELS[0].id === 'xiaomi-mimo-v2.5-pro', 'Xiaomi MiMo V2.5 Pro should be first official Xiaomi option');
  assert(XIAOMI_MODELS[1].id === 'xiaomi-mimo-v2.5', 'Xiaomi MiMo V2.5 should be second official Xiaomi option');
  assert(OPENROUTER_MODELS.some((model) => model.id === 'openrouter-mimo-v2.5-pro'), 'OpenRouter MiMo V2.5 Pro missing from OpenRouter list');
  assert(OPENROUTER_MODELS.some((model) => model.id === 'openrouter-mimo-v2.5'), 'OpenRouter MiMo V2.5 missing from OpenRouter list');

  console.log(JSON.stringify({
    success: true,
    official: {
      id: official.id,
      apiModelId: official.apiModelId,
      recommended: official.recommended
    },
    officialLegacy: {
      id: officialLegacy.id,
      apiModelId: officialLegacy.apiModelId,
      recommended: officialLegacy.recommended === true
    },
    officialOmniV25: {
      id: officialOmniV25.id,
      apiModelId: officialOmniV25.apiModelId,
      supportsVision: officialOmniV25.supportsVision
    },
    openrouter: {
      id: openrouter.id,
      apiModelId: openrouter.apiModelId
    },
    openrouterOmniV25: {
      id: openrouterOmniV25.id,
      apiModelId: openrouterOmniV25.apiModelId,
      supportsVision: openrouterOmniV25.supportsVision
    },
    boundary: [
      'This smoke validates Xiaomi MiMo model configuration only.',
      'It does not call Xiaomi or OpenRouter APIs and does not prove quota availability.'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
