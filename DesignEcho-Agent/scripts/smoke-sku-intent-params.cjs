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
  extractSkuComboSizesFromText,
  isSkuNoteOnlyText,
  inferSkuIntentParamsFromText
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'sku-intent-params.ts'));
const {
  applySharedSkillParamDefaults
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skill-param-defaults.ts'));
const routing = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function main() {
  assert(sameJson(extractSkuComboSizesFromText('帮我做2-3-4的自选备注'), [2, 3, 4]), '2-3-4 must map to [2,3,4]');
  assert(sameJson(extractSkuComboSizesFromText('帮我做单双装备注'), [1]), '单双装 must map to [1]');
  assert(sameJson(extractSkuComboSizesFromText('帮我做一双 SKU'), [1]), '一双 must map to [1]');

  const plainSku = applySharedSkillParamDefaults({
    skillId: 'sku-batch',
    userInput: '帮我做SKU',
    params: {}
  });
  assert(plainSku.generateNotes === true, 'plain SKU should generate self-select notes by default');
  assert(plainSku.countPerSize === 5, 'plain SKU should keep default countPerSize=5');

  const genericSku = inferSkuIntentParamsFromText('帮我做SKU');
  assert(genericSku.generateNotes === true, 'generic SKU should include self-select notes by default');
  assert(genericSku.onlyNotes === false, 'generic SKU should still generate combo images');

  const fourSku = applySharedSkillParamDefaults({
    skillId: 'sku-batch',
    userInput: '帮我做4双的SKU组合，需要3个',
    params: {}
  });
  assert(sameJson(fourSku.comboSizes, [4]), '4双 SKU must extract comboSizes=[4]');
  assert(fourSku.countPerSize === 3, '需要3个 must extract countPerSize=3');
  assert(fourSku.generateNotes === true, 'explicit combo SKU should still generate notes unless disabled');

  const noNotesSku = inferSkuIntentParamsFromText('帮我做SKU，不需要自选备注');
  assert(noNotesSku.generateNotes === false, 'explicit no-note SKU should disable self-select notes');
  assert(noNotesSku.onlyNotes === false, 'explicit no-note SKU should keep combo work enabled');

  const comboOnlySku = inferSkuIntentParamsFromText('只要组合，帮我做SKU');
  assert(comboOnlySku.generateNotes === false, 'combo-only SKU should disable self-select notes');
  assert(comboOnlySku.onlyNotes === false, 'combo-only SKU should not become note-only');

  const noteOnly = routing.fastDeterministicRoute('帮我做2-3-4的自选备注');
  assert(noteOnly?.skillId === 'sku-batch', '2-3-4 self-select note should route to sku-batch');
  assert(noteOnly.skillParams.onlyNotes === true, '2-3-4 self-select note must set onlyNotes=true');
  assert(sameJson(noteOnly.skillParams.comboSizes, [2, 3, 4]), '2-3-4 self-select note must preserve combo sizes');
  assert(noteOnly.skillParams.generateNotes === true, 'explicit self-select note must set generateNotes=true');

  const singleNote = routing.fastDeterministicRoute('帮我做单双装自选备注');
  assert(singleNote?.skillId === 'sku-batch', '单双装自选备注 should route to sku-batch');
  assert(singleNote.skillParams.onlyNotes === true, '单双装自选备注 must set onlyNotes=true');
  assert(sameJson(singleNote.skillParams.comboSizes, [1]), '单双装自选备注 must preserve comboSizes=[1]');

  const inferred = inferSkuIntentParamsFromText('帮我做4双的SKU组合，需要3个，不需要自选备注');
  assert(sameJson(inferred.comboSizes, [4]), 'inferred comboSizes should include 4');
  assert(inferred.countPerSize === 3, 'inferred countPerSize should be 3');
  assert(inferred.generateNotes === false, 'explicit no-note request should keep generateNotes=false');
  assert(inferred.onlyNotes === false, 'explicit no-note request must not become onlyNotes=true');

  const comboPlusNotes = inferSkuIntentParamsFromText('帮我做SKU，每个规格6个组合以及对应自选备注');
  assert(comboPlusNotes.countPerSize === 6, 'combined SKU+note request should preserve countPerSize=6');
  assert(comboPlusNotes.generateNotes === true, 'combined SKU+note request should generate notes');
  assert(comboPlusNotes.onlyNotes === false, 'combined SKU+note request must not become onlyNotes=true');

  const correspondingNoteOnly = routing.fastDeterministicRoute('我还需要对应的SKU自选备注');
  assert(correspondingNoteOnly?.skillId === 'sku-batch', 'corresponding SKU self-select note should route to sku-batch');
  assert(correspondingNoteOnly.skillParams.onlyNotes === true, 'corresponding SKU self-select note must be note-only');
  assert(correspondingNoteOnly.skillParams.generateNotes === true, 'corresponding SKU self-select note must generate notes');
  assert(isSkuNoteOnlyText('我还需要对应的SKU自选备注') === true, 'SKU自选备注 should not be treated as color-combo work');

  console.log(JSON.stringify({
    success: true,
    cases: {
      plainSku,
      fourSku,
      noteOnly: noteOnly.skillParams,
      singleNote: singleNote.skillParams,
      inferred,
      comboPlusNotes,
      genericSku,
      noNotesSku,
      comboOnlySku,
      correspondingNoteOnly: correspondingNoteOnly.skillParams
    },
    boundary: [
      '普通 SKU 默认包含自选备注，除非用户明确说只要组合或不要备注。',
      '用户明确自选备注时才生成备注；1双/单双仍由 self-select note policy 跳过。',
      '单双/一双/1双都归一为 comboSizes=[1]。'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
