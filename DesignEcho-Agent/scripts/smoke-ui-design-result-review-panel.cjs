#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildDesignResultReviewPanel,
  deriveDesignResultReviewScenario
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-result-review-panel.ts'));

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

const panel = buildDesignResultReviewPanel({
  projectName: 'C-1160',
  isPluginConnected: true,
  ecommerceSummary: {
    totalImages: 18,
    totalFolders: 7,
    byFolderType: {
      source: 9,
      psd: 3,
      mainImage: 4,
      detail: 1,
      sku: 2
    }
  },
  messages: [
    {
      id: 'assistant-main-image',
      role: 'assistant',
      agentRequestLifecycle: {
        decision: { skillId: 'main-image-design', route: 'skill_execution' },
        blockers: [],
        warnings: ['需要人工复核结果图']
      },
      executionSummary: {
        status: 'needs_review',
        acceptanceVerified: 2,
        acceptanceFailed: 0,
        acceptanceNeedsReview: 1,
        blockers: [],
        warnings: ['等待人工复核'],
        summaryText: '主图结果图、pixel probe 已进入复核。'
      },
      agentDiagnosticEvidence: {
        version: 'agent-diagnostic-evidence/v0',
        evidenceKeys: ['mainImageQaReport', 'mainImageScreenshotQa', 'mainImageScreenshotProbeReadiness'],
        rawPayloadRedacted: true,
        mainImageQaReport: {
          reportVersion: 'main-image-qa-report/v0',
          stage: 'needs_manual_review',
          status: 'needs_review',
          summary: '主图 QA 等待人工复核。',
          resultImageSummary: {
            resultImageCount: 3,
            fileProbeCount: 3,
            okFileProbeCount: 3,
            pixelProbeStatus: 'needs_review'
          },
          sections: [
            { id: 'screenshot-qa', status: 'needs_review' },
            { id: 'pixel-probe', status: 'needs_review' }
          ],
          checks: [
            { id: 'main-image-qa-quality-boundary', status: 'needs_review' }
          ],
          qualityClaim: {
            allowed: false,
            requiredEvidence: ['manual review approved', 'pixel probe ok'],
            blockers: ['manual review is required']
          },
          blockers: [],
          warnings: ['pixel probe 仍需人工确认'],
          nextActions: ['完成主图人工复核']
        },
        mainImageScreenshotQa: {
          stage: 'needs_manual_review',
          resultImageEvidence: {
            resultImageCount: 3
          },
          blockers: [],
          warnings: ['截图 QA 尚未完成']
        },
        mainImageScreenshotProbeReadiness: {
          stage: 'passed',
          requiredNextEvidence: ['manual review approved']
        }
      }
    },
    {
      id: 'assistant-detail',
      role: 'assistant',
      agentRequestLifecycle: {
        decision: { skillId: 'detail-page-design', route: 'skill_execution' }
      },
      executionSummary: {
        status: 'completed',
        acceptanceVerified: 1,
        acceptanceFailed: 0,
        acceptanceNeedsReview: 1,
        warnings: ['详情页需要检查图片置入']
      },
      agentDiagnosticEvidence: {
        version: 'agent-diagnostic-evidence/v0',
        evidenceKeys: ['detailPageSkillReadiness', 'designAgentOs'],
        rawPayloadRedacted: true,
        detailPageSkillReadiness: {
          readinessVersion: 'detail-page-skill-readiness/v0',
          mode: 'execute',
          status: 'ready',
          canExecute: true,
          requiredNextEvidence: ['detail-page screenshot review'],
          warnings: ['执行后需要截图复核']
        },
        designAgentOs: {
          executionPlan: {
            status: 'planned',
            steps: [{ id: 'screen-1' }, { id: 'screen-2' }, { id: 'screen-3' }]
          },
          executionTrace: {
            status: 'needs_review',
            toolCallCount: 5,
            successfulToolCalls: 5,
            failedToolCalls: 0
          },
          verificationReport: {
            status: 'needs_review',
            checks: [{ id: 'layout' }, { id: 'placement' }],
            blockers: [],
            warnings: ['需要人工检查首屏节奏']
          }
        }
      }
    },
    {
      id: 'assistant-sku',
      role: 'assistant',
      agentRequestLifecycle: {
        decision: { skillId: 'sku-batch', route: 'skill_execution' }
      },
      executionSummary: {
        status: 'failed',
        acceptanceVerified: 0,
        acceptanceFailed: 1,
        acceptanceNeedsReview: 0,
        blockers: ['SKU 自选备注未完成'],
        warnings: []
      },
      agentDiagnosticEvidence: {
        version: 'agent-diagnostic-evidence/v0',
        evidenceKeys: ['businessSkillExecutionPlanIntake'],
        rawPayloadRedacted: true,
        businessSkillExecutionPlanIntake: {
          scenario: 'sku',
          status: 'blocked'
        },
        designAgentOs: {
          executionPlan: {
            status: 'partial',
            steps: [{ id: '2-pair' }, { id: '3-pair' }]
          },
          executionTrace: {
            status: 'failed',
            toolCallCount: 4,
            successfulToolCalls: 3,
            failedToolCalls: 1
          },
          verificationReport: {
            status: 'failed',
            checks: [{ id: 'note-output' }],
            blockers: ['SKU 自选备注缺少导出记录'],
            warnings: []
          }
        }
      }
    }
  ],
  humanReviewRecords: [
    {
      recordVersion: 'human-review-record/v0',
      projectId: 'C-1160',
      scenario: 'main-image',
      status: 'recorded_approved',
      statusLabel: '已记录通过',
      summary: '人工已通过主图复核',
      recordedAt: '2026-05-27T12:00:00.000Z',
      review: { decision: 'approved', reviewer: 'designer', score: 0.92, notes: [] },
      canClaimDesignQuality: false,
      canRunProvider: false,
      canRunPhotoshop: false
    },
    {
      recordVersion: 'human-review-record/v0',
      projectId: 'C-1160',
      scenario: 'sku',
      status: 'recorded_needs_review',
      statusLabel: '已记录待调整',
      summary: 'SKU 需要补自选备注',
      recordedAt: '2026-05-27T12:05:00.000Z',
      review: { decision: 'needs_review', reviewer: 'designer', notes: ['补自选备注'] },
      canClaimDesignQuality: false,
      canRunProvider: false,
      canRunPhotoshop: false
    }
  ],
  generatedAt: '2026-05-27T12:10:00.000Z'
});
const emptyPanelAfterRichPanel = buildDesignResultReviewPanel({
  projectName: 'C-empty',
  isPluginConnected: false,
  ecommerceSummary: {
    byFolderType: { mainImage: 0, detail: 0, sku: 0 }
  },
  messages: [],
  humanReviewRecords: [],
  generatedAt: '2026-05-27T12:11:00.000Z'
});

