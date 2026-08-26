"use strict";

const crypto = require("crypto");
const path = require("path");

const CASE_VERSION = "design-reliability-case/v1";
const RUN_VERSION = "design-reliability-run/v1";
const REVIEW_VERSION = "design-reliability-human-review/v1";
const ATTRIBUTION_VERSION = "design-reliability-attribution/v1";
const COHORT_VERSION = "design-reliability-cohort/v1";

const TASK_FAMILIES = Object.freeze(["main_image", "detail_page", "sku"]);
const EXECUTION_MODELS = Object.freeze(["agentic", "staged"]);
const REVIEW_DECISIONS = Object.freeze(["pass", "needs_fix", "unscorable"]);
const ATTRIBUTION_STATUSES = Object.freeze(["hypothesis", "confirmed", "rejected"]);
const ATTRIBUTION_OWNERS = Object.freeze([
  "case_fixture",
  "model_judgment",
  "harness_context",
  "harness_control",
  "skill",
  "tool_contract",
  "tool_implementation",
  "photoshop_environment",
  "model_provider",
  "evaluation",
  "user_input",
  "unknown"
]);
const FAILURE_MODES = Object.freeze([
  "task_understanding",
  "fact_grounding",
  "reference_grounding",
  "asset_selection",
  "design_strategy",
  "geometry",
  "execution",
  "readback",
  "recovery",
  "interaction",
  "delivery",
  "provider",
  "measurement",
  "unknown"
]);

const VISUAL_READBACK_TOOLS = new Set([
  "getDocumentSnapshot",
  "getCanvasSnapshot",
  "getAnnotatedSnapshot"
]);
const STRUCTURE_READBACK_TOOLS = new Set([
  "getAcceptanceSnapshot",
  "getLayerHierarchy"
]);
const SAVE_TOOLS = new Set([
  "saveDocument"
]);
const EXPORT_TOOLS = new Set([
  "exportMainImageDocuments"
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJson(value[key]);
  }
  return sorted;
}

function stableStringify(value) {
  return JSON.stringify(sortJson(value));
}

