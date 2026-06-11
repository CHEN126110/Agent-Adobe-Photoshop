#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const POLICY_PATH = path.join(ROOT, 'src/renderer/services/agent-orchestration/streaming-policy.ts');
const CHAT_PANEL_PATH = path.join(ROOT, 'src/renderer/components/ChatPanel.tsx');

const policy = fs.readFileSync(POLICY_PATH, 'utf8');
const chatPanel = fs.readFileSync(CHAT_PANEL_PATH, 'utf8');

function assertContains(source, expected, message) {
  assert(source.includes(expected), message);
}

assertContains(
  policy,
  "options?.purpose !== 'direct_response' && options?.purpose !== 'visible_reasoning'",
  'provider stream policy must only allow direct_response and visible_reasoning purposes'
);
assertContains(
  policy,
  "context.hasAttachedImage",
  'provider stream policy must block attached-image or multimodal requests'
);
assertContains(
  policy,
  "context.hasToolCalling",
  'provider stream policy must block tool-calling requests'
);
assertContains(
  policy,
  "typeof message.content === 'string'",
  'provider stream policy must block structured multimodal content'
);
assertContains(
  chatPanel,
  "import { canUsePlainTextProviderStream } from '../services/agent-orchestration/streaming-policy';",
  'ChatPanel must use the shared provider stream policy instead of inline conditions'
);
assertContains(
  chatPanel,
  'const streamHasAttachedImage = isVisibleReasoningCall ? false : hasAttachedImage;',
  'ChatPanel must keep visible reasoning text-only even when the user attached images'
);
assertContains(
  chatPanel,
  'hasAttachedImage: streamHasAttachedImage',
  'ChatPanel must pass effective attachment context into provider stream policy'
);
assertContains(
  chatPanel,
  'hasToolCalling: false',
  'ChatPanel must pass tool-calling context into provider stream policy'
);
assert(
  !chatPanel.includes('const canUseProviderStream ='),
  'ChatPanel must not reintroduce an inline canUseProviderStream policy'
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'provider stream policy only allows direct_response and visible_reasoning purposes',
    'provider stream policy blocks attached images and structured content',
    'provider stream policy blocks tool-calling requests',
    'ChatPanel keeps visible reasoning text-only before applying attachment stream guards',
    'ChatPanel uses the shared provider stream policy and has no inline duplicate'
  ]
}, null, 2));
