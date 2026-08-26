#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const renamePath = path.join(root, "src", "tools", "layout", "rename-layer.ts");
const groupLayersSafelyPath = path.join(
  root,
  "src",
  "tools",
  "layout",
  "group-layers-safely.ts"
);
const reorderLayerPath = path.join(
  root,
  "src",
  "tools",
  "layout",
  "reorder-layer.ts"
);
const createGroupPath = path.join(
  root,
  "src",
  "tools",
  "layout",
  "create-group.ts"
);
const selectLayerPath = path.join(
  root,
  "src",
  "tools",
  "layout",
  "select-layer.ts"
);
const setTextStylePath = path.join(
  root,
  "src",
  "tools",
  "text",
  "set-text-style.ts"
);
const createTextLayerPath = path.join(
  root,
  "src",
  "tools",
  "text",
  "create-text-layer.ts"
);
const setTextContentPath = path.join(
  root,
  "src",
  "tools",
  "text",
  "set-text-content.ts"
);
const moveLayerPath = path.join(
  root,
  "src",
  "tools",
  "layout",
  "move-layer.ts"
);
const layerPropertiesPath = path.join(
  root,
  "src",
  "tools",
  "layer",
  "layer-properties.ts"
);
const placeImagePath = path.join(
  root,
  "src",
  "tools",
  "image",
  "place-image.ts"
);
const transformLayerPath = path.join(
  root,
  "src",
  "tools",
  "layer",
  "transform-layer.ts"
);
const runnerPath = path.join(root, "src", "core", "photoshop-transaction-runner.ts");
const targetGuardPath = path.join(root, "src", "core", "photoshop-target-guard.ts");
const toolErrorNormalizerPath = path.join(root, "src", "core", "tool-error-normalizer.ts");
const source = fs.readFileSync(renamePath, "utf8");
const groupLayersSafelySource = fs.readFileSync(groupLayersSafelyPath, "utf8");
const reorderLayerSource = fs.readFileSync(reorderLayerPath, "utf8");
const createGroupSource = fs.readFileSync(createGroupPath, "utf8");
const selectLayerSource = fs.readFileSync(selectLayerPath, "utf8");
const setTextStyleSource = fs.readFileSync(setTextStylePath, "utf8");
const createTextLayerSource = fs.readFileSync(createTextLayerPath, "utf8");
const setTextContentSource = fs.readFileSync(setTextContentPath, "utf8");
const moveLayerSource = fs.readFileSync(moveLayerPath, "utf8");
const layerPropertiesSource = fs.readFileSync(layerPropertiesPath, "utf8");
const placeImageSource = fs.readFileSync(placeImagePath, "utf8");
const transformLayerSource = fs.readFileSync(transformLayerPath, "utf8");
const runnerSource = fs.readFileSync(runnerPath, "utf8");
const targetGuardSource = fs.readFileSync(targetGuardPath, "utf8");
const toolErrorNormalizerSource = fs.readFileSync(toolErrorNormalizerPath, "utf8");

function sliceClass(className, nextClassName) {
  const start = source.indexOf(`export class ${className}`);
  assert(start >= 0, `${className} must exist`);
  const end = nextClassName
    ? source.indexOf(`export class ${nextClassName}`, start)
    : source.length;
  assert(end > start, `${className} class boundary must be resolvable`);
  return source.slice(start, end);
}

function sliceReorderClass(className, nextClassName) {
  const start = reorderLayerSource.indexOf(`export class ${className}`);
  assert(start >= 0, `${className} must exist in reorder-layer.ts`);
  const end = nextClassName
    ? reorderLayerSource.indexOf(`export class ${nextClassName}`, start)
    : reorderLayerSource.length;
  assert(end > start, `${className} reorder class boundary must be resolvable`);
  return reorderLayerSource.slice(start, end);
}

function sliceLockLayerOwner() {
  const start = layerPropertiesSource.indexOf("type LockLayerLockType");
  assert(start >= 0, "LockLayerTool helper boundary must exist");
  const end = layerPropertiesSource.indexOf(
    "export class GetLayerPropertiesTool",
    start
  );
  assert(end > start, "LockLayerTool owner boundary must be resolvable");
  return layerPropertiesSource.slice(start, end);
}