function sha256Text(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value), "utf8").digest("hex")}`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildCaseDigest(caseSpec) {
  const digestInput = cloneJson(caseSpec);
  delete digestInput.caseDigest;
  // `loadSuite()` attaches this development-only locator after the persisted
  // Case has already been validated. It is not part of the Case contract and
  // must never make the same Case acquire a machine-specific digest.
  delete digestInput.__file;
  return sha256Text(stableStringify(digestInput));
}

function isAbsoluteOrUnsafeRef(value) {
  const ref = cleanString(value);
  if (!ref) return true;
  if (ref.startsWith("eagle:item:")) return false;
  if (/^[a-z]+:\/\//i.test(ref)) return true;
  if (/^[a-z]:[\\/]/i.test(ref) || ref.startsWith("\\\\") || ref.startsWith("/")) return true;
  const normalized = ref.replace(/\\/g, "/");
  return normalized.split("/").includes("..");
}

function validateInputRef(input, fieldName, errors) {
  if (!isRecord(input)) {
    errors.push(`${fieldName} 必须是对象。`);
    return;
  }
  if (isAbsoluteOrUnsafeRef(input.ref)) {
    errors.push(`${fieldName}.ref 必须是安全的 fixture 相对路径，不能保存绝对路径或 URL。`);
  }
  if (!cleanString(input.role)) {
    errors.push(`${fieldName}.role 不能为空。`);
  }
}

function validateReviewRef(input, fieldName, errors) {
  if (!isRecord(input)) {
    errors.push(`${fieldName} 必须是对象。`);
    return;
  }
  const kind = cleanString(input.kind);
  const ref = cleanString(input.ref);
  if (!kind || !ref) {
    errors.push(`${fieldName} 需要 kind 与 ref。`);
    return;
  }
  if (kind === "eagle_item") {
    if (!ref.startsWith("eagle:item:")) {
      errors.push(`${fieldName}.ref 必须使用 eagle:item:<id>。`);
    }
    return;
  }
  if (isAbsoluteOrUnsafeRef(ref)) {
    errors.push(`${fieldName}.ref 必须是安全的相对引用。`);
  }
}

function validateDesignReliabilityCase(caseSpec) {
  const errors = [];
  const warnings = [];
  if (!isRecord(caseSpec)) {
    return { ok: false, errors: ["Case 不是对象。"], warnings };
  }
  if (caseSpec.version !== CASE_VERSION) errors.push(`version 必须是 ${CASE_VERSION}。`);
  if (!cleanString(caseSpec.suiteId)) errors.push("suiteId 不能为空。");
  if (!cleanString(caseSpec.caseId)) errors.push("caseId 不能为空。");
  if (!Number.isInteger(caseSpec.revision) || caseSpec.revision < 1) errors.push("revision 必须是正整数。");
  if (caseSpec.status !== "active" && caseSpec.status !== "draft" && caseSpec.status !== "retired") {
    errors.push("status 必须是 active、draft 或 retired。");
  }
  if (!TASK_FAMILIES.includes(caseSpec.taskFamily)) errors.push("taskFamily 非法。");
  if (!EXECUTION_MODELS.includes(caseSpec.executionModel)) errors.push("executionModel 非法。");
  if (!isRecord(caseSpec.skillContract)) {
    errors.push("skillContract 缺失。");
  } else {
    if (!cleanString(caseSpec.skillContract.userFacingSkillId)) {
      errors.push("skillContract.userFacingSkillId 不能为空。");
    }
    if (!Array.isArray(caseSpec.skillContract.runtimeSkillIds)
      || caseSpec.skillContract.runtimeSkillIds.filter(cleanString).length === 0) {
      errors.push("skillContract.runtimeSkillIds 至少需要一个 Runtime Skill id。");
    }
  }
  if (!isRecord(caseSpec.task)) {
    errors.push("task 缺失。");
  } else {
    const instruction = cleanString(caseSpec.task.instruction);
    if (!instruction) errors.push("task.instruction 不能为空。");
    if (instruction.length > 200) errors.push("task.instruction 必须保持为自然、简短的用户请求（不超过 200 字）。");
    if (caseSpec.task.instructionStyle !== "natural_user_request") {
      errors.push("task.instructionStyle 必须是 natural_user_request。");
    }
    if (!cleanString(caseSpec.task.fixtureId)) errors.push("task.fixtureId 不能为空。");
    if (!Array.isArray(caseSpec.task.agentVisibleInputs)) {
      errors.push("task.agentVisibleInputs 必须是数组。");
    } else {
      caseSpec.task.agentVisibleInputs.forEach((item, index) => {
        validateInputRef(item, `task.agentVisibleInputs[${index}]`, errors);
      });
      if (caseSpec.status === "active" && caseSpec.task.agentVisibleInputs.length === 0) {
        errors.push("active Case 至少需要一个 Agent 可见输入。 ");
      }
    }
    if (!Array.isArray(caseSpec.task.reviewOnlyReferences)) {
      errors.push("task.reviewOnlyReferences 必须是数组。");
    } else {
      caseSpec.task.reviewOnlyReferences.forEach((item, index) => {
        validateReviewRef(item, `task.reviewOnlyReferences[${index}]`, errors);
      });
    }
  }
  if (!isRecord(caseSpec.oracle)) {
    errors.push("oracle 缺失。");
  } else {
    if (!cleanString(caseSpec.oracle.rubricId)) errors.push("oracle.rubricId 不能为空。");
    if (!Array.isArray(caseSpec.oracle.requiredEvidence) || caseSpec.oracle.requiredEvidence.length === 0) {
      errors.push("oracle.requiredEvidence 至少需要一项。 ");
    }
    if (!Array.isArray(caseSpec.oracle.invariants) || caseSpec.oracle.invariants.length === 0) {
      errors.push("oracle.invariants 至少需要一项。 ");
    }
    if (!Array.isArray(caseSpec.oracle.forbiddenBehaviors) || caseSpec.oracle.forbiddenBehaviors.length === 0) {
      errors.push("oracle.forbiddenBehaviors 至少需要一项。 ");
    }
    if (!Array.isArray(caseSpec.oracle.machineChecks) || caseSpec.oracle.machineChecks.length === 0) {
      errors.push("oracle.machineChecks 至少需要一项。 ");
    }
  }
  if (!isRecord(caseSpec.boundaries)
    || caseSpec.boundaries.devBenchmarkOnly !== true
    || caseSpec.boundaries.neverAffectsRuntime !== true
    || caseSpec.boundaries.reviewOnlyReferencesExcludedFromAgentContext !== true) {
    errors.push("Case 缺少 devBenchmarkOnly / neverAffectsRuntime / reviewOnlyReferencesExcludedFromAgentContext 边界。 ");
  }
  const expectedDigest = buildCaseDigest(caseSpec);
  if (cleanString(caseSpec.caseDigest) !== expectedDigest) {
    errors.push(`caseDigest 不匹配；期望 ${expectedDigest}。`);
  }
  if (caseSpec.status !== "active") warnings.push(`Case ${cleanString(caseSpec.caseId) || "unknown"} 当前不是 active。`);
  return { ok: errors.length === 0, errors, warnings, expectedDigest };
}

function hasObservedMutation(call) {
  if (!isRecord(call) || call.activityClass !== "mutation") return false;
  return call.photoshopMutationCommit?.mutationObserved === true
    || call.photoshopHistoryTransition?.mutationObserved === true;
}

function hasCommittedMutation(call) {
  if (!hasObservedMutation(call)) return false;
  const commit = call.photoshopMutationCommit;
  if (isRecord(commit)
    && commit.toolActionCompleted === true
    && commit.mutationObserved === true) {
    return true;
  }

  // The production runtime intentionally accepts a successful tool result plus an observed
  // Photoshop history transition as a completed mutation proof when a same-modal commit receipt
  // is unavailable (see readObservedPhotoshopMutationProof). The dev evaluator must use the same
  // fact semantics; otherwise it reports committedMutationCalls=0 for a document whose history
  // advanced and whose write tool returned success, as happened in the r11 live run.
  const transition = call.photoshopHistoryTransition;
  return call.success === true
    && isRecord(transition)
    && transition.mutationObserved === true
    && Number.isInteger(transition.before?.documentId)
    && Number.isInteger(transition.before?.historyStateId)
    && Number.isInteger(transition.after?.documentId)
    && Number.isInteger(transition.after?.historyStateId);
}

function parseTime(value) {
  const parsed = Date.parse(cleanString(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function recordStartTime(record) {
  const issuedAt = parseTime(record?.runtimeSession?.issuedAt);
  if (issuedAt !== null) return issuedAt;
  const endedAt = parseTime(record?.endedAt);
  const elapsedValues = (Array.isArray(record?.toolCalls) ? record.toolCalls : [])
    .map((call) => call?.elapsedMs)
    .filter(isFiniteNumber);
  if (endedAt === null || elapsedValues.length === 0) return endedAt;
  return endedAt - Math.max(...elapsedValues);
}

function normalizePathIdentity(value) {
  const normalized = cleanString(value)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function readTaskRunId(record) {
  return cleanString(record?.runtimeSession?.taskRun?.taskRunId)
    || cleanString(record?.runtimeSession?.taskRunId);
}

function validateAgentRunRecordChain(records, options = {}) {
  const errors = [];
  if (!Array.isArray(records) || records.length === 0) {
    return { ok: false, errors: ["RunRecord 链为空。"] };
  }

  const ids = records.map((record) => cleanString(record?.runId));
  if (ids.some((id) => !id)) errors.push("RunRecord 链存在空 runId。");
  if (new Set(ids).size !== ids.length) errors.push("RunRecord 链存在重复 runId。");

  const expectedGoal = cleanString(options.expectedGoal);
  const goals = [...new Set(records.map((record) => cleanString(record?.goal)))];
  if (goals.length !== 1 || !goals[0]) errors.push("RunRecord 链的 goal 不唯一或为空。");
  if (expectedGoal && (goals.length !== 1 || goals[0] !== expectedGoal)) {
    errors.push("RunRecord 链的 goal 与固定 Case 指令不一致。");
  }

  const projectPaths = records
    .map((record) => normalizePathIdentity(record?.projectPath))
    .filter(Boolean);
  if (new Set(projectPaths).size > 1) errors.push("RunRecord 链跨越了多个项目目录。");
  const expectedProjectPath = normalizePathIdentity(options.expectedProjectPath);
  if (expectedProjectPath && (
    projectPaths.length !== records.length
    || projectPaths.some((projectPath) => projectPath !== expectedProjectPath)
  )) {
    errors.push("RunRecord 链没有全部绑定到本次 fixture 项目目录。");
  }

  const conversationKeys = records.map((record) => {
    const conversationId = cleanString(record?.conversationScope?.conversationId);
    const branchId = cleanString(record?.conversationScope?.branchId);
    return conversationId && branchId ? `${conversationId}\u0000${branchId}` : "";
  });
  const knownConversationKeys = conversationKeys.filter(Boolean);
  if (new Set(knownConversationKeys).size > 1) errors.push("RunRecord 链跨越了多个对话或分支。");
  if (records.length > 1 && knownConversationKeys.length !== records.length) {
    errors.push("多代 RunRecord 缺少完整 conversationScope，无法证明属于同一请求。");
  }

  const taskRunIds = records.map(readTaskRunId).filter(Boolean);
  if (new Set(taskRunIds).size > 1) errors.push("RunRecord 链包含多个 taskRunId。");
  if (taskRunIds.length > 0 && taskRunIds.length !== records.length) {
    errors.push("RunRecord 链混合了有 TaskRun 与无 TaskRun 的记录。");
  }
  const sessionIds = records
    .map((record) => cleanString(record?.runtimeSession?.sessionId))
    .filter(Boolean);
  if (new Set(sessionIds).size > 1) errors.push("RunRecord 链包含多个 Runtime Session。");

  if (records.length > 1 && ids.every(Boolean) && new Set(ids).size === ids.length) {
    const idSet = new Set(ids);
    const childrenByParent = new Map();
    const roots = [];
    for (const record of records) {
      const runId = cleanString(record.runId);
      const parentRunId = cleanString(record.parentRunId);
      if (!parentRunId) {
        roots.push(runId);
        continue;
      }
      if (!idSet.has(parentRunId)) {
        errors.push(`RunRecord ${runId} 的 parentRunId 不在本次完整链中。`);
        continue;
      }
      const children = childrenByParent.get(parentRunId) || [];
      children.push(runId);
      childrenByParent.set(parentRunId, children);
      if (children.length > 1) errors.push(`RunRecord 链在 ${parentRunId} 处分叉。`);
    }
    if (roots.length !== 1) errors.push(`RunRecord 链必须且只能有一个根，实际为 ${roots.length} 个。`);
    if (roots.length === 1) {
      const visited = new Set();
      let current = roots[0];
      while (current && !visited.has(current)) {
        visited.add(current);
        current = (childrenByParent.get(current) || [])[0];
      }
      if (current) errors.push("RunRecord parentRunId 链存在环。");
      if (visited.size !== records.length) errors.push("RunRecord parentRunId 链不连续。");
    }
  }

  const generations = records
    .map((record) => record?.runtimeSession?.generation)
    .filter((value) => Number.isInteger(value));
  if (generations.length > 0 && generations.length !== records.length) {
    errors.push("RunRecord 链混合了有 generation 与无 generation 的记录。");
  }
  if (new Set(generations).size !== generations.length) {
    errors.push("RunRecord 链的 Runtime generation 重复。");
  }

  return {
    ok: errors.length === 0,
    errors,
    identityKind: taskRunIds.length === records.length ? "task_run" : "agentic_parent_chain"
  };
}

function flattenRunRecords(records) {
  const sortedRecords = [...records].sort((left, right) => {
    const leftTime = parseTime(left?.endedAt) ?? 0;
    const rightTime = parseTime(right?.endedAt) ?? 0;
    return leftTime - rightTime;
  });
  const flattened = [];
  sortedRecords.forEach((record, turnIndex) => {
    const startTime = recordStartTime(record);
    const toolCalls = Array.isArray(record?.toolCalls) ? record.toolCalls : [];
    toolCalls.forEach((call, callIndex) => {
      const absoluteTime = startTime !== null && isFiniteNumber(call?.elapsedMs)
        ? startTime + call.elapsedMs
        : null;
      flattened.push({
        record,
        call,
        turnIndex,
        callIndex,
        ordinal: flattened.length,
        absoluteTime
      });
    });
  });
  return { sortedRecords, calls: flattened };
}

function readCumulativePerformanceIterations(record) {
  const runtimeSessionValue = record?.runtimeSession?.accounting?.performanceUsage?.iterations;
  const standaloneValue = record?.runtimeAccounting?.performanceUsage?.iterations;
  const value = Number.isSafeInteger(runtimeSessionValue)
    ? runtimeSessionValue
    : standaloneValue;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * Current Runtime performanceUsage is monotonic across Agent generations, so the final
 * snapshot already contains the whole TaskRun. Legacy RunRecords lack that versioned
 * cumulative field and retain their historical per-generation sum behavior.
 */
function resolveTaskRunIterations(sortedRecords) {
  const cumulativeIterations = readCumulativePerformanceIterations(sortedRecords.at(-1));
  if (cumulativeIterations !== null) return cumulativeIterations;
  return sortedRecords.reduce((sum, record) => {
    const value = record?.iterations;
    return sum + (Number.isSafeInteger(value) && value >= 0 ? value : 0);
  }, 0);
}

function readActualSkillIds(records, calls, expectedSkillIds) {
  const values = new Set();
  for (const record of records) {
    const runtimeSkillId = cleanString(record?.runtimeSession?.skillId);
    if (runtimeSkillId) values.add(runtimeSkillId);
    const runtimeContractStatus = record?.runtimeContractStatus;
    const resolvedRuntimeContract = runtimeContractStatus?.version === "runtime-contract-status/v0"
      && runtimeContractStatus?.status === "resolved"
      && runtimeContractStatus?.boundaries?.doesNotExecuteSkill === true
      && runtimeContractStatus?.boundaries?.doesNotGrantToolPermission === true;
    if (resolvedRuntimeContract) {
      const selectedSkillId = cleanString(runtimeContractStatus.selectedSkillId);
      const manifestSkillId = cleanString(runtimeContractStatus.manifestSkillId);
      if (selectedSkillId) values.add(selectedSkillId);
      if (manifestSkillId) values.add(manifestSkillId);
    }
  }
  for (const entry of calls) {
    const toolName = cleanString(entry?.call?.name);
    if (toolName && expectedSkillIds.includes(toolName)) values.add(toolName);
  }
  return [...values].sort();
}

function buildSourceRunRef(record) {
  const runtimeSession = record?.runtimeSession;
  return {
    agentRunId: cleanString(record?.runId),
    ...(cleanString(record?.parentRunId) ? { parentRunId: cleanString(record.parentRunId) } : {}),
    ...(cleanString(runtimeSession?.sessionId) ? { sessionId: cleanString(runtimeSession.sessionId) } : {}),
    ...(cleanString(runtimeSession?.taskRun?.taskRunId)
      ? { taskRunId: cleanString(runtimeSession.taskRun.taskRunId) }
      : {}),
    ...(Number.isInteger(runtimeSession?.generation) ? { generation: runtimeSession.generation } : {})
  };
}

function findSuccessfulCallAfter(calls, toolNames, afterOrdinal) {
  return calls.find((entry) => (
    entry.ordinal > afterOrdinal
    && entry.call?.success === true
    && toolNames.has(cleanString(entry.call?.name))
  ));
}

function readMutationAfterRef(call) {
  const commitAfter = call?.photoshopMutationCommit?.after;
  if (Number.isInteger(commitAfter?.documentId) && Number.isInteger(commitAfter?.historyStateId)) {
    return { documentId: commitAfter.documentId, historyStateId: commitAfter.historyStateId };
  }
  const transitionAfter = call?.photoshopHistoryTransition?.after;
  if (Number.isInteger(transitionAfter?.documentId) && Number.isInteger(transitionAfter?.historyStateId)) {
    return { documentId: transitionAfter.documentId, historyStateId: transitionAfter.historyStateId };
  }
  return undefined;
}

function isReadbackBoundToMutation(readback, mutationRef) {
  const observationRef = readback?.call?.photoshopObservationRef;
  return Boolean(
    mutationRef
    && Number.isInteger(observationRef?.documentId)
    && Number.isInteger(observationRef?.historyStateId)
    && observationRef.documentId === mutationRef.documentId
    && observationRef.historyStateId >= mutationRef.historyStateId
  );
}

function hasEvidence(evidenceRefs, kind) {
  return evidenceRefs.some((evidence) => (
    evidence?.kind === kind
    && evidence?.verified === true
    && cleanString(evidence?.ref)
  ));
}

function buildMachineCheckResults(caseSpec, facts) {
  const knownChecks = {
    correct_skill_binding: facts.correctSkillBinding,
    observed_photoshop_mutation: facts.observedMutationCount > 0,
    committed_photoshop_mutation: facts.committedMutationCount > 0,
    post_write_structure_readback: facts.postWriteStructureReadback,
    post_write_visual_readback: facts.postWriteVisualReadback,
    post_write_readback_target_verified: facts.postWriteReadbackTargetVerified,
    save_tool_receipt: facts.saveToolReceipt,
    editable_psd_evidence: facts.editablePsdEvidence,
    raster_export_evidence: facts.rasterExportEvidence,
    sku_output_inventory_evidence: facts.skuOutputInventoryEvidence,
    fixture_instance_evidence: facts.fixtureInstanceEvidence,
    runtime_model_identity_evidence: facts.runtimeModelIdentityEvidence,
    expected_project_binding_evidence: facts.expectedProjectBindingEvidence,
    source_input_integrity_evidence: facts.sourceInputIntegrityEvidence,
    no_unresolved_blockers: facts.unresolvedBlockerCount === 0,
    terminal_task_run: facts.terminalTaskRun
  };
  const checks = Array.isArray(caseSpec?.oracle?.machineChecks) ? caseSpec.oracle.machineChecks : [];
  return checks.map((check) => {
    const id = cleanString(check?.id);
    const supported = Object.prototype.hasOwnProperty.call(knownChecks, id);
    return {
      id,
      required: check?.required !== false,
      status: supported ? (knownChecks[id] ? "passed" : "failed") : "unknown",
      ...(supported ? {} : { reason: "当前评测器不认识该 machine check，未臆造结果。" })
    };
  });
}

function resolveRunStatus(record) {
  if (!record) return "unknown";
  if (record.cancelled === true || record.stopReason === "cancelled") return "cancelled";
  if (record.stopReason === "awaiting_user_confirmation" || record.stopReason === "awaiting_user_input") {
    return "needs_review";
  }
  const runtimeStatus = cleanString(record?.runtimeSession?.taskRun?.status);
  if (runtimeStatus === "completed") return "completed";
  if (runtimeStatus === "waiting_user" || runtimeStatus === "needs_review") return "needs_review";
  if (runtimeStatus === "failed") return "failed";
  const executionStatus = cleanString(record?.quality?.executionStatus);
  if (executionStatus === "completed") return "completed";
  if (executionStatus === "needs_review" || executionStatus === "awaiting_confirmation") {
    return "needs_review";
  }
  if (executionStatus === "failed" || executionStatus === "cancelled") return executionStatus;
  if (record.success === true && record.stopReason === "final_response") return "completed";
  if (record.success === false) return "failed";
  return "unknown";
}

function isClaimedCompletion(record, runStatus) {
  if (runStatus !== "completed") return false;
  const executionStatus = cleanString(record?.quality?.executionStatus);
  return record?.success === true || executionStatus === "completed";
}

function buildObservedSymptoms(input) {
  const symptoms = [];
  if (input.providerFailure) {
    symptoms.push({
      code: "model_provider_failure",
      phase: "provider",
      failureMode: "provider",
      evidence: "agent_run_record.providerFailure"
    });
  }
  if (!input.correctSkillBinding) {
    symptoms.push({
      code: "wrong_or_missing_skill_binding",
      phase: "routing",
      failureMode: "task_understanding",
      evidence: "runtimeSession.skillId / decision.skillId"
    });
  }
  if (input.observedMutationCount === 0) {
    symptoms.push({
      code: "no_observed_photoshop_mutation",
      phase: "execution",
      failureMode: "execution",
      evidence: "toolCalls.photoshopMutationCommit / photoshopHistoryTransition"
    });
  }
  if (input.observedMutationCount > 0 && !input.postWriteStructureReadback) {
    symptoms.push({
      code: "post_write_structure_readback_missing",
      phase: "verification",
      failureMode: "readback",
      evidence: "toolCalls after last observed mutation"
    });
  }
  if (input.observedMutationCount > 0 && !input.postWriteVisualReadback) {
    symptoms.push({
      code: "post_write_visual_readback_missing",
      phase: "verification",
      failureMode: "readback",
      evidence: "toolCalls after last observed mutation"
    });
  }
  if (!input.editablePsdEvidence || !input.rasterExportEvidence) {
    symptoms.push({
      code: "delivery_evidence_missing",
      phase: "delivery",
      failureMode: "delivery",
      evidence: "run sidecar evidenceRefs"
    });
  }
  if (!input.expectedProjectBindingEvidence) {
    symptoms.push({
      code: "expected_project_binding_unverified",
      phase: "context",
      failureMode: "fact_grounding",
      evidence: "run sidecar evidenceRefs"
    });
  }
  if (!input.sourceInputIntegrityEvidence) {
    symptoms.push({
      code: "source_input_integrity_unverified",
      phase: "delivery",
      failureMode: "delivery",
      evidence: "fixture before/after digest"
    });
  }
  return symptoms;
}

function deriveDesignReliabilityRunObservation(input) {
  const caseSpec = input?.caseSpec;
  const records = Array.isArray(input?.runRecords)
    ? input.runRecords.filter((record) => record?.version === "agent-run-record/v0")
    : [];
  if (records.length === 0) throw new Error("至少需要一条 agent-run-record/v0。 ");
  const caseValidation = validateDesignReliabilityCase(caseSpec);
  if (!caseValidation.ok) {
    throw new Error(`Case 不合法：${caseValidation.errors.join("；")}`);
  }
  const chainValidation = validateAgentRunRecordChain(records, {
    expectedGoal: caseSpec.task.instruction,
    expectedProjectPath: input.expectedProjectPath
  });
  if (!chainValidation.ok) {
    throw new Error(`RunRecord 链不合法：${chainValidation.errors.join("；")}`);
  }
  const flattened = flattenRunRecords(records);
  const finalRecord = flattened.sortedRecords.at(-1);
  const expectedSkillIds = [
    cleanString(caseSpec.skillContract.userFacingSkillId),
    ...caseSpec.skillContract.runtimeSkillIds.map(cleanString)
  ].filter(Boolean);
  const actualSkillIds = readActualSkillIds(
    flattened.sortedRecords,
    flattened.calls,
    expectedSkillIds
  );
  const correctSkillBinding = actualSkillIds.some((skillId) => expectedSkillIds.includes(skillId));
  const observedMutations = flattened.calls.filter((entry) => hasObservedMutation(entry.call));
  const committedMutations = flattened.calls.filter((entry) => hasCommittedMutation(entry.call));
  const lastObservedMutation = observedMutations.at(-1);
  const lastMutationOrdinal = lastObservedMutation ? lastObservedMutation.ordinal : -1;
  const postWriteStructure = lastMutationOrdinal >= 0
    ? findSuccessfulCallAfter(flattened.calls, STRUCTURE_READBACK_TOOLS, lastMutationOrdinal)
    : undefined;
  const postWriteVisual = lastMutationOrdinal >= 0
    ? findSuccessfulCallAfter(flattened.calls, VISUAL_READBACK_TOOLS, lastMutationOrdinal)
    : undefined;
  const lastMutationRef = lastObservedMutation
    ? readMutationAfterRef(lastObservedMutation.call)
    : undefined;
  const postWriteReadbackTargetVerified = Boolean(
    isReadbackBoundToMutation(postWriteStructure, lastMutationRef)
    && isReadbackBoundToMutation(postWriteVisual, lastMutationRef)
  );
  const saveReceipt = lastMutationOrdinal >= 0
    ? findSuccessfulCallAfter(flattened.calls, SAVE_TOOLS, lastMutationOrdinal)
    : undefined;
  const exportReceipt = lastMutationOrdinal >= 0
    ? findSuccessfulCallAfter(flattened.calls, EXPORT_TOOLS, lastMutationOrdinal)
    : undefined;
  const evidenceRefs = Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [];
  const runStatus = resolveRunStatus(finalRecord);
  // 技术交付与人工审美是两条分母：needs_review 已经是稳定终态，不等于仍在后台执行。
  // 只要写入、读回与文件证据完整，技术交付可以通过；作品是否可用仍由 Human Review 决定。
  const terminalTaskRun = runStatus === "completed" || runStatus === "needs_review";
  const unresolvedBlockerCount = Array.isArray(finalRecord?.blockers)
    ? finalRecord.blockers.length
    : 0;
  const facts = {
    correctSkillBinding,
    observedMutationCount: observedMutations.length,
    committedMutationCount: committedMutations.length,
    postWriteStructureReadback: Boolean(postWriteStructure),
    postWriteVisualReadback: Boolean(postWriteVisual),
    postWriteReadbackTargetVerified,
    saveToolReceipt: Boolean(saveReceipt),
    exportToolReceipt: Boolean(exportReceipt),
    editablePsdEvidence: hasEvidence(evidenceRefs, "editable_psd"),
    rasterExportEvidence: hasEvidence(evidenceRefs, "raster_export"),
    skuOutputInventoryEvidence: hasEvidence(evidenceRefs, "sku_output_inventory"),
    fixtureInstanceEvidence: hasEvidence(evidenceRefs, "fixture_instance"),
    runtimeModelIdentityEvidence: hasEvidence(evidenceRefs, "runtime_model_identity"),
    expectedProjectBindingEvidence: hasEvidence(evidenceRefs, "expected_project_binding"),
    sourceInputIntegrityEvidence: hasEvidence(evidenceRefs, "source_input_integrity"),
    unresolvedBlockerCount,
    terminalTaskRun
  };
  const machineChecks = buildMachineCheckResults(caseSpec, facts);
  const requiredChecks = machineChecks.filter((check) => check.required);
  const technicalDeliveryPassed = requiredChecks.length > 0
    && requiredChecks.every((check) => check.status === "passed");
  const claimedCompletion = isClaimedCompletion(finalRecord, runStatus);
  const falseCompletionSuspected = claimedCompletion && !technicalDeliveryPassed;
  const startTimes = flattened.sortedRecords.map(recordStartTime).filter((value) => value !== null);
  const endTimes = flattened.sortedRecords.map((record) => parseTime(record.endedAt)).filter((value) => value !== null);
  const attemptStart = startTimes.length > 0 ? Math.min(...startTimes) : null;
  const attemptEnd = endTimes.length > 0 ? Math.max(...endTimes) : null;
  const firstMutationAbsolute = observedMutations.map((entry) => entry.absoluteTime).find((value) => value !== null);
  const firstMutationElapsedMs = attemptStart !== null && firstMutationAbsolute !== undefined
    ? Math.max(0, firstMutationAbsolute - attemptStart)
    : undefined;
  const userInterventionKnown = Number.isInteger(input.userInterventionCount)
    && input.userInterventionCount >= 0;
  const modelCallCount = flattened.sortedRecords.reduce((count, record) => {
    const accounting = record?.runtimeSession?.accounting || record?.runtimeAccounting;
    return count + (Number.isInteger(accounting?.modelCallCount) ? accounting.modelCallCount : 0);
  }, 0);
  const missingEvidence = [];
  if (!userInterventionKnown) missingEvidence.push("user_intervention_count");
  if (!facts.editablePsdEvidence) missingEvidence.push("editable_psd");
  if (!facts.rasterExportEvidence) missingEvidence.push("raster_export");
  if (!facts.postWriteStructureReadback) missingEvidence.push("post_write_structure_readback");
  if (!facts.postWriteVisualReadback) missingEvidence.push("post_write_visual_readback");
  if (!facts.postWriteReadbackTargetVerified) missingEvidence.push("post_write_readback_target_verified");
  if (!facts.expectedProjectBindingEvidence) missingEvidence.push("expected_project_binding");
  if (!facts.fixtureInstanceEvidence) missingEvidence.push("fixture_instance");
  if (!facts.runtimeModelIdentityEvidence) missingEvidence.push("runtime_model_identity");
  if (!facts.sourceInputIntegrityEvidence) missingEvidence.push("source_input_integrity");
  const symptoms = buildObservedSymptoms({
    ...facts,
    providerFailure: flattened.sortedRecords.some((record) => Boolean(record.providerFailure))
  });
  const environment = isRecord(input.environment) ? input.environment : {};
  const runObservationId = cleanString(input.runObservationId)
    || `${caseSpec.caseId}-${cleanString(finalRecord.runId) || sha256Text(String(attemptEnd)).slice(7, 19)}`;
  return {
    version: RUN_VERSION,
    runObservationId,
    cohortId: cleanString(input.cohortId) || "unassigned",
    caseRef: {
      suiteId: caseSpec.suiteId,
      caseId: caseSpec.caseId,
      revision: caseSpec.revision,
      caseDigest: caseSpec.caseDigest
    },
    sourceRunRefs: flattened.sortedRecords.map(buildSourceRunRef),
    attempt: {
      repeatIndex: Number.isInteger(input.repeatIndex) && input.repeatIndex > 0 ? input.repeatIndex : 1,
      ...(attemptStart !== null ? { startedAt: new Date(attemptStart).toISOString() } : {}),
      ...(attemptEnd !== null ? { endedAt: new Date(attemptEnd).toISOString() } : {})
    },
    cohortDimensions: {
      gitCommit: cleanString(environment.gitCommit) || "unknown",
      dirty: environment.dirty === true,
      ...(cleanString(environment.dirtyFingerprint)
        ? { dirtyFingerprint: cleanString(environment.dirtyFingerprint) }
        : {}),
      provider: cleanString(environment.provider) || "unknown",
      modelId: cleanString(environment.modelId) || "unknown",
      executionModel: caseSpec.executionModel,
      skillIds: actualSkillIds,
      taskTypes: [...new Set(flattened.sortedRecords.map((record) => cleanString(record?.runtimeSession?.taskType)).filter(Boolean))],
      ...(cleanString(input.fixtureDigest) ? { fixtureDigest: cleanString(input.fixtureDigest) } : {})
    },
    observed: {
      runStatus,
      ...(firstMutationElapsedMs !== undefined ? { firstMutationElapsedMs } : {}),
      ...(attemptStart !== null && attemptEnd !== null
        ? { totalElapsedMs: Math.max(0, attemptEnd - attemptStart) }
        : {}),
      iterations: resolveTaskRunIterations(flattened.sortedRecords),
      modelCalls: modelCallCount,
      toolCalls: flattened.calls.length,
      writeToolSuccesses: flattened.calls.filter((entry) => (
        entry.call?.activityClass === "mutation" && entry.call?.success === true
      )).length,
      observedMutationCalls: facts.observedMutationCount,
      committedMutationCalls: facts.committedMutationCount,
      observationCalls: flattened.calls.filter((entry) => (
        entry.call?.activityClass === "observation" && entry.call?.success === true
      )).length,
      ...(userInterventionKnown ? { userInterventionCount: input.userInterventionCount } : {}),
      correctSkillBinding,
      postWriteStructureReadback: facts.postWriteStructureReadback,
      postWriteVisualReadback: facts.postWriteVisualReadback,
      postWriteReadbackTargetVerified: facts.postWriteReadbackTargetVerified,
      saveToolReceipt: facts.saveToolReceipt,
      exportToolReceipt: facts.exportToolReceipt,
      technicalDeliveryPassed,
      falseCompletionSuspected,
      unresolvedBlockerCount,
      stopReason: cleanString(finalRecord.stopReason) || "unknown",
      machineChecks,
      symptoms
    },
    evidenceRefs,
    missingEvidence: [...new Set(missingEvidence)].sort(),
    boundaries: {
      devBenchmarkSidecarOnly: true,
      neverAffectsRuntime: true,
      noRawToolPayloads: true,
      noInlineImages: true,
      noAbsoluteUserPaths: true,
      doesNotJudgeAesthetics: true
    }
  };
}

function validateEvidenceRef(evidence, fieldName, errors) {
  if (!isRecord(evidence)) {
    errors.push(`${fieldName} 必须是对象。`);
    return;
  }
  if (!cleanString(evidence.kind) || !cleanString(evidence.ref)) {
    errors.push(`${fieldName} 需要 kind 与 ref。`);
  }
  if (path.isAbsolute(cleanString(evidence.ref))) {
    errors.push(`${fieldName}.ref 不得保存绝对路径。`);
  }
  if (evidence.digest !== undefined && !/^sha256:[a-f0-9]{64}$/i.test(cleanString(evidence.digest))) {
    errors.push(`${fieldName}.digest 必须是 sha256:<64 hex>。`);
  }
}

function validateDesignReliabilityRun(run) {
  const errors = [];
  if (!isRecord(run)) return { ok: false, errors: ["Run observation 不是对象。"] };
  if (run.version !== RUN_VERSION) errors.push(`version 必须是 ${RUN_VERSION}。`);
  if (!cleanString(run.runObservationId)) errors.push("runObservationId 不能为空。");
  if (!cleanString(run.cohortId)) errors.push("cohortId 不能为空。");
  if (!isRecord(run.caseRef) || !cleanString(run.caseRef.caseDigest)) errors.push("caseRef 不完整。");
  if (!Array.isArray(run.sourceRunRefs) || run.sourceRunRefs.length === 0) errors.push("sourceRunRefs 不能为空。");
  if (!isRecord(run.observed) || !Array.isArray(run.observed.machineChecks)) errors.push("observed.machineChecks 缺失。");
  if (!Array.isArray(run.evidenceRefs)) {
    errors.push("evidenceRefs 必须是数组。");
  } else {
    run.evidenceRefs.forEach((evidence, index) => validateEvidenceRef(evidence, `evidenceRefs[${index}]`, errors));
  }
  if (!isRecord(run.boundaries)
    || run.boundaries.devBenchmarkSidecarOnly !== true
    || run.boundaries.neverAffectsRuntime !== true
    || run.boundaries.noRawToolPayloads !== true
    || run.boundaries.noInlineImages !== true
    || run.boundaries.noAbsoluteUserPaths !== true
    || run.boundaries.doesNotJudgeAesthetics !== true) {
    errors.push("Run observation 边界声明不完整。 ");
  }
  return { ok: errors.length === 0, errors };
}

function validateScoreMap(scores, errors) {
  if (!isRecord(scores)) {
    errors.push("scores 必须是对象。");
    return;
  }
  for (const [dimension, value] of Object.entries(scores)) {
    if (!cleanString(dimension)) errors.push("score 维度名不能为空。");
    if (value !== null && (!isFiniteNumber(value) || value < 0 || value > 1)) {
      errors.push(`scores.${dimension} 必须是 0..1 或 null。`);
    }
  }
}

function validateDesignReliabilityReview(review) {
  const errors = [];
  if (!isRecord(review)) return { ok: false, errors: ["Review 不是对象。"] };
  if (review.version !== REVIEW_VERSION) errors.push(`version 必须是 ${REVIEW_VERSION}。`);
  if (!cleanString(review.reviewId) || !cleanString(review.runObservationId)) {
    errors.push("reviewId 与 runObservationId 不能为空。");
  }
  if (!cleanString(review.rubricId) || !cleanString(review.reviewerId)) {
    errors.push("rubricId 与 reviewerId 不能为空。");
  }
  if (!REVIEW_DECISIONS.includes(review.decision)) errors.push("decision 非法。");
  validateScoreMap(review.scores, errors);
  if (!Array.isArray(review.findings)) errors.push("findings 必须是数组。");
  if (!Array.isArray(review.evidenceRefs) || review.evidenceRefs.length === 0) {
    errors.push("人工评审至少需要一个证据引用。");
  }
  if (!isRecord(review.boundaries)
    || review.boundaries.devBenchmarkSidecarOnly !== true
    || review.boundaries.neverAffectsRuntime !== true) {
    errors.push("Review 边界声明不完整。 ");
  }
  return { ok: errors.length === 0, errors };
}

function validateDesignReliabilityAttribution(attribution) {
  const errors = [];
  if (!isRecord(attribution)) return { ok: false, errors: ["Attribution 不是对象。"] };
  if (attribution.version !== ATTRIBUTION_VERSION) errors.push(`version 必须是 ${ATTRIBUTION_VERSION}。`);
  if (!cleanString(attribution.attributionId) || !cleanString(attribution.runObservationId)) {
    errors.push("attributionId 与 runObservationId 不能为空。");
  }
  if (!ATTRIBUTION_OWNERS.includes(attribution.owner)) errors.push("owner 非法。");
  if (!FAILURE_MODES.includes(attribution.failureMode)) errors.push("failureMode 非法。");
  if (!ATTRIBUTION_STATUSES.includes(attribution.status)) errors.push("status 非法。");
  if (!cleanString(attribution.rationale)) errors.push("rationale 不能为空。");
  if (!Array.isArray(attribution.evidenceRefs) || attribution.evidenceRefs.length === 0) {
    errors.push("归因至少需要一个证据引用。");
  }
  if (!isRecord(attribution.boundaries)
    || attribution.boundaries.devBenchmarkSidecarOnly !== true
    || attribution.boundaries.neverAffectsRuntime !== true
    || attribution.boundaries.cannotBecomeRuntimeGate !== true) {
    errors.push("Attribution 边界声明不完整。 ");
  }
  return { ok: errors.length === 0, errors };
}

function rate(numerator, denominator) {
  return {
    numerator,
    denominator,
    value: denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : null
  };
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return null;
  const index = Math.ceil(sorted.length * ratio) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function distribution(values) {
  const sorted = values.filter(isFiniteNumber).sort((left, right) => left - right);
  if (sorted.length === 0) return { count: 0, median: null, p90: null };
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return {
    count: sorted.length,
    median: Math.round(median),
    p90: Math.round(percentile(sorted, 0.9))
  };
}

function uniqueCaseRefs(runs) {
  return [...new Set(runs.map((run) => `${run.caseRef.caseId}@${run.caseRef.revision}`))].sort();
}

function hasPassedRequiredMachineChecks(run, checkIds) {
  const checks = Array.isArray(run?.observed?.machineChecks)
    ? run.observed.machineChecks.filter((check) => check?.required !== false && checkIds.has(check?.id))
    : [];
  return checks.length > 0 && checks.every((check) => check.status === "passed");
}

function aggregateFamily(runs, reviews) {
  const reviewedRunIds = new Set(reviews.map((review) => review.runObservationId));
  const passRunIds = new Set(reviews.filter((review) => review.decision === "pass").map((review) => review.runObservationId));
  const completedRuns = runs.filter((run) => run?.observed?.runStatus === "completed");
  const artifactCheckIds = new Set([
    "editable_psd_evidence",
    "raster_export_evidence",
    "sku_output_inventory_evidence"
  ]);
  const projectSafetyCheckIds = new Set([
    "expected_project_binding_evidence",
    "source_input_integrity_evidence"
  ]);
  return {
    runs: runs.length,
    reliability: {
      technicalDeliveryRate: rate(runs.filter((run) => run.observed.technicalDeliveryPassed === true).length, runs.length),
      observedMutationRate: rate(runs.filter((run) => run.observed.observedMutationCalls > 0).length, runs.length),
      postWriteVisualReadbackRate: rate(runs.filter((run) => run.observed.postWriteVisualReadback === true).length, runs.length),
      completedPostWriteReadbackRate: rate(completedRuns.filter((run) => (
        run.observed.postWriteStructureReadback === true
        && run.observed.postWriteVisualReadback === true
        && run.observed.postWriteReadbackTargetVerified === true
      )).length, completedRuns.length),
      completedArtifactEvidenceRate: rate(completedRuns.filter((run) => (
        hasPassedRequiredMachineChecks(run, artifactCheckIds)
      )).length, completedRuns.length),
      falseCompletionRate: rate(runs.filter((run) => run.observed.falseCompletionSuspected === true).length, runs.length),
      wrongDocumentOrOverwriteCount: runs.filter((run) => (
        !hasPassedRequiredMachineChecks(run, projectSafetyCheckIds)
      )).length
    },
    quality: {
      humanReviewedRate: rate(runs.filter((run) => reviewedRunIds.has(run.runObservationId)).length, runs.length),
      humanPassRate: rate(passRunIds.size, reviewedRunIds.size),
      humanUsableRate: rate(passRunIds.size, runs.length)
    },
    efficiency: {
      firstMutationMs: distribution(runs.map((run) => run.observed.firstMutationElapsedMs)),
      totalElapsedMs: distribution(runs.map((run) => run.observed.totalElapsedMs)),
      iterations: distribution(runs.map((run) => run.observed.iterations)),
      modelCalls: distribution(runs.map((run) => run.observed.modelCalls)),
      toolCalls: distribution(runs.map((run) => run.observed.toolCalls)),
      userInterventions: distribution(runs.map((run) => run.observed.userInterventionCount))
    }
  };
}

function evaluateDesignReliabilityReleaseGates(report, gates, families = TASK_FAMILIES) {
  const minimumRunsPerFamily = Math.max(1, Math.floor(Number(gates?.minimumRunsPerFamily) || 0));
  const checksByFamily = {};
  for (const family of families) {
    const familyReport = report?.byTaskFamily?.[family];
    const runs = Number(familyReport?.runs) || 0;
    const reviewedRuns = Number(familyReport?.quality?.humanReviewedRate?.numerator) || 0;
    const checks = {
      minimumRunsPerFamily: runs >= minimumRunsPerFamily,
      minimumHumanReviewedRunsPerFamily: reviewedRuns >= minimumRunsPerFamily,
      technicalDeliveryRate: Number(familyReport?.reliability?.technicalDeliveryRate?.value)
        >= Number(gates?.technicalDeliveryRate),
      humanUsableRate: Number(familyReport?.quality?.humanUsableRate?.value)
        >= Number(gates?.humanUsableRate),
      completedPostWriteReadbackRate: Number(familyReport?.reliability?.completedPostWriteReadbackRate?.value)
        >= Number(gates?.completedPostWriteReadbackRate),
      completedArtifactEvidenceRate: Number(familyReport?.reliability?.completedArtifactEvidenceRate?.value)
        >= Number(gates?.completedArtifactEvidenceRate),
      falseCompletionRate: Number(familyReport?.reliability?.falseCompletionRate?.value)
        <= Number(gates?.falseCompletionRate),
      wrongDocumentOrOverwriteCount: Number(familyReport?.reliability?.wrongDocumentOrOverwriteCount)
        <= Number(gates?.wrongDocumentOrOverwriteCount),
      userInterventionCoverage: Number(familyReport?.efficiency?.userInterventions?.count)
        >= minimumRunsPerFamily,
      userInterventionMedian: Number(familyReport?.efficiency?.userInterventions?.median)
        <= Number(gates?.userInterventionMedian),
      userInterventionP90: Number(familyReport?.efficiency?.userInterventions?.p90)
        <= Number(gates?.userInterventionP90)
    };
    const sampleReady = checks.minimumRunsPerFamily
      && checks.minimumHumanReviewedRunsPerFamily
      && checks.userInterventionCoverage;
    checksByFamily[family] = {
      passed: Object.values(checks).every(Boolean),
      sampleReady,
      runs,
      reviewedRuns,
      checks,
      failedChecks: Object.entries(checks)
        .filter(([, passed]) => !passed)
        .map(([name]) => name)
    };
  }
  const coverageComplete = Array.isArray(report?.coverage?.missingCaseIds)
    && report.coverage.missingCaseIds.length === 0;
  const familyResults = Object.values(checksByFamily);
  return {
    passed: coverageComplete && familyResults.every((result) => result.passed),
    sampleReady: coverageComplete && familyResults.every((result) => result.sampleReady),
    coverageComplete,
    minimumRunsPerFamily,
    checksByFamily
  };
}

function buildDesignReliabilityCohortReport(input) {
  const cases = Array.isArray(input?.cases) ? input.cases.filter((item) => item?.status === "active") : [];
  const runs = Array.isArray(input?.runs)
    ? input.runs.filter((run) => run?.version === RUN_VERSION && run?.cohortId === input.cohortId)
    : [];
  const reviews = Array.isArray(input?.reviews)
    ? input.reviews.filter((review) => review?.version === REVIEW_VERSION
      && runs.some((run) => run.runObservationId === review.runObservationId))
    : [];
  const attributions = Array.isArray(input?.attributions)
    ? input.attributions.filter((item) => item?.version === ATTRIBUTION_VERSION
      && runs.some((run) => run.runObservationId === item.runObservationId))
    : [];
  const eligibleCaseIds = cases.map((item) => item.caseId).sort();
  const coveredCaseIds = [...new Set(runs.map((run) => run.caseRef.caseId))].sort();
  const missingCaseIds = eligibleCaseIds.filter((caseId) => !coveredCaseIds.includes(caseId));
  const caseSetDigest = sha256Text(stableStringify(cases.map((item) => ({
    caseId: item.caseId,
    revision: item.revision,
    caseDigest: item.caseDigest
  })).sort((left, right) => left.caseId.localeCompare(right.caseId))));
  const confirmedAttributions = attributions.filter((item) => item.status === "confirmed");
  const confirmedByOwner = {};
  for (const item of confirmedAttributions) {
    confirmedByOwner[item.owner] = (confirmedByOwner[item.owner] || 0) + 1;
  }
  const byTaskFamily = {};
  for (const family of TASK_FAMILIES) {
    const familyCaseIds = new Set(cases.filter((item) => item.taskFamily === family).map((item) => item.caseId));
    const familyRuns = runs.filter((run) => familyCaseIds.has(run.caseRef.caseId));
    const familyReviews = reviews.filter((review) => familyRuns.some((run) => run.runObservationId === review.runObservationId));
    byTaskFamily[family] = aggregateFamily(familyRuns, familyReviews);
  }
  return {
    version: COHORT_VERSION,
    cohortId: cleanString(input.cohortId),
    generatedAt: cleanString(input.generatedAt) || new Date().toISOString(),
    selector: {
      suiteId: cleanString(input.suiteId),
      caseSetDigest,
      caseRefs: uniqueCaseRefs(runs),
      filters: isRecord(input.filters) ? input.filters : {}
    },
    coverage: {
      eligibleCases: eligibleCaseIds.length,
      coveredCases: coveredCaseIds.length,
      runs: runs.length,
      humanReviewedRuns: new Set(reviews.map((review) => review.runObservationId)).size,
      coveredCaseIds,
      missingCaseIds
    },
    overall: aggregateFamily(runs, reviews),
    byTaskFamily,
    attribution: {
      confirmedByOwner,
      confirmedCount: confirmedAttributions.length,
      hypothesisCount: attributions.filter((item) => item.status === "hypothesis").length,
      unknownCount: confirmedAttributions.filter((item) => item.owner === "unknown").length
    },
    boundaries: {
      comparableOnlyWithinCaseSetAndRubric: true,
      devBenchmarkOnly: true,
      doesNotGateRuntime: true,
      doesNotJudgeAestheticsWithoutHumanReview: true
    }
  };
}

function compareDesignReliabilityCohorts(baseline, candidate) {
  const comparable = baseline?.version === COHORT_VERSION
    && candidate?.version === COHORT_VERSION
    && baseline.selector?.caseSetDigest === candidate.selector?.caseSetDigest;
  if (!comparable) {
    return {
      comparable: false,
      reason: "两个 cohort 的固定 Case 集不同，禁止用总体平均值伪装前后效果。"
    };
  }
  function delta(pathReader) {
    const before = pathReader(baseline);
    const after = pathReader(candidate);
    if (!isFiniteNumber(before) || !isFiniteNumber(after)) return null;
    return Math.round((after - before) * 10000) / 10000;
  }
  return {
    comparable: true,
    caseSetDigest: baseline.selector.caseSetDigest,
    deltas: {
      technicalDeliveryRate: delta((report) => report.overall.reliability.technicalDeliveryRate.value),
      postWriteVisualReadbackRate: delta((report) => report.overall.reliability.postWriteVisualReadbackRate.value),
      falseCompletionRate: delta((report) => report.overall.reliability.falseCompletionRate.value),
      humanPassRate: delta((report) => report.overall.quality.humanPassRate.value)
    }
  };
}

module.exports = {
  ATTRIBUTION_OWNERS,
  ATTRIBUTION_STATUSES,
  ATTRIBUTION_VERSION,
  CASE_VERSION,
  COHORT_VERSION,
  EXECUTION_MODELS,
  FAILURE_MODES,
  REVIEW_DECISIONS,
  REVIEW_VERSION,
  RUN_VERSION,
  TASK_FAMILIES,
  buildCaseDigest,
  buildDesignReliabilityCohortReport,
  compareDesignReliabilityCohorts,
  deriveDesignReliabilityRunObservation,
  evaluateDesignReliabilityReleaseGates,
  hasCommittedMutation,
  hasObservedMutation,
  sha256Text,
  stableStringify,
  validateAgentRunRecordChain,
  validateDesignReliabilityAttribution,
  validateDesignReliabilityCase,
  validateDesignReliabilityReview,
  validateDesignReliabilityRun
};
