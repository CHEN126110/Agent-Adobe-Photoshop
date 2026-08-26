"use strict";

const crypto = require("crypto");
const path = require("path");

const CASE_VERSION = "design-reliability-case/v1";
const RUN_VERSION = "design-reliability-run/v1";
const REVIEW_VERSION = "design-reliability-human-review/v2";
const LEGACY_REVIEW_VERSION = "design-reliability-human-review/v1";
const VERIFIED_REVIEW_PACKET_PROOF_VERSION = "design-reliability-verified-review-packet-proof/v1";
const ATTRIBUTION_VERSION = "design-reliability-attribution/v1";
const COHORT_VERSION = "design-reliability-cohort/v1";
const OFFICIAL_REVIEW_DISK_TRUST = Symbol.for("designecho.designReliability.officialReviewDiskVerified");

const TASK_FAMILIES = Object.freeze(["main_image", "detail_page", "sku"]);
const EXECUTION_MODELS = Object.freeze(["agentic", "staged"]);
const REVIEW_DECISIONS = Object.freeze(["pass", "needs_fix", "unscorable"]);
const PAIRWISE_OUTCOMES = Object.freeze(["better", "comparable", "weaker", "unscorable"]);
const COMPARISON_EVIDENCE_KINDS = Object.freeze([
  "candidate_final",
  "user_design_anchor",
  "eagle_anchor"
]);
const COMPARISON_EVIDENCE_REF_PREFIXES = Object.freeze({
  candidate_final: ["candidate:"],
  user_design_anchor: ["user-design:"],
  eagle_anchor: ["eagle:item:"]
});
const REVIEW_EVIDENCE_PROTOCOLS = Object.freeze([
  "bound_self_reported",
  "anonymous_packet_verified"
]);
const DECISION_PRESERVATION_VERSION = "decision-preservation-observation/v1";
const DECISION_PRESERVATION_STATUSES = Object.freeze(["passed", "failed", "unscorable"]);
const HARNESS_TOOL_ORIGINS = new Set([
  "harness_compact_workflow_owner",
  "harness_opening_observation",
  "harness_quality_verification"
]);
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
const FIXTURE_FACT_KEYS = new Set([
  "product_type",
  "available_colors",
  "product_claims",
  "prohibited_claim_categories",
  "source_encoding",
  "color_mapping",
  "source_asset_semantics",
  "production_spec_semantics"
]);
const PRODUCT_CLAIM_PROVENANCE_KINDS = new Set([
  "user_provided",
  "project_spec",
  "source_observable"
]);
const PRODUCT_CLAIM_CATEGORIES = new Set([
  "wearing_cut",
  "wearing_scenario",
  "color_availability",
  "visible_structure",
  "visible_pattern",
  "visible_finish"
]);
const PROHIBITED_CLAIM_CATEGORIES = new Set([
  "material_composition",
  "performance",
  "certification",
  "quantified_durability",
  "medical_or_antimicrobial"
]);
const DESIGN_DIRECTIVE_PATTERN = /(?:版式|构图|排版|字体|字号|字距|配色|色板|背景|渐变|标题层级|主体(?:占比|缩放|大小|\s*\d+\s*%)|占画面|选择|固定|使用.{0,8}(?:模板|版式)|放大|缩小|裁切|居中|左对齐|右对齐|[粉白黑灰蓝紫绿红黄]底[粉白黑灰蓝紫绿红黄]字)/i;
const SIMPLE_FACT_LABEL_PATTERN = /^[\p{L}\p{N}·\-\s]{1,40}$/u;

function isUnsafeFixtureFactText(value) {
  const text = cleanString(value);
  return !text
    || DESIGN_DIRECTIVE_PATTERN.test(text)
    || /(?:^|\s)file:/i.test(text)
    || /[a-z]:[\\/]/i.test(text)
    || text.startsWith("/")
    || text.startsWith("\\\\")
    || text.replace(/\\/g, "/").split("/").includes("..");
}

function isInvalidSimpleFixtureFactLabel(value, limit = 40) {
  const text = cleanString(value);
  return text.length > limit
    || !SIMPLE_FACT_LABEL_PATTERN.test(text)
    || isUnsafeFixtureFactText(text);
}

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
const DELIVERY_TOOLS = new Set([
  "saveDocument",
  "smartSave",
  "quickExport",
  "exportGroup",
  "exportMainImageDocuments",
  "exportDetailPageSlices",
  "exportWhiteBgFromSkuMaterial",
  "exportToSkuDir",
  "batchExport"
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

function uniqueCleanStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanString).filter(Boolean))];
}

function calculateWeightedOverall(rubric, scores) {
  if (!isRecord(rubric) || !Array.isArray(rubric.dimensions) || !isRecord(scores)) return undefined;
  let weightedTotal = 0;
  let weightTotal = 0;
  for (const dimension of rubric.dimensions) {
    const id = cleanString(dimension?.id);
    const weight = Number(dimension?.weight);
    const score = scores[id];
    if (!id || !Number.isFinite(weight) || weight <= 0 || !isFiniteNumber(score) || score < 0 || score > 1) {
      return undefined;
    }
    weightedTotal += score * weight;
    weightTotal += weight;
  }
  if (weightTotal <= 0) return undefined;
  return Math.round((weightedTotal / weightTotal) * 10000) / 10000;
}

function requiredComparisonEvidenceKinds(caseSpec) {
  const kinds = new Set(["candidate_final"]);
  const references = Array.isArray(caseSpec?.task?.reviewOnlyReferences)
    ? caseSpec.task.reviewOnlyReferences
    : [];
  if (references.some((reference) => cleanString(reference?.kind) === "user_design")) {
    kinds.add("user_design_anchor");
  }
  if (references.some((reference) => cleanString(reference?.kind) === "eagle_item")) {
    kinds.add("eagle_anchor");
  }
  return [...kinds];
}

function buildExpectedComparisonEvidenceRefs(caseSpec, run) {
  const expected = new Map(COMPARISON_EVIDENCE_KINDS.map((kind) => [kind, new Set()]));
  const runEvidence = Array.isArray(run?.evidenceRefs) ? run.evidenceRefs : [];
  const finalRasterRefs = new Set(
    (Array.isArray(run?.finalArtifactManifest?.artifacts) ? run.finalArtifactManifest.artifacts : [])
      .filter((artifact) => cleanString(artifact?.kind) === "raster_export")
      .map((artifact) => cleanString(artifact?.ref).replace(/\\/g, "/"))
      .filter(Boolean)
  );
  for (const evidence of runEvidence) {
    if (cleanString(evidence?.kind) !== 'raster_export' || evidence?.verified !== true) continue;
    const ref = cleanString(evidence.ref).replace(/\\/g, '/');
    if (!finalRasterRefs.has(ref)) continue;
    const digest = cleanString(evidence.digest).toLowerCase();
    if (!ref || !/^sha256:[a-f0-9]{64}$/.test(digest)) continue;
    expected.get('candidate_final').add(`candidate:${ref}@${digest}`);
  }

  const references = Array.isArray(caseSpec?.task?.reviewOnlyReferences)
    ? caseSpec.task.reviewOnlyReferences
    : [];
  for (const reference of references) {
    const kind = cleanString(reference?.kind);
    const ref = cleanString(reference?.ref).replace(/\\/g, '/');
    const digest = cleanString(reference?.digest).toLowerCase();
    if (kind === 'user_design' && ref && isSha256Digest(digest)) {
      expected.get('user_design_anchor').add(`user-design:${ref}@${digest}`);
    } else if (kind === 'eagle_item' && ref.startsWith('eagle:item:') && isSha256Digest(digest)) {
      expected.get('eagle_anchor').add(`${ref}@${digest}`);
    }
  }
  return expected;
}

function buildExpectedComparisonEvidenceList(caseSpec, run) {
  const expected = buildExpectedComparisonEvidenceRefs(caseSpec, run);
  return COMPARISON_EVIDENCE_KINDS.flatMap((kind) => (
    [...(expected.get(kind) || [])]
      .sort()
      .map((ref) => ({ kind, ref }))
  ));
}

function validateComparisonEvidenceBindings(value, caseSpec, run, errors) {
  const expected = buildExpectedComparisonEvidenceRefs(caseSpec, run);
  const actual = new Map(COMPARISON_EVIDENCE_KINDS.map((kind) => [kind, new Set()]));
  for (const item of value) {
    if (!actual.has(item.kind)) continue;
    actual.get(item.kind).add(item.ref);
  }

  for (const kind of requiredComparisonEvidenceKinds(caseSpec)) {
    const expectedRefs = expected.get(kind) || new Set();
    if (expectedRefs.size === 0) {
      errors.push(`当前 Run / Case 没有可绑定的 ${kind} 真实证据。`);
      continue;
    }
    for (const ref of expectedRefs) {
      if (!actual.get(kind)?.has(ref)) {
        errors.push(`comparisonEvidenceRefs 缺少当前 Run / Case 的真实证据：${kind}=${ref}。`);
      }
    }
  }

  for (const [kind, refs] of actual.entries()) {
    const expectedRefs = expected.get(kind) || new Set();
    for (const ref of refs) {
      if (!expectedRefs.has(ref)) {
        errors.push(`comparisonEvidenceRefs 不属于当前 Run / Case：${kind}=${ref}。`);
      }
    }
  }
}

function validateComparisonEvidenceRefs(value, evidenceRefs, errors) {
  if (!Array.isArray(value)) {
    if (value !== undefined) errors.push("comparisonEvidenceRefs 必须是数组。");
    return [];
  }
  const normalized = [];
  const identities = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isRecord(item)) {
      errors.push(`comparisonEvidenceRefs[${index}] 必须是对象。`);
      continue;
    }
    const kind = cleanString(item.kind);
    const ref = cleanString(item.ref);
    if (!COMPARISON_EVIDENCE_KINDS.includes(kind)) {
      errors.push(`comparisonEvidenceRefs[${index}].kind 非法。`);
      continue;
    }
    if (!ref || path.isAbsolute(ref)) {
      errors.push(`comparisonEvidenceRefs[${index}].ref 必须是非绝对路径的稳定证据引用。`);
      continue;
    }
    const allowedPrefixes = COMPARISON_EVIDENCE_REF_PREFIXES[kind] || [];
    const matchedPrefix = allowedPrefixes.find((prefix) => ref.startsWith(prefix));
    if (!matchedPrefix) {
      errors.push(`comparisonEvidenceRefs[${index}].ref 与 ${kind} 的证据前缀不匹配。`);
    } else {
      const payload = ref.slice(matchedPrefix.length).trim();
      const normalizedPayload = payload.replace(/\\/g, "/");
      if (!payload
        || path.isAbsolute(payload)
        || /^[a-z]:\//i.test(normalizedPayload)
        || normalizedPayload.startsWith("/")
        || normalizedPayload.split("/").includes("..")) {
        errors.push(`comparisonEvidenceRefs[${index}].ref 不能在类型前缀后隐藏绝对路径或目录穿越。`);
      }
    }
    if (!evidenceRefs.includes(ref)) {
      errors.push(`comparisonEvidenceRefs[${index}].ref 未绑定到 evidenceRefs。`);
    }
    const identity = `${kind}\u0000${ref}`;
    if (identities.has(identity)) {
      errors.push("comparisonEvidenceRefs 不能包含重复项。");
      continue;
    }
    identities.add(identity);
    normalized.push({ kind, ref });
  }
  return normalized;
}