function sliceLayerPropertiesClass(className, nextClassName) {
  const start = layerPropertiesSource.indexOf(`export class ${className}`);
  assert(start >= 0, `${className} must exist in layer-properties.ts`);
  const end = nextClassName
    ? layerPropertiesSource.indexOf(`export class ${nextClassName}`, start)
    : layerPropertiesSource.length;
  assert(end > start, `${className} layer properties boundary must be resolvable`);
  return layerPropertiesSource.slice(start, end);
}

function sliceTransformClass(className, nextClassName) {
  const start = transformLayerSource.indexOf(`export class ${className}`);
  assert(start >= 0, `${className} must exist in transform-layer.ts`);
  const end = nextClassName
    ? transformLayerSource.indexOf(`export class ${nextClassName}`, start)
    : transformLayerSource.length;
  assert(end > start, `${className} transform boundary must be resolvable`);
  return transformLayerSource.slice(start, end);
}

const renameOwner = sliceClass("RenameLayerTool", "BatchRenameLayersTool");
const batchLegacyOwner = sliceClass("BatchRenameLayersTool");
const reorderOwner = sliceReorderClass(
  "ReorderLayerTool",
  "GroupLayersTool"
);
const genericGroupOwner = sliceReorderClass(
  "GroupLayersTool",
  "UngroupLayersTool"
);
const lockLayerOwner = sliceLockLayerOwner();
const duplicateLayerOwner = sliceLayerPropertiesClass(
  "DuplicateLayerTool",
  "DeleteLayerTool"
);
const quickScaleOwner = sliceTransformClass("QuickScaleTool");

function loadTypeScriptModule(filePath, dependencyMocks = {}) {
  const outputText = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true
    },
    fileName: filePath,
    reportDiagnostics: true
  }).outputText;
  const loadedModule = { exports: {} };
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(dependencyMocks, request)) {
      return dependencyMocks[request];
    }
    return require(request);
  };
  const evaluateModule = new Function(
    "require",
    "module",
    "exports",
    "__filename",
    "__dirname",
    outputText
  );
  evaluateModule(
    localRequire,
    loadedModule,
    loadedModule.exports,
    filePath,
    path.dirname(filePath)
  );
  return loadedModule.exports;
}

async function assertTargetGuardMismatchHasActionableDiagnostics() {
  const toolErrorNormalizer = loadTypeScriptModule(toolErrorNormalizerPath);
  const photoshopMock = {
    app: {
      activeDocument: {
        id: 22,
        activeLayers: [{ id: 5 }]
      }
    }
  };
  const targetGuardModule = loadTypeScriptModule(targetGuardPath, {
    photoshop: photoshopMock,
    "./photoshop-history-state-ref": {
      readActiveHistoryStateRef(document) {
        return { documentId: Number(document.id), historyStateId: 9 };
      },
      sameHistoryStateRef(left, right) {
        return Boolean(
          left
          && right
          && left.documentId === right.documentId
          && left.historyStateId === right.historyStateId
        );
      }
    },
    "./tool-error-normalizer": toolErrorNormalizer
  });
  let executionCount = 0;
  const result = await targetGuardModule.executeToolWithPhotoshopTargetGuard(
    {
      name: "moveLayer",
      schema: { name: "moveLayer", parameters: { type: "object", properties: {} } },
      async execute() {
        executionCount += 1;
        return { success: true };
      }
    },
    {
      layerId: 5,
      __designEchoTargetGuard: {
        expectedDocumentId: 11,
        expectedHistoryStateRef: { documentId: 11, historyStateId: 7 }
      }
    },
    {}
  );

  assert.strictEqual(executionCount, 0, "target mismatch must stop before Tool execution");
  assert.strictEqual(
    result.code,
    "photoshop_target_changed_before_execution",
    "target mismatch normalization must preserve the original machine code"
  );
  for (const field of ["message", "summary"]) {
    assert.strictEqual(
      typeof result[field],
      "string",
      `target mismatch must include a ${field}`
    );
    assert(
      result[field].includes("活动文档已变化")
        && result[field].includes("switchDocument")
        && result[field].includes("getDocumentInfo")
        && result[field].includes("只重试一次"),
      `target mismatch ${field} must state the mismatch and the next action`
    );
  }
}

