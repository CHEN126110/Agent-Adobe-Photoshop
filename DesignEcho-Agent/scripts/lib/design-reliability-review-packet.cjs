"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const {
  REVIEW_VERSION,
  VERIFIED_REVIEW_PACKET_PROOF_VERSION,
  buildComparisonEvidenceDigest,
  buildExpectedComparisonEvidenceList,
  buildRubricDigest,
  buildReviewPacketProjectionDigest,
  calculateWeightedOverall,
  sha256Text,
  stableStringify,
  validateDesignReliabilityCase,
  validateDesignReliabilityReview,
  validateDesignReliabilityRun
} = require("./design-reliability-contract.cjs");

const REVIEW_PACKET_VERSION = "design-reliability-review-packet/v2";
const SEALED_MAPPING_VERSION = "design-reliability-review-packet-mapping/v2";
const REVIEWER_RESPONSE_VERSION = "design-reliability-reviewer-response/v1";
const REVIEW_PACKET_FILE = "packet.json";
const MAX_REVIEW_IMAGE_BYTES = 512 * 1024 * 1024;
const MAX_REVIEW_IMAGE_PIXELS = 160_000_000;
const SAFE_IMAGE_EXTENSIONS = new Set([
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp"
]);
const RESPONSE_DECISIONS = new Set(["pass", "needs_fix", "unscorable"]);
const RESPONSE_CONFIDENCE = new Set(["low", "medium", "high"]);
const RESPONSE_PAIRWISE_OUTCOMES = new Set([
  "left_better",
  "comparable",
  "right_better",
  "unscorable"
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function fail(message) {
  throw new Error(message);
}

function assertExactKeys(value, allowedKeys, fieldName) {
  if (!isRecord(value)) fail(`${fieldName} 必须是对象。`);
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unexpected.length > 0) {
    fail(`${fieldName} 含未声明字段：${unexpected.join("、")}。`);
  }
}

function isSha256Digest(value) {
  return /^sha256:[a-f0-9]{64}$/i.test(cleanString(value));
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return `sha256:${hash.digest("hex")}`;
}

function digestJsonWithout(value, fieldName) {
  const clone = cloneJson(value);
  delete clone[fieldName];
  return sha256Text(stableStringify(clone));
}

function isUnsafePublicString(value) {
  const text = cleanString(value).replace(/\\/g, "/");
  return path.isAbsolute(text)
    || /[a-z]:\//i.test(text)
    || text.startsWith("//")
    || /^file:/i.test(text)
    || /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
}

function assertPublicPacketHasNoAbsolutePaths(value, fieldName = "packet") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicPacketHasNoAbsolutePaths(item, `${fieldName}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) => (
      assertPublicPacketHasNoAbsolutePaths(item, `${fieldName}.${key}`)
    ));
    return;
  }
  if (typeof value === "string" && isUnsafePublicString(value)) {
    fail(`${fieldName} 不能包含绝对路径、file URI 或 URL。`);
  }
}

function normalizeSafeRelativePath(value, fieldName) {
  const normalized = cleanString(value).replace(/\\/g, "/");
  if (!normalized
    || path.posix.isAbsolute(normalized)
    || /^[a-z]:\//i.test(normalized)
    || normalized.startsWith("//")
    || normalized.split("/").includes("..")) {
    fail(`${fieldName} 必须是安全相对路径。`);
  }
  return normalized;
}

function resolveInside(root, relativePath, fieldName) {
  const safeRelativePath = normalizeSafeRelativePath(relativePath, fieldName);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...safeRelativePath.split("/"));
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`${fieldName} 不能逃逸 reviewer packet。`);
  }
  return resolved;
}

function isPathInside(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function requireAbsoluteFreshDestination(targetPath, fieldName, expectedType) {
  if (!path.isAbsolute(targetPath)) fail(`${fieldName} 必须是明确的绝对路径。`);
  if (fs.existsSync(targetPath)) fail(`${fieldName} 已存在；匿名评审产物必须 fail-if-exists。`);
  const parentDirectory = path.dirname(targetPath);
  if (!fs.existsSync(parentDirectory) || !fs.statSync(parentDirectory).isDirectory()) {
    fail(`${fieldName} 的父目录必须已存在。`);
  }
  if (expectedType === "directory" && path.resolve(targetPath) === path.parse(targetPath).root) {
    fail(`${fieldName} 不能是磁盘根目录。`);
  }
}

async function verifySourceFile(sourcePath, evidenceRef) {
  if (!path.isAbsolute(sourcePath)) fail(`sourceBindings[${evidenceRef}] 必须提供绝对源文件路径。`);
  if (!fs.existsSync(sourcePath)) fail(`sourceBindings[${evidenceRef}] 的源文件不存在。`);
  const stat = fs.lstatSync(sourcePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(`sourceBindings[${evidenceRef}] 必须指向普通文件，不能是目录或符号链接。`);
  }
  if (stat.size < 1 || stat.size > MAX_REVIEW_IMAGE_BYTES) {
    fail(`sourceBindings[${evidenceRef}] 超出匿名评审允许的图片字节边界。`);
  }
  const extension = path.extname(sourcePath).toLowerCase();
  if (!SAFE_IMAGE_EXTENSIONS.has(extension)) {
    fail(`sourceBindings[${evidenceRef}] 不是受支持的可视图片格式。`);
  }
  let metadata;
  try {
    metadata = await sharp(sourcePath, {
      failOn: "error",
      limitInputPixels: MAX_REVIEW_IMAGE_PIXELS
    }).metadata();
  } catch (error) {
    fail(`sourceBindings[${evidenceRef}] 不是可解码的真实图片：${error.message}`);
  }
  if (!Number.isInteger(metadata?.width) || metadata.width < 1
    || !Number.isInteger(metadata?.height) || metadata.height < 1) {
    fail(`sourceBindings[${evidenceRef}] 缺少有效像素尺寸。`);
  }
  return {
    sourcePath: path.resolve(sourcePath),
    digest: sha256File(sourcePath),
    sizeBytes: stat.size,
    width: metadata.width,
    height: metadata.height
  };
}

function validateCaseRunRubric(caseSpec, run, rubric) {
  const caseValidation = validateDesignReliabilityCase(caseSpec);
  if (!caseValidation.ok) fail(`Case 无效：${caseValidation.errors.join("；")}`);
  const runValidation = validateDesignReliabilityRun(run);
  if (!runValidation.ok) fail(`Run 无效：${runValidation.errors.join("；")}`);
  if (cleanString(run.caseRef?.caseId) !== cleanString(caseSpec.caseId)
    || run.caseRef?.revision !== caseSpec.revision
    || cleanString(run.caseRef?.caseDigest).toLowerCase() !== cleanString(caseSpec.caseDigest).toLowerCase()) {
    fail("Run 没有绑定当前 Case 的精确身份。 ");
  }
  if (!isRecord(rubric)
    || cleanString(rubric.rubricId) !== cleanString(caseSpec.oracle?.rubricId)
    || !Array.isArray(rubric.dimensions)
    || rubric.dimensions.length === 0) {
    fail("Rubric 与当前 Case 不一致或缺少评分维度。 ");
  }
  const rubricDigest = buildRubricDigest(rubric);
  if (!isSha256Digest(rubricDigest)) fail("无法生成稳定 Rubric 摘要。 ");
  return rubricDigest;
}

function normalizeExpectedEvidence(caseSpec, run) {
  const expected = buildExpectedComparisonEvidenceList(caseSpec, run);
  const candidateCount = expected.filter((item) => item.kind === "candidate_final").length;
  const anchorCount = expected.filter((item) => (
    item.kind === "user_design_anchor" || item.kind === "eagle_anchor"
  )).length;
  if (candidateCount === 0) fail("Run 没有经过验证并进入 finalArtifactManifest 的 raster final。 ");
  if (anchorCount === 0) fail("Case 没有可用于匿名比较的 reviewOnly reference。 ");
  return expected;
}

async function normalizeSourceBindings(expectedEvidence, sourceBindings) {
  if (!Array.isArray(sourceBindings)) fail("sourceBindings 必须是数组。 ");
  const expectedRefs = new Set(expectedEvidence.map((item) => item.ref));
  const byRef = new Map();
  for (let index = 0; index < sourceBindings.length; index += 1) {
    const binding = sourceBindings[index];
    assertExactKeys(binding, ["evidenceRef", "sourcePath"], `sourceBindings[${index}]`);
    const evidenceRef = cleanString(binding.evidenceRef);
    if (!expectedRefs.has(evidenceRef)) {
      fail(`sourceBindings[${index}] 不属于当前 Case / Run：${evidenceRef}。`);
    }
    if (byRef.has(evidenceRef)) fail(`sourceBindings 重复绑定：${evidenceRef}。`);
    const source = await verifySourceFile(cleanString(binding.sourcePath), evidenceRef);
    const declaredDigest = /@(sha256:[a-f0-9]{64})$/i.exec(evidenceRef)?.[1]?.toLowerCase();
    if (!declaredDigest || declaredDigest !== source.digest.toLowerCase()) {
      fail(`比较证据 ${evidenceRef} 的真实文件摘要与 Case / Run 冻结摘要不一致。`);
    }
    byRef.set(evidenceRef, { evidenceRef, ...source });
  }
  for (const evidence of expectedEvidence) {
    if (!byRef.has(evidence.ref)) fail(`sourceBindings 缺少 ${evidence.kind}：${evidence.ref}。`);
  }
  if (byRef.size !== expectedEvidence.length) fail("sourceBindings 必须与比较证据集合一一对应。 ");
  const sources = [...byRef.values()];
  const sourceDigests = sources.map((source) => source.digest.toLowerCase());
  if (new Set(sourceDigests).size !== sourceDigests.length) {
    fail("不同比较证据不能绑定相同内容摘要。 ");
  }
  const candidateDigests = new Set(sources
    .filter((source) => source.evidenceRef.startsWith("candidate:"))
    .map((source) => source.digest.toLowerCase()));
  if (sources.some((source) => (
    !source.evidenceRef.startsWith("candidate:")
    && candidateDigests.has(source.digest.toLowerCase())
  ))) {
    fail("参考锚点不能绑定候选成稿内容。 ");
  }
  return byRef;
}

function buildOriginGroups(expectedEvidence, sourceBindings) {
  return expectedEvidence.map((evidence) => ({
      originKind: evidence.kind,
      evidenceRefs: [evidence.ref],
      sources: [sourceBindings.get(evidence.ref)]
  }));
}

function groupIdentity(group) {
  return `${group.originKind}\u0000${group.evidenceRefs.slice().sort().join("\u0000")}`;
}

function randomRank(nonce, identity) {
  return crypto.createHmac("sha256", nonce).update(identity, "utf8").digest("hex");
}

function assignAnonymousLabels(groups, nonce) {
  return groups
    .map((group) => ({ ...group, randomRank: randomRank(nonce, groupIdentity(group)) }))
    .sort((left, right) => left.randomRank.localeCompare(right.randomRank))
    .map((group, index) => ({ ...group, label: `G${String(index + 1).padStart(2, "0")}` }));
}

function sanitizeRubric(rubric, rubricDigest) {
  return {
    rubricId: cleanString(rubric.rubricId),
    rubricDigest,
    scale: cleanString(rubric.scale),
    dimensions: rubric.dimensions.map((dimension) => ({
      id: cleanString(dimension.id),
      weight: Number(dimension.weight),
      description: cleanString(dimension.description),
      scoreAnchors: isRecord(dimension.scoreAnchors) ? cloneJson(dimension.scoreAnchors) : {}
    })),
    decisionRule: isRecord(rubric.decisionRule) ? cloneJson(rubric.decisionRule) : {}
  };
}

function buildPacketId(randomBytes) {
  const bytes = randomBytes(16);
  if (!Buffer.isBuffer(bytes) || bytes.length !== 16) {
    fail("randomBytes 必须为 packetId 返回 16 字节 Buffer。 ");
  }
  return `review-packet-${bytes.toString("hex")}`;
}

function validatePacketId(packetId) {
  if (!/^[a-z0-9][a-z0-9._-]{7,127}$/i.test(packetId)) fail("packetId 不是安全稳定身份。 ");
}

async function createDesignReliabilityReviewPacket(input) {
  if (!isRecord(input)) fail("createDesignReliabilityReviewPacket input 必须是对象。 ");
  const reviewerPacketDirectory = path.resolve(cleanString(input.reviewerPacketDirectory));
  const sealedMappingPath = path.resolve(cleanString(input.sealedMappingPath));
  if (!cleanString(input.reviewerPacketDirectory) || !cleanString(input.sealedMappingPath)) {
    fail("reviewerPacketDirectory 与 sealedMappingPath 不能为空。 ");
  }
  requireAbsoluteFreshDestination(reviewerPacketDirectory, "reviewerPacketDirectory", "directory");
  requireAbsoluteFreshDestination(sealedMappingPath, "sealedMappingPath", "file");
  if (isPathInside(reviewerPacketDirectory, sealedMappingPath)
    || path.resolve(reviewerPacketDirectory) === path.dirname(sealedMappingPath)) {
    fail("sealedMappingPath 必须与 reviewer packet 物理分离，不能放在公开包内或其根目录。 ");
  }
  const rubricDigest = validateCaseRunRubric(input.caseSpec, input.run, input.rubric);
  const expectedEvidence = normalizeExpectedEvidence(input.caseSpec, input.run);
  const sourceBindings = await normalizeSourceBindings(expectedEvidence, input.sourceBindings);
  const randomBytes = typeof input.randomBytes === "function" ? input.randomBytes : crypto.randomBytes;
  const packetId = cleanString(input.packetId) || buildPacketId(randomBytes);
  validatePacketId(packetId);
  const createdAt = cleanString(input.createdAt) || new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) fail("createdAt 必须是有效时间。 ");
  const nonce = randomBytes(32);
  if (!Buffer.isBuffer(nonce) || nonce.length !== 32) {
    fail("randomBytes 必须为匿名排序返回 32 字节 Buffer。 ");
  }
  const originGroups = buildOriginGroups(expectedEvidence, sourceBindings);
  const contextGroups = originGroups
    .filter((group) => group.originKind === "target_reference_context")
    .map((group, index) => ({
      ...group,
      label: `T${String(index + 1).padStart(2, "0")}`,
      publicRole: "user_target_reference"
    }));
  const anonymousGroups = assignAnonymousLabels(
    originGroups.filter((group) => group.originKind !== "target_reference_context"),
    nonce
  );
  const labeledGroups = [...contextGroups, ...anonymousGroups];

  const publicContextGroups = [];
  const publicAnonymousGroups = [];
  const sealedGroups = [];
  for (const group of labeledGroups) {
    const rankedSources = group.sources
      .map((source) => ({
        ...source,
        randomRank: randomRank(nonce, `${groupIdentity(group)}\u0000${source.evidenceRef}`)
      }))
      .sort((left, right) => left.randomRank.localeCompare(right.randomRank));
    const publicAssets = [];
    const sealedAssets = [];
    rankedSources.forEach((source, index) => {
      const assetId = `A${String(index + 1).padStart(2, "0")}`;
      const publicRef = group.originKind === "target_reference_context"
        ? `context/${group.label}/${assetId}.png`
        : `assets/${group.label}/${assetId}.png`;
      publicAssets.push({ assetId, ref: publicRef });
      sealedAssets.push({
        assetId,
        publicRef,
        evidenceRef: source.evidenceRef,
        sourceDigest: source.digest,
        sourceSizeBytes: source.sizeBytes,
        sourceWidth: source.width,
        sourceHeight: source.height
      });
    });
    if (group.originKind === "target_reference_context") {
      publicContextGroups.push({
        label: group.label,
        role: group.publicRole,
        assets: publicAssets
      });
    } else {
      publicAnonymousGroups.push({ label: group.label, assets: publicAssets });
    }
    sealedGroups.push({
      label: group.label,
      originKind: group.originKind,
      evidenceRefs: group.evidenceRefs.slice().sort(),
      assets: sealedAssets
    });
  }
  const sourceBindingDigest = sha256Text(stableStringify(
    [...sourceBindings.values()]
      .map((source) => ({ evidenceRef: source.evidenceRef, digest: source.digest, sizeBytes: source.sizeBytes }))
      .sort((left, right) => left.evidenceRef.localeCompare(right.evidenceRef))
  ));
  const packet = {
    version: REVIEW_PACKET_VERSION,
    packetId,
    createdAt,
    rubric: sanitizeRubric(input.rubric, rubricDigest),
    contextGroups: publicContextGroups,
    anonymousGroups: publicAnonymousGroups,
    responseContract: {
      version: REVIEWER_RESPONSE_VERSION,
      assessEveryGroup: true,
      compareEveryUnorderedPair: true,
      targetContextAppliesToEveryAssessment: true,
      pairwiseOutcomes: [...RESPONSE_PAIRWISE_OUTCOMES]
    },
    boundaries: {
      noCandidateOriginLabels: true,
      noCohortIdentity: true,
      noSourceReferences: true,
      noAbsolutePaths: true,
      targetContextRoleExplicit: true,
      uniformSingleAssetAnonymousGroups: true,
      sealedMappingStoredSeparately: true,
      devBenchmarkOnly: true
    }
  };
  packet.packetDigest = digestJsonWithout(packet, "packetDigest");
  assertPublicPacketHasNoAbsolutePaths(packet);

  fs.mkdirSync(reviewerPacketDirectory);
  for (const group of labeledGroups) {
    const sealedGroup = sealedGroups.find((item) => item.label === group.label);
    const publicDirectory = group.originKind === "target_reference_context" ? "context" : "assets";
    fs.mkdirSync(path.join(reviewerPacketDirectory, publicDirectory, group.label), { recursive: true });
    for (const asset of sealedGroup.assets) {
      const source = sourceBindings.get(asset.evidenceRef);
      const destination = resolveInside(reviewerPacketDirectory, asset.publicRef, "asset.publicRef");
      await sharp(source.sourcePath, {
        failOn: "error",
        limitInputPixels: MAX_REVIEW_IMAGE_PIXELS
      })
        .rotate()
        .toColorspace("srgb")
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toFile(destination);
      const publicMetadata = await sharp(destination, {
        failOn: "error",
        limitInputPixels: MAX_REVIEW_IMAGE_PIXELS
      }).metadata();
      if (publicMetadata.format !== "png"
        || publicMetadata.space !== "srgb"
        || publicMetadata.exif
        || publicMetadata.xmp
        || publicMetadata.iptc
        || publicMetadata.icc) {
        fail(`匿名公开资产没有完成无源元数据 sRGB PNG 规范化：${asset.publicRef}。`);
      }
      const publicStat = fs.statSync(destination);
      asset.digest = sha256File(destination);
      asset.sizeBytes = publicStat.size;
      asset.width = publicMetadata.width;
      asset.height = publicMetadata.height;
    }
  }
  const assetSet = sealedGroups
    .flatMap((group) => group.assets.map((asset) => ({
      ref: asset.publicRef,
      digest: asset.digest,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height
    })))
    .sort((left, right) => left.ref.localeCompare(right.ref));
  const assetSetDigest = sha256Text(stableStringify(assetSet));
  const sealedMapping = {
    version: SEALED_MAPPING_VERSION,
    packetId,
    packetDigest: packet.packetDigest,
    createdAt,
    caseRef: {
      caseId: cleanString(input.caseSpec.caseId),
      revision: input.caseSpec.revision,
      caseDigest: cleanString(input.caseSpec.caseDigest).toLowerCase()
    },
    runObservationId: cleanString(input.run.runObservationId),
    rubricId: cleanString(input.rubric.rubricId),
    rubricDigest,
    shuffleNonce: nonce.toString("base64url"),
    sourceBindingDigest,
    assetSetDigest,
    groups: sealedGroups,
    boundaries: {
      neverIncludedInReviewerPacket: true,
      normalizedPublicAssets: "srgb_png_without_source_metadata",
      devBenchmarkOnly: true
    }
  };
  sealedMapping.mappingDigest = digestJsonWithout(sealedMapping, "mappingDigest");
  fs.writeFileSync(
    path.join(reviewerPacketDirectory, REVIEW_PACKET_FILE),
    `${JSON.stringify(packet, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" }
  );
  fs.writeFileSync(
    sealedMappingPath,
    `${JSON.stringify(sealedMapping, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 }
  );
  return {
    packet,
    sealedMapping,
    reviewerPacketDirectory,
    sealedMappingPath
  };
}

function readJsonFile(filePath, fieldName) {
  if (!path.isAbsolute(filePath) || !fs.existsSync(filePath)) fail(`${fieldName} 必须是存在的绝对路径。`);
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) fail(`${fieldName} 必须是普通 JSON 文件。`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function collectPacketFiles(rootDirectory) {
  const files = [];
  const stack = [rootDirectory];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) fail("reviewer packet 不能包含符号链接。 ");
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(path.relative(rootDirectory, fullPath).replace(/\\/g, "/"));
      } else {
        fail("reviewer packet 只能包含普通文件和目录。 ");
      }
    }
  }
  return files.sort();
}

function verifyMappingAgainstContext(mapping, packet, caseSpec, run, rubric) {
  if (mapping.version !== SEALED_MAPPING_VERSION) fail("sealed mapping version 非法。 ");
  if (mapping.packetId !== packet.packetId || mapping.packetDigest !== packet.packetDigest) {
    fail("sealed mapping 没有绑定当前 reviewer packet。 ");
  }
  if (mapping.mappingDigest !== digestJsonWithout(mapping, "mappingDigest")) {
    fail("sealed mapping 摘要校验失败。 ");
  }
  if (!isRecord(mapping.boundaries)
    || mapping.boundaries.neverIncludedInReviewerPacket !== true
    || mapping.boundaries.normalizedPublicAssets !== "srgb_png_without_source_metadata"
    || mapping.boundaries.devBenchmarkOnly !== true) {
    fail("sealed mapping boundaries 不完整。 ");
  }
  if (mapping.caseRef?.caseId !== caseSpec.caseId
    || mapping.caseRef?.revision !== caseSpec.revision
    || cleanString(mapping.caseRef?.caseDigest).toLowerCase() !== cleanString(caseSpec.caseDigest).toLowerCase()
    || mapping.runObservationId !== run.runObservationId
    || mapping.rubricId !== rubric.rubricId
    || cleanString(mapping.rubricDigest).toLowerCase() !== buildRubricDigest(rubric).toLowerCase()) {
    fail("sealed mapping 与当前 Case / Run / Rubric 不一致。 ");
  }
  const expected = buildExpectedComparisonEvidenceList(caseSpec, run);
  const actual = mapping.groups
    .flatMap((group) => group.evidenceRefs.map((ref) => ({ kind: group.originKind, ref })))
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.ref.localeCompare(right.ref));
  const sortedExpected = expected.slice()
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.ref.localeCompare(right.ref));
  if (stableStringify(actual) !== stableStringify(sortedExpected)) {
    fail("sealed mapping 没有覆盖当前 Case / Run 的精确比较证据集合。 ");
  }
  const candidateGroups = mapping.groups.filter((group) => group.originKind === "candidate_final");
  const anchorGroups = mapping.groups.filter((group) => (
    group.originKind === "user_design_anchor" || group.originKind === "eagle_anchor"
  ));
  if (candidateGroups.length === 0
    || anchorGroups.length === 0
    || mapping.groups.some((group) => (
      !Array.isArray(group.evidenceRefs)
      || group.evidenceRefs.length !== 1
      || !Array.isArray(group.assets)
      || group.assets.length !== 1
    ))) {
    fail("sealed mapping 必须把每个候选与参考都表示为单文件匿名项。 ");
  }
  const mappedBindings = mapping.groups.flatMap((group) => {
    if (!Array.isArray(group.assets)) fail("sealed mapping group.assets 必须是数组。 ");
    const groupRefs = group.evidenceRefs.slice().sort();
    const assetRefs = group.assets.map((asset) => cleanString(asset.evidenceRef)).sort();
    if (stableStringify(groupRefs) !== stableStringify(assetRefs)) {
      fail(`sealed mapping 匿名组 ${group.label} 的资产与来源引用不是一一对应。`);
    }
    return group.assets.map((asset) => ({
      evidenceRef: cleanString(asset.evidenceRef),
      digest: cleanString(asset.sourceDigest).toLowerCase(),
      sizeBytes: asset.sourceSizeBytes
    }));
  });
  if (new Set(mappedBindings.map((item) => item.evidenceRef)).size !== mappedBindings.length) {
    fail("sealed mapping 不能重复绑定同一来源引用。 ");
  }
  if (new Set(mappedBindings.map((item) => item.digest)).size !== mappedBindings.length) {
    fail("sealed mapping 不能让不同比较证据复用相同来源内容。 ");
  }
  for (const binding of mappedBindings) {
    const expectedDigest = /@(sha256:[a-f0-9]{64})$/i.exec(binding.evidenceRef)?.[1]?.toLowerCase();
    if (!expectedDigest || expectedDigest !== binding.digest) {
      fail(`sealed mapping 来源摘要与冻结 evidenceRef 不一致：${binding.evidenceRef}。`);
    }
  }
  const sourceBindingDigest = sha256Text(stableStringify(
    mappedBindings.sort((left, right) => left.evidenceRef.localeCompare(right.evidenceRef))
  ));
  if (sourceBindingDigest !== mapping.sourceBindingDigest) {
    fail("sealed mapping 的 sourceBindingDigest 无法从密封资产映射复核。 ");
  }
  const nonce = Buffer.from(cleanString(mapping.shuffleNonce), "base64url");
  if (nonce.length !== 32) fail("sealed mapping 的匿名排序 nonce 非法。 ");
  const relabeled = assignAnonymousLabels(mapping.groups
    .filter((group) => group.originKind !== "target_reference_context")
    .map((group) => ({
    originKind: group.originKind,
    evidenceRefs: group.evidenceRefs,
    sources: []
  })), nonce).map((group) => ({ label: group.label, identity: groupIdentity(group) }));
  const currentLabels = mapping.groups
    .filter((group) => group.originKind !== "target_reference_context")
    .map((group) => ({
    label: group.label,
    identity: groupIdentity(group)
  })).sort((left, right) => left.label.localeCompare(right.label));
  if (stableStringify(relabeled) !== stableStringify(currentLabels)) {
    fail("sealed mapping 的匿名标签不能由随机 nonce 复核。 ");
  }
  const contextGroups = mapping.groups.filter((group) => group.originKind === "target_reference_context");
  if (contextGroups.some((group, index) => group.label !== `T${String(index + 1).padStart(2, "0")}`)) {
    fail("sealed mapping 的目标参考上下文标签非法。 ");
  }
}

function validatePublicPacketShape(packet) {
  assertExactKeys(packet, [
    "version",
    "packetId",
    "createdAt",
    "rubric",
    "contextGroups",
    "anonymousGroups",
    "responseContract",
    "boundaries",
    "packetDigest"
  ], "reviewerPacket");
  validatePacketId(cleanString(packet.packetId));
  if (!isRecord(packet.boundaries)
    || packet.boundaries.noCandidateOriginLabels !== true
    || packet.boundaries.noCohortIdentity !== true
    || packet.boundaries.noSourceReferences !== true
    || packet.boundaries.noAbsolutePaths !== true
    || packet.boundaries.targetContextRoleExplicit !== true
    || packet.boundaries.uniformSingleAssetAnonymousGroups !== true
    || packet.boundaries.sealedMappingStoredSeparately !== true
    || packet.boundaries.devBenchmarkOnly !== true) {
    fail("reviewer packet boundaries 不完整。 ");
  }
  if (!Array.isArray(packet.contextGroups)) fail("reviewer packet contextGroups 必须是数组。 ");
  const contextLabels = new Set();
  packet.contextGroups.forEach((group, groupIndex) => {
    assertExactKeys(group, ["label", "role", "assets"], `reviewerPacket.contextGroups[${groupIndex}]`);
    if (!/^T\d{2,}$/.test(cleanString(group.label))
      || contextLabels.has(group.label)
      || group.role !== "user_target_reference") {
      fail("reviewer packet 目标参考上下文标签、角色非法或重复。 ");
    }
    contextLabels.add(group.label);
    if (!Array.isArray(group.assets) || group.assets.length !== 1) {
      fail("每个目标参考上下文必须恰好包含一个公开资产。 ");
    }
    const asset = group.assets[0];
    assertExactKeys(asset, ["assetId", "ref"], `reviewerPacket.contextGroups[${groupIndex}].assets[0]`);
    const safeAssetRef = normalizeSafeRelativePath(asset.ref, "reviewerPacket context asset ref");
    if (asset.assetId !== "A01"
      || path.posix.dirname(safeAssetRef) !== `context/${group.label}`
      || path.posix.basename(safeAssetRef, path.posix.extname(safeAssetRef)) !== "A01"
      || path.posix.extname(safeAssetRef).toLowerCase() !== ".png") {
      fail("reviewer packet 目标参考资产 ref 与上下文标签不一致。 ");
    }
  });
  if (!Array.isArray(packet.anonymousGroups) || packet.anonymousGroups.length < 2) {
    fail("reviewer packet 至少需要两个匿名项。 ");
  }
  const labels = new Set();
  packet.anonymousGroups.forEach((group, groupIndex) => {
    assertExactKeys(group, ["label", "assets"], `reviewerPacket.anonymousGroups[${groupIndex}]`);
    if (!/^G\d{2,}$/.test(cleanString(group.label)) || labels.has(group.label)) {
      fail("reviewer packet 匿名标签非法或重复。 ");
    }
    labels.add(group.label);
    if (!Array.isArray(group.assets) || group.assets.length !== 1) {
      fail("reviewer packet 每个匿名项必须恰好包含一个公开资产。 ");
    }
    const asset = group.assets[0];
    assertExactKeys(asset, ["assetId", "ref"], `reviewerPacket.anonymousGroups[${groupIndex}].assets[0]`);
    if (asset.assetId !== "A01") fail("单文件匿名项的 assetId 必须是 A01。 ");
    const safeAssetRef = normalizeSafeRelativePath(asset.ref, "reviewerPacket asset ref");
    const extension = path.posix.extname(safeAssetRef).toLowerCase();
    if (path.posix.dirname(safeAssetRef) !== `assets/${group.label}`
      || path.posix.basename(safeAssetRef, extension) !== "A01"
      || extension !== ".png") {
      fail("reviewer packet asset ref 与匿名标签不一致。 ");
    }
  });
}

async function verifyPacketFiles(reviewerPacketDirectory, packet, mapping) {
  const packetGroups = [
    ...(Array.isArray(packet.contextGroups) ? packet.contextGroups : []),
    ...(Array.isArray(packet.anonymousGroups) ? packet.anonymousGroups : [])
  ];
  if (!Array.isArray(packet.anonymousGroups) || packet.anonymousGroups.length < 2) {
    fail("reviewer packet 至少需要两个匿名组。 ");
  }
  const packetProjection = packetGroups.map((group) => ({
    label: group.label,
    assets: group.assets
  }));
  const mappingProjection = mapping.groups.map((group) => ({
    label: group.label,
    assets: group.assets.map((asset) => ({
      assetId: asset.assetId,
      ref: asset.publicRef
    }))
  }));
  if (stableStringify(packetProjection) !== stableStringify(mappingProjection)) {
    fail("公开 packet 与 sealed mapping 的匿名资产清单不一致。 ");
  }
  const expectedFiles = new Set([REVIEW_PACKET_FILE]);
  const assetSet = [];
  for (const group of mapping.groups) {
    for (const asset of group.assets) {
      const relativePath = normalizeSafeRelativePath(asset.publicRef, "mapping.groups.assets.publicRef");
      expectedFiles.add(relativePath);
      const filePath = resolveInside(reviewerPacketDirectory, relativePath, "mapping.groups.assets.publicRef");
      if (!fs.existsSync(filePath)) fail(`reviewer packet 缺少匿名资产：${relativePath}。`);
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) fail(`匿名资产不是普通文件：${relativePath}。`);
      const digest = sha256File(filePath);
      if (digest.toLowerCase() !== cleanString(asset.digest).toLowerCase()
        || stat.size !== asset.sizeBytes) {
        fail(`匿名资产哈希或字节数校验失败：${relativePath}。`);
      }
      const metadata = await sharp(filePath, {
        failOn: "error",
        limitInputPixels: MAX_REVIEW_IMAGE_PIXELS
      }).metadata();
      if (metadata.format !== "png"
        || metadata.space !== "srgb"
        || metadata.width !== asset.width
        || metadata.height !== asset.height
        || metadata.exif
        || metadata.xmp
        || metadata.iptc
        || metadata.icc) {
        fail(`匿名资产不是已验证的无源元数据 PNG：${relativePath}。`);
      }
      assetSet.push({
        ref: relativePath,
        digest,
        sizeBytes: stat.size,
        width: asset.width,
        height: asset.height
      });
    }
  }
  const actualFiles = collectPacketFiles(reviewerPacketDirectory);
  if (stableStringify(actualFiles) !== stableStringify([...expectedFiles].sort())) {
    fail("reviewer packet 含未声明文件或缺少声明文件。 ");
  }
  const assetSetDigest = sha256Text(stableStringify(
    assetSet.sort((left, right) => left.ref.localeCompare(right.ref))
  ));
  if (assetSetDigest !== mapping.assetSetDigest) {
    fail("reviewer packet 资产集合摘要不一致。 ");
  }
  return assetSetDigest;
}

function normalizeStringArray(value, fieldName) {
  if (!Array.isArray(value)) fail(`${fieldName} 必须是数组。`);
  const normalized = value.map(cleanString);
  if (normalized.some((item) => !item) || new Set(normalized).size !== normalized.length) {
    fail(`${fieldName} 不能包含空值或重复项。`);
  }
  return normalized;
}

function validateAssessment(assessment, rubric, fieldName) {
  assertExactKeys(
    assessment,
    ["label", "decision", "scores", "findings", "blockers", "confidence", "missingEvidence"],
    fieldName
  );
  if (!RESPONSE_DECISIONS.has(assessment.decision)) fail(`${fieldName}.decision 非法。`);
  if (!RESPONSE_CONFIDENCE.has(assessment.confidence)) fail(`${fieldName}.confidence 非法。`);
  if (!isRecord(assessment.scores)) fail(`${fieldName}.scores 必须是对象。`);
  const expectedDimensions = rubric.dimensions.map((dimension) => dimension.id).sort();
  const actualDimensions = Object.keys(assessment.scores).sort();
  if (stableStringify(expectedDimensions) !== stableStringify(actualDimensions)) {
    fail(`${fieldName}.scores 必须完整且仅包含当前 Rubric 维度。`);
  }
  for (const [dimension, score] of Object.entries(assessment.scores)) {
    if (score !== null && (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1)) {
      fail(`${fieldName}.scores.${dimension} 必须是 0..1 或 null。`);
    }
  }
  if (assessment.decision !== "unscorable" && calculateWeightedOverall(rubric, assessment.scores) === undefined) {
    fail(`${fieldName} 可评分结果不能包含 null 或非法分数。`);
  }
  if (!Array.isArray(assessment.findings)) fail(`${fieldName}.findings 必须是数组。`);
  normalizeStringArray(assessment.blockers, `${fieldName}.blockers`);
  normalizeStringArray(assessment.missingEvidence, `${fieldName}.missingEvidence`);
}

function normalizePairKey(leftLabel, rightLabel) {
  return [leftLabel, rightLabel].sort().join("\u0000");
}

function validateReviewerResponse(response, packet, mapping, rubric) {
  assertExactKeys(response, [
    "version",
    "packetId",
    "packetDigest",
    "rubricId",
    "rubricDigest",
    "reviewerId",
    "reviewedAt",
    "assessments",
    "pairwiseComparisons"
  ], "reviewerResponse");
  if (response.version !== REVIEWER_RESPONSE_VERSION
    || response.packetId !== packet.packetId
    || response.packetDigest !== packet.packetDigest
    || response.rubricId !== rubric.rubricId
    || cleanString(response.rubricDigest).toLowerCase() !== buildRubricDigest(rubric).toLowerCase()) {
    fail("reviewer response 没有绑定当前 packet / rubric。 ");
  }
  if (!cleanString(response.reviewerId)) fail("reviewerResponse.reviewerId 不能为空。 ");
  if (!cleanString(response.reviewedAt) || !Number.isFinite(Date.parse(response.reviewedAt))) {
    fail("reviewerResponse.reviewedAt 必须是有效时间。 ");
  }
  const labels = mapping.groups
    .filter((group) => group.originKind !== "target_reference_context")
    .map((group) => group.label)
    .sort();
  if (!Array.isArray(response.assessments)) fail("reviewerResponse.assessments 必须是数组。 ");
  const assessmentLabels = response.assessments.map((assessment) => cleanString(assessment?.label)).sort();
  if (stableStringify(labels) !== stableStringify(assessmentLabels)) {
    fail("reviewer response 必须对每个匿名组恰好评审一次。 ");
  }
  const assessments = new Map();
  response.assessments.forEach((assessment, index) => {
    validateAssessment(assessment, rubric, `reviewerResponse.assessments[${index}]`);
    assessments.set(assessment.label, assessment);
  });
  if (!Array.isArray(response.pairwiseComparisons)) {
    fail("reviewerResponse.pairwiseComparisons 必须是数组。 ");
  }
  const expectedPairKeys = [];
  for (let left = 0; left < labels.length; left += 1) {
    for (let right = left + 1; right < labels.length; right += 1) {
      expectedPairKeys.push(normalizePairKey(labels[left], labels[right]));
    }
  }
  const comparisons = new Map();
  response.pairwiseComparisons.forEach((comparison, index) => {
    assertExactKeys(
      comparison,
      ["leftLabel", "rightLabel", "outcome", "rationale"],
      `reviewerResponse.pairwiseComparisons[${index}]`
    );
    const leftLabel = cleanString(comparison.leftLabel);
    const rightLabel = cleanString(comparison.rightLabel);
    if (!labels.includes(leftLabel) || !labels.includes(rightLabel) || leftLabel === rightLabel) {
      fail(`reviewerResponse.pairwiseComparisons[${index}] 的匿名组标签非法。`);
    }
    if (!RESPONSE_PAIRWISE_OUTCOMES.has(comparison.outcome)) {
      fail(`reviewerResponse.pairwiseComparisons[${index}].outcome 非法。`);
    }
    if (!cleanString(comparison.rationale)) {
      fail(`reviewerResponse.pairwiseComparisons[${index}].rationale 不能为空。`);
    }
    const key = normalizePairKey(leftLabel, rightLabel);
    if (comparisons.has(key)) fail("reviewerResponse.pairwiseComparisons 不能重复比较同一对。 ");
    comparisons.set(key, comparison);
  });
  if (stableStringify([...comparisons.keys()].sort()) !== stableStringify(expectedPairKeys.sort())) {
    fail("reviewer response 必须覆盖所有匿名组的无序两两比较，不能只针对候选来源。 ");
  }
  return { assessments, comparisons };
}

function candidatePairwiseOutcome(candidateLabels, anchorLabels, comparisons) {
  const outcomes = candidateLabels.flatMap((candidateLabel) => anchorLabels.map((anchorLabel) => {
    const comparison = comparisons.get(normalizePairKey(candidateLabel, anchorLabel));
    if (comparison.outcome === "unscorable") return "unscorable";
    if (comparison.outcome === "comparable") return "comparable";
    const candidateIsLeft = comparison.leftLabel === candidateLabel;
    if (comparison.outcome === "left_better") return candidateIsLeft ? "better" : "weaker";
    return candidateIsLeft ? "weaker" : "better";
  }));
  if (outcomes.includes("unscorable")) return "unscorable";
  if (outcomes.includes("weaker")) return "weaker";
  if (outcomes.includes("comparable")) return "comparable";
  return "better";
}

function aggregateCandidateAssessments(candidateLabels, assessments, rubric) {
  const candidateAssessments = candidateLabels.map((label) => assessments.get(label));
  let decision = "pass";
  if (candidateAssessments.some((assessment) => assessment.decision === "unscorable")) {
    decision = "unscorable";
  } else if (candidateAssessments.some((assessment) => assessment.decision === "needs_fix")) {
    decision = "needs_fix";
  }
  const scores = {};
  for (const dimension of rubric.dimensions) {
    const values = candidateAssessments.map((assessment) => assessment.scores[dimension.id]);
    scores[dimension.id] = values.some((value) => value === null) ? null : Math.min(...values);
  }
  const confidenceRank = { low: 0, medium: 1, high: 2 };
  const confidence = candidateAssessments
    .map((assessment) => assessment.confidence)
    .sort((left, right) => confidenceRank[left] - confidenceRank[right])[0];
  return {
    decision,
    scores,
    findings: candidateAssessments.flatMap((assessment) => cloneJson(assessment.findings)),
    blockers: [...new Set(candidateAssessments.flatMap((assessment) => assessment.blockers))],
    confidence,
    missingEvidence: [...new Set(candidateAssessments.flatMap((assessment) => assessment.missingEvidence))]
  };
}

async function verifyDesignReliabilityReviewerResponse(input) {
  if (!isRecord(input)) fail("verifyDesignReliabilityReviewerResponse input 必须是对象。 ");
  const reviewerPacketDirectory = path.resolve(cleanString(input.reviewerPacketDirectory));
  const sealedMappingPath = path.resolve(cleanString(input.sealedMappingPath));
  if (!fs.existsSync(reviewerPacketDirectory) || !fs.statSync(reviewerPacketDirectory).isDirectory()) {
    fail("reviewerPacketDirectory 必须是存在的目录。 ");
  }
  if (isPathInside(reviewerPacketDirectory, sealedMappingPath)
    || path.resolve(reviewerPacketDirectory) === path.dirname(sealedMappingPath)) {
    fail("sealed mapping 不能位于 reviewer packet 内或其根目录。 ");
  }
  const rubricDigest = validateCaseRunRubric(input.caseSpec, input.run, input.rubric);
  const packetPath = path.join(reviewerPacketDirectory, REVIEW_PACKET_FILE);
  const packet = readJsonFile(packetPath, "reviewer packet");
  const mapping = readJsonFile(sealedMappingPath, "sealed mapping");
  if (packet.version !== REVIEW_PACKET_VERSION) fail("reviewer packet version 非法。 ");
  if (packet.packetDigest !== digestJsonWithout(packet, "packetDigest")) {
    fail("reviewer packet 摘要校验失败。 ");
  }
  validatePublicPacketShape(packet);
  assertPublicPacketHasNoAbsolutePaths(packet);
  verifyMappingAgainstContext(mapping, packet, input.caseSpec, input.run, input.rubric);
  const assetSetDigest = await verifyPacketFiles(reviewerPacketDirectory, packet, mapping);
  const response = isRecord(input.reviewerResponse)
    ? cloneJson(input.reviewerResponse)
    : readJsonFile(path.resolve(cleanString(input.reviewerResponsePath)), "reviewer response");
  const responseValidation = validateReviewerResponse(response, packet, mapping, input.rubric);
  const candidateGroups = mapping.groups.filter((group) => group.originKind === "candidate_final");
  const anchorGroups = mapping.groups.filter((group) => (
    group.originKind === "user_design_anchor" || group.originKind === "eagle_anchor"
  ));
  if (candidateGroups.length === 0 || anchorGroups.length === 0) {
    fail("sealed mapping 缺少候选匿名项或参考匿名项。 ");
  }
  const candidateLabels = candidateGroups.map((group) => group.label);
  const candidateAssessment = aggregateCandidateAssessments(
    candidateLabels,
    responseValidation.assessments,
    input.rubric
  );
  const pairwiseOutcome = candidatePairwiseOutcome(
    candidateLabels,
    anchorGroups.map((group) => group.label),
    responseValidation.comparisons
  );
  const comparisonEvidenceRefs = mapping.groups
    .flatMap((group) => group.evidenceRefs.map((ref) => ({ kind: group.originKind, ref })))
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.ref.localeCompare(right.ref));
  const reviewerResponseDigest = sha256Text(stableStringify(response));
  const reviewProjection = {
    version: REVIEW_VERSION,
    reviewId: `review-${packet.packetId}-${reviewerResponseDigest.slice(7, 19)}`,
    runObservationId: input.run.runObservationId,
    rubricId: input.rubric.rubricId,
    rubricDigest,
    reviewerId: response.reviewerId,
    reviewedAt: response.reviewedAt,
    blindedToCohort: true,
    blindedToCandidateOrigin: true,
    evidenceProtocol: "anonymous_packet_verified",
    evidenceRefs: comparisonEvidenceRefs.map((item) => item.ref),
    comparisonEvidenceKinds: [...new Set(comparisonEvidenceRefs.map((item) => item.kind))],
    comparisonEvidenceRefs,
    decision: candidateAssessment.decision,
    scores: cloneJson(candidateAssessment.scores),
    weightedOverall: calculateWeightedOverall(input.rubric, candidateAssessment.scores),
    pairwiseOutcome,
    findings: cloneJson(candidateAssessment.findings),
    blockers: cloneJson(candidateAssessment.blockers),
    confidence: candidateAssessment.confidence,
    missingEvidence: cloneJson(candidateAssessment.missingEvidence),
    boundaries: { devBenchmarkSidecarOnly: true, neverAffectsRuntime: true }
  };
  if (candidateAssessment.decision === "unscorable") delete reviewProjection.weightedOverall;
  const verifiedAt = cleanString(input.verifiedAt) || new Date().toISOString();
  if (!Number.isFinite(Date.parse(verifiedAt))) fail("verifiedAt 必须是有效时间。 ");
  const verifiedPacketProof = {
    version: VERIFIED_REVIEW_PACKET_PROOF_VERSION,
    packetId: packet.packetId,
    packetDigest: packet.packetDigest,
    sealedMappingDigest: mapping.mappingDigest,
    reviewerResponseDigest,
    assetSetDigest,
    sourceBindingDigest: mapping.sourceBindingDigest,
    comparisonEvidenceDigest: buildComparisonEvidenceDigest(comparisonEvidenceRefs),
    reviewProjectionDigest: buildReviewPacketProjectionDigest(reviewProjection),
    caseRef: cloneJson(mapping.caseRef),
    runObservationId: input.run.runObservationId,
    rubricId: input.rubric.rubricId,
    rubricDigest,
    reviewerId: response.reviewerId,
    reviewedAt: response.reviewedAt,
    verifiedAt,
    verification: {
      packetDigestVerified: true,
      sealedMappingDigestVerified: true,
      reviewerResponseBound: true,
      assetHashesVerified: true,
      sourceBindingsVerified: true,
      randomizedLabelsVerified: true,
      completeBlindResponseVerified: true
    },
    boundaries: {
      sealedMappingExcludedFromReviewerPacket: true,
      noOriginMetadataInReviewerPacket: true,
      noAbsolutePathsInReviewerPacket: true,
      uniformSingleAssetAnonymousGroups: true,
      devBenchmarkOnly: true
    }
  };
  const review = { ...reviewProjection, verifiedPacketProof };
  const reviewValidation = validateDesignReliabilityReview(review, {
    rubric: input.rubric,
    caseSpec: input.caseSpec,
    run: input.run,
    enforceBlindProtocol: true
  });
  if (!reviewValidation.ok) {
    fail(`匿名评审响应不能形成合法 Review v2：${reviewValidation.errors.join("；")}`);
  }
  return {
    review,
    reviewProjection,
    verifiedPacketProof,
    verification: {
      packet,
      sealedMappingDigest: mapping.mappingDigest,
      reviewerResponseDigest,
      assetSetDigest
    }
  };
}

module.exports = {
  REVIEWER_RESPONSE_VERSION,
  REVIEW_PACKET_FILE,
  REVIEW_PACKET_VERSION,
  SEALED_MAPPING_VERSION,
  createDesignReliabilityReviewPacket,
  verifyDesignReliabilityReviewerResponse
};
