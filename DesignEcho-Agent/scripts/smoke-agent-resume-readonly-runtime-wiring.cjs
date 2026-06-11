#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildAgentResumeReadonlyToolHandlers
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'resume-readonly-handlers.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

async function runBuilderCase() {
  const calls = [];
  const handlers = buildAgentResumeReadonlyToolHandlers({
    executeToolCall: async (toolName, params) => {
      calls.push({ toolName, params });
      if (toolName === 'getDocumentInfo') return { success: true, name: 'Live.psd', width: 800, height: 800 };
      if (toolName === 'getDocumentSnapshot') return { success: true, snapshot: { width: 320, height: 320 }, imageData: 'must-not-leak-to-planning' };
      if (toolName === 'getLayerHierarchy') return { success: true, layers: [{ id: 1, name: '标题' }] };
      if (toolName === 'getAcceptanceSnapshot') return { success: true, layers: [{ id: 1, name: '标题' }], rawPayloadRedacted: true };
      throw new Error(`unexpected tool ${toolName}`);
    },
    projectContext: {
      projectPath: 'C:\\Project\\GeneralDesign',
      projectImageCount: 12,
      sampleImagePaths: ['C:\\Project\\GeneralDesign\\source\\a.jpg'],
      visualInsightCache: {
        cacheVersion: 'project-visual-insight-cache/v0',
        source: 'provided-options',
        exists: true,
        entries: [],
        summary: {
          totalEntries: 12,
          entriesWithInsight: 4,
          entriesWithRawPayloadRemoved: 0
        },
        warnings: ['缓存测试警告'],
        limitations: ['缓存测试限制'],
        evidence: []
      },
      contextSnapshot: {
        snapshotVersion: 'context-snapshot/v0',
        project: {
          path: 'C:/Project/GeneralDesign',
          name: 'GeneralDesign'
        },
        selectedAssetPaths: ['C:/Project/GeneralDesign/source/a.jpg'],
        userConstraints: [],
        taskHistory: ['继续上一项'],
        unverifiedItems: ['需要重新规划'],
        readiness: 'needs_visual_sampling',
        warnings: ['测试警告'],
        limitations: ['测试限制'],
        evidence: []
      },
      contextSnapshotSource: 'runtime-project-service',
      contextSnapshotWarnings: ['测试警告'],
      contextSnapshotLimitations: ['测试限制']
    }
  });

  assert(typeof handlers.getDocumentInfo === 'function', 'runtime builder should provide getDocumentInfo handler');
  assert(typeof handlers.getDocumentSnapshot === 'function', 'runtime builder should provide getDocumentSnapshot handler');
  assert(typeof handlers.getLayerHierarchy === 'function', 'runtime builder should provide getLayerHierarchy handler');
  assert(typeof handlers.getAcceptanceSnapshot === 'function', 'runtime builder should provide getAcceptanceSnapshot handler');
  assert(typeof handlers.getProjectContextSnapshot === 'function', 'runtime builder should provide getProjectContextSnapshot handler');

  const documentInfo = await handlers.getDocumentInfo();
  const documentSnapshot = await handlers.getDocumentSnapshot();
  const layerHierarchy = await handlers.getLayerHierarchy();
  const acceptanceSnapshot = await handlers.getAcceptanceSnapshot();
  const projectContextSnapshot = await handlers.getProjectContextSnapshot();

  assert(documentInfo.name === 'Live.psd', 'document info should come from injected readonly tool', documentInfo);
  assert(documentSnapshot.success === true, 'document snapshot should come from injected readonly tool', documentSnapshot);
  assert(layerHierarchy.layers?.[0]?.name === '标题', 'layer hierarchy should come from injected readonly tool', layerHierarchy);
  assert(acceptanceSnapshot.rawPayloadRedacted === true, 'acceptance snapshot should preserve redaction marker', acceptanceSnapshot);
  assert(projectContextSnapshot.projectPath === 'C:\\Project\\GeneralDesign', 'project context snapshot should come from current project context', projectContextSnapshot);
  assert(projectContextSnapshot.contextSnapshotSource === 'runtime-project-service', 'project context snapshot should preserve source', projectContextSnapshot);
  assert(projectContextSnapshot.visualInsightCache.totalEntries === 12, 'project context snapshot should summarize visual insight cache totals', projectContextSnapshot);
  assert(projectContextSnapshot.contextSnapshotSummary.readiness === 'needs_visual_sampling', 'project context snapshot should summarize typed ContextSnapshot fields', projectContextSnapshot);

  const callNames = calls.map((call) => call.toolName);
  assert(!callNames.some((name) => ![
    'getDocumentInfo',
    'getDocumentSnapshot',
    'getLayerHierarchy',
    'getAcceptanceSnapshot'
  ].includes(name)), 'runtime readonly handlers must not call write tools', calls);
  assert(calls.find((call) => call.toolName === 'getDocumentSnapshot')?.params?.maxWidth <= 640, 'document snapshot should stay bounded', calls);
  assert(calls.find((call) => call.toolName === 'getAcceptanceSnapshot')?.params?.includeText === true, 'acceptance snapshot should include text for planning', calls);
}

function runChatPanelWiringCase() {
  const chatPanelSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'ChatPanel.tsx'), 'utf8');
  assert(
    chatPanelSource.includes('buildAgentResumeReadonlyToolHandlers'),
    'ChatPanel should import the runtime resume readonly handler builder'
  );
  assert(
    /resumeReadonlyToolHandlers\s*:\s*buildAgentResumeReadonlyToolHandlers/.test(chatPanelSource),
    'ChatPanel should inject resumeReadonlyToolHandlers into AgentContext'
  );
}

Promise.resolve()
  .then(runBuilderCase)
  .then(runChatPanelWiringCase)
  .then(() => {
    console.log(JSON.stringify({
      success: true,
      checks: [
        'runtime builder exposes all controlled readonly resume handlers',
        'runtime builder uses only existing readonly Photoshop tools',
        'project context snapshot comes from current Agent project context',
        'ChatPanel injects resumeReadonlyToolHandlers into AgentContext'
      ]
    }, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
