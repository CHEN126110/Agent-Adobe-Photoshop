#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const settings = read('src/renderer/components/SettingsModal.tsx');
const memoryService = read('src/renderer/services/memory.service.ts');

assert(settings.includes("| 'preferences'"), 'SettingsTab must include preferences');
assert(settings.includes("activeTab === 'preferences'"), 'SettingsModal must render the preferences tab content');
assert(settings.includes("setActiveTab('preferences')"), 'SettingsModal must expose a preferences tab button');
assert(settings.includes('用户偏好记忆'), 'Preferences tab must use user-facing Chinese title');
assert(settings.includes('getMemoryService().listPreferenceItems()'), 'Preferences tab must read preference items through MemoryService');
assert(settings.includes('getMemoryService().setPreferenceEnabled'), 'Preferences tab must toggle preferences through MemoryService');
assert(settings.includes('getMemoryService().archivePreference'), 'Preferences tab must archive preferences through MemoryService');
assert(settings.includes('getMemoryService().clearInferredPreferences'), 'Preferences tab must clear inferred preferences through MemoryService');
assert(settings.includes('handleCreatePreference'), 'Preferences tab must expose a create preference handler');
assert(settings.includes('handleEditPreference'), 'Preferences tab must expose an edit preference handler');
assert(settings.includes('handleSavePreferenceDraft'), 'Preferences tab must expose a save preference draft handler');
assert(settings.includes('handleExportPreferences'), 'Preferences tab must expose an export preference handler');
assert(settings.includes('handleImportPreferences'), 'Preferences tab must expose an import preference handler');
assert(settings.includes('getMemoryService().upsertExplicitPreference'), 'Create preference UI must save through MemoryService.upsertExplicitPreference');
assert(settings.includes('getMemoryService().updatePreferenceItem'), 'Edit preference UI must update through MemoryService.updatePreferenceItem');
assert(settings.includes('getMemoryService().exportPreferences'), 'Export preference UI must call MemoryService.exportPreferences');
assert(settings.includes('getMemoryService().importPreferences'), 'Import preference UI must call MemoryService.importPreferences');
[
  '作用域',
  '用户级',
  '项目级',
  '品牌级',
  '会话级',
  '确认并启用',
  '导出偏好',
  '导入偏好'
].forEach((text) => {
  assert(settings.includes(text), `Preferences tab must render ${text}`);
});
assert(!settings.includes("localStorage.removeItem('designecho-memory'"), 'SettingsModal must not directly remove the memory localStorage key');
assert(!settings.includes('window.location.reload()'), 'SettingsModal preference controls must not force reload');
assert(!settings.includes('置信度'), 'Preferences settings UI must not mention confidence');

[
  'listPreferenceItems',
  'upsertExplicitPreference',
  'updatePreferenceItem',
  'setPreferenceEnabled',
  'archivePreference',
  'clearInferredPreferences',
  'clearPreferences',
  'exportPreferences',
  'importPreferences'
].forEach((name) => {
  assert(memoryService.includes(`${name}(`), `MemoryService must implement ${name}`);
});

console.log(JSON.stringify({
  success: true,
  checks: [
    'SettingsModal exposes a user preference tab',
    'SettingsModal supports manual create/edit/import/export preference workflows',
    'preference controls call MemoryService instead of localStorage deletion',
    'UI avoids confidence wording',
    'service contract methods are present'
  ]
}, null, 2));