function isSafeReviewEvidenceRef(ref) {
  const normalized = cleanString(ref).replace(/\\/g, "/");
  const typedPrefix = /^(candidate:|user-design:|receipt:|eagle:item:)/i.exec(normalized)?.[0] || "";
  const payload = typedPrefix ? normalized.slice(typedPrefix.length) : normalized;
  return Boolean(
    normalized
    && !path.isAbsolute(normalized)
    && !/^[a-z]:\//i.test(normalized)
    && !/(?:^|:)[a-z]:\//i.test(normalized)
    && !/(?:^|:)\//.test(normalized)
    && !normalized.startsWith("/")
    && !normalized.split("/").includes("..")
    && !/^file:/i.test(normalized)
    && !/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)
    && !path.isAbsolute(payload)
    && !/^[a-z]:\//i.test(payload)
    && !payload.startsWith("/")
    && !payload.startsWith("//")
    && !payload.split("/").includes("..")
  );
}

function isBlockingReviewFinding(finding) {
  if (!isRecord(finding)) return false;
  return finding.blocking === true
    || ["blocker", "blocking"].includes(cleanString(finding.severity).toLowerCase())
    || ["blocker", "blocking"].includes(cleanString(finding.status).toLowerCase());
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

function isSha256Digest(value) {
  return /^sha256:[a-f0-9]{64}$/i.test(cleanString(value));
}

function buildReviewPacketProjection(review) {
  if (!isRecord(review)) return {};
  const projection = cloneJson(review);
  delete projection.verifiedPacketProof;
  return projection;
}

function buildReviewPacketProjectionDigest(review) {
  return sha256Text(stableStringify(buildReviewPacketProjection(review)));
}

function buildComparisonEvidenceDigest(value) {
  const refs = Array.isArray(value)
    ? value
      .filter(isRecord)
      .map((item) => ({ kind: cleanString(item.kind), ref: cleanString(item.ref) }))
      .sort((left, right) => left.kind.localeCompare(right.kind) || left.ref.localeCompare(right.ref))
    : [];
  return sha256Text(stableStringify(refs));
}

function validateVerifiedReviewPacketProof(proof, review, context = {}) {
  const errors = [];
  if (!isRecord(proof)) {
    return { ok: false, errors: ["verifiedPacketProof 缺失或不是对象。"] };
  }
  if (proof.version !== VERIFIED_REVIEW_PACKET_PROOF_VERSION) {
    errors.push(`verifiedPacketProof.version 必须是 ${VERIFIED_REVIEW_PACKET_PROOF_VERSION}。`);
  }
  const packetId = cleanString(proof.packetId);
  if (!/^[a-z0-9][a-z0-9._-]{7,127}$/i.test(packetId)) {
    errors.push("verifiedPacketProof.packetId 不是安全、稳定的包身份。 ");
  }
  for (const field of [
    "packetDigest",
    "sealedMappingDigest",
    "reviewerResponseDigest",
    "assetSetDigest",
    "sourceBindingDigest",
    "comparisonEvidenceDigest",
    "reviewProjectionDigest"
  ]) {
    if (!isSha256Digest(proof[field])) {
      errors.push(`verifiedPacketProof.${field} 必须是 sha256:<64 hex>。`);
    }
  }
  if (!cleanString(proof.runObservationId)
    || cleanString(proof.runObservationId) !== cleanString(review?.runObservationId)) {
    errors.push("verifiedPacketProof.runObservationId 与 Review 不一致。 ");
  }
  if (!cleanString(proof.rubricId)
    || cleanString(proof.rubricId) !== cleanString(review?.rubricId)) {
    errors.push("verifiedPacketProof.rubricId 与 Review 不一致。 ");
  }
  if (!isSha256Digest(proof.rubricDigest)
    || cleanString(proof.rubricDigest).toLowerCase() !== cleanString(review?.rubricDigest).toLowerCase()) {
    errors.push("verifiedPacketProof.rubricDigest 与 Review 不一致。 ");
  }
  if (!cleanString(proof.reviewerId)
    || cleanString(proof.reviewerId) !== cleanString(review?.reviewerId)) {
    errors.push("verifiedPacketProof.reviewerId 与 Review 不一致。 ");
  }
  if (!cleanString(proof.reviewedAt)
    || cleanString(proof.reviewedAt) !== cleanString(review?.reviewedAt)) {
    errors.push("verifiedPacketProof.reviewedAt 与 Review 不一致。 ");
  }
  if (!isRecord(proof.caseRef)
    || !cleanString(proof.caseRef.caseId)
    || !Number.isInteger(proof.caseRef.revision)
    || proof.caseRef.revision < 1
    || !isSha256Digest(proof.caseRef.caseDigest)) {
    errors.push("verifiedPacketProof.caseRef 不完整。 ");
  }
  if (cleanString(proof.reviewProjectionDigest).toLowerCase()
    !== buildReviewPacketProjectionDigest(review).toLowerCase()) {
    errors.push("verifiedPacketProof 未绑定当前完整 Review 投影。 ");
  }
  if (cleanString(proof.comparisonEvidenceDigest).toLowerCase()
    !== buildComparisonEvidenceDigest(review?.comparisonEvidenceRefs).toLowerCase()) {
    errors.push("verifiedPacketProof 未绑定当前 comparisonEvidenceRefs。 ");
  }
  const requiredChecks = [
    "packetDigestVerified",
    "sealedMappingDigestVerified",
    "reviewerResponseBound",
    "assetHashesVerified",
    "sourceBindingsVerified",
    "randomizedLabelsVerified",
    "completeBlindResponseVerified"
  ];
  if (!isRecord(proof.verification)
    || requiredChecks.some((field) => proof.verification[field] !== true)
    || Object.keys(proof.verification).some((field) => !requiredChecks.includes(field))) {
    errors.push("verifiedPacketProof.verification 必须完整且只能包含受信验证器签发的检查项。 ");
  }
  if (!isRecord(proof.boundaries)
    || proof.boundaries.sealedMappingExcludedFromReviewerPacket !== true
    || proof.boundaries.noOriginMetadataInReviewerPacket !== true
    || proof.boundaries.noAbsolutePathsInReviewerPacket !== true
    || proof.boundaries.uniformSingleAssetAnonymousGroups !== true
    || proof.boundaries.devBenchmarkOnly !== true) {
    errors.push("verifiedPacketProof.boundaries 不完整。 ");
  }
  if (!cleanString(proof.verifiedAt) || !Number.isFinite(Date.parse(proof.verifiedAt))) {
    errors.push("verifiedPacketProof.verifiedAt 必须是有效时间。 ");
  }

  const caseSpec = isRecord(context.caseSpec) ? context.caseSpec : undefined;
  const run = isRecord(context.run) ? context.run : undefined;
  const rubric = isRecord(context.rubric) ? context.rubric : undefined;
  if (caseSpec) {
    if (cleanString(proof.caseRef?.caseId) !== cleanString(caseSpec.caseId)
      || proof.caseRef?.revision !== caseSpec.revision
      || cleanString(proof.caseRef?.caseDigest).toLowerCase()
        !== cleanString(caseSpec.caseDigest).toLowerCase()) {
      errors.push("verifiedPacketProof.caseRef 与当前 Case 不一致。 ");
    }
  }
  if (run) {
    if (cleanString(proof.runObservationId) !== cleanString(run.runObservationId)) {
      errors.push("verifiedPacketProof 与当前 Run 不一致。 ");
    }
    if (cleanString(proof.caseRef?.caseDigest).toLowerCase()
      !== cleanString(run.caseRef?.caseDigest).toLowerCase()) {
      errors.push("verifiedPacketProof 没有绑定当前 Run 的 Case 摘要。 ");
    }
  }
  if (rubric && cleanString(proof.rubricDigest).toLowerCase() !== buildRubricDigest(rubric).toLowerCase()) {
    errors.push("verifiedPacketProof 没有绑定当前 Rubric 内容。 ");
  }
  if (caseSpec && run) {
    const expectedDigest = buildComparisonEvidenceDigest(
      buildExpectedComparisonEvidenceList(caseSpec, run)
    );
    if (cleanString(proof.comparisonEvidenceDigest).toLowerCase() !== expectedDigest.toLowerCase()) {
      errors.push("verifiedPacketProof 没有绑定当前 Case / Run 的完整比较证据集合。 ");
    }
  }
  return { ok: errors.length === 0, errors };
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

function buildRubricDigest(rubric) {
  const digestInput = cloneJson(rubric);
  delete digestInput.__file;
  return sha256Text(stableStringify(digestInput));
}

function isAbsoluteOrUnsafeRef(value) {
  const ref = cleanString(value);
  if (!ref) return true;
  if (/^eagle:item:[A-Za-z0-9._-]+$/.test(ref)) return false;
  if (/^file:/i.test(ref) || /^[a-z]+:\/\//i.test(ref)) return true;
  if (/^[a-z]:[\\/]/i.test(ref) || ref.startsWith("\\\\") || ref.startsWith("/")) return true;
  const normalized = ref.replace(/\\/g, "/");
  const typedPrefix = /^(candidate:|user-design:|receipt:|eagle:item:)/i.exec(normalized)?.[0] || "";
  const payload = typedPrefix ? normalized.slice(typedPrefix.length) : normalized;
  return normalized.split("/").includes("..")
    || /(?:^|:)[a-z]:\//i.test(normalized)
    || /(?:^|:)\//.test(normalized)
    || path.isAbsolute(payload)
    || /^[a-z]:\//i.test(payload)
    || payload.startsWith("/")
    || payload.startsWith("//")
    || payload.split("/").includes("..");
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

function validateGeneratedInput(input, fieldName, errors) {
  validateInputRef(input, fieldName, errors);
  if (!isRecord(input)) return;
  if (Object.keys(input).some((key) => !["ref", "role", "encoding", "facts"].includes(key))) {
    errors.push(`${fieldName} 含未声明字段，生成输入只能保存 ref/role/encoding/facts。`);
  }
  if (input.encoding !== "utf8") {
    errors.push(`${fieldName}.encoding 必须是 utf8。`);
  }
  if (!isRecord(input.facts) || Object.keys(input.facts).length === 0) {
    errors.push(`${fieldName}.facts 必须是非空结构化事实对象。`);
    return;
  }
  for (const key of Object.keys(input.facts)) {
    if (!FIXTURE_FACT_KEYS.has(key)) {
      errors.push(`${fieldName}.facts 含非事实字段：${key}。`);
    }
  }
  if (input.facts.available_colors !== undefined
    && (!Array.isArray(input.facts.available_colors)
      || input.facts.available_colors.length > 24
      || input.facts.available_colors.some((item) => (
        isInvalidSimpleFixtureFactLabel(item, 24)
      )))) {
    errors.push(`${fieldName}.facts.available_colors 必须是有界非空字符串数组。`);
  }
  if (input.facts.product_claims !== undefined) {
    if (!Array.isArray(input.facts.product_claims)
      || input.facts.product_claims.length > 24
      || input.facts.product_claims.some((claim) => (
        !isRecord(claim)
        || Object.keys(claim).some((key) => !["category", "value", "provenance"].includes(key))
        || Object.keys(claim).length !== 3
        || !PRODUCT_CLAIM_CATEGORIES.has(cleanString(claim.category))
        || !cleanString(claim.value)
        || isInvalidSimpleFixtureFactLabel(claim.value, 40)
        || !isRecord(claim.provenance)
        || Object.keys(claim.provenance).some((key) => !["kind", "ref"].includes(key))
        || Object.keys(claim.provenance).length !== 2
        || !PRODUCT_CLAIM_PROVENANCE_KINDS.has(cleanString(claim.provenance.kind))
        || isAbsoluteOrUnsafeRef(claim.provenance.ref)
      ))) {
      errors.push(`${fieldName}.facts.product_claims 必须是带受控 provenance 的原子商品事实，不能包含设计指令。`);
    }
  }
  if (input.facts.prohibited_claim_categories !== undefined
    && (!Array.isArray(input.facts.prohibited_claim_categories)
      || input.facts.prohibited_claim_categories.length > PROHIBITED_CLAIM_CATEGORIES.size
      || input.facts.prohibited_claim_categories.some((category) => (
        !PROHIBITED_CLAIM_CATEGORIES.has(cleanString(category))
      )))) {
    errors.push(`${fieldName}.facts.prohibited_claim_categories 含未受控类别。`);
  }
  if (input.facts.product_type !== undefined
    && isInvalidSimpleFixtureFactLabel(input.facts.product_type, 40)) {
    errors.push(`${fieldName}.facts.product_type 非法。`);
  }
  if (input.facts.source_encoding !== undefined
    && !["gbk", "utf8"].includes(cleanString(input.facts.source_encoding).toLowerCase())) {
    errors.push(`${fieldName}.facts.source_encoding 非法。`);
  }
  if (input.facts.source_asset_semantics !== undefined
    && input.facts.source_asset_semantics !== "completed_color_cards") {
    errors.push(`${fieldName}.facts.source_asset_semantics 非法。`);
  }
  if (input.facts.production_spec_semantics !== undefined
    && input.facts.production_spec_semantics !== "template_plus_color_indices") {
    errors.push(`${fieldName}.facts.production_spec_semantics 非法。`);
  }
  if (input.facts.color_mapping !== undefined) {
    const mapping = input.facts.color_mapping;
    if (!isRecord(mapping)
      || Object.keys(mapping).length === 0
      || Object.keys(mapping).some((key) => !/^\d{1,2}$/.test(key))
      || Object.values(mapping).some((value) => (
        !isRecord(value)
        || Object.keys(value).some((key) => !["sourceRef", "displayName"].includes(key))
        || Object.keys(value).length !== 2
        || isAbsoluteOrUnsafeRef(value.sourceRef)
        || isInvalidSimpleFixtureFactLabel(value.displayName, 24)
      ))) {
      errors.push(`${fieldName}.facts.color_mapping 必须是编号到 { sourceRef, displayName } 的受控映射。`);
    }
  }
}

function validateReviewRef(input, fieldName, errors) {
  if (!isRecord(input)) {
    errors.push(`${fieldName} 必须是对象。`);
    return;
  }
  const kind = cleanString(input.kind);
  const ref = cleanString(input.ref);
  const digest = cleanString(input.digest).toLowerCase();
  if (!kind || !ref || !digest) {
    errors.push(`${fieldName} 需要 kind、ref 与冻结 digest。`);
    return;
  }
  if (!['user_design', 'eagle_item'].includes(kind)) {
    errors.push(`${fieldName}.kind 非法。`);
  }
  if (!isSha256Digest(digest)) {
    errors.push(`${fieldName}.digest 必须是 sha256:<64 hex>。`);
  }
  if (kind === "eagle_item") {
    if (!/^eagle:item:[A-Za-z0-9._-]+$/.test(ref)) {
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
    if (caseSpec.task.fixtureGeneratedInputs !== undefined) {
      if (!Array.isArray(caseSpec.task.fixtureGeneratedInputs)) {
        errors.push("task.fixtureGeneratedInputs 必须是数组。 ");
      } else {
        caseSpec.task.fixtureGeneratedInputs.forEach((item, index) => {
          validateGeneratedInput(item, `task.fixtureGeneratedInputs[${index}]`, errors);
        });
        const visibleRefs = new Set(
          (caseSpec.task.agentVisibleInputs || []).map((item) => cleanString(item?.ref).replace(/\\/g, "/"))
        );
        for (const generated of caseSpec.task.fixtureGeneratedInputs) {
          if (visibleRefs.has(cleanString(generated?.ref).replace(/\\/g, "/"))) {
            errors.push("fixtureGeneratedInputs 不能覆盖 source-root 中声明的 Agent 输入。 ");
          }
          for (const claim of Array.isArray(generated?.facts?.product_claims)
            ? generated.facts.product_claims
            : []) {
            const provenanceRef = cleanString(claim?.provenance?.ref).replace(/\\/g, "/");
            if (provenanceRef && !visibleRefs.has(provenanceRef)) {
              errors.push(`fixtureGeneratedInputs 的 claim provenance 必须绑定 Agent 可见源输入：${provenanceRef}。`);
            }
          }
          for (const mapping of Object.values(isRecord(generated?.facts?.color_mapping)
            ? generated.facts.color_mapping
            : {})) {
            const sourceRef = cleanString(mapping?.sourceRef).replace(/\\/g, "/");
            if (sourceRef && !visibleRefs.has(sourceRef)) {
              errors.push(`fixtureGeneratedInputs 的 color_mapping sourceRef 必须绑定 Agent 可见源输入：${sourceRef}。`);
            }
          }
        }
        if (caseSpec.task.fixtureGeneratedInputs.length > 0
          && caseSpec.boundaries?.fixtureGeneratedInputsContainFactsOnly !== true) {
          errors.push("包含 fixtureGeneratedInputs 时必须声明只含事实、不含设计预设。 ");
        }
      }
    }
    if (!Array.isArray(caseSpec.task.reviewOnlyReferences)) {
      errors.push("task.reviewOnlyReferences 必须是数组。");
    } else {
      caseSpec.task.reviewOnlyReferences.forEach((item, index) => {
        validateReviewRef(item, `task.reviewOnlyReferences[${index}]`, errors);
      });
      const reviewDigests = caseSpec.task.reviewOnlyReferences
        .map((item) => cleanString(item?.digest).toLowerCase())
        .filter(Boolean);
      if (new Set(reviewDigests).size !== reviewDigests.length) {
        errors.push("task.reviewOnlyReferences 不能冻结重复内容摘要。 ");
      }
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
    if (caseSpec.taskFamily === "sku") {
      const expectedRasterRefs = caseSpec.oracle?.outputInventory?.expectedRasterRefs;
      const expectedEditableRefs = caseSpec.oracle?.outputInventory?.expectedEditableRefs;
      const exactRasterExports = Number(caseSpec.oracle?.outputInventory?.exactRasterExports);
      const exactEditableDocuments = Number(caseSpec.oracle?.outputInventory?.exactEditableDocuments);
      if (!Number.isInteger(exactRasterExports)
        || exactRasterExports < 1
        || !Array.isArray(expectedRasterRefs)
        || expectedRasterRefs.length !== exactRasterExports
        || new Set(expectedRasterRefs.map((ref) => cleanString(ref).replace(/\\/g, "/"))).size !== exactRasterExports
        || expectedRasterRefs.some(isAbsoluteOrUnsafeRef)) {
        errors.push("SKU oracle.outputInventory 必须逐项冻结安全、唯一的 expectedRasterRefs，不能只记录数量。 ");
      }
      if (!Number.isInteger(exactEditableDocuments)
        || exactEditableDocuments < 1
        || !Array.isArray(expectedEditableRefs)
        || expectedEditableRefs.length !== exactEditableDocuments
        || new Set(expectedEditableRefs.map((ref) => cleanString(ref).replace(/\\/g, "/"))).size !== exactEditableDocuments
        || expectedEditableRefs.some(isAbsoluteOrUnsafeRef)) {
        errors.push("SKU oracle.outputInventory 必须逐项冻结安全、唯一的 expectedEditableRefs。 ");
      }
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

function buildDecisionPreservationObservation(caseSpec, flattenedCalls, finalRecord) {
  const attemptedDesignMutations = flattenedCalls.filter((entry) => (
    entry.call?.activityClass === "mutation"
    && !DELIVERY_TOOLS.has(cleanString(entry.call?.name))
  ));
  const committedDesignMutations = attemptedDesignMutations.filter((entry) => (
    hasCommittedMutation(entry.call)
  ));
  const modelOwnedAttemptCount = attemptedDesignMutations.filter((entry) => (
    cleanString(entry.call?.origin) === "model_tool_call"
  )).length;
  const harnessAttemptCount = attemptedDesignMutations.filter((entry) => (
    HARNESS_TOOL_ORIGINS.has(cleanString(entry.call?.origin))
  )).length;
  const unattributedAttemptCount = Math.max(
    0,
    attemptedDesignMutations.length - modelOwnedAttemptCount - harnessAttemptCount
  );
  const modelOwnedCommittedMutationCount = committedDesignMutations.filter((entry) => (
    cleanString(entry.call?.origin) === "model_tool_call"
  )).length;
  const harnessCommittedMutationCount = committedDesignMutations.filter((entry) => (
    HARNESS_TOOL_ORIGINS.has(cleanString(entry.call?.origin))
  )).length;
  const unattributedCommittedMutationCount = Math.max(
    0,
    committedDesignMutations.length
      - modelOwnedCommittedMutationCount
      - harnessCommittedMutationCount
  );
  let status = "unscorable";
  let reason = committedDesignMutations.length === 0
    ? "当前运行没有已提交的设计写入，不能判断成稿的决策归属。"
    : "当前运行没有足够的已提交设计写入来源证据。";
  if (caseSpec.executionModel === "agentic" && harnessCommittedMutationCount > 0) {
    status = "failed";
    reason = "Agentic 设计中观察到 Harness-origin 的已提交设计写入。";
  } else if (caseSpec.executionModel === "agentic"
    && committedDesignMutations.length > 0
    && modelOwnedCommittedMutationCount === committedDesignMutations.length) {
    status = "passed";
    reason = "所有已提交设计写入均由 model_tool_call 发起，未观察到 Harness 提交设计改动。";
  } else if (caseSpec.executionModel === "staged") {
    reason = "Staged 生产允许 Harness 执行已签名计划；缺参数等价收据时保持不可评分。";
  }
  if (caseSpec.executionModel === "agentic" && harnessAttemptCount > harnessCommittedMutationCount) {
    reason += ` 另观察到 ${harnessAttemptCount - harnessCommittedMutationCount} 次未提交的 Harness-origin 写入尝试；只记为边界诊断，不冒充成稿变化。`;
  }
  const evidenceScope = finalRecord?.quality?.finalQualityModelProtocol?.evidenceScope;
  return {
    version: DECISION_PRESERVATION_VERSION,
    status,
    basis: "tool_origin_level_1",
    attemptedDesignMutationCount: attemptedDesignMutations.length,
    committedDesignMutationCount: committedDesignMutations.length,
    modelOwnedAttemptCount,
    harnessAttemptCount,
    unattributedAttemptCount,
    modelOwnedCommittedMutationCount,
    harnessCommittedMutationCount,
    unattributedCommittedMutationCount,
    harnessWriteAttemptObserved: caseSpec.executionModel === "agentic" && harnessAttemptCount > 0,
    modelIntentDeclared: flattenedCalls.some((entry) => (
      entry.call?.name === "declareDesignIntent"
      && entry.call?.success === true
      && entry.call?.origin === "model_tool_call"
    )),
    comparisonEvidenceScope: {
      finalArtifactObserved: evidenceScope?.finalArtifactObserved === true,
      selectedSourceCompared: evidenceScope?.selectedSourceCompared === true,
      declaredReferenceCompared: evidenceScope?.declaredReferenceCompared === true,
      candidateSetCompared: evidenceScope?.candidateSetCompared === true
    },
    reason,
    boundaries: {
      levelOneOriginEvidenceOnly: true,
      strongParameterEquivalenceAvailable: false,
      neverAffectsRuntime: true,
      doesNotJudgeAesthetics: true
    }
  };
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

function resolveTaskRunModelCalls(sortedRecords) {
  const finalAccounting = sortedRecords.at(-1)?.runtimeSession?.accounting;
  if (finalAccounting?.version === "runtime-accounting-digest/v0"
    && Number.isSafeInteger(finalAccounting.modelCallCount)
    && finalAccounting.modelCallCount >= 0) {
    return finalAccounting.modelCallCount;
  }
  return sortedRecords.reduce((count, record) => {
    const accounting = record?.runtimeSession?.accounting || record?.runtimeAccounting;
    return count + (Number.isSafeInteger(accounting?.modelCallCount) ? accounting.modelCallCount : 0);
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

function normalizeFinalArtifactManifest(value) {
  if (!isRecord(value) || value.declaredBy !== "agent_delivery_receipt") return undefined;
  const artifacts = (Array.isArray(value.artifacts) ? value.artifacts : []).map((candidate) => ({
    kind: cleanString(candidate?.kind),
    ref: cleanString(candidate?.ref).replace(/\\/g, "/"),
    digest: cleanString(candidate?.digest).toLowerCase()
  }));
  artifacts.sort((left, right) => left.ref.localeCompare(right.ref) || left.kind.localeCompare(right.kind));
  return {
    version: "design-reliability-final-artifact-manifest/v1",
    declaredBy: "agent_delivery_receipt",
    artifacts,
    manifestDigest: sha256Text(stableStringify(artifacts))
  };
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
    paired_editable_delivery_receipt: facts.pairedEditableDeliveryReceipt,
    sku_structure_readback_set: facts.skuStructureReadbackSet,
    sku_visual_readback_set: facts.skuVisualReadbackSet,
    sku_pair_binding: facts.skuPairBinding,
    editable_psd_evidence: facts.editablePsdEvidence,
    raster_export_evidence: facts.rasterExportEvidence,
    sku_output_inventory_evidence: facts.skuOutputInventoryEvidence,
    final_artifact_manifest_evidence: facts.finalArtifactManifestEvidence,
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
    return "waiting_user";
  }
  const runtimeStatus = cleanString(record?.runtimeSession?.taskRun?.status);
  if (runtimeStatus === "completed") return "completed";
  if (runtimeStatus === "waiting_user") return "waiting_user";
  if (runtimeStatus === "needs_review") return "needs_review";
  if (runtimeStatus === "failed") return "failed";
  const executionStatus = cleanString(record?.quality?.executionStatus);
  if (executionStatus === "completed") return "completed";
  if (executionStatus === "needs_review") return "needs_review";
  if (executionStatus === "awaiting_confirmation") return "waiting_user";
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
  if (input.runStatus === "waiting_user") {
    symptoms.push({
      code: "user_intervention_required_before_completion",
      phase: "interaction",
      failureMode: "interaction",
      evidence: "agent_run_record.stopReason / runtimeSession.taskRun.status"
    });
  }
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
  const decisionPreservation = buildDecisionPreservationObservation(
    caseSpec,
    flattened.calls,
    finalRecord
  );
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
  const finalArtifactManifest = normalizeFinalArtifactManifest(input.finalArtifactManifest);
  const finalArtifactManifestErrors = [];
  validateFinalArtifactManifest(finalArtifactManifest, evidenceRefs, caseSpec, finalArtifactManifestErrors);
  const runStatus = resolveRunStatus(finalRecord);
  // 技术交付与人工审美是两条分母：needs_review 表示完整成稿只等待开发侧人工审美评审；
  // waiting_user 表示产品任务仍在等用户输入 / 确认，不是技术终态，不能以完整收据掩盖自主完成失败。
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
    pairedEditableDeliveryReceipt: hasEvidence(evidenceRefs, "paired_editable_delivery_receipt"),
    skuStructureReadbackSet: hasEvidence(evidenceRefs, "sku_structure_readback_set"),
    skuVisualReadbackSet: hasEvidence(evidenceRefs, "sku_visual_readback_set"),
    skuPairBinding: hasEvidence(evidenceRefs, "sku_pair_binding"),
    editablePsdEvidence: hasEvidence(evidenceRefs, "editable_psd"),
    rasterExportEvidence: hasEvidence(evidenceRefs, "raster_export"),
    skuOutputInventoryEvidence: hasEvidence(evidenceRefs, "sku_output_inventory"),
    fixtureInstanceEvidence: hasEvidence(evidenceRefs, "fixture_instance"),
    runtimeModelIdentityEvidence: hasEvidence(evidenceRefs, "runtime_model_identity"),
    expectedProjectBindingEvidence: hasEvidence(evidenceRefs, "expected_project_binding"),
    sourceInputIntegrityEvidence: hasEvidence(evidenceRefs, "source_input_integrity"),
    finalArtifactManifestEvidence: finalArtifactManifestErrors.length === 0,
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
  const modelCallCount = resolveTaskRunModelCalls(flattened.sortedRecords);
  const missingEvidence = [];
  if (!userInterventionKnown) missingEvidence.push("user_intervention_count");
  if (!facts.editablePsdEvidence) missingEvidence.push("editable_psd");
  if (!facts.rasterExportEvidence) missingEvidence.push("raster_export");
  if (caseSpec?.taskFamily === "sku") {
    if (!facts.pairedEditableDeliveryReceipt) missingEvidence.push("paired_editable_delivery_receipt");
    if (!facts.skuStructureReadbackSet) missingEvidence.push("sku_structure_readback_set");
    if (!facts.skuVisualReadbackSet) missingEvidence.push("sku_visual_readback_set");
    if (!facts.skuPairBinding) missingEvidence.push("sku_pair_binding");
  } else {
    if (!facts.postWriteStructureReadback) missingEvidence.push("post_write_structure_readback");
    if (!facts.postWriteVisualReadback) missingEvidence.push("post_write_visual_readback");
    if (!facts.postWriteReadbackTargetVerified) missingEvidence.push("post_write_readback_target_verified");
  }
  if (!facts.expectedProjectBindingEvidence) missingEvidence.push("expected_project_binding");
  if (!facts.fixtureInstanceEvidence) missingEvidence.push("fixture_instance");
  if (!facts.runtimeModelIdentityEvidence) missingEvidence.push("runtime_model_identity");
  if (!facts.sourceInputIntegrityEvidence) missingEvidence.push("source_input_integrity");
  if (!facts.finalArtifactManifestEvidence) missingEvidence.push("final_artifact_manifest");
  const symptoms = buildObservedSymptoms({
    ...facts,
    runStatus,
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
      ...(cleanString(environment.attemptId) ? { attemptId: cleanString(environment.attemptId) } : {}),
      ...(cleanString(environment.attemptFingerprint)
        ? { attemptFingerprint: cleanString(environment.attemptFingerprint) }
        : {}),
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
      ...(cleanString(environment.requestedModelId)
        ? { requestedModelId: cleanString(environment.requestedModelId) }
        : {}),
      executionModel: caseSpec.executionModel,
      skillIds: actualSkillIds,
      taskTypes: [...new Set(flattened.sortedRecords.map((record) => cleanString(record?.runtimeSession?.taskType)).filter(Boolean))],
      ...(cleanString(input.fixtureDigest) ? { fixtureDigest: cleanString(input.fixtureDigest) } : {}),
      ...(cleanString(environment.runtimeGitCommit)
        ? { runtimeGitCommit: cleanString(environment.runtimeGitCommit) }
        : {}),
      ...(cleanString(environment.runtimeBuildId)
        ? { runtimeBuildId: cleanString(environment.runtimeBuildId) }
        : {}),
      ...(cleanString(environment.runtimeAppVersion)
        ? { runtimeAppVersion: cleanString(environment.runtimeAppVersion) }
        : {}),
      ...(cleanString(environment.photoshopRuntimeBuildId)
        ? { photoshopRuntimeBuildId: cleanString(environment.photoshopRuntimeBuildId) }
        : {}),
      ...(cleanString(environment.photoshopRuntimeBindingDigest)
        ? { photoshopRuntimeBindingDigest: cleanString(environment.photoshopRuntimeBindingDigest) }
        : {}),
      ...(Number.isFinite(environment.timeoutMs) ? { timeoutMs: Math.round(environment.timeoutMs) } : {}),
      ...(cleanString(environment.instructionDigest)
        ? { instructionDigest: cleanString(environment.instructionDigest) }
        : {}),
      ...(cleanString(environment.rubricDigest)
        ? { rubricDigest: cleanString(environment.rubricDigest) }
        : {}),
      ...(cleanString(environment.fixtureInstanceId)
        ? { fixtureInstanceId: cleanString(environment.fixtureInstanceId) }
        : {}),
      ...(cleanString(environment.suiteCaseSetDigest)
        ? { suiteCaseSetDigest: cleanString(environment.suiteCaseSetDigest) }
        : {}),
      ...(cleanString(environment.suiteRubricSetDigest)
        ? { suiteRubricSetDigest: cleanString(environment.suiteRubricSetDigest) }
        : {}),
      ...(cleanString(environment.cohortFingerprint)
        ? { cohortFingerprint: cleanString(environment.cohortFingerprint) }
        : {})
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
      decisionPreservation,
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
    ...(finalArtifactManifest ? { finalArtifactManifest } : {}),
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
  if (isAbsoluteOrUnsafeRef(evidence.ref)) {
    errors.push(`${fieldName}.ref 不得保存绝对路径、URL 或目录穿越。`);
  }
  if (evidence.digest !== undefined && !/^sha256:[a-f0-9]{64}$/i.test(cleanString(evidence.digest))) {
    errors.push(`${fieldName}.digest 必须是 sha256:<64 hex>。`);
  }
}

function validateFinalArtifactManifest(manifest, evidenceRefs, caseSpec, errors) {
  if (!isRecord(manifest)) {
    errors.push("finalArtifactManifest 必须是对象。");
    return;
  }
  if (manifest.version !== "design-reliability-final-artifact-manifest/v1") {
    errors.push("finalArtifactManifest.version 非法。");
  }
  if (manifest.declaredBy !== "agent_delivery_receipt") {
    errors.push("finalArtifactManifest.declaredBy 必须是 agent_delivery_receipt，不能由评测器猜测最终交付。");
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    errors.push("finalArtifactManifest.artifacts 不能为空。");
    return;
  }
  const evidenceByRef = new Map((Array.isArray(evidenceRefs) ? evidenceRefs : []).map((item) => [
    cleanString(item?.ref).replace(/\\/g, "/"),
    item
  ]));
  const identities = new Set();
  for (let index = 0; index < manifest.artifacts.length; index += 1) {
    const artifact = manifest.artifacts[index];
    const fieldName = `finalArtifactManifest.artifacts[${index}]`;
    if (!isRecord(artifact)) {
      errors.push(`${fieldName} 必须是对象。`);
      continue;
    }
    const kind = cleanString(artifact.kind);
    const ref = cleanString(artifact.ref).replace(/\\/g, "/");
    const digest = cleanString(artifact.digest).toLowerCase();
    if (!["editable_psd", "raster_export"].includes(kind)) {
      errors.push(`${fieldName}.kind 只能是 editable_psd 或 raster_export。`);
    }
    if (isAbsoluteOrUnsafeRef(ref)) errors.push(`${fieldName}.ref 必须是安全的项目相对路径。`);
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) errors.push(`${fieldName}.digest 非法。`);
    const evidence = evidenceByRef.get(ref);
    if (!evidence
      || cleanString(evidence.kind) !== kind
      || evidence.verified !== true
      || cleanString(evidence.digest).toLowerCase() !== digest) {
      errors.push(`${fieldName} 未精确绑定同一 Run 的已验证产物证据。`);
    }
    const identity = `${kind}\u0000${ref}`;
    if (identities.has(identity)) errors.push("finalArtifactManifest.artifacts 不能重复。");
    identities.add(identity);
  }
  const editableCount = manifest.artifacts.filter((item) => item?.kind === "editable_psd").length;
  const editableRefs = manifest.artifacts
    .filter((item) => item?.kind === "editable_psd")
    .map((item) => cleanString(item.ref).replace(/\\/g, "/"))
    .sort();
  const rasterRefs = manifest.artifacts
    .filter((item) => item?.kind === "raster_export")
    .map((item) => cleanString(item.ref).replace(/\\/g, "/"))
    .sort();
  if (editableCount < 1) errors.push("finalArtifactManifest 至少需要一个可编辑 PSD/PSB 最终交付。");
  if (rasterRefs.length < 1) errors.push("finalArtifactManifest 至少需要一个最终位图交付。");
  if (caseSpec?.taskFamily === "sku") {
    const expectedRefs = [...new Set(
      Array.isArray(caseSpec?.oracle?.outputInventory?.expectedRasterRefs)
        ? caseSpec.oracle.outputInventory.expectedRasterRefs.map((ref) => cleanString(ref).replace(/\\/g, "/"))
        : []
    )].sort();
    const expectedEditableRefs = [...new Set(
      Array.isArray(caseSpec?.oracle?.outputInventory?.expectedEditableRefs)
        ? caseSpec.oracle.outputInventory.expectedEditableRefs.map((ref) => cleanString(ref).replace(/\\/g, "/"))
        : []
    )].sort();
    if (expectedRefs.length === 0) {
      errors.push("SKU Case 缺少 oracle.outputInventory.expectedRasterRefs，不能只按数量冒充完整交付。");
    } else if (stableStringify(rasterRefs) !== stableStringify(expectedRefs)) {
      errors.push("SKU finalArtifactManifest 必须逐项匹配 Case 冻结的 expectedRasterRefs。");
    }
    if (expectedEditableRefs.length === 0) {
      errors.push("SKU Case 缺少 oracle.outputInventory.expectedEditableRefs。");
    } else if (stableStringify(editableRefs) !== stableStringify(expectedEditableRefs)) {
      errors.push("SKU finalArtifactManifest 必须逐项匹配 Case 冻结的 expectedEditableRefs。");
    }
  }
  const expectedDigest = sha256Text(stableStringify(manifest.artifacts.map((artifact) => ({
    kind: cleanString(artifact?.kind),
    ref: cleanString(artifact?.ref).replace(/\\/g, "/"),
    digest: cleanString(artifact?.digest).toLowerCase()
  }))));
  if (cleanString(manifest.manifestDigest) !== expectedDigest) {
    errors.push(`finalArtifactManifest.manifestDigest 不匹配；期望 ${expectedDigest}。`);
  }
}

function validateDecisionPreservationObservation(observation, executionModel, errors) {
  if (observation === undefined) return;
  if (!isRecord(observation)) {
    errors.push("observed.decisionPreservation 必须是对象。");
    return;
  }
  if (observation.version !== DECISION_PRESERVATION_VERSION) {
    errors.push(`observed.decisionPreservation.version 必须是 ${DECISION_PRESERVATION_VERSION}。`);
  }
  if (!DECISION_PRESERVATION_STATUSES.includes(observation.status)) {
    errors.push("observed.decisionPreservation.status 非法。");
  }
  if (observation.basis !== "tool_origin_level_1") {
    errors.push("observed.decisionPreservation.basis 必须是 tool_origin_level_1。");
  }
  const countFields = [
    "attemptedDesignMutationCount",
    "committedDesignMutationCount",
    "modelOwnedAttemptCount",
    "harnessAttemptCount",
    "unattributedAttemptCount",
    "modelOwnedCommittedMutationCount",
    "harnessCommittedMutationCount",
    "unattributedCommittedMutationCount"
  ];
  for (const field of countFields) {
    if (!Number.isSafeInteger(observation[field]) || observation[field] < 0) {
      errors.push(`observed.decisionPreservation.${field} 必须是非负整数。`);
    }
  }
  if (Number.isSafeInteger(observation.attemptedDesignMutationCount)
    && Number.isSafeInteger(observation.modelOwnedAttemptCount)
    && Number.isSafeInteger(observation.harnessAttemptCount)
    && Number.isSafeInteger(observation.unattributedAttemptCount)
    && observation.attemptedDesignMutationCount !== observation.modelOwnedAttemptCount
      + observation.harnessAttemptCount
      + observation.unattributedAttemptCount) {
    errors.push("observed.decisionPreservation 的尝试来源计数与设计写入尝试总数不一致。");
  }
  if (Number.isSafeInteger(observation.committedDesignMutationCount)
    && Number.isSafeInteger(observation.modelOwnedCommittedMutationCount)
    && Number.isSafeInteger(observation.harnessCommittedMutationCount)
    && Number.isSafeInteger(observation.unattributedCommittedMutationCount)
    && observation.committedDesignMutationCount !== observation.modelOwnedCommittedMutationCount
      + observation.harnessCommittedMutationCount
      + observation.unattributedCommittedMutationCount) {
    errors.push("observed.decisionPreservation 的提交来源计数与已提交设计写入总数不一致。");
  }
  if (Number.isSafeInteger(observation.committedDesignMutationCount)
    && Number.isSafeInteger(observation.attemptedDesignMutationCount)
    && observation.committedDesignMutationCount > observation.attemptedDesignMutationCount) {
    errors.push("committedDesignMutationCount 不能大于 attemptedDesignMutationCount。");
  }
  if (typeof observation.harnessWriteAttemptObserved !== "boolean") {
    errors.push("observed.decisionPreservation.harnessWriteAttemptObserved 必须是布尔值。");
  } else if (Number.isSafeInteger(observation.harnessAttemptCount)
    && observation.harnessWriteAttemptObserved !== (
      executionModel === "agentic" && observation.harnessAttemptCount > 0
    )) {
    errors.push("harnessWriteAttemptObserved 与 Agentic Harness 尝试计数不一致。");
  }
  if (typeof observation.modelIntentDeclared !== "boolean") {
    errors.push("observed.decisionPreservation.modelIntentDeclared 必须是布尔值。");
  }
  if (!isRecord(observation.comparisonEvidenceScope)
    || typeof observation.comparisonEvidenceScope.finalArtifactObserved !== "boolean"
    || typeof observation.comparisonEvidenceScope.selectedSourceCompared !== "boolean"
    || typeof observation.comparisonEvidenceScope.declaredReferenceCompared !== "boolean"
    || typeof observation.comparisonEvidenceScope.candidateSetCompared !== "boolean") {
    errors.push("observed.decisionPreservation.comparisonEvidenceScope 不完整。");
  }
  if (!cleanString(observation.reason)) {
    errors.push("observed.decisionPreservation.reason 不能为空。");
  }
  if (!isRecord(observation.boundaries)
    || observation.boundaries.levelOneOriginEvidenceOnly !== true
    || observation.boundaries.strongParameterEquivalenceAvailable !== false
    || observation.boundaries.neverAffectsRuntime !== true
    || observation.boundaries.doesNotJudgeAesthetics !== true) {
    errors.push("observed.decisionPreservation.boundaries 不完整。");
  }
  if (executionModel === "staged" && observation.status !== "unscorable") {
    errors.push("Staged 运行缺少参数等价收据时，decisionPreservation 必须保持 unscorable。");
  }
  let expectedStatus = "unscorable";
  if (executionModel === "agentic" && observation.harnessCommittedMutationCount > 0) {
    expectedStatus = "failed";
  } else if (executionModel === "agentic"
    && observation.committedDesignMutationCount > 0
    && observation.modelOwnedCommittedMutationCount === observation.committedDesignMutationCount) {
    expectedStatus = "passed";
  }
  if (DECISION_PRESERVATION_STATUSES.includes(observation.status)
    && observation.status !== expectedStatus) {
    errors.push(`observed.decisionPreservation.status 与提交事实不一致；期望 ${expectedStatus}。`);
  }
  if (observation.status === "passed"
    && (executionModel !== "agentic"
      || observation.committedDesignMutationCount <= 0
      || observation.modelOwnedCommittedMutationCount !== observation.committedDesignMutationCount
      || observation.harnessCommittedMutationCount !== 0
      || observation.unattributedCommittedMutationCount !== 0)) {
    errors.push("decisionPreservation=passed 要求 Agentic 已提交设计写入全部来自模型调用。");
  }
  if (observation.status === "failed"
    && (executionModel !== "agentic" || observation.harnessCommittedMutationCount <= 0)) {
    errors.push("decisionPreservation=failed 必须有 Agentic Harness-origin 已提交设计写入证据。");
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
  validateDecisionPreservationObservation(
    run.observed?.decisionPreservation,
    cleanString(run.cohortDimensions?.executionModel),
    errors
  );
  if (!Array.isArray(run.evidenceRefs)) {
    errors.push("evidenceRefs 必须是数组。");
  } else {
    run.evidenceRefs.forEach((evidence, index) => validateEvidenceRef(evidence, `evidenceRefs[${index}]`, errors));
  }
  if (run.finalArtifactManifest !== undefined) {
    validateFinalArtifactManifest(run.finalArtifactManifest, run.evidenceRefs, undefined, errors);
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

function validateDesignReliabilityReview(review, context = {}) {
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
  if (!PAIRWISE_OUTCOMES.includes(review.pairwiseOutcome)) {
    errors.push(`pairwiseOutcome 必须是 ${PAIRWISE_OUTCOMES.join(" / ")}。`);
  }
  if (typeof review.blindedToCohort !== "boolean") errors.push("blindedToCohort 必须是布尔值。");
  if (review.blindedToCandidateOrigin !== undefined
    && typeof review.blindedToCandidateOrigin !== "boolean") {
    errors.push("blindedToCandidateOrigin 必须是布尔值。");
  }
  const comparisonEvidenceKinds = uniqueCleanStrings(review.comparisonEvidenceKinds);
  if (review.comparisonEvidenceKinds !== undefined) {
    if (!Array.isArray(review.comparisonEvidenceKinds)) {
      errors.push("comparisonEvidenceKinds 必须是数组。");
    } else {
      const invalidKinds = comparisonEvidenceKinds.filter((kind) => !COMPARISON_EVIDENCE_KINDS.includes(kind));
      if (invalidKinds.length > 0) {
        errors.push(`comparisonEvidenceKinds 含非法类型：${invalidKinds.join("、")}。`);
      }
      if (comparisonEvidenceKinds.length !== review.comparisonEvidenceKinds.length) {
        errors.push("comparisonEvidenceKinds 不能包含空值或重复项。");
      }
    }
  }
  const evidenceRefs = uniqueCleanStrings(review.evidenceRefs);
  if (Array.isArray(review.evidenceRefs)) {
    if (evidenceRefs.length !== review.evidenceRefs.length) {
      errors.push("evidenceRefs 不能包含空值或重复项。 ");
    }
    for (let index = 0; index < evidenceRefs.length; index += 1) {
      if (!isSafeReviewEvidenceRef(evidenceRefs[index])) {
        errors.push(`evidenceRefs[${index}] 不能包含绝对路径、URL 或目录穿越。`);
      }
    }
  }
  const evidenceProtocol = cleanString(review.evidenceProtocol);
  if (!REVIEW_EVIDENCE_PROTOCOLS.includes(evidenceProtocol)) {
    errors.push(`evidenceProtocol 必须是 ${REVIEW_EVIDENCE_PROTOCOLS.join(" / ")}。`);
  }
  if (evidenceProtocol === "anonymous_packet_verified" && !isRecord(review.verifiedPacketProof)) {
    errors.push("anonymous_packet_verified 必须携带受信验证器签发的 verifiedPacketProof。 ");
  }
  if (evidenceProtocol !== "anonymous_packet_verified" && review.verifiedPacketProof !== undefined) {
    errors.push("只有 anonymous_packet_verified 可以携带 verifiedPacketProof。 ");
  }
  const comparisonEvidenceRefs = validateComparisonEvidenceRefs(
    review.comparisonEvidenceRefs,
    evidenceRefs,
    errors
  );
  const comparisonEvidenceKindsFromRefs = uniqueCleanStrings(
    comparisonEvidenceRefs.map((item) => item.kind)
  );
  if (review.comparisonEvidenceRefs !== undefined
    && comparisonEvidenceKinds.slice().sort().join("\u0000")
      !== comparisonEvidenceKindsFromRefs.slice().sort().join("\u0000")) {
    errors.push("comparisonEvidenceKinds 必须由 comparisonEvidenceRefs 一一推导。 ");
  }
  if (review.weightedOverall !== undefined
    && (!isFiniteNumber(review.weightedOverall) || review.weightedOverall < 0 || review.weightedOverall > 1)) {
    errors.push("weightedOverall 必须是 0..1。");
  }
  if (review.blockers !== undefined) {
    if (!Array.isArray(review.blockers)) {
      errors.push("blockers 必须是数组。");
    } else if (uniqueCleanStrings(review.blockers).length !== review.blockers.length) {
      errors.push("blockers 不能包含空值或重复项。");
    }
  }
  if (review.missingEvidence !== undefined && !Array.isArray(review.missingEvidence)) {
    errors.push("missingEvidence 必须是数组。");
  }
  if (!Array.isArray(review.evidenceRefs) || review.evidenceRefs.length === 0) {
    errors.push("人工评审至少需要一个证据引用。");
  }
  if (!isRecord(review.boundaries)
    || review.boundaries.devBenchmarkSidecarOnly !== true
    || review.boundaries.neverAffectsRuntime !== true) {
    errors.push("Review 边界声明不完整。 ");
  }

  const rubric = isRecord(context.rubric) ? context.rubric : undefined;
  const caseSpec = isRecord(context.caseSpec) ? context.caseSpec : undefined;
  const run = isRecord(context.run) ? context.run : undefined;
  if (evidenceProtocol === "anonymous_packet_verified" && isRecord(review.verifiedPacketProof)) {
    const proofValidation = validateVerifiedReviewPacketProof(
      review.verifiedPacketProof,
      review,
      { rubric, caseSpec, run }
    );
    errors.push(...proofValidation.errors);
  }
  if (rubric && cleanString(review.rubricId) !== cleanString(rubric.rubricId)) {
    errors.push("Review rubricId 与当前 rubric 不一致。");
  }
  if (rubric && cleanString(review.rubricDigest) !== buildRubricDigest(rubric)) {
    errors.push("Review rubricDigest 与当前 rubric 内容不一致。");
  }
  if (!/^sha256:[a-f0-9]{64}$/i.test(cleanString(review.rubricDigest))) {
    errors.push("Review rubricDigest 必须是 sha256:<64 hex>。");
  }
  if (caseSpec && cleanString(review.rubricId) !== cleanString(caseSpec.oracle?.rubricId)) {
    errors.push("Review rubricId 与固定 Case 不一致。");
  }
  if (run && cleanString(review.runObservationId) !== cleanString(run.runObservationId)) {
    errors.push("Review runObservationId 与当前 Run 不一致。");
  }
  if (run && caseSpec && cleanString(run.caseRef?.caseId) !== cleanString(caseSpec.caseId)) {
    errors.push("当前 Run 与固定 Case 不一致。");
  }
  const hasBlindProtocolFields = review.weightedOverall !== undefined
    || review.blindedToCandidateOrigin !== undefined
    || review.comparisonEvidenceKinds !== undefined
    || review.comparisonEvidenceRefs !== undefined
    || review.blockers !== undefined;
  const enforceBlindProtocol = context.enforceBlindProtocol === true
    || hasBlindProtocolFields
    || review.decision === "pass";
  const scoreable = review.decision !== "unscorable";

  if (enforceBlindProtocol && scoreable) {
    if (review.blindedToCohort !== true) errors.push("可评分结果必须对 cohort 保持盲评。");
    if (review.blindedToCandidateOrigin !== true) {
      errors.push("可评分结果必须确认 blindedToCandidateOrigin=true。");
    }
    if (!isFiniteNumber(review.weightedOverall)) errors.push("可评分结果必须包含自动计算的 weightedOverall。");
    if (!Array.isArray(review.comparisonEvidenceRefs) || comparisonEvidenceRefs.length === 0) {
      errors.push("可评分结果必须包含逐项绑定的 comparisonEvidenceRefs。 ");
    }
    if (review.pairwiseOutcome === "unscorable") {
      errors.push("可评分结果的 pairwiseOutcome 不能是 unscorable。");
    }
    const requiredKinds = caseSpec
      ? requiredComparisonEvidenceKinds(caseSpec)
      : [
          "candidate_final",
          ...(comparisonEvidenceKinds.some((kind) => kind === "user_design_anchor" || kind === "eagle_anchor")
            ? []
            : ["applicable_reference_anchor"])
        ];
    for (const kind of requiredKinds) {
      if (kind === "applicable_reference_anchor") {
        errors.push("可评分结果至少需要 user_design_anchor 或 eagle_anchor。");
      } else if (!comparisonEvidenceKindsFromRefs.includes(kind)) {
        errors.push(`可评分结果缺少 comparisonEvidenceRefs：${kind}。`);
      }
    }
    if (caseSpec && run) {
      validateFinalArtifactManifest(run.finalArtifactManifest, run.evidenceRefs, caseSpec, errors);
      validateComparisonEvidenceBindings(
        comparisonEvidenceRefs,
        caseSpec,
        run,
        errors
      );
    } else if (caseSpec || run || context.enforceContextBinding === true) {
      errors.push('可评分结果必须绑定当前 Case 与 Run，不能只提交自报证据字符串。');
    }
  }

  if (rubric && scoreable && enforceBlindProtocol) {
    const expectedDimensions = rubric.dimensions.map((dimension) => cleanString(dimension?.id)).filter(Boolean);
    const actualDimensions = Object.keys(isRecord(review.scores) ? review.scores : {}).sort();
    if (expectedDimensions.slice().sort().join("\u0000") !== actualDimensions.join("\u0000")) {
      errors.push("可评分结果必须完整且仅包含当前 rubric 的评分维度。");
    }
    const calculated = calculateWeightedOverall(rubric, review.scores);
    if (!isFiniteNumber(calculated)) {
      errors.push("无法从 rubric 与 scores 计算 weightedOverall。");
    } else if (!isFiniteNumber(review.weightedOverall)
      || Math.abs(review.weightedOverall - calculated) > 0.0001) {
      errors.push(`weightedOverall 与 rubric 自动计算结果不一致；期望 ${calculated}。`);
    }
  }

  if (review.decision === "pass") {
    const minimumOverall = Number(rubric?.decisionRule?.passMinimumOverall);
    if (Number.isFinite(minimumOverall)
      && (!isFiniteNumber(review.weightedOverall) || review.weightedOverall < minimumOverall)) {
      errors.push(`decision=pass 要求 weightedOverall >= ${minimumOverall}。`);
    }
    if (review.pairwiseOutcome !== "better" && review.pairwiseOutcome !== "comparable") {
      errors.push("decision=pass 要求 pairwiseOutcome 为 better 或 comparable。");
    }
    if (!Array.isArray(review.blockers)) {
      errors.push("decision=pass 必须显式记录 blockers=[]。 ");
    } else if (review.blockers.length > 0) {
      errors.push("decision=pass 不能包含人工评审 blocker。");
    }
    if (Array.isArray(review.findings) && review.findings.some(isBlockingReviewFinding)) {
      errors.push("decision=pass 不能包含 blocking finding。");
    }
    if (Array.isArray(review.missingEvidence) && review.missingEvidence.length > 0) {
      errors.push("decision=pass 不能包含 missingEvidence。");
    }
    if (run) {
      if (run.observed?.technicalDeliveryPassed !== true) {
        errors.push("decision=pass 要求对应 Run 通过技术交付检查。");
      }
      if (Number(run.observed?.unresolvedBlockerCount) !== 0) {
        errors.push("decision=pass 要求对应 Run 没有 unresolved blocker。");
      }
      if (run.observed?.falseCompletionSuspected === true) {
        errors.push("decision=pass 不能绑定疑似假完成 Run。");
      }
    }
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
  } else {
    attribution.evidenceRefs.forEach((ref, index) => {
      if (!isSafeReviewEvidenceRef(ref)) {
        errors.push(`evidenceRefs[${index}] 不能包含绝对路径、URL 或目录穿越。`);
      }
    });
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
  const strictBlindReviews = reviews.filter((review) => (
    review.evidenceProtocol === "anonymous_packet_verified"
    && review.blindedToCohort === true
    && review.blindedToCandidateOrigin === true
    && isFiniteNumber(review.weightedOverall)
    && Array.isArray(review.comparisonEvidenceRefs)
    && review.comparisonEvidenceRefs.length > 0
    && Array.isArray(review.blockers)
    && validateVerifiedReviewPacketProof(review.verifiedPacketProof, review).ok
    && review[OFFICIAL_REVIEW_DISK_TRUST] === true
  ));
  const strictReviewsByRun = new Map();
  for (const review of strictBlindReviews) {
    const current = strictReviewsByRun.get(review.runObservationId) || [];
    current.push(review);
    strictReviewsByRun.set(review.runObservationId, current);
  }
  const strictReviewedRunIds = new Set(strictReviewsByRun.keys());
  const passRunIds = new Set();
  let conflictingReviewRunCount = 0;
  for (const [runObservationId, runReviews] of strictReviewsByRun.entries()) {
    const decisions = new Set(runReviews.map((review) => review.decision));
    if (decisions.size !== 1) {
      conflictingReviewRunCount += 1;
      continue;
    }
    if (runReviews[0]?.decision === "pass") passRunIds.add(runObservationId);
  }
  const completedRuns = runs.filter((run) => run?.observed?.runStatus === "completed");
  const agenticRuns = runs.filter((run) => run?.cohortDimensions?.executionModel === "agentic");
  const decisionPreservationScorableRuns = agenticRuns.filter((run) => (
    run?.observed?.decisionPreservation?.status === "passed"
    || run?.observed?.decisionPreservation?.status === "failed"
  ));
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
      agenticDecisionPreservationEvidenceCoverage: rate(
        decisionPreservationScorableRuns.length,
        agenticRuns.length
      ),
      agenticLevelOneDecisionPreservationRate: rate(
        decisionPreservationScorableRuns.filter((run) => (
          run.observed.decisionPreservation.status === "passed"
        )).length,
        decisionPreservationScorableRuns.length
      ),
      agenticHarnessWriteAttemptRunCount: agenticRuns.filter((run) => (
        run?.observed?.decisionPreservation?.harnessWriteAttemptObserved === true
      )).length,
      wrongDocumentOrOverwriteCount: runs.filter((run) => (
        !hasPassedRequiredMachineChecks(run, projectSafetyCheckIds)
      )).length
    },
    quality: {
      humanReviewedRate: rate(runs.filter((run) => reviewedRunIds.has(run.runObservationId)).length, runs.length),
      strictHumanReviewedRate: rate(
        runs.filter((run) => strictReviewedRunIds.has(run.runObservationId)).length,
        runs.length
      ),
      humanPassRate: rate(passRunIds.size, strictReviewedRunIds.size),
      humanUsableRate: rate(passRunIds.size, runs.length),
      conflictingReviewRunCount
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
  const minimumRunsPerCase = Math.max(1, Math.floor(Number(gates?.minimumRunsPerCase) || 0));
  const attemptCohort = isRecord(report?.attempts) && Number(report.attempts.submitted) > 0
    ? report.attempts
    : undefined;
  const checksByFamily = {};
  for (const family of families) {
    const familyReport = report?.byTaskFamily?.[family];
    const attemptFamily = attemptCohort?.byTaskFamily?.[family];
    const runs = attemptFamily
      ? Number(attemptFamily.submitted) || 0
      : Number(familyReport?.runs) || 0;
    const technicalPassed = attemptFamily
      ? Number(attemptFamily.technicalDeliveryPassed) || 0
      : Number(familyReport?.reliability?.technicalDeliveryRate?.numerator) || 0;
    const reviewedRuns = attemptFamily
      ? Number(attemptFamily.strictReviewedTechnicalPasses) || 0
      : Number(familyReport?.quality?.strictHumanReviewedRate?.numerator) || 0;
    const strictReviewCoverageComplete = attemptFamily
      ? technicalPassed === reviewedRuns
      : reviewedRuns >= minimumRunsPerFamily;
    const technicalDeliveryRate = attemptFamily?.technicalDeliveryRate
      || familyReport?.reliability?.technicalDeliveryRate;
    const humanUsableRate = attemptFamily?.commercialUsableRate
      || familyReport?.quality?.humanUsableRate;
    const requiredInterventionRecords = attemptFamily ? technicalPassed : minimumRunsPerFamily;
    const checks = {
      minimumRunsPerFamily: runs >= minimumRunsPerFamily,
      minimumHumanReviewedRunsPerFamily: strictReviewCoverageComplete,
      technicalDeliveryRate: Number(technicalDeliveryRate?.value)
        >= Number(gates?.technicalDeliveryRate),
      humanUsableRate: Number(humanUsableRate?.value)
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
        >= requiredInterventionRecords,
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
      technicalPassed,
      reviewedRuns,
      checks,
      failedChecks: Object.entries(checks)
        .filter(([, passed]) => !passed)
        .map(([name]) => name)
    };
  }
  const attemptCaseIds = attemptCohort
    ? Object.entries(attemptCohort.byCase || {})
      .filter(([, value]) => Number(value?.submitted) > 0)
      .map(([caseId]) => caseId)
    : [];
  const coverageComplete = attemptCohort
    ? Object.keys(report?.byCase || {}).every((caseId) => attemptCaseIds.includes(caseId))
    : Array.isArray(report?.coverage?.missingCaseIds)
      && report.coverage.missingCaseIds.length === 0;
  const checksByCase = {};
  for (const [caseId, caseReport] of Object.entries(report?.byCase || {})) {
    const attemptCase = attemptCohort?.byCase?.[caseId];
    const runs = attemptCase
      ? Number(attemptCase.submitted) || 0
      : Number(caseReport?.runs) || 0;
    const technicalPassed = attemptCase
      ? Number(attemptCase.technicalDeliveryPassed) || 0
      : Number(caseReport?.reliability?.technicalDeliveryRate?.numerator) || 0;
    const reviewedRuns = attemptCase
      ? Number(attemptCase.strictReviewedTechnicalPasses) || 0
      : Number(caseReport?.quality?.strictHumanReviewedRate?.numerator) || 0;
    const strictReviewCoverageComplete = attemptCase
      ? technicalPassed === reviewedRuns
      : reviewedRuns >= minimumRunsPerCase;
    const terminalCoverageComplete = attemptCase
      ? Number(attemptCase.terminal) === runs
      : true;
    checksByCase[caseId] = {
      passed: runs >= minimumRunsPerCase
        && terminalCoverageComplete
        && strictReviewCoverageComplete,
      runs,
      technicalPassed,
      reviewedRuns,
      minimumRunsPerCase: runs >= minimumRunsPerCase,
      minimumStrictHumanReviewsPerCase: strictReviewCoverageComplete,
      terminalCoverageComplete
    };
  }
  const caseResults = Object.values(checksByCase);
  const caseSamplesReady = caseResults.length > 0 && caseResults.every((result) => result.passed);
  const cohortHomogeneous = attemptCohort
    ? attemptCohort.homogeneous === true
    : report?.cohortIntegrity?.homogeneous === true;
  const explicitCohortFingerprintCoverage = attemptCohort
    ? attemptCohort.homogeneous === true
    : Number(report?.cohortIntegrity?.explicitFingerprintCoverage?.value) === 1;
  const attemptProtocolReady = attemptCohort
    ? attemptCohort.protocolValid === true
      && attemptCohort.allSubmittedAttemptsTerminal === true
      && Number(attemptCohort.unknownWriteStateCount) === 0
      && Number(attemptCohort.strictReviewConflictCount) === 0
    : true;
  const familyResults = Object.values(checksByFamily);
  return {
    passed: coverageComplete
      && cohortHomogeneous
      && explicitCohortFingerprintCoverage
      && attemptProtocolReady
      && caseSamplesReady
      && familyResults.every((result) => result.passed),
    sampleReady: coverageComplete
      && cohortHomogeneous
      && explicitCohortFingerprintCoverage
      && attemptProtocolReady
      && caseSamplesReady
      && familyResults.every((result) => result.sampleReady),
    coverageComplete,
    cohortHomogeneous,
    explicitCohortFingerprintCoverage,
    attemptProtocolReady,
    minimumRunsPerFamily,
    minimumRunsPerCase,
    checksByFamily,
    checksByCase
  };
}

function buildRunControlledDimensionFingerprint(run) {
  const dimensions = isRecord(run?.cohortDimensions) ? run.cohortDimensions : {};
  return sha256Text(stableStringify({
    gitCommit: cleanString(dimensions.gitCommit) || "unknown",
    dirty: dimensions.dirty === true,
    dirtyFingerprint: cleanString(dimensions.dirtyFingerprint) || "unknown",
    provider: cleanString(dimensions.provider) || "unknown",
    modelId: cleanString(dimensions.modelId) || "unknown",
    runtimeGitCommit: cleanString(dimensions.runtimeGitCommit) || "unknown",
    runtimeBuildId: cleanString(dimensions.runtimeBuildId) || "unknown",
    runtimeAppVersion: cleanString(dimensions.runtimeAppVersion) || "unknown",
    photoshopRuntimeBuildId: cleanString(dimensions.photoshopRuntimeBuildId) || "unknown",
    timeoutMs: Number.isFinite(dimensions.timeoutMs) ? dimensions.timeoutMs : null,
    fixtureDigest: cleanString(dimensions.fixtureDigest) || "unknown",
    suiteCaseSetDigest: cleanString(dimensions.suiteCaseSetDigest) || "unknown",
    suiteRubricSetDigest: cleanString(dimensions.suiteRubricSetDigest) || "unknown"
  }));
}

function buildRunGlobalControlledDimensionFingerprint(run) {
  const dimensions = isRecord(run?.cohortDimensions) ? run.cohortDimensions : {};
  return sha256Text(stableStringify({
    gitCommit: cleanString(dimensions.gitCommit) || "unknown",
    dirty: dimensions.dirty === true,
    dirtyFingerprint: cleanString(dimensions.dirtyFingerprint) || "unknown",
    provider: cleanString(dimensions.provider) || "unknown",
    modelId: cleanString(dimensions.modelId) || "unknown",
    runtimeGitCommit: cleanString(dimensions.runtimeGitCommit) || "unknown",
    runtimeBuildId: cleanString(dimensions.runtimeBuildId) || "unknown",
    runtimeAppVersion: cleanString(dimensions.runtimeAppVersion) || "unknown",
    photoshopRuntimeBuildId: cleanString(dimensions.photoshopRuntimeBuildId) || "unknown",
    timeoutMs: Number.isFinite(dimensions.timeoutMs) ? dimensions.timeoutMs : null,
    suiteCaseSetDigest: cleanString(dimensions.suiteCaseSetDigest) || "unknown",
    suiteRubricSetDigest: cleanString(dimensions.suiteRubricSetDigest) || "unknown"
  }));
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
  const rubricSetDigest = sha256Text(stableStringify(
    (Array.isArray(input?.rubrics) ? input.rubrics : [])
      .map((rubric) => ({
        rubricId: cleanString(rubric?.rubricId),
        rubricDigest: buildRubricDigest(rubric)
      }))
      .sort((left, right) => left.rubricId.localeCompare(right.rubricId))
  ));
  const confirmedAttributions = attributions.filter((item) => item.status === "confirmed");
  const controlledFingerprintsByCase = new Map();
  const fixtureDigestsByCase = {};
  for (const run of runs) {
    const caseId = cleanString(run?.caseRef?.caseId) || "unknown";
    const fingerprints = controlledFingerprintsByCase.get(caseId) || new Set();
    fingerprints.add(buildRunControlledDimensionFingerprint(run));
    controlledFingerprintsByCase.set(caseId, fingerprints);
    const fixtureDigests = fixtureDigestsByCase[caseId] || [];
    const fixtureDigest = cleanString(run?.cohortDimensions?.fixtureDigest) || "unknown";
    if (!fixtureDigests.includes(fixtureDigest)) fixtureDigests.push(fixtureDigest);
    fixtureDigestsByCase[caseId] = fixtureDigests.sort();
  }
  const perCaseFingerprintCounts = [...controlledFingerprintsByCase.values()]
    .map((fingerprints) => fingerprints.size);
  const globalControlledFingerprints = new Set(
    runs.map(buildRunGlobalControlledDimensionFingerprint)
  );
  const explicitFingerprintRuns = runs.filter((run) => cleanString(run?.cohortDimensions?.cohortFingerprint));
  const explicitFingerprints = explicitFingerprintRuns.map((run) => (
    cleanString(run.cohortDimensions.cohortFingerprint)
  ));
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
  const byCase = {};
  for (const caseSpec of cases) {
    const caseRuns = runs.filter((run) => run.caseRef.caseId === caseSpec.caseId);
    const caseReviews = reviews.filter((review) => caseRuns.some((run) => (
      run.runObservationId === review.runObservationId
    )));
    byCase[caseSpec.caseId] = aggregateFamily(caseRuns, caseReviews);
  }
  return {
    version: COHORT_VERSION,
    cohortId: cleanString(input.cohortId),
    generatedAt: cleanString(input.generatedAt) || new Date().toISOString(),
    selector: {
      suiteId: cleanString(input.suiteId),
      caseSetDigest,
      rubricSetDigest,
      fixtureDigestsByCase,
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
    cohortIntegrity: {
      homogeneous: globalControlledFingerprints.size <= 1
        && perCaseFingerprintCounts.every((count) => count <= 1)
        && new Set(explicitFingerprints).size <= 1,
      controlledDimensionFingerprintCount: perCaseFingerprintCounts.length > 0
        ? Math.max(globalControlledFingerprints.size, ...perCaseFingerprintCounts)
        : globalControlledFingerprints.size,
      explicitFingerprintCoverage: rate(explicitFingerprintRuns.length, runs.length),
      explicitFingerprintCount: new Set(explicitFingerprints).size
    },
    overall: aggregateFamily(runs, reviews),
    byTaskFamily,
    byCase,
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
    && baseline.selector?.caseSetDigest === candidate.selector?.caseSetDigest
    && cleanString(baseline.selector?.rubricSetDigest)
    && baseline.selector?.rubricSetDigest === candidate.selector?.rubricSetDigest
    && stableStringify(baseline.selector?.fixtureDigestsByCase || {})
      === stableStringify(candidate.selector?.fixtureDigestsByCase || {});
  if (!comparable) {
    return {
      comparable: false,
      reason: "两个 cohort 的固定 Case、Rubric 或逐 Case 输入摘要不同，禁止用总体平均值伪装前后效果。"
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
    rubricSetDigest: baseline.selector.rubricSetDigest,
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
  DECISION_PRESERVATION_VERSION,
  EXECUTION_MODELS,
  FAILURE_MODES,
  COMPARISON_EVIDENCE_KINDS,
  PAIRWISE_OUTCOMES,
  LEGACY_REVIEW_VERSION,
  REVIEW_EVIDENCE_PROTOCOLS,
  REVIEW_DECISIONS,
  REVIEW_VERSION,
  RUN_VERSION,
  TASK_FAMILIES,
  VERIFIED_REVIEW_PACKET_PROOF_VERSION,
  buildCaseDigest,
  buildComparisonEvidenceDigest,
  buildExpectedComparisonEvidenceList,
  buildRubricDigest,
  buildReviewPacketProjectionDigest,
  buildDesignReliabilityCohortReport,
  calculateWeightedOverall,
  compareDesignReliabilityCohorts,
  deriveDesignReliabilityRunObservation,
  evaluateDesignReliabilityReleaseGates,
  hasCommittedMutation,
  hasObservedMutation,
  requiredComparisonEvidenceKinds,
  sha256Text,
  stableStringify,
  validateAgentRunRecordChain,
  validateDesignReliabilityAttribution,
  validateDesignReliabilityCase,
  validateDesignReliabilityReview,
  validateDesignReliabilityRun,
  validateVerifiedReviewPacketProof
};