assert(panel.version === 'design-result-review-panel/v0', 'panel should expose stable version', panel);
assert(panel.canClaimDesignQuality === false, 'review panel must not claim design quality', panel);
assert(panel.canRunProvider === false, 'review panel must not call provider', panel);
assert(panel.canRunAgentRuntime === false, 'review panel must not call Agent runtime', panel);
assert(panel.canRunPhotoshop === false, 'review panel must not run Photoshop', panel);
assert(panel.canRunEagle === false, 'review panel must not run Eagle', panel);
assert(panel.totals.scenarioCount === 3, 'panel should cover main-image, detail-page and SKU', panel.totals);
assert(panel.totals.deliverableCount === 7, 'panel should count main image, detail and SKU deliverables', panel.totals);
assert(emptyPanelAfterRichPanel.scenarios.every((item) => item.businessResult.hasEvidence === false), 'business result summaries must not share mutable arrays across builds', emptyPanelAfterRichPanel);

const mainImage = panel.scenarios.find((item) => item.scenario === 'main-image');
const detailPage = panel.scenarios.find((item) => item.scenario === 'detail-page');
const sku = panel.scenarios.find((item) => item.scenario === 'sku');
assert(mainImage, 'main-image scenario should exist');
assert(detailPage, 'detail-page scenario should exist');
assert(sku, 'sku scenario should exist');
assert(mainImage.status === 'review_recorded', 'main-image should show recorded review without upgrading quality claim', mainImage);
assert(mainImage.humanReview.approved === 1, 'main-image should count approved human review', mainImage.humanReview);
assert(mainImage.evidenceKeys.includes('mainImageQaReport'), 'main-image should consume diagnostic QA evidence keys', mainImage.evidenceKeys);
assert(mainImage.qa.needsReview === 1, 'main-image should expose QA review count', mainImage.qa);
assert(mainImage.businessResult.resultImageCount === 3, 'main-image should expose result image count from QA report', mainImage.businessResult);
assert(mainImage.businessResult.qaStages.includes('needs_manual_review'), 'main-image should expose QA stage evidence', mainImage.businessResult);
assert(mainImage.businessResult.verificationCheckCount === 3, 'main-image should count QA sections and checks without exposing raw payload', mainImage.businessResult);
assert(mainImage.businessResult.requiredNextEvidence.includes('manual review approved'), 'main-image should surface required next evidence', mainImage.businessResult);
assert(detailPage.status === 'needs_review', 'detail-page should enter review when deep business evidence exists', detailPage);
assert(detailPage.businessResult.plannedStepCount === 3, 'detail-page should expose planned step count from designAgentOs', detailPage.businessResult);
assert(detailPage.businessResult.toolCallCount === 5, 'detail-page should expose tool call counts from designAgentOs', detailPage.businessResult);
assert(detailPage.businessResult.requiredNextEvidence.includes('detail-page screenshot review'), 'detail-page should expose readiness next evidence', detailPage.businessResult);
assert(sku.status === 'blocked', 'SKU should be blocked when execution evidence has failed acceptance', sku);
assert(sku.blockers.some((item) => item.includes('SKU 自选备注')), 'SKU blockers should stay visible', sku.blockers);
assert(sku.businessResult.failedToolCalls === 1, 'SKU should expose failed tool call count from designAgentOs', sku.businessResult);
assert(sku.businessResult.verificationCheckCount === 1, 'SKU should expose verification check count', sku.businessResult);