assert(
  source.includes("from '../../core/photoshop-transaction-runner'"),
  "RenameLayerTool must import the canonical Photoshop transaction runner"
);
assert(
  renameOwner.includes("photoshopTransactionRunner.run"),
  "RenameLayerTool must delegate transaction ownership to photoshopTransactionRunner"
);
assert(
  !/\b(?:core\.)?executeAsModal\s*\(/.test(renameOwner),
  "RenameLayerTool must not own executeAsModal"
);
assert(
  !renameOwner.includes("hostControl.suspendHistory"),
  "RenameLayerTool must not own suspendHistory"
);
assert(
  !renameOwner.includes("hostControl.resumeHistory"),
  "RenameLayerTool must not own commit or rollback"
);
assert(
  !renameOwner.includes("rollbackSuspendedHistory(")
    && !renameOwner.includes("rollbackFailure("),
  "RenameLayerTool must not implement a private rollback state machine"
);
assert(
  renameOwner.includes("verifyRolledBack"),
  "RenameLayerTool may declare its business rollback postcondition for the runner to verify"
);

assert(
  /\bcore\.executeAsModal\s*\(/.test(batchLegacyOwner),
  "BatchRenameLayersTool must remain explicitly visible as a legacy direct modal owner"
);
assert(
  !batchLegacyOwner.includes("photoshopTransactionRunner.run"),
  "BatchRenameLayersTool must not be falsely reported as migrated"
);

assert(
  groupLayersSafelySource.includes("photoshopTransactionRunner.run"),
  "GroupLayersSafelyTool must delegate transaction ownership to photoshopTransactionRunner"
);
assert(
  !/\b(?:core\.)?executeAsModal\s*\(/.test(groupLayersSafelySource),
  "GroupLayersSafelyTool must not own executeAsModal"
);
assert(
  !groupLayersSafelySource.includes("hostControl.suspendHistory")
    && !groupLayersSafelySource.includes("hostControl.resumeHistory"),
  "GroupLayersSafelyTool must not own history commit or rollback"
);
assert(
  !groupLayersSafelySource.includes("rollbackSuspendedHistory(")
    && !groupLayersSafelySource.includes("HistoryCommitOutcomeUnknownError")
    && !groupLayersSafelySource.includes("SuspendedHistoryRollbackError"),
  "GroupLayersSafelyTool must not keep its previous private transaction state machine"
);
assert(
  groupLayersSafelySource.includes("requiredBinding: 'document_revision'"),
  "GroupLayersSafelyTool must require a document revision binding through the runner"
);
assert(
  groupLayersSafelySource.includes("rollbackTargetPolicy: 'document_revision'"),
  "structural rollback must require document/history restoration without assuming selection restoration"
);
assert(
  genericGroupOwner.includes("executeVerifiedGroupCreation"),
  "GroupLayersTool must reuse the verified group creation transaction"
);
assert(
  !/\b(?:core\.)?executeAsModal\s*\(/.test(genericGroupOwner),
  "GroupLayersTool must not own executeAsModal"
);
assert(
  createGroupSource.includes("photoshopTransactionRunner.run"),
  "CreateGroupTool must delegate transaction ownership to photoshopTransactionRunner"
);
assert(
  createGroupSource.includes("historyMode: 'suspend'")
    && createGroupSource.includes("verifyApplied")
    && createGroupSource.includes("verifyRolledBack")
    && createGroupSource.includes("buildVerifiedResult"),
  "CreateGroupTool must verify real child ids and rollback through the runner"
);
assert(
  createGroupSource.includes("sameNumberSet(after.childIds, before.expectedChildIds)"),
  "CreateGroupTool must compare requested and actual group children"
);
assert(
  reorderOwner.includes("photoshopTransactionRunner.run")
    && reorderOwner.includes("verifyApplied")
    && reorderOwner.includes("verifyRolledBack")
    && reorderOwner.includes("buildVerifiedResult"),
  "ReorderLayerTool must verify actual sibling order and rollback through the runner"
);
assert(
  !/\b(?:core\.)?executeAsModal\s*\(/.test(reorderOwner),
  "ReorderLayerTool must not own executeAsModal"
);
assert(
  selectLayerSource.includes("sameLayerIdSet(expectedSelectedIds, actualSelectedIds)"),
  "SelectLayerTool must compare requested and actual active layer ids"
);

assert(
  setTextStyleSource.includes("from '../../core/photoshop-transaction-runner'"),
  "SetTextStyleTool must import the canonical Photoshop transaction runner"
);
assert(
  setTextStyleSource.includes("photoshopTransactionRunner.run"),
  "SetTextStyleTool must delegate transaction ownership to photoshopTransactionRunner"
);
assert(
  !/\b(?:core\.)?executeAsModal\s*\(/.test(setTextStyleSource),
  "SetTextStyleTool must not own executeAsModal"
);
assert(
  !setTextStyleSource.includes("hostControl.suspendHistory")
    && !setTextStyleSource.includes("hostControl.resumeHistory"),
  "SetTextStyleTool must not own history commit or rollback"
);
assert(
  setTextStyleSource.includes("verifyApplied")
    && setTextStyleSource.includes("verifyRolledBack"),
  "SetTextStyleTool must declare same-target apply and rollback verification"
);
assert(
  setTextStyleSource.includes("before.ranges.map"),
  "SetTextStyleTool must patch every existing textStyleRange instead of flattening text"
);
assert(
  !setTextStyleSource.includes("_enum: 'ordinal'"),
  "SetTextStyleTool must target the stable layer id without selecting targetEnum"
);

assert(
  createTextLayerSource.includes("photoshopTransactionRunner.run")
    && createTextLayerSource.includes("historyMode: 'suspend'")
    && createTextLayerSource.includes("verifyApplied")
    && createTextLayerSource.includes("verifyRolledBack")
    && createTextLayerSource.includes("buildVerifiedResult"),
  "CreateTextLayerTool must verify the new live text layer and delegate rollback"
);
assert(
  createTextLayerSource.includes("layer.content === before.expectedContent")
    && createTextLayerSource.includes("readCreatedTextLayerState")
    && createTextLayerSource.includes("layer.bounds.width > 0")
    && createTextLayerSource.includes("layer.bounds.height > 0"),
  "CreateTextLayerTool must read back actual text content and non-empty bounds"
);
assert(
  !/\b(?:core\.)?executeAsModal\s*\(/.test(createTextLayerSource),
  "CreateTextLayerTool must not own executeAsModal"
);

assert(
  setTextContentSource.includes("photoshopTransactionRunner.run")
    && setTextContentSource.includes("historyMode: 'suspend'")
    && setTextContentSource.includes("verifyApplied")
    && setTextContentSource.includes("verifyRolledBack")
    && setTextContentSource.includes("buildVerifiedResult"),
  "SetTextContentTool must verify live content and delegate rollback"
);
assert(
  setTextContentSource.includes("before.updates.filter((update, index)")
    && setTextContentSource.includes("live.content !== update.newContent")
    && setTextContentSource.includes("live.content !== update.previousNormalizedContent"),
  "SetTextContentTool must verify every batch target and verify rollback content"
);
assert(
  setTextContentSource.includes("content: this.normalizeContent(layer.textItem.contents || '')"),
  "SetTextContentTool readback must come from each live Photoshop text layer"
);
assert(
  !/\b(?:core\.)?executeAsModal\s*\(/.test(setTextContentSource),
  "SetTextContentTool must not own executeAsModal"
);

assert(
  moveLayerSource.includes("from '../../core/photoshop-transaction-runner'"),
  "MoveLayerTool must import the canonical Photoshop transaction runner"
);
assert(
  moveLayerSource.includes("photoshopTransactionRunner.run"),
  "MoveLayerTool must delegate transaction ownership to photoshopTransactionRunner"
);
assert(
  !/\b(?:core\.)?executeAsModal\s*\(/.test(moveLayerSource),
  "MoveLayerTool must not own executeAsModal"
);
assert(
  !moveLayerSource.includes("hostControl.suspendHistory")
    && !moveLayerSource.includes("hostControl.resumeHistory"),
  "MoveLayerTool must not own history commit or rollback"
);
assert(
  moveLayerSource.includes("historyMode: 'suspend'")
    && moveLayerSource.includes("requiredBinding: 'document_revision'")
    && moveLayerSource.includes("rollbackTargetPolicy: 'document_revision'"),
  "MoveLayerTool must bind document revision and delegate suspended-history rollback"
);
assert(
  moveLayerSource.includes("historyStateId: boundHistoryStateId"),
  "MoveLayerTool prepare state must bind the target history revision"
);
assert(
  moveLayerSource.includes("verifyApplied")
    && moveLayerSource.includes("verifyRolledBack")
    && moveLayerSource.includes("buildVerifiedResult"),
  "MoveLayerTool must declare operation-specific apply, rollback, and verified-result readback"
);
assert(
  !moveLayerSource.includes("diagnosePhotoshopState")
    && !moveLayerSource.includes("function moveError")
    && !moveLayerSource.includes("normalizePhotoshopToolError")
    && !moveLayerSource.includes("wrapToolExecutionError"),
  "MoveLayerTool must not keep its former private execution/result owner"
);

assert(
  layerPropertiesSource.includes("from '../../core/photoshop-transaction-runner'"),
  "LockLayerTool must import the canonical Photoshop transaction runner"
);
assert(
  lockLayerOwner.includes("photoshopTransactionRunner.run"),
  "LockLayerTool must delegate transaction ownership to photoshopTransactionRunner"
);
assert(
  !/\b(?:core\.)?executeAsModal\s*\(/.test(lockLayerOwner),
  "LockLayerTool must not own executeAsModal"
);
assert(
  !lockLayerOwner.includes(".allLocked =")
    && !lockLayerOwner.includes(".positionLocked =")
    && !lockLayerOwner.includes(".transparentPixelsLocked ="),
  "LockLayerTool must not use active-target DOM lock setters"
);
assert(
  lockLayerOwner.includes("_obj: 'applyLocking'")
    && lockLayerOwner.includes("{ _ref: 'layer', _id: before.layerId }")
    && lockLayerOwner.includes("{ _ref: 'document', _id: before.documentId }"),
  "LockLayerTool must apply locking by explicit layer and document ids"
);
assert(
  lockLayerOwner.includes("_obj: 'get'")
    && lockLayerOwner.includes("{ _ref: 'layer', _id: layerId }")
    && lockLayerOwner.includes("{ _ref: 'document', _id: documentId }"),
  "LockLayerTool readback must target the same explicit layer and document ids"
);
assert(
  lockLayerOwner.includes("historyMode: 'suspend'")
    && lockLayerOwner.includes("requiredBinding: 'document_revision'")
    && lockLayerOwner.includes("rollbackTargetPolicy: 'document_revision'"),
  "LockLayerTool must bind document revision and delegate history rollback"
);
assert(
  lockLayerOwner.includes("effect: 'already_satisfied'")
    && lockLayerOwner.includes("verifyApplied")
    && lockLayerOwner.includes("verifyRolledBack")
    && lockLayerOwner.includes("buildVerifiedResult"),
  "LockLayerTool must support idempotency and operation-specific readback verification"
);
assert(
  !lockLayerOwner.includes("JSON.stringify"),
  "LockLayerTool must return a structured object instead of a JSON string"
);

assert(
  placeImageSource.includes("photoshopTransactionRunner.run")
    && placeImageSource.includes("historyMode: 'suspend'")
    && placeImageSource.includes("verifyApplied")
    && placeImageSource.includes("verifyRolledBack")
    && placeImageSource.includes("buildVerifiedResult"),
  "PlaceImageTool must verify a new layer with non-empty bounds and delegate rollback"
);
assert(
  placeImageSource.includes("Boolean(placedLayer.bounds)")
    && placeImageSource.includes("width <= 0 || height <= 0"),
  "PlaceImageTool must reject missing or empty readback bounds"
);
assert(
  !/\b(?:core\.)?executeAsModal\s*\(/.test(placeImageSource),
  "PlaceImageTool must not own executeAsModal"
);

assert(
  duplicateLayerOwner.includes("photoshopTransactionRunner.run")
    && duplicateLayerOwner.includes("verifyApplied")
    && duplicateLayerOwner.includes("verifyRolledBack")
    && duplicateLayerOwner.includes("buildVerifiedResult"),
  "DuplicateLayerTool must verify the real duplicated layer and delegate rollback"
);
assert(
  !duplicateLayerOwner.includes("JSON.stringify")
    && duplicateLayerOwner.includes("(duplicate as DuplicateLayerState).subtreeLayerIds")
    && duplicateLayerOwner.includes("sameDuplicateGeometry"),
  "DuplicateLayerTool must return structured readback and verify identity or geometry"
);
assert(
  !/\b(?:core\.)?executeAsModal\s*\(/.test(duplicateLayerOwner),
  "DuplicateLayerTool must not own executeAsModal"
);

assert(
  quickScaleOwner.includes("photoshopTransactionRunner.run")
    && quickScaleOwner.includes("verifyQuickScaleRatio")
    && quickScaleOwner.includes("verifyApplied")
    && quickScaleOwner.includes("verifyRolledBack")
    && quickScaleOwner.includes("buildVerifiedResult"),
  "QuickScaleTool must verify the actual bounds ratio and delegate rollback"
);
assert(
  quickScaleOwner.includes("percent <= 0")
    && !quickScaleOwner.includes("params.percent || 100"),
  "QuickScaleTool must reject zero/negative percent instead of silently replacing it with 100"
);
assert(
  !/\b(?:core\.)?executeAsModal\s*\(/.test(quickScaleOwner),
  "QuickScaleTool must not own executeAsModal"
);

assert(
  runnerSource.includes("export class PhotoshopTransactionRunner"),
  "canonical runner class must exist"
);
assert(
  runnerSource.includes("export const photoshopTransactionRunner = new PhotoshopTransactionRunner()"),
  "canonical singleton runner must exist"
);
assert(
  runnerSource.includes("core.executeAsModal"),
  "canonical runner must own the migrated action modal"
);
assert(
  runnerSource.includes("hostControl.suspendHistory")
    && runnerSource.includes("hostControl.resumeHistory"),
  "canonical runner must own history commit and rollback"
);
assert(
  (targetGuardSource.match(/ensurePhotoshopToolFailureDiagnostics\s*\(/g) || []).length >= 2,
  "public Photoshop target guard must normalize both guarded and unguarded tool results"
);
const failureFactoryStart = toolErrorNormalizerSource.indexOf(
  "export function createToolFailureResult"
);
const failureFactoryEnd = toolErrorNormalizerSource.indexOf(
  "export function ensurePhotoshopToolFailureDiagnostics",
  failureFactoryStart
);
assert(
  failureFactoryStart >= 0
    && failureFactoryEnd > failureFactoryStart
    && toolErrorNormalizerSource
      .slice(failureFactoryStart, failureFactoryEnd)
      .includes("code: normalized.category")
    && toolErrorNormalizerSource
      .slice(failureFactoryStart, failureFactoryEnd)
      .includes("summary: actionableSummary"),
  "createToolFailureResult must include a top-level code and human summary"
);

async function main() {
  await assertTargetGuardMismatchHasActionableDiagnostics();
  console.log(JSON.stringify({
  success: true,
  migratedOwners: [
    "RenameLayerTool",
    "GroupLayersSafelyTool",
    "CreateGroupTool",
    "GroupLayersTool",
    "ReorderLayerTool",
    "SelectLayerTool(readback-only)",
    "PlaceImageTool",
    "DuplicateLayerTool",
    "QuickScaleTool",
    "CreateTextLayerTool",
    "SetTextContentTool",
    "SetTextStyleTool",
    "MoveLayerTool",
    "LockLayerTool"
  ],
  legacyOwners: ["BatchRenameLayersTool"],
  checks: [
    "RenameLayerTool delegates to photoshopTransactionRunner",
    "RenameLayerTool owns no modal/history transaction policy",
    "RenameLayerTool only declares rollback verification",
    "GroupLayersSafelyTool delegates modal/history ownership to the runner",
    "GroupLayersSafelyTool keeps structural verification but no private transaction state machine",
    "GroupLayersSafelyTool requires document_revision binding",
    "CreateGroupTool verifies the created group and exact child ids",
    "GroupLayersTool reuses verified group creation instead of owning a second modal path",
    "ReorderLayerTool verifies the actual sibling order and delegates rollback",
    "SelectLayerTool reads back and compares active layer ids",
    "PlaceImageTool verifies one new layer with non-empty bounds and delegates rollback",
    "DuplicateLayerTool returns a verified structured layer result",
    "QuickScaleTool rejects zero percent and verifies actual bounds ratio",
    "CreateTextLayerTool verifies actual text content, position, and bounds",
    "SetTextContentTool reads back every target and verifies rollback content",
    "SetTextStyleTool delegates transaction ownership to the runner",
    "SetTextStyleTool preserves existing ranges and verifies apply/rollback",
    "SetTextStyleTool writes by stable layer id without selection side effects",
    "MoveLayerTool delegates modal/history/result ownership to the runner",
    "MoveLayerTool binds target revision and verifies apply/rollback readback",
    "LockLayerTool uses explicit-id applyLocking with explicit-id readback",
    "LockLayerTool delegates modal/history ownership and verifies apply/rollback",
    "BatchRenameLayersTool remains explicitly legacy",
    "Photoshop target guard normalizes guarded, unguarded, and target-mismatch failures",
    "Tool failure factory returns a top-level code and summary",
    "PhotoshopTransactionRunner owns modal, commit, and rollback"
  ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
