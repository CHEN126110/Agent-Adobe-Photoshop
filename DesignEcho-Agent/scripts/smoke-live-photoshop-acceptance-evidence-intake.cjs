#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const {
  buildLivePhotoshopAcceptanceEvidenceIntake,
  hasLivePhotoshopAcceptanceEvidenceReady
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'live-photoshop-acceptance-evidence-intake.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function makeLiveArtifact(overrides = {}) {
  return {
    success: true,
    skipped: false,
    mode: 'live-photoshop-deterministic-operations',
    cases: [{
      id: 'layer-order-light-to-dark-live',
      status: 'passed',
      evidence: {
        hasPhotoshopSnapshot: true,
        hasSnapshotDiff: true,
        toolCount: 3,
        changedLayerCount: 2
      }
    }],
    beforeSnapshot: {
      success: true,
      hasDocument: true,
      summary: {
        totalLayers: 3
      }
    },
    afterSnapshot: {
      success: true,
      hasDocument: true,
      summary: {
        totalLayers: 3
      }
    },
    bundle: {
      tools: [{
        name: 'getDocumentInfo',
        success: true
      }, {
        name: 'reorderLayer',
        success: true
      }, {
        name: 'focusLayer',
        success: true,
        focusEvidence: {
          focusedLayer: {
            id: 42,
            name: 'Layer 42'
          },
          viewport: {
            exactPanZoomSupported: false,
            pannedOrZoomed: false
          }
        }
      }]
    },
    liveAssertions: [{
      name: 'layer-order-light-to-dark-verified',
      passed: true
    }, {
      name: 'focus-layer-feedback-present',
      passed: true
    }],
    boundaries: [
      'This runner does not validate open-ended design quality or reference replication fidelity.'
    ],
    ...overrides
  };
}

function runNoArtifactCase() {
  const intake = buildLivePhotoshopAcceptanceEvidenceIntake({
    relativePath: 'tmp/acceptance/agent-live-photoshop-acceptance.json',
    artifactExists: false
  });

  assert(intake.status === 'no_artifact', 'missing artifact should be reported as no_artifact', intake);
  assert(intake.mustNotRunLivePhotoshop === true, 'intake must not run live Photoshop', intake);
  assert(intake.requiredNextEvidence.includes('live_photoshop_acceptance_artifact_required'), 'missing artifact should require live artifact', intake);
  assert(intake.canClaimDesignQuality === false, 'missing artifact cannot claim design quality', intake);
}

function runNonLiveArtifactCase() {
  const intake = buildLivePhotoshopAcceptanceEvidenceIntake({
    artifact: {
      success: true,
      mode: 'desktop-bridge-fake-provider-fake-photoshop',
      cases: []
    }
  });

  assert(intake.status === 'artifact_without_live_mode', 'desktop artifact must not be treated as live evidence', intake);
  assert(intake.requiredNextEvidence.includes('live_photoshop_acceptance_artifact_required'), 'non-live artifact should require live artifact', intake);
}

function runSnapshotOnlyCase() {
  const intake = buildLivePhotoshopAcceptanceEvidenceIntake({
    artifact: makeLiveArtifact({
      bundle: {
        tools: [{
          name: 'getDocumentInfo',
          success: true
        }, {
          name: 'reorderLayer',
          success: true
        }]
      },
      liveAssertions: [{
        name: 'layer-order-light-to-dark-verified',
        passed: true
      }]
    })
  });

  assert(intake.status === 'snapshot_evidence_ready', 'snapshot-only live artifact should be ready but require focus evidence', intake);
  assert(hasLivePhotoshopAcceptanceEvidenceReady(intake) === true, 'snapshot-only live artifact should be evidence-ready for observability', intake);
  assert(intake.requiredNextEvidence.includes('focus_tool_evidence_required'), 'snapshot-only artifact should require focus evidence', intake);
}

function runFocusAndSnapshotCase() {
  const intake = buildLivePhotoshopAcceptanceEvidenceIntake({
    relativePath: 'tmp/acceptance/agent-live-photoshop-acceptance.json',
    artifact: makeLiveArtifact()
  });

  assert(intake.status === 'focus_and_snapshot_evidence_ready', 'focus + snapshot live artifact should be fully ready', intake);
  assert(intake.snapshotEvidence.hasBeforeSnapshot === true, 'before snapshot should be detected', intake);
  assert(intake.snapshotEvidence.hasAfterSnapshot === true, 'after snapshot should be detected', intake);
  assert(intake.snapshotEvidence.hasSnapshotDiff === true, 'snapshot diff should be detected', intake);
  assert(intake.focusEvidence.hasFocusToolEvent === true, 'focus tool event should be detected', intake);
  assert(intake.focusEvidence.exactViewportControlClaimed === false, 'focus evidence must not claim exact viewport control', intake);
  assert(intake.toolEvidence.toolNames.includes('focusLayer'), 'focusLayer should be listed in tool names', intake);
  assert(intake.requiredNextEvidence.includes('manual_review_or_screenshot_required_for_design_quality'), 'quality review boundary should remain required', intake);
  assert(JSON.stringify(intake).includes('provider thinking') === false, 'intake must not present itself as provider thinking', intake);
}

function runBlockedCase() {
  const intake = buildLivePhotoshopAcceptanceEvidenceIntake({
    artifact: makeLiveArtifact({
      success: false,
      preflight: {
        blockers: ['Photoshop UXP plugin is not connected.']
      }
    })
  });

  assert(intake.status === 'failed_or_blocked', 'failed live artifact should be blocked', intake);
  assert(intake.blockers.some((item) => item.includes('preflight_blocker')), 'preflight blocker should be preserved', intake);
}

function runViewportClaimCase() {
  const intake = buildLivePhotoshopAcceptanceEvidenceIntake({
    artifact: makeLiveArtifact({
      bundle: {
        tools: [{
          name: 'focusLayer',
          success: true,
          focusEvidence: {
            viewport: {
              exactPanZoomSupported: true
            }
          }
        }]
      }
    })
  });

  assert(intake.status === 'failed_or_blocked', 'exact viewport focus claim should block intake', intake);
  assert(intake.blockers.includes('focus_evidence_claims_exact_viewport_control'), 'viewport claim blocker should be explicit', intake);
}

function run() {
  runNoArtifactCase();
  runNonLiveArtifactCase();
  runSnapshotOnlyCase();
  runFocusAndSnapshotCase();
  runBlockedCase();
  runViewportClaimCase();

  return {
    success: true,
    checks: [
      'missing artifact stays no_artifact',
      'non-live artifact cannot count as live evidence',
      'snapshot-only artifact is evidence-ready but still requires focus evidence',
      'snapshot plus focus artifact is ready without design-quality overclaim',
      'failed or blocked artifact remains failed_or_blocked',
      'exact viewport pan or zoom claims are rejected'
    ]
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