assert(deriveDesignResultReviewScenario('main-image-design') === 'main-image', 'main-image skill should map to main-image scenario');
assert(deriveDesignResultReviewScenario('detail-page-design') === 'detail-page', 'detail-page skill should map to detail-page scenario');
assert(deriveDesignResultReviewScenario('sku-batch') === 'sku', 'sku skill should map to sku scenario');
assert(deriveDesignResultReviewScenario('project-image-analysis') === 'general-design', 'non business skill should map to general design');

const payloadText = JSON.stringify(panel);
for (const forbidden of ['confidence', '置信', 'data:image', 'rawImage', 'base64', 'C:\\tmp']) {
  assert(!payloadText.includes(forbidden), `design result review payload must not expose forbidden marker: ${forbidden}`);
}

const contractSource = read('src/shared/design-result-review-panel.ts');
const workbench = read('src/renderer/components/DesignAgentWorkbench.tsx');
const css = read('src/renderer/components/DesignAgentWorkbench.css');
const packageJson = read('package.json');
const changeBoundaries = read('scripts/report-change-boundaries.cjs');
const maintenance = read('scripts/validate-maintenance-hygiene.cjs');

assert(!workbench.includes('buildDesignResultReviewPanel'), 'Workbench should not mount design result review by default');
assert(!workbench.includes('data-testid="workbench-design-result-review-panel"'), 'Workbench should not expose design result review panel in the default surface');
assert(!workbench.includes('data-testid="workbench-design-result-review-summary"'), 'Workbench should not expose review panel summary in the default surface');
assert(!workbench.includes('window.designEcho'), 'Workbench design result review panel must not call desktop APIs directly');
assert(!workbench.includes('executeToolCall'), 'Workbench design result review panel must not execute tools');
assert(!workbench.includes('processWithUnifiedAgent'), 'Workbench design result review panel must not call Agent runtime');
assert(!css.includes('.design-result-review-panel'), 'Workbench CSS should not keep removed design review panel styles');
assert(!css.includes('.design-result-scenario-list'), 'Workbench CSS should not keep removed design scenario list styles');
assert(contractSource.includes('canClaimDesignQuality: false'), 'contract should keep design quality claim disabled');
assert(contractSource.includes('canRunAgentRuntime: false'), 'contract should keep Agent runtime execution disabled');
assert(contractSource.includes('canRunEagle: false'), 'contract should keep Eagle execution disabled');
assert(packageJson.includes('"smoke:ui:design-result-review-panel"'), 'package script should expose design result review panel smoke');
assert(packageJson.includes('smoke:ui:design-result-review-panel'), 'maintenance preflight should run design result review panel smoke');
assert(changeBoundaries.includes('design-result-review-panel'), 'change boundaries should include design result review panel files');
assert(maintenance.includes('smoke-ui-design-result-review-panel.cjs'), 'maintenance hygiene should run/check design result review panel smoke');
assert(exists('src/shared/design-result-review-panel.ts'), 'design result review panel contract should exist');

console.log(JSON.stringify({
  success: true,
  checks: [
    'design result review panel aggregates project deliverables, diagnostic evidence, QA counts and human review records',
    'main-image, detail-page and SKU are shown as separate business review lanes',
    'panel remains readonly and cannot call providers, Agent runtime or Photoshop',
    'quality boundaries stay explicit; no confidence fields or raw image payloads are exposed',
    'Workbench default surface no longer mounts the review panel; package, maintenance preflight, change boundaries and maintenance hygiene remain wired'
  ]
}, null, 2));
