const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const {
    normalizeContactSheetObservation
} = require(path.join(root, 'src/main/services/resource-manager-service.ts'));
const {
    applyDesignProjectFactOperations
} = require(path.join(root, 'src/shared/design-project-fact-provenance.ts'));
const {
    extractImagesFromToolResult
} = require(path.join(root, 'src/renderer/services/agent-runtime/tool-result-sanitizer.ts'));
const {
    hasValidDetailAssetSelectionReceipt,
    resolveDetailImageExecutionDeferral
} = require(path.join(root, 'src/renderer/services/skill-executors/detail-page-plan-utils.ts'));
const {
    matchDetailPageContentPlans
} = require(path.join(root, 'src/renderer/services/skill-executors/detail-page-asset-ranker.ts'));
const {
    solveLayout,
    solveRegionLayout,
    validateModelAuthoredLayout
} = require(path.join(root, 'src/shared/layout/layout-engine.ts'));
const {
    buildRenderLayoutStackPlan
} = require(path.join(root, 'src/shared/layout/render-layout-stack-plan.ts'));
const {
    buildSkuColorCardPlan
} = require(path.join(root, 'src/shared/sku-color-card-skill.ts'));
const {
    buildSkuRetouchUniformScaleMetrics
} = require(path.join(root, 'src/shared/sku-retouch-contract.ts'));
const {
    buildRuntimeDeliveryReceipt,
    readRuntimeDeliveryReceipt,
    verifyRuntimeDelivery
} = require(path.join(root, 'src/shared/agent-runtime-v5/runtime-delivery-receipt.ts'));
const {
    beginRuntimeOwnedSkillToolLedgerScope,
    completeRuntimeOwnedSkillToolLedgerScope,
    createGuardedAtomicToolExecutor,
    createRuntimeOwnedSkillDeliveryPlanAuthority,
    issueRuntimeOwnedSkillExternalDeliveryCommitReceipt,
    issueRuntimeOwnedSkillStagingLease
} = require(path.join(root, 'src/shared/agent-skill-atomic-tool-execution.ts'));
const {
    buildAgentDesignExecutionPreflight
} = require(path.join(root, 'src/shared/agent-design-execution-preflight.ts'));
const {
    buildSkuExpectedExportInventory
} = require(path.join(root, 'src/shared/sku-export-readback.ts'));
const {
    buildSkillDeliveryPlan,
    buildSkillDeliveryPlanDigest,
    isCurrentSkillDeliveryPlanDigest,
    isSkillDeliveryPlanDigest,
    resolveSkillDeliveryConvention
} = require(path.join(root, 'src/shared/skills/skill-delivery-convention.ts'));
const {
    normalizeStableSourceReference
} = require(path.join(root, 'src/shared/stable-source-reference.ts'));
const {
    buildMainImageSkillDeliveryPlan
} = require(path.join(root, 'src/shared/main-image-skill-delivery-plan.ts'));
const {
    MAIN_IMAGE_DELIVERY_DOCUMENTS
} = require(path.join(root, 'src/shared/main-image-production-spec.ts'));
const {
    buildMainImageStrategyInputs
} = require(path.join(root, 'src/shared/main-image-strategy-input-builder.ts'));
const {
    buildMainImageAgentDraftPlan
} = require(path.join(root, 'src/shared/main-image-agent-draft-plan.ts'));
const {
    buildMainImageExecutionAlignment
} = require(path.join(root, 'src/shared/main-image-execution-alignment.ts'));
const {
    buildMainImageCopyStrategy
} = require(path.join(root, 'src/shared/main-image-copy-strategy.ts'));
const {
    buildMainImageDesignStandards
} = require(path.join(root, 'src/shared/main-image-design-standards.ts'));
const {
    buildMainImageStateContext
} = require(path.join(root, 'src/shared/main-image-state-consumption.ts'));
const {
    buildMainImageLiveExecutorCheckpoint
} = require(path.join(root, 'src/shared/main-image-live-executor-checkpoint.ts'));
const {
    buildMainImageLivePhotoshopAdapterContract
} = require(path.join(root, 'src/shared/main-image-live-photoshop-adapter-contract.ts'));
const {
    createMainImageLivePhotoshopToolAdapter
} = require(path.join(
    root,
    'src/renderer/services/skill-executors/main-image-live-photoshop-tool-adapter.ts'
));
const {
    hasVerifiedMainImageWhiteBackgroundExport,
    mainImageExecutor
} = require(path.join(
    root,
    'src/renderer/services/skill-executors/main-image.executor.ts'
));
const {
    selectDesignKnowledgeResultsForSkillUse
} = require(path.join(root, 'src/renderer/services/skill-executors/design-planner-context.ts'));
const {
    executeGetDesignLearningTimeline,
    executeProposeSkillImprovement,
    executeRecordDesignVerdict
} = require(path.join(root, 'src/renderer/services/design-workshop/design-learning.store.ts'));
const {
    resolveToolVisualConsumptionOwner
} = require(path.join(root, 'src/renderer/services/tool-executor.service.ts'));
const {
    createDesignLearningLedger
} = require(path.join(root, 'src/shared/design-learning-candidates.ts'));
const {
    buildMainImageDeliveryRuntimeEvidence,
    inspectMainImageStagedDeliveryBeforePromotion
} = require(path.join(
    root,
    'src/renderer/services/skill-executors/main-image-delivery-runtime.ts'
));
const {
    collectRuntimeFinalArtifactPaths
} = require(path.join(root, 'src/shared/runtime-final-artifact-paths.ts'));
const {
    buildSkuEditableDeliveryReadback,
    buildSkuRuntimeDeliveryArtifacts,
    finalizeSkuEditableDeliveryReceipts,
    supportsSkuPairedEditableDelivery,
    validateSkuEditableDeliveryResult
} = require(path.join(
    root,
    'src/renderer/services/skill-executors/sku-editable-delivery.service.ts'
));
const {
    normalizeSkuExportPathForCompare
} = require(path.join(
    root,
    'src/renderer/services/skill-executors/sku-export-transaction.service.ts'
));
const {
    buildDetailPageDeliveryPlan,
    validateDetailPageDeliveryRequest
} = require(path.join(
    root,
    'src/renderer/services/skill-executors/detail-page-delivery-plan.ts'
));
const {
    buildDetailPageDeliveryRuntimeEvidence
} = require(path.join(
    root,
    'src/renderer/services/skill-executors/detail-page-delivery-runtime.ts'
));
const {
    buildDetailPageAgentIntake
} = require(path.join(root, 'src/shared/detail-page-agent-intake.ts'));
const {
    evaluateAgentWorkflowContinuationToolAccess,
    issueRuntimeWorkflowDeliveryReentry,
    peekRuntimeWorkflowDeliveryReentry,
    resolveAgentWorkflowContinuationScopeUpdate
} = require(path.join(root, 'src/shared/agent-workflow-continuation-scope.ts'));
const {
    bindSkuColorCardRuntimeSelection,
    createSkuColorCardRuntimeSelectionReceipt
} = require(path.join(root, 'src/shared/sku-color-card-runtime-selection.ts'));
const {
    buildVisibleAgentActivityFromProgress,
    buildVisibleAgentActivityFromStepEvent,
    formatAgentToolEventContent,
    formatAgentProcessEventContent,
    isVisibleAgentProcessEvent,
    isVisibleAgentStepEvent,
    resolveAgentToolCompletionStepDisposition
} = require(path.join(root, 'src/renderer/services/agent-visible-feedback.ts'));
const {
    canExecuteProviderStreamToolCalls,
    isProviderStreamOutputBlocked,
    isProviderStreamOutputIncomplete,
    mergeProviderFinishReason,
    resolveCanonicalProviderStopReason,
    resolveProviderStreamStopReason
} = require(path.join(root, 'src/shared/provider-stream-completion.ts'));
const {
    parseDsmlToolCallBatch
} = require(path.join(root, 'src/shared/model-tool-call-markup.ts'));
const {
    parseToolCallsFromText
} = require(path.join(root, 'src/main/services/provider-adapters/prompt-tool-parser.ts'));
const { OpenAIAdapter } = require(path.join(root, 'src/main/services/provider-adapters/openai-adapter.ts'));
const { AnthropicAdapter } = require(path.join(root, 'src/main/services/provider-adapters/anthropic-adapter.ts'));
const { GeminiAdapter } = require(path.join(root, 'src/main/services/provider-adapters/gemini-adapter.ts'));
const { OllamaAdapter } = require(path.join(root, 'src/main/services/provider-adapters/ollama-adapter.ts'));
const { BaseStreamAdapter } = require(path.join(root, 'src/main/services/stream-adapter.ts'));
const { ProviderSseDecoder } = require(path.join(root, 'src/main/services/provider-sse-decoder.ts'));
const {
    buildProviderTransportMetrics,
    readProviderTransportMetrics
} = require(path.join(root, 'src/shared/provider-transport-metrics.ts'));
const {
    buildRuntimeAccountingDigest,
    createRuntimeAccountingLedger,
    measureRuntimePromptShape,
    recordRuntimeProviderOutputRecoveryAttempt,
    recordRuntimeProviderOutputRecoveryOutcome,
    validatePersistedRuntimeAccountingDigest,
    validateRuntimeAccountingDigest
} = require(path.join(root, 'src/shared/agent-runtime-v5/runtime-accounting.ts'));
const {
    buildProviderOutputContinuationPrompt,
    buildProviderOutputFailurePresentation,
    ProviderOutputRecoveryController,
    readCompleteProviderTextContent,
    resolveProviderOutputRecoveryOutcome,
    settleProviderToolResponse
} = require(path.join(root, 'src/renderer/services/agent-runtime/provider-output-recovery.ts'));
const { StringDecoder } = require('string_decoder');

async function main() {
const failures = [];

function source(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function check(name, condition, detail = '') {
    if (condition) {
        console.log(`✅ ${name}`);
        return;
    }
    failures.push(`${name}${detail ? `: ${detail}` : ''}`);
    console.error(`❌ ${failures[failures.length - 1]}`);
}

function isPathInside(basePath, targetPath) {
    const relative = path.relative(path.resolve(basePath), path.resolve(targetPath));
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function readTestFileIdentity(filePath) {
    const stat = fs.statSync(filePath);
    return {
        path: filePath,
        byteLength: stat.size,
        modifiedAt: stat.mtimeMs,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
    };
}

function createMainImageStagedDeliveryTestEnvironment(projectRoot) {
    const transactions = new Map();
    const toolCalls = [];
    const documents = new Map();
    let activeDocument = null;
    let transactionSequence = 0;
    let documentSequence = 1100;
    let layerSequence = 4000;

    function activeDocumentOrThrow() {
        if (!activeDocument) throw new Error('positive_main_image_fixture_missing_active_document');
        return activeDocument;
    }

    function makeMutationCommit(document, nextActiveLayerId) {
        const before = {
            documentId: document.id,
            historyStateId: document.historyStateId,
            activeLayerId: document.activeLayerId
        };
        document.historyStateId += 1;
        document.activeLayerId = nextActiveLayerId;
        return {
            version: 'photoshop-mutation-commit/v1',
            basis: 'same_execute_as_modal',
            bindingStrength: 'document_revision',
            before,
            after: {
                documentId: document.id,
                historyStateId: document.historyStateId,
                activeLayerId: document.activeLayerId
            },
            toolActionCompleted: true,
            mutationObserved: true,
            documentChanged: false
        };
    }

    function buildHierarchy(document) {
        const groups = Array.from(document.layers.values()).filter((layer) => layer.kind === 'group');
        const nodes = [];
        document.rootGroupIds.forEach((groupId, index) => {
            const group = document.layers.get(groupId);
            if (!group) return;
            nodes.push({
                id: group.id,
                name: group.name,
                path: group.name,
                kind: 'group',
                parentId: null,
                parentName: null,
                depth: 0,
                index,
                locked: false,
                isBackgroundLayer: false
            });
            group.childGroupIds.forEach((childId, childIndex) => {
                const child = document.layers.get(childId);
                if (!child) return;
                nodes.push({
                    id: child.id,
                    name: child.name,
                    path: `${group.name}/${child.name}`,
                    kind: 'group',
                    parentId: group.id,
                    parentName: group.name,
                    depth: 1,
                    index: childIndex,
                    locked: false,
                    isBackgroundLayer: false
                });
            });
        });
        const groupPathById = new Map(
            nodes.filter((node) => node.kind === 'group').map((node) => [node.id, node.path])
        );
        const contentLayersByParent = new Map();
        Array.from(document.layers.values())
            .filter((layer) => layer.kind !== 'group' && Number.isSafeInteger(layer.parentId))
            .forEach((layer) => {
                const siblings = contentLayersByParent.get(layer.parentId) || [];
                siblings.push(layer);
                contentLayersByParent.set(layer.parentId, siblings);
            });
        for (const [parentId, contentLayers] of contentLayersByParent) {
            const parentPath = groupPathById.get(parentId);
            if (!parentPath) continue;
            contentLayers.forEach((layer, index) => {
                nodes.push({
                    id: layer.id,
                    name: layer.name,
                    path: `${parentPath}/${layer.name}`,
                    kind: layer.kind,
                    parentId,
                    parentName: document.layers.get(parentId)?.name || null,
                    depth: parentPath.split('/').length,
                    index,
                    locked: false,
                    isBackgroundLayer: false
                });
            });
        }
        nodes.push({
            id: document.backgroundLayerId,
            name: 'Background',
            path: 'Background',
            kind: 'background',
            parentId: null,
            parentName: null,
            depth: 0,
            index: document.rootGroupIds.length,
            locked: true,
            isBackgroundLayer: true
        });
        return nodes;
    }

    async function executeTool(toolName, params) {
        toolCalls.push({ toolName, params: { ...params } });
        if (toolName === 'createDocument') {
            documentSequence += 1;
            layerSequence += 1;
            const document = {
                id: documentSequence,
                name: String(params.name || ''),
                width: Number(params.width),
                height: Number(params.height),
                resolution: Number(params.resolution),
                colorMode: String(params.colorMode || 'RGB'),
                bitDepth: Number(params.bitDepth || 8),
                backgroundLayerId: layerSequence,
                historyStateId: 1,
                activeLayerId: layerSequence,
                layers: new Map(),
                rootGroupIds: []
            };
            const beforeOpenDocumentIds = Array.from(documents.keys()).sort((left, right) => left - right);
            documents.set(document.id, document);
            activeDocument = document;
            const backgroundLayer = {
                id: document.backgroundLayerId,
                name: 'Background',
                isBackgroundLayer: true,
                locked: true
            };
            return {
                success: true,
                documentId: document.id,
                name: document.name,
                width: document.width,
                height: document.height,
                resolution: document.resolution,
                backgroundLayer,
                document: {
                    id: document.id,
                    name: document.name,
                    width: document.width,
                    height: document.height,
                    resolution: document.resolution,
                    colorMode: document.colorMode,
                    bitDepth: document.bitDepth,
                    backgroundLayer
                },
                photoshopMutationCommit: {
                    version: 'photoshop-mutation-commit/v1',
                    basis: 'same_execute_as_modal',
                    bindingStrength: 'unguarded',
                    changeKind: 'document_creation',
                    beforeOpenDocumentIds,
                    createdDocumentId: document.id,
                    after: {
                        documentId: document.id,
                        historyStateId: document.historyStateId,
                        activeLayerId: document.activeLayerId
                    },
                    toolActionCompleted: true,
                    mutationObserved: true,
                    documentChanged: true
                }
            };
        }

        const document = activeDocumentOrThrow();
        if (toolName === 'getDocumentInfo') {
            return {
                success: true,
                historyStateRef: {
                    documentId: document.id,
                    historyStateId: document.historyStateId
                },
                document: {
                    id: document.id,
                    name: document.name,
                    width: document.width,
                    height: document.height,
                    resolution: document.resolution,
                    colorMode: document.colorMode,
                    bitDepth: document.bitDepth,
                    layerCount: 1 + document.layers.size
                }
            };
        }
        if (toolName === 'createGroup') {
            layerSequence += 1;
            const layer = {
                id: layerSequence,
                name: String(params.groupName || ''),
                kind: 'group',
                parentId: undefined,
                childGroupIds: []
            };
            document.layers.set(layer.id, layer);
            return {
                success: true,
                layerId: layer.id,
                groupName: layer.name,
                photoshopMutationCommit: makeMutationCommit(document, layer.id)
            };
        }
        if (toolName === 'moveLayerToGroup') {
            const layerId = Number(params.layerId);
            const targetGroupId = Number(params.targetGroupId);
            const layer = document.layers.get(layerId);
            if (!layer) return { success: false, error: 'fixture_layer_not_found' };
            layer.parentId = targetGroupId;
            if (layer.kind === 'group') {
                if (targetGroupId === 0) {
                    document.rootGroupIds.unshift(layer.id);
                } else {
                    const parent = document.layers.get(targetGroupId);
                    if (!parent || parent.kind !== 'group') {
                        return { success: false, error: 'fixture_parent_group_not_found' };
                    }
                    parent.childGroupIds.push(layer.id);
                }
            }
            return {
                success: true,
                layerId,
                targetGroupId,
                photoshopMutationCommit: makeMutationCommit(document, layerId)
            };
        }
        if (toolName === 'getLayerHierarchy') {
            return {
                success: true,
                historyStateRef: {
                    documentId: document.id,
                    historyStateId: document.historyStateId
                },
                flatList: buildHierarchy(document)
            };
        }
        if (toolName === 'placeImage') {
            layerSequence += 1;
            const layer = {
                id: layerSequence,
                name: path.basename(String(params.filePath || 'placed-image')),
                kind: 'image',
                parentId: undefined
            };
            document.layers.set(layer.id, layer);
            return {
                success: true,
                layerId: layer.id,
                layer: { id: layer.id, name: layer.name },
                photoshopMutationCommit: makeMutationCommit(document, layer.id)
            };
        }
        if (toolName === 'transformLayer') {
            const layerId = Number(params.layerId || document.activeLayerId);
            return {
                success: true,
                layerId,
                photoshopMutationCommit: makeMutationCommit(document, layerId)
            };
        }
        if (toolName === 'getLayerProperties') {
            const layerId = Number(params.layerId || document.activeLayerId);
            return {
                success: true,
                historyStateRef: {
                    documentId: document.id,
                    historyStateId: document.historyStateId
                },
                layer: { id: layerId, name: document.layers.get(layerId)?.name || 'layer' }
            };
        }
        if (toolName === 'saveDocument') {
            const targetPath = String(params.path || '');
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, Buffer.from(`editable:${document.name}:${document.historyStateId}`));
            const identity = readTestFileIdentity(targetPath);
            const format = path.extname(targetPath).slice(1).toLowerCase();
            return {
                success: true,
                saved: true,
                savedPath: targetPath,
                format,
                sourceHistoryStateRef: {
                    documentId: document.id,
                    historyStateId: document.historyStateId
                },
                editableDocumentArtifact: {
                    version: 'runtime-editable-document-artifact/v1',
                    basis: 'uxp_post_save_file_metadata',
                    path: targetPath,
                    format,
                    byteLength: identity.byteLength,
                    modifiedAt: identity.modifiedAt,
                    documentId: document.id,
                    canvas: { width: document.width, height: document.height }
                }
            };
        }
        if (toolName === 'exportGroup') {
            const targetPath = String(params.outputPath || '');
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, Buffer.from(`raster:${document.name}:${document.historyStateId}`));
            return {
                success: true,
                outputPath: targetPath,
                sourceHistoryStateRef: {
                    documentId: document.id,
                    historyStateId: document.historyStateId
                },
                readback: {
                    outputPath: targetPath,
                    sourceHistoryStateRef: {
                        documentId: document.id,
                        historyStateId: document.historyStateId
                    }
                }
            };
        }
        if (toolName === 'getAcceptanceSnapshot') {
            return {
                success: true,
                historyStateRef: {
                    documentId: document.id,
                    historyStateId: document.historyStateId
                },
                documentId: document.id,
                layerCount: 1 + document.layers.size
            };
        }
        return { success: true };
    }

    const designEcho = {
        async issueSkuStagingTransaction(input) {
            transactionSequence += 1;
            const stagingParent = path.join(input.outputDir, '.designecho-staging');
            const transactionId = `main-image-positive-${transactionSequence}`;
            const stagingRoot = path.join(stagingParent, transactionId);
            const transactionToken = `main-image-positive-token-${transactionSequence}`;
            fs.mkdirSync(stagingRoot, { recursive: true });
            transactions.set(transactionToken, {
                transactionId,
                stagingRoot,
                stagingParent,
                outputDir: input.outputDir
            });
            return {
                success: true,
                transactionToken,
                transactionId,
                stagingRoot,
                stagingParent,
                outputDir: input.outputDir
            };
        },
        async captureSkuStagingDestinationBaselines(transactionToken, destinationPaths) {
            if (!transactions.has(transactionToken)) {
                return { success: false, error: 'fixture_transaction_not_found' };
            }
            return {
                success: true,
                baselines: destinationPaths.map((destinationPath) => {
                    if (!fs.existsSync(destinationPath)) return { path: destinationPath, exists: false };
                    const identity = readTestFileIdentity(destinationPath);
                    return {
                        path: destinationPath,
                        exists: true,
                        modifiedTimeMs: identity.modifiedAt,
                        byteLength: identity.byteLength,
                        sha256: identity.sha256
                    };
                })
            };
        },
        async promoteStagedFileSet(input) {
            const transaction = transactions.get(input.transactionToken);
            if (!transaction) return { success: false, error: 'fixture_transaction_not_found' };
            const committedPaths = [];
            const committedFiles = [];
            for (const item of input.items) {
                if (!isPathInside(transaction.stagingRoot, item.sourcePath)
                    || !isPathInside(projectRoot, item.destinationPath)
                    || !fs.existsSync(item.sourcePath)
                    || fs.existsSync(item.destinationPath)
                    || item.expectedDestinationBaseline?.exists !== false) {
                    return { success: false, error: 'fixture_promotion_mapping_rejected', rollbackComplete: true };
                }
                fs.mkdirSync(path.dirname(item.destinationPath), { recursive: true });
                fs.copyFileSync(item.sourcePath, item.destinationPath);
                const identity = readTestFileIdentity(item.destinationPath);
                committedPaths.push(item.destinationPath);
                committedFiles.push({
                    path: item.destinationPath,
                    byteLength: identity.byteLength,
                    sha256: identity.sha256
                });
            }
            return {
                success: true,
                committedPaths,
                committedFiles,
                cleanupWarnings: []
            };
        },
        async removeSkuStagingTransactionRoot(transactionToken) {
            const transaction = transactions.get(transactionToken);
            if (!transaction || !isPathInside(projectRoot, transaction.stagingRoot)) {
                return { success: false, error: 'fixture_cleanup_scope_rejected' };
            }
            fs.rmSync(transaction.stagingRoot, { recursive: true, force: true });
            return { success: true };
        },
        async removeSkuStagingParentIfEmpty(transactionToken) {
            const transaction = transactions.get(transactionToken);
            if (!transaction || !isPathInside(projectRoot, transaction.stagingParent)) {
                return { success: false, error: 'fixture_parent_cleanup_scope_rejected' };
            }
            if (fs.existsSync(transaction.stagingParent)
                && fs.readdirSync(transaction.stagingParent).length === 0) {
                fs.rmdirSync(transaction.stagingParent);
            }
            return { success: true };
        },
        async probeImageFile(filePath) {
            if (!fs.existsSync(filePath)) {
                return {
                    success: true,
                    path: filePath,
                    status: 'missing',
                    exists: false,
                    isFile: false,
                    rawImagesRedacted: true
                };
            }
            const identity = readTestFileIdentity(filePath);
            const sizeKey = /[\\/]750[\\/]/.test(filePath)
                ? '750'
                : (/[\\/]1200[\\/]/.test(filePath) ? '1200' : '800');
            const documentSpec = MAIN_IMAGE_DELIVERY_DOCUMENTS.find((document) => (
                document.folderKey === sizeKey
            ));
            return {
                success: true,
                path: filePath,
                status: 'ok',
                exists: true,
                isFile: true,
                byteLength: identity.byteLength,
                sha256: identity.sha256,
                format: path.extname(filePath).slice(1).toLowerCase(),
                dimensions: documentSpec?.canvasSize,
                rawImagesRedacted: true
            };
        }
    };

    return {
        designEcho,
        executeTool,
        toolCalls,
        transactions,
        documents,
        getActiveDocument() {
            return activeDocument;
        },
        setActiveDocument(document) {
            if (!document || !documents.has(document.id)) {
                throw new Error('positive_main_image_fixture_document_not_owned');
            }
            activeDocument = document;
        }
    };
}

const toolExecutor = source('src/renderer/services/tool-executor.service.ts');
const toolSchemas = source('src/renderer/services/agent-runtime/tool-schemas.ts');
const toolDisplayInfoSource = source('src/renderer/services/tool-display-info.ts');
const composeExecutor = source('src/renderer/services/design-workshop/compose-design.executor.ts');
const scalingPolicy = source('src/shared/design-smart-scaling-policy.ts');
const mainImagePlacement = source('src/shared/main-image-variant-placement-strategy.ts');
const mainImageExecutorSource = source('src/renderer/services/skill-executors/main-image.executor.ts');
const mainImageDeliveryRuntimeSource = source('src/renderer/services/skill-executors/main-image-delivery-runtime.ts');
const mainImageExecutionPlanSource = source('src/shared/main-image-production-execution-plan.ts');
const mainImageAdapterContractSource = source('src/shared/main-image-live-photoshop-adapter-contract.ts');
const uxpExportGroupSource = source('../DesignEcho-UXP/src/tools/image/export-group.ts');
const skillDeclarations = source('src/shared/skills/skill-declarations.ts');
const skillParamDefaults = source('src/shared/skill-param-defaults.ts');
const mainImageSkillPlaybook = source('skills/main-image-design/SKILL.md');
const detailPageSkillPlaybook = source('skills/detail-page-design/SKILL.md');
const skuProductionSkillPlaybook = source('skills/sku-production/SKILL.md');
const referenceStyleRecipes = source('src/shared/reference-replication-style-recipes.ts');
const referenceApply = source('src/renderer/services/skill-executors/layout-replication-apply.ts');
const composeSpec = source('src/shared/design-workshop/compose-design-spec.ts');
const prompts = source('src/shared/prompts/index.ts');
const mainImageManifest = source('src/shared/agent-runtime-v5/manifests/main-image.manifest.ts');
const detailPageManifest = source('src/shared/agent-runtime-v5/manifests/detail-page.manifest.ts');
const observationCard = source('src/shared/agent-runtime-v5/visual-observation-card.ts');
const taskCompletion = source('src/renderer/services/agent-runtime/task-completion-contract.ts');
const codexSubscription = source('src/main/services/codex-subscription-service.ts');
const codexStrictOutputSchema = source('src/main/services/codex-strict-output-schema.ts');
const capabilitySession = source('src/renderer/services/agent-runtime/capability-session.ts');
const autonomousExecutor = source('src/renderer/services/skill-executors/autonomous-agent.executor.ts');
const designAgentEngineSource = source('src/renderer/services/design-agent/engine.ts');
const skillRoutingSource = source('src/shared/skill-routing.ts');
const agentRuntime = source('src/renderer/services/agent-runtime/agent.ts');
const modelCallAccountingSource = source(
    'src/renderer/services/agent-runtime/model-call-accounting.ts'
);
const providerOutputRecoverySource = source('src/renderer/services/agent-runtime/provider-output-recovery.ts');
const agentMessageContext = source('src/renderer/services/agent-runtime/message-context.ts');
const mcpHostClient = source('src/renderer/services/mcp-host.client.ts');
const preloadSource = source('src/main/preload.ts');
const detailPageAssetRanker = source('src/renderer/services/skill-executors/detail-page-asset-ranker.ts');
const detailPageExecutor = source('src/renderer/services/skill-executors/detail-page.executor.ts');
const detailPageDeliveryPlanSource = source('src/renderer/services/skill-executors/detail-page-delivery-plan.ts');
const detailPagePlanUtils = source('src/renderer/services/skill-executors/detail-page-plan-utils.ts');
const uxpDetailPageFiller = source('../DesignEcho-UXP/src/tools/layout/detail-page-filler.ts');
const uxpDetailPageSliceExporter = source('../DesignEcho-UXP/src/tools/layout/slice-exporter.ts');
const uxpDetailPageSliceContract = source('../DesignEcho-UXP/src/tools/layout/slice-export-contract.ts');
const mainImageProjectStyleStrategy = source('src/shared/main-image-project-style-strategy.ts');
const skuTemplateManifest = source('src/shared/agent-runtime-v5/manifests/sku-template.manifest.ts');
const skuColorCardManifestSource = source('src/shared/agent-runtime-v5/manifests/sku-color-card.manifest.ts');
const skuColorCardRetouchStrategySource = source('src/shared/sku-color-card-retouch-strategy.ts');
const skuVisualReviewIntakeSource = source('src/shared/sku-visual-review-intake.ts');
const toolDependenciesSource = source('src/shared/config/tool-dependencies.ts');
const skuTemplateDesignLoop = source('src/shared/sku-template-design-loop.ts');
const modelProviderFailureBoundary = source('src/renderer/services/agent-runtime/model-provider-failure-boundary.ts');
const modelProviderTransportPolicy = source('src/shared/model-provider-transport-policy.ts');
const failureBreaker = source('src/renderer/services/agent-runtime/tool-failure-breaker.ts');
const messageRendererCss = source('src/renderer/components/message/MessageRenderer.css');
const designerAutonomyPrinciples = source('src/shared/designer-agent-autonomy-principles.ts');
const designerDecisionContractSource = source('src/shared/designer-agent-decision-contract.ts');
const designMethodKnowledgeSource = source('src/shared/agent-runtime-v5/design-method-knowledge.ts');
const designArtifactKnowledgeSource = source('src/shared/knowledge/design-artifact-knowledge.ts');
const designPrinciplesSource = source('src/shared/knowledge/design-principles.ts');
const projectVisualSamplingSource = source('src/shared/project-visual-sampling.ts');
const resourceManagerSource = source('src/main/services/resource-manager-service.ts');
const toolResultSanitizerSource = source('src/renderer/services/agent-runtime/tool-result-sanitizer.ts');
const uxpTemplateTool = source('../DesignEcho-UXP/src/tools/layout/template-tool.ts');
const layoutEngineSource = source('src/shared/layout/layout-engine.ts');
const skuBatchExecutorSource = source('src/renderer/services/skill-executors/sku-batch.executor.ts');
const skuColorCardExecutorSource = source('src/renderer/services/skill-executors/sku-color-card.executor.ts');
const skuColorCardContractSource = source('src/shared/sku-color-card-skill.ts');
const skuCardSourcePreparationSource = source('src/shared/sku-card-source-preparation-plan.ts');
const manualSkuColorCardBridgeSource = source('src/renderer/services/manual-sku-color-card-bridge.ts');
const manualSkuColorCardContractSource = source('src/shared/manual-sku-color-card.ts');
const manualSkuColorCardHandlerSource = source('src/main/uxp-handlers/manual-sku-color-card-handlers.ts');
const uxpIndexSource = source('../DesignEcho-UXP/src/index.ts');
const skillToolsSource = source('src/renderer/services/skill-executors/skill-tools.ts');
const chatPanelSource = source('src/renderer/components/ChatPanel.tsx');
const streamChatSource = source('src/renderer/services/stream-chat.service.ts');
const agentToolStreamSource = source('src/renderer/services/agent-tool-stream.service.ts');
const streamAdapterSource = source('src/main/services/stream-adapter.ts');
const modelServiceSource = source('src/main/services/model-service.ts');
const openAiCompatibleToolStreamSource = modelServiceSource.slice(
    modelServiceSource.indexOf('private async streamOpenAICompatibleWithTools'),
    modelServiceSource.indexOf('private streamOpenRouterWithTools')
);
const skuRetouchServiceSource = source('src/main/services/sku-retouch-service.ts');
const skuRetouchContractSource = source('src/shared/sku-retouch-contract.ts');
const claudeSubscriptionSource = source('src/main/services/claude-subscription-service.ts');
const agentRunRecordSource = source('src/shared/agent-run-record.ts');
const skillExecutorRegistrySource = source('src/renderer/services/skill-executors/registry.ts');

const skuSourcePreparationSlice = skuBatchExecutorSource.slice(
    skuBatchExecutorSource.indexOf('const executeSkuCardSourcePreparationPlan = async'),
    skuBatchExecutorSource.indexOf('const executeSkuCardTemplatePreparationPlan = async')
);
const skuRetouchToolSchemaSlice = toolSchemas.slice(
    toolSchemas.indexOf("name: 'prepareSkuRetouchAssets'"),
    toolSchemas.indexOf("name: 'generateImage'", toolSchemas.indexOf("name: 'prepareSkuRetouchAssets'"))
);

const interactionOwnerResolverSource = autonomousExecutor.slice(
    autonomousExecutor.indexOf('function resolveProviderOwnedInteractionSkillIds('),
    autonomousExecutor.indexOf('function buildWorkflowMenuLines(')
);
const providerTruncationRecoveryBranchSource = agentRuntime.slice(
    agentRuntime.indexOf('if (isProviderOutputTruncated(response.stopReason))'),
    agentRuntime.indexOf('if (isProviderOutputBlocked(response.stopReason))')
);
check(
    '普通文字推荐不能在模型理解前绑定 Runtime Skill 身份',
    designAgentEngineSource.includes('buildRuntimeSelectedSkillHandoffFromUserSelection({')
        && !designAgentEngineSource.includes('buildRuntimeSelectedSkillHandoffFromRecommendation')
        && !skillRoutingSource.includes('function buildRuntimeSelectedSkillHandoffFromRecommendation')
        && skillRoutingSource.includes('bindsRuntimeIdentity: false')
);
check(
    '业务 Skill 结果使用执行器实际消费的刷新后视觉上下文',
    !skillExecutorRegistrySource.includes(
        'const businessVisualContext = buildBusinessVisualContextForSkill(skillId, scenarioPreparedExecuteParams);'
    )
        && skillExecutorRegistrySource.includes(
            'buildBusinessVisualContextForSkill(skillId, executeParamsForBusiness)'
        )
);
const controlledRunVisibleReviewSource = designAgentEngineSource.slice(
    designAgentEngineSource.indexOf('function emitControlledRunVisibleReview('),
    designAgentEngineSource.indexOf('function shouldRepairAfterControlledRunObservation(')
);
check(
    'legacy public-plan 已创建结果不替 canonical verdict 固定要求审美复核',
    controlledRunVisibleReviewSource.includes('计划中的主要内容仍然存在。')
        && !/人工审美确认|建议再看一下整体留白|需要继续复核整体效果/.test(
            controlledRunVisibleReviewSource
        )
);
check(
    '未绑定的 Skill 推荐不能抢占通用交互卡所有权',
    interactionOwnerResolverSource.includes('capabilitySession?.getResolution().manifestRef')
        && !interactionOwnerResolverSource.includes('skillRoutingRecommendation')
        && !interactionOwnerResolverSource.includes('recommendation.skillId')
);
check(
    'Provider 截断恢复保留真实故障但不冒充用户可见设计回复',
    !agentRuntime.includes('回复未完整，继续整理')
        && agentRuntime.includes("title: 'Provider 输出截断，后台续接'")
        && agentRuntime.includes("audience: 'debug'")
        && !providerTruncationRecoveryBranchSource.includes('createAssistantHistoryMessage(')
        && !agentRuntime.includes('如 sourceDirectory')
        && agentRuntime.includes('这次没有拿到完整结果')
);
const providerTruncationDebugEvent = {
    kind: 'warning',
    title: 'Provider 输出截断，后台续接',
    detail: '丢弃本次未提交输出并请求有界续接；残缺 Tool 调用不会执行。',
    status: 'running',
    audience: 'debug',
    issue: 'provider_output_truncated'
};
const providerTruncationWithMutation = buildProviderOutputFailurePresentation({
    kind: 'truncated',
    phase: 'agent_turn',
    recoveryAttempts: 2,
    recoveryAttemptsInRun: 4,
    hasPhotoshopMutation: true,
    taskProgressPreserved: true
});
const providerTruncationWithoutMutation = buildProviderOutputFailurePresentation({
    kind: 'truncated',
    phase: 'agent_turn',
    recoveryAttempts: 2,
    recoveryAttemptsInRun: 4,
    hasPhotoshopMutation: false,
    taskProgressPreserved: false
});
const guardedProviderProcessText = formatAgentProcessEventContent({
    ...providerTruncationDebugEvent,
    audience: 'user',
    visibility: 'user_process',
    status: 'error'
});
check(
    '成功的 Provider 截断续接不会进入普通 UI，连续失败仍以写入事实区分最终结果',
    buildVisibleAgentActivityFromStepEvent(providerTruncationDebugEvent) === null
        && isVisibleAgentProcessEvent(providerTruncationDebugEvent) === false
        && buildVisibleAgentActivityFromProgress('Provider 输出截断，后台续接') === null
        && buildVisibleAgentActivityFromProgress('本轮消耗 4096 token，后台续接') === null
        && guardedProviderProcessText === '当前处理条件还不完整，暂时不能确认画面结果。'
        && !/token|轮次|Provider|Harness|后台续接/u.test(guardedProviderProcessText)
        && providerTruncationWithMutation.message.includes('前面的 Photoshop 改动已保留')
        && providerTruncationWithoutMutation.message.includes('尚未修改 Photoshop 画面')
        && providerTruncationWithMutation.stopReason === 'provider_output_truncated'
        && !/token|轮次|Provider|Harness|后台续接/u.test(providerTruncationWithMutation.message)
        && chatPanelSource.includes('const activity = buildVisibleAgentActivityFromStepEvent(event)')
        && chatPanelSource.includes('if (event?.title && isVisibleAgentProcessEvent(event))')
        && chatPanelSource.includes('buildVisibleAgentActivityFromProgress(message, current) || current')
        && chatPanelSource.includes('const resultVisibleMessage = resolvedVisibleResult.content')
        && chatPanelSource.includes('const formattedFailureContent = formatFailureContent(')
);
const recoverableToolCompletion = {
    kind: 'tool_completed',
    title: '失败：写入文字',
    detail: '目标图层已经变化',
    status: 'error',
    toolName: 'setTextContent',
    toolCallId: 'call-recoverable-1',
    issue: 'tool_attempt_failed',
    audience: 'debug'
};
const visibleToolCompletion = {
    kind: 'tool_completed',
    title: '完成：写入文字',
    status: 'success',
    toolName: 'setTextContent',
    toolCallId: 'call-visible-1',
    audience: 'user',
    visibility: 'user_process'
};
const explicitVisibleActionError = {
    ...recoverableToolCompletion,
    title: '写入文字遇到问题',
    detail: '目标图层不存在',
    issue: 'terminal_action_error',
    audience: 'user',
    visibility: 'user_process'
};
const explicitVisibleActionErrorText = formatAgentToolEventContent(explicitVisibleActionError);
check(
    '动作 disposition 收束过程行，不能由原始 error 提前宣判整个任务未完成',
    resolveAgentToolCompletionStepDisposition(recoverableToolCompletion) === 'settle_started_step'
        && isVisibleAgentStepEvent(recoverableToolCompletion) === false
        && resolveAgentToolCompletionStepDisposition({
            ...recoverableToolCompletion,
            issue: 'cancelled'
        }) === 'ignore'
        && resolveAgentToolCompletionStepDisposition(visibleToolCompletion) === 'visible'
        && isVisibleAgentStepEvent(visibleToolCompletion) === true
        && explicitVisibleActionErrorText.includes('目标图层不存在')
        && !explicitVisibleActionErrorText.includes('未完成')
        && chatPanelSource.includes("completionStepDisposition === 'settle_started_step'")
        && chatPanelSource.includes('toolStepIdsByCallId.get(event.toolCallId)')
        && chatPanelSource.includes("startedStep?.status === 'running' || startedStep?.status === 'pending'")
        && chatPanelSource.includes('removeStep(startedStep.id)')
        && chatPanelSource.includes("status: 'failed',\n        summaryText: existingSummaryText || '这次没有取得可确认的执行结果。'")
        && !chatPanelSource.includes('执行状态字段不是结构化状态，已按需复核处理')
        && !chatPanelSource.includes('（未完成）')
);
const plainTextContinuationPrompt = buildProviderOutputContinuationPrompt({
    truncatedToolNames: [],
    requiresRealAction: false
});
check(
    '纯文本截断恢复重新生成完整终稿而不是只交付续写后半段',
    plainTextContinuationPrompt.includes('完整、精简、可独立阅读的最终回答')
        && plainTextContinuationPrompt.includes('不要只续写后半段')
        && !plainTextContinuationPrompt.includes('请直接补全当前回复')
        && !plainTextContinuationPrompt.includes('不要重复已经说过的内容，请继续完成当前判断')
);
check(
    'Provider 终态缺失、长度截断和内容拦截不会冒充完整回复或可执行 Tool',
    resolveProviderStreamStopReason({ finishReason: 'stop' }) === 'end_turn'
        && resolveProviderStreamStopReason({ finishReason: 'tool_calls', hasToolCalls: true }) === 'tool_use'
        && resolveProviderStreamStopReason({ finishReason: 'tool_calls', hasToolCalls: false }) === 'stream_incomplete'
        && resolveProviderStreamStopReason({ finishReason: 'length', hasToolCalls: true }) === 'max_tokens'
        && resolveProviderStreamStopReason({ finishReason: 'MAX_TOKENS' }) === 'max_tokens'
        && resolveProviderStreamStopReason({ finishReason: 'SAFETY' }) === 'content_blocked'
        && resolveProviderStreamStopReason({ finishReason: undefined, hasToolCalls: true }) === 'stream_incomplete'
        && resolveProviderStreamStopReason({ finishReason: 'stop', transportComplete: true }) === 'end_turn'
        && resolveProviderStreamStopReason({ finishReason: 'stop', transportComplete: false }) === 'stream_incomplete'
        && resolveProviderStreamStopReason({ finishReason: 'length', transportComplete: true }) === 'max_tokens'
        && resolveProviderStreamStopReason({ finishReason: 'length', transportComplete: false }) === 'stream_incomplete'
        && resolveProviderStreamStopReason({ finishReason: undefined, transportComplete: true }) === 'stream_incomplete'
        && isProviderStreamOutputIncomplete('stream_incomplete') === true
        && isProviderStreamOutputBlocked('content_blocked') === true
        && canExecuteProviderStreamToolCalls('tool_use') === true
        && canExecuteProviderStreamToolCalls('max_tokens') === false
        && canExecuteProviderStreamToolCalls('stream_incomplete') === false
        && ['end_turn', 'tool_use', 'max_tokens', 'stream_incomplete', 'content_blocked']
            .every((reason) => resolveCanonicalProviderStopReason(reason) === reason)
);
const conflictingFinishReason = mergeProviderFinishReason('length', 'stop');
const repeatedFinishReason = mergeProviderFinishReason('tool_calls', 'tool_calls');
const validSettledToolResponse = settleProviderToolResponse({
    stopReason: 'tool_use',
    toolCalls: [{ id: 'call-1', name: 'saveDocument', arguments: {} }]
});
const missingToolSettledResponse = settleProviderToolResponse({
    stopReason: 'tool_use',
    toolCalls: []
});
const unexpectedToolSettledResponse = settleProviderToolResponse({
    stopReason: 'end_turn',
    toolCalls: [{ id: 'call-2', name: 'saveDocument', arguments: {} }]
});
const duplicateToolIdSettledResponse = settleProviderToolResponse({
    stopReason: 'tool_use',
    toolCalls: [
        { id: 'duplicate', name: 'saveDocument', arguments: {} },
        { id: 'duplicate', name: 'getDocumentInfo', arguments: {} }
    ]
});
check(
    '冲突 finish reason 与 stopReason/ToolCall 协议矛盾统一 fail closed',
    conflictingFinishReason.finishReason === 'length'
        && conflictingFinishReason.conflict === true
        && repeatedFinishReason.finishReason === 'tool_calls'
        && repeatedFinishReason.conflict === false
        && validSettledToolResponse.stopReason === 'tool_use'
        && validSettledToolResponse.toolCalls.length === 1
        && missingToolSettledResponse.stopReason === 'stream_incomplete'
        && missingToolSettledResponse.toolCalls.length === 0
        && unexpectedToolSettledResponse.stopReason === 'stream_incomplete'
        && unexpectedToolSettledResponse.toolCalls.length === 0
        && duplicateToolIdSettledResponse.stopReason === 'stream_incomplete'
        && duplicateToolIdSettledResponse.toolCalls.length === 0
);
const completeAuxiliaryText = readCompleteProviderTextContent({
    stopReason: 'stop',
    content: '完整正文。',
    toolCalls: []
});
const emptyCompleteAuxiliaryText = readCompleteProviderTextContent({
    stopReason: 'end_turn',
    content: '',
    toolCalls: []
});
const rejectedAuxiliaryTexts = [
    readCompleteProviderTextContent({ stopReason: 'max_tokens', content: '半句话' }),
    readCompleteProviderTextContent({ stopReason: 'content_blocked', content: '不可消费' }),
    readCompleteProviderTextContent({ content: '缺少终态' }),
    readCompleteProviderTextContent({
        stopReason: 'end_turn',
        content: '与工具调用冲突',
        toolCalls: [{ id: 'call-3', name: 'saveDocument', arguments: {} }]
    }),
    readCompleteProviderTextContent({
        stopReason: 'end_turn',
        content: '带残缺工具名',
        incompleteToolCallNames: ['saveDocument']
    }),
    readCompleteProviderTextContent({
        stopReason: 'end_turn',
        content: '冲突终态',
        terminalConflict: true
    }),
    readCompleteProviderTextContent({
        stopReason: 'end_turn',
        content: '传输未完成',
        transportComplete: false
    })
];
check(
    '辅助模型正文只在无 Tool 的完整自然终态后可消费',
    completeAuxiliaryText.complete === true
        && completeAuxiliaryText.content === '完整正文。'
        && completeAuxiliaryText.stopReason === 'end_turn'
        && emptyCompleteAuxiliaryText.complete === true
        && emptyCompleteAuxiliaryText.content === ''
        && rejectedAuxiliaryTexts.every((result) => (
            result.complete === false
            && result.content === ''
        ))
);
check(
    '初始图片、视觉批次、强制收尾、no-tool replan 与两类总结共用完整终态 reader',
    (agentRuntime.match(/readCompleteProviderTextContent\(/g) || []).length >= 7
        && !agentRuntime.includes("const observation = String(response?.content || '').trim()")
        && !agentRuntime.includes("const judgment = String(expertResponse?.content || '').trim()")
        && agentRuntime.includes('if (!terminalContent.complete)')
        && agentRuntime.includes("throw new Error('视觉评审模型没有返回可消费的完整终态')")
);
check(
    'Provider 恢复结果按完整、截断、拦截和未知终态稳定归类',
    resolveProviderOutputRecoveryOutcome('end_turn') === 'succeeded'
        && resolveProviderOutputRecoveryOutcome('tool_use') === 'succeeded'
        && resolveProviderOutputRecoveryOutcome('length') === 'max_tokens'
        && resolveProviderOutputRecoveryOutcome('max_tokens') === 'max_tokens'
        && resolveProviderOutputRecoveryOutcome('content_blocked') === 'content_blocked'
        && resolveProviderOutputRecoveryOutcome(undefined) === 'stream_incomplete'
        && resolveProviderOutputRecoveryOutcome('future_unknown_reason') === 'stream_incomplete'
);
const providerRecoveryController = new ProviderOutputRecoveryController();
providerRecoveryController.schedule([{ name: 'first' }]);
const recoveredToolSnapshot = providerRecoveryController.consumePendingTools();
recoveredToolSnapshot[0].name = 'mutated-outside';
providerRecoveryController.schedule([{ name: 'second' }]);
const exhaustedConsecutiveRecovery = providerRecoveryController.canSchedule() === false;
providerRecoveryController.markComplete();
providerRecoveryController.schedule([{ name: 'third' }]);
providerRecoveryController.markComplete();
providerRecoveryController.schedule([{ name: 'fourth' }]);
providerRecoveryController.markComplete();
check(
    '未结算正文与 reasoning delta 不持久化，Provider 恢复按连续 2 次、整轮 4 次限额并隔离工具快照',
    modelCallAccountingSource.includes('onContentDelta: () => {}')
        && modelCallAccountingSource.includes('onThinkingDelta: () => {}')
        && !agentRuntime.includes("this.emitVisibleReasoning(fullThinking, { source: 'provider_thinking_delta' })")
        && !agentRuntime.includes("this.emitVisibleReasoning(fullContent, { source: 'model_visible_reasoning_delta' })")
        && exhaustedConsecutiveRecovery === true
        && providerRecoveryController.recoveryAttempts === 0
        && providerRecoveryController.recoveryAttemptsInRun === 4
        && providerRecoveryController.canSchedule() === false
        && recoveredToolSnapshot[0].name === 'mutated-outside'
        && providerOutputRecoverySource.includes('tools.map((tool) => ({ ...tool }))')
);
check(
    '交互重入 lease 只在完整 Provider 终态后提交，截断或拦截不会提前消费',
    agentRuntime.indexOf('interactiveReentryState?.adoptAfterSuccessfulModelResponse()')
        > agentRuntime.indexOf('this.providerOutputRecovery.markComplete()')
        && agentRuntime.indexOf('this.providerOutputRecovery.markComplete()')
            > agentRuntime.indexOf('if (isProviderOutputBlocked(response.stopReason))')
);
check(
    '主图、详情页与 SKU Skill 从用户设计目录学习交付习惯，但不把目录多数票写进 Harness 决策',
    [mainImageSkillPlaybook, detailPageSkillPlaybook, skuProductionSkillPlaybook].every((playbook) => (
        playbook.includes('用户当前')
        && playbook.includes('updateDesignProjectState')
        && playbook.includes('delivery')
        && playbook.includes('Harness')
    ))
        && mainImageSkillPlaybook.includes('既有设计成品')
        && detailPageSkillPlaybook.includes('既有详情页成品')
        && skuProductionSkillPlaybook.includes('交付惯例候选')
        && skuProductionSkillPlaybook.includes('不自行从目录多数票决定名称')
        && skillDeclarations.includes('不能由早期参数默认器抢先冻结')
        && !skillParamDefaults.includes('fallback.sizes = [...MAIN_IMAGE_DEFAULT_SIZE_KEYS]')
        && agentRuntime.includes('expectedDeliveryPlanDigest: readRuntimeOwnedSkillDeliveryPlanDigest(')
        && !skuBatchExecutorSource.includes('expectedDeliveryPlanDigest: expectedExportInventory.deliveryPlanDigest')
        && !agentRuntime.includes('交付惯例候选')
        && !autonomousExecutor.includes('交付惯例候选')
);
const agentSelectedDeliveryConvention = {
    version: 'skill-delivery-convention/v0',
    provenance: 'agent_selected',
    supportRefs: [
        'document:sku-example-01',
        'project-file:SKU/参考成品/2双组合.psb'
    ],
    raster: {
        projectRelativeRoot: '客户交付/色卡成品',
        folderPattern: '规格{size}双',
        fileNamePattern: '第 {index} 组 - {colors}',
        format: 'jpg'
    },
    editable: {
        projectRelativeRoot: '客户交付/色卡成品/源稿',
        folderPattern: '规格{size}双',
        fileNamePattern: '源稿 {index} - {colors}',
        format: 'psb'
    },
    pairing: 'one_editable_per_raster',
    versionPolicy: 'fail_if_exists'
};
const mainImageDeliveryConvention = {
    version: 'skill-delivery-convention/v0',
    provenance: 'agent_selected',
    supportRefs: ['user-instruction:current-turn'],
    raster: {
        projectRelativeRoot: '交付/主图',
        folderPattern: '{size}-{version}',
        fileNamePattern: '{kind}-{index}',
        format: 'jpg'
    },
    editable: {
        projectRelativeRoot: '交付/主图源稿',
        folderPattern: '{size}-{version}',
        fileNamePattern: '主图-{size}-{version}',
        format: 'psb'
    },
    pairing: 'one_master_many_rasters',
    versionPolicy: 'new_version'
};
const standardMainImageAsset = {
    id: 'standard-main-image-asset',
    path: 'C:\\shop\\摄影图\\01.jpg',
    name: '01.jpg',
    width: 1200,
    height: 1600
};
const standardMainImagePlacementPreset = {
    scaleMode: 'contain',
    targetFill: 0.72,
    minFill: 0.5,
    maxFill: 0.9,
    anchor: 'center',
    cropPolicy: 'protect-subject',
    visualBiasY: 0,
    minScale: 0.1,
    maxScale: 4
};
function makeMainImageSlotAssignment(input) {
    return {
        sizeKey: input.sizeKey,
        imageType: input.imageType,
        slotName: input.slotName,
        variantId: input.variantId,
        objective: input.objective,
        visualHook: input.visualHook,
        layoutFocus: input.layoutFocus,
        copyRole: input.copyRole,
        asset: {
            id: input.asset.id,
            name: input.asset.name,
            path: input.asset.path,
            width: input.asset.width,
            height: input.asset.height
        },
        subjectBounds: input.subjectBounds,
        placement: {
            targetBox: input.targetBox,
            ...(input.safeBox ? { safeBox: input.safeBox } : {}),
            preset: {
                ...standardMainImagePlacementPreset,
                ...(input.preset || {})
            },
            decisionReason: input.decisionReason || 'Agent 明确声明该槽位素材、主体边界和目标构图。'
        }
    };
}

function getMainImageAssignmentKey(assignment) {
    return [
        assignment.sizeKey,
        assignment.imageType,
        assignment.slotName,
        assignment.variantId
    ].join('/');
}

function collectMainImagePlannedOperations(bundle) {
    return bundle.productionExecutionPlan.documents
        .flatMap((document) => document.operations);
}

/**
 * “只读计划”字段本身不能证明零写入；必须沿 structure -> execution -> handoff ->
 * dispatch -> dry-run -> live request 整条生产提交链确认没有任何可执行请求。
 */
function hasZeroMainImageProductionWritePlan(bundle) {
    return bundle.productionDocumentStructure.slotAssignments.length === 0
        && bundle.productionDocumentStructure.exportSpecs.length === 0
        && bundle.productionDocumentStructure.documents.every((document) => (
            document.parentGroups.flatMap((group) => group.childGroups)
                .every((group) => group.populationStatus === 'unassigned')
        ))
        && bundle.deliveryPlan.artifacts.filter((artifact) => artifact.kind === 'raster_export').length === 0
        && bundle.productionExecutionPlan.plannedOperationCount === 0
        && bundle.productionExecutionPlan.documents.length === 0
        && bundle.productionExecutorHandoff.toolRequests.length === 0
        && bundle.productionExecutorDispatchPlan.executorQueue.length === 0
        && bundle.productionExecutorDryRunPreview.operationCount === 0
        && bundle.productionExecutorDryRunPreview.operationResults.length === 0
        && bundle.liveExecutorRequestPackage.status !== 'ready_for_executor_dispatch'
        && bundle.liveExecutorRequestPackage.canDispatchLiveExecutor === false
        && bundle.liveExecutorRequestPackage.operationCount === 0
        && bundle.liveExecutorRequestPackage.operationRequests.length === 0;
}

function summarizeMainImageAssignmentSemantics(bundle) {
    return bundle.variantPlacementStrategy.variantPlacementPlans
        .map((plan) => ({
            assignmentKey: plan.assignmentKey,
            asset: plan.asset,
            subjectBox: plan.placementPlan.source.subjectBox,
            targetBox: plan.targetSlot.box,
            safeBox: plan.targetSlot.safeBox,
            preset: plan.placementPlan.decision.preset
        }))
        .sort((left, right) => left.assignmentKey.localeCompare(right.assignmentKey));
}

function summarizeMainImageContentOperationMapping(bundle) {
    const plansByAssignment = new Map(
        bundle.variantPlacementStrategy.variantPlacementPlans
            .map((plan) => [plan.assignmentKey, plan])
    );
    const operations = collectMainImagePlannedOperations(bundle);
    const assignmentKeys = Array.from(plansByAssignment.keys()).sort();
    return assignmentKeys.map((assignmentKey) => {
        const plan = plansByAssignment.get(assignmentKey);
        const places = operations.filter((operation) => (
            operation.tool === 'placeImage' && operation.assignmentKey === assignmentKey
        ));
        const transforms = operations.filter((operation) => (
            operation.tool === 'transformLayer' && operation.assignmentKey === assignmentKey
        ));
        const exports = operations.filter((operation) => (
            operation.tool === 'exportGroup' && operation.assignmentKey === assignmentKey
        ));
        const liveRequests = bundle.liveExecutorRequestPackage.operationRequests.filter((request) => (
            request.assignmentKey === assignmentKey
        ));
        const place = places[0];
        const transform = transforms[0];
        const exportOperation = exports[0];
        return {
            assignmentKey,
            placeCount: places.length,
            placeAssetPath: place?.asset?.path,
            placeGroupPath: place?.groupPath,
            placePlacementPlanId: place?.placementPlanId,
            transformCount: transforms.length,
            transformPlacementPlanId: transform?.placementPlanId,
            transformMatchesAssignmentPlan: Boolean(
                plan
                && JSON.stringify(transform?.destinationBox)
                    === JSON.stringify(plan.placementPlan.execution.destinationBox)
                && JSON.stringify(transform?.subjectDestinationBox)
                    === JSON.stringify(plan.placementPlan.execution.subjectDestinationBox)
            ),
            exportCount: exports.length,
            exportGroupPath: exportOperation?.groupPath,
            exportOutputPath: exportOperation?.outputPath,
            exportCanvasPolicy: exportOperation?.canvasPolicy,
            liveContentTools: liveRequests
                .filter((request) => ['placeImage', 'transformLayer', 'exportGroup'].includes(request.tool))
                .map((request) => request.tool)
                .sort()
        };
    });
}
const standardMainImageToolNames = [
    'createDocument',
    'createGroup',
    'moveLayerToGroup',
    'placeImage',
    'transformLayer',
    'moveLayer',
    'exportGroup',
    'saveDocument',
    'getDocumentInfo',
    'getLayerHierarchy',
    'getLayerProperties',
    'getAcceptanceSnapshot'
];
const emptyStandardMainImageBundle = buildMainImageStrategyInputs({
    userText: '建立当前店铺标准主图工作文档骨架。',
    projectPath: 'C:\\shop',
    createEmptySkeleton: true,
    toolNames: standardMainImageToolNames,
    userCheckpointApproved: true,
    selectedAsset: standardMainImageAsset,
    projectAssets: [standardMainImageAsset],
    visionSignal: {
        source: 'vision-model',
        assetRef: { id: standardMainImageAsset.id, path: standardMainImageAsset.path },
        productType: 'socks',
        subjectSummary: '一组袜子摄影素材',
        backgroundSummary: '棚拍背景',
        styleHints: []
    }
});
const emptyStandardMainImageStructure = emptyStandardMainImageBundle.productionDocumentStructure;
const emptyStandardMainImageOperations = emptyStandardMainImageBundle.productionExecutionPlan.documents
    .flatMap((document) => document.operations);
check(
    '主图生产骨架只固定真实工作文档与 5+4 空槽，不把测试样例升级成设计答案',
    JSON.stringify(MAIN_IMAGE_DELIVERY_DOCUMENTS.map((document) => ({
        key: document.folderKey,
        ratio: document.ratio,
        canvas: document.canvasSize,
        batchExport: document.batchExportSize,
        upload: document.platformUploadSize,
        mode: [document.resolutionPpi, document.colorMode, document.bitDepth],
        click: document.slots.click.map((slot) => slot.name),
        conversion: document.slots.conversion.map((slot) => slot.name),
        panelClick: document.slotPanelOrderTopDown.click,
        panelConversion: document.slotPanelOrderTopDown.conversion
    }))) === JSON.stringify([
        {
            key: '800', ratio: '1:1', canvas: { width: 1500, height: 1500 },
            batchExport: { width: 1500, height: 1500 }, upload: null, mode: [72, 'RGB', 8],
            click: ['800-1', '800-2', '800-3', '800-4', '800-5'], conversion: ['2', '3', '4', '5'],
            panelClick: ['800-5', '800-4', '800-3', '800-2', '800-1'], panelConversion: ['5', '4', '3', '2']
        },
        {
            key: '750', ratio: '3:4', canvas: { width: 1500, height: 2000 },
            batchExport: { width: 1500, height: 2000 }, upload: null, mode: [72, 'RGB', 8],
            click: ['750-1', '750-2', '750-3', '750-4', '750-5'], conversion: ['2', '3', '4', '5'],
            panelClick: ['750-5', '750-4', '750-3', '750-2', '750-1'], panelConversion: ['5', '4', '3', '2']
        },
        {
            key: '1200', ratio: '2:3', canvas: { width: 1440, height: 2160 },
            batchExport: { width: 1440, height: 2160 }, upload: null, mode: [72, 'RGB', 8],
            click: ['1200-1', '1200-2', '1200-3', '1200-4', '1200-5'], conversion: ['2', '3', '4', '5'],
            panelClick: ['1200-5', '1200-4', '1200-3', '1200-2', '1200-1'], panelConversion: ['5', '4', '3', '2']
        }
    ])
        && MAIN_IMAGE_DELIVERY_DOCUMENTS.every((document) => (
            document.batchExportPolicy.pixelPolicy === 'preserve_work_canvas'
            && document.batchExportPolicy.fileNamePolicy === 'child_group_name'
            && document.batchExportPolicy.occupancyPolicy === 'export_structurally_non_empty_only'
            && document.batchExportPolicy.siblingIsolationRequired === true
        ))
        && emptyStandardMainImageStructure.status === 'ready_production_document_structure'
        && emptyStandardMainImageStructure.documents.length === 3
        && emptyStandardMainImageStructure.documents.every((document) => (
            document.name === document.sizeProfileId.match(/tmall-(800|750|1200)-main-image/)?.[1]
            && document.parentGroups.flatMap((group) => group.childGroups).length === 9
            && document.parentGroups.flatMap((group) => group.childGroups)
                .every((group) => group.populationStatus === 'unassigned')
            && document.backgroundLayer.name === '背景'
            && document.backgroundLayer.locked
            && document.backgroundLayer.exportRole === 'none'
        ))
        && emptyStandardMainImageStructure.exportSpecs.length === 0
        && emptyStandardMainImageBundle.deliveryPlan.status === 'ready'
        && emptyStandardMainImageBundle.deliveryPlan.artifacts.length === 3
        && emptyStandardMainImageBundle.deliveryPlan.artifacts.every((artifact) => (
            artifact.kind === 'editable_document'
        ))
        && emptyStandardMainImageBundle.productionExecutionPlan.status === 'ready_execution_plan'
        && emptyStandardMainImageBundle.productionExecutionPlan.plannedOperationCount === 39
        && emptyStandardMainImageOperations.filter((operation) => operation.tool === 'createDocument').length === 3
        && emptyStandardMainImageOperations.filter((operation) => operation.tool === 'createGroup').length === 33
        && emptyStandardMainImageOperations.filter((operation) => operation.tool === 'saveDocument').length === 3
        && emptyStandardMainImageOperations.every((operation) => (
            operation.tool !== 'placeImage'
            && operation.tool !== 'transformLayer'
            && operation.tool !== 'exportGroup'
        ))
        && emptyStandardMainImageBundle.liveExecutorRequestPackage.status === 'ready_for_executor_dispatch',
    JSON.stringify(emptyStandardMainImageStructure)
);

const secondStandardMainImageAsset = {
    id: 'standard-main-image-asset-2',
    path: 'C:\\shop\\摄影图\\02.jpg',
    name: '02.jpg',
    width: 1400,
    height: 1800
};
const multiVariantMainImageInput = {
    userText: '为 800 点击图明确设计两个方向。',
    imageType: 'click',
    projectPath: 'C:\\shop',
    selectedAsset: standardMainImageAsset,
    projectAssets: [standardMainImageAsset, secondStandardMainImageAsset],
    subjectBounds: { left: 100, top: 100, right: 1100, bottom: 1500, width: 1000, height: 1400 },
    sizePlans: [{
        sizeKey: '800',
        targetSize: { width: 1500, height: 1500 },
        subjectSize: { width: 1000, height: 1400 },
        scale: 0.8,
        targetX: 300,
        targetY: 190,
        decisionReason: 'Agent authored two distinct click directions.',
        smartLayoutPlanned: true,
        quickExportPlanned: true
    }],
    visionSignal: {
        source: 'vision-model',
        assetRef: { id: standardMainImageAsset.id, path: standardMainImageAsset.path },
        productType: 'socks',
        subjectSummary: '袜子摄影素材',
        backgroundSummary: '棚拍背景',
        styleHints: []
    },
    agentDesignDecision: {
        clickVisualHooks: ['方向一', '方向二'],
        clickLayoutFocus: '两个方向分别保留自己的素材和构图关系'
    },
    toolNames: standardMainImageToolNames,
    userCheckpointApproved: true
};
const implicitFanoutMainImageBundle = buildMainImageStrategyInputs(multiVariantMainImageInput);
const explicitMainImageSlotAssignments = [
    makeMainImageSlotAssignment({
        sizeKey: '800',
        imageType: 'click',
        slotName: '800-1',
        variantId: 'click-1',
        objective: '方向一',
        visualHook: '方向一',
        layoutFocus: '主体完整并保留 Agent 声明的留白关系',
        asset: standardMainImageAsset,
        subjectBounds: { left: 100, top: 100, right: 1100, bottom: 1500, width: 1000, height: 1400 },
        targetBox: { x: 220, y: 160, width: 920, height: 1180 },
        safeBox: { x: 100, y: 80, width: 1200, height: 1320 }
    }),
    makeMainImageSlotAssignment({
        sizeKey: '800',
        imageType: 'click',
        slotName: '800-2',
        variantId: 'click-2',
        objective: '方向二',
        visualHook: '方向二',
        layoutFocus: '第二张素材使用自己的主体范围与构图决定',
        asset: secondStandardMainImageAsset,
        subjectBounds: { left: 120, top: 110, right: 1280, bottom: 1700, width: 1160, height: 1590 },
        targetBox: { x: 160, y: 120, width: 1080, height: 1260 },
        safeBox: { x: 80, y: 60, width: 1320, height: 1380 },
        preset: {
            targetFill: 0.8,
            minFill: 0.6,
            maxFill: 0.92,
            anchor: 'top-center',
            visualBiasY: 0.1
        }
    })
];
const explicitVariantAssetsMainImageBundle = buildMainImageStrategyInputs({
    ...multiVariantMainImageInput,
    slotAssignments: explicitMainImageSlotAssignments
});
const explicitVariantOperations = explicitVariantAssetsMainImageBundle.productionExecutionPlan.documents
    .flatMap((document) => document.operations);
const expectedMainImageAssignmentSemantics = explicitMainImageSlotAssignments
    .map((assignment) => ({
        assignmentKey: getMainImageAssignmentKey(assignment),
        asset: assignment.asset,
        subjectBox: {
            x: assignment.subjectBounds.left,
            y: assignment.subjectBounds.top,
            width: assignment.subjectBounds.width,
            height: assignment.subjectBounds.height
        },
        targetBox: assignment.placement.targetBox,
        safeBox: assignment.placement.safeBox,
        preset: assignment.placement.preset
    }))
    .sort((left, right) => left.assignmentKey.localeCompare(right.assignmentKey));
const actualMainImageAssignmentSemantics = summarizeMainImageAssignmentSemantics(
    explicitVariantAssetsMainImageBundle
);
const actualMainImageContentOperationMapping = summarizeMainImageContentOperationMapping(
    explicitVariantAssetsMainImageBundle
);
const expectedMainImageContentOperationMapping = explicitMainImageSlotAssignments
    .map((assignment) => {
        const assignmentKey = getMainImageAssignmentKey(assignment);
        return {
            assignmentKey,
            placeCount: 1,
            placeAssetPath: assignment.asset.path,
            placeGroupPath: ['点击图', assignment.slotName],
            placePlacementPlanId: assignmentKey,
            transformCount: 1,
            transformPlacementPlanId: assignmentKey,
            transformMatchesAssignmentPlan: true,
            exportCount: 1,
            exportGroupPath: ['点击图', assignment.slotName],
            exportOutputPath: `C:\\shop\\主图\\800\\${assignment.slotName}.jpg`,
            exportCanvasPolicy: 'preserve_document_canvas',
            liveContentTools: ['exportGroup', 'placeImage', 'transformLayer']
        };
    })
    .sort((left, right) => left.assignmentKey.localeCompare(right.assignmentKey));
check(
    '普通主图没有逐槽 assignments 且未明确要求空骨架时，整条生产提交链保持零写计划',
    hasZeroMainImageProductionWritePlan(implicitFanoutMainImageBundle),
    JSON.stringify({
        structure: implicitFanoutMainImageBundle.productionDocumentStructure,
        deliveryPlan: implicitFanoutMainImageBundle.deliveryPlan,
        executionPlan: implicitFanoutMainImageBundle.productionExecutionPlan,
        handoff: implicitFanoutMainImageBundle.productionExecutorHandoff,
        dispatch: implicitFanoutMainImageBundle.productionExecutorDispatchPlan,
        dryRun: implicitFanoutMainImageBundle.productionExecutorDryRunPreview,
        liveRequest: implicitFanoutMainImageBundle.liveExecutorRequestPackage
    })
);
check(
    '主图两个方向逐 assignmentKey 消费各自素材、主体 bounds、目标框、安全框、缩放预设和提交操作',
    explicitVariantAssetsMainImageBundle.productionExecutionPlan.status === 'ready_execution_plan'
        && explicitVariantAssetsMainImageBundle.productionDocumentStructure.documents[0]
            .parentGroups.flatMap((group) => group.childGroups).length === 9
        && explicitVariantAssetsMainImageBundle.productionDocumentStructure.documents[0]
            .parentGroups.flatMap((group) => group.childGroups)
            .filter((group) => group.populationStatus === 'assigned').length === 2
        && explicitVariantAssetsMainImageBundle.productionDocumentStructure.exportSpecs
            .map((spec) => `${spec.groupPath.join('/')}:${spec.fileName}`).join('|')
            === '点击图/800-1:800-1.jpg|点击图/800-2:800-2.jpg'
        && explicitVariantOperations.filter((operation) => operation.tool === 'createGroup').length === 11
        && explicitVariantOperations.filter((operation) => operation.tool === 'createGroup')
            .map((operation) => operation.groupPath?.join('/')).join('|')
            === '点击图|点击图/800-5|点击图/800-4|点击图/800-3|点击图/800-2|点击图/800-1|转化图|转化图/5|转化图/4|转化图/3|转化图/2'
        && explicitVariantOperations.filter((operation) => operation.tool === 'placeImage').length === 2
        && explicitVariantOperations.filter((operation) => operation.tool === 'transformLayer').length === 2
        && explicitVariantOperations.filter((operation) => operation.tool === 'exportGroup').length === 2
        && JSON.stringify(actualMainImageAssignmentSemantics)
            === JSON.stringify(expectedMainImageAssignmentSemantics)
        && JSON.stringify(actualMainImageContentOperationMapping)
            === JSON.stringify(expectedMainImageContentOperationMapping)
        && explicitVariantOperations.filter((operation) => operation.tool === 'exportGroup')
            .every((operation) => operation.canvasPolicy === 'preserve_document_canvas')
        && explicitVariantAssetsMainImageBundle.deliveryPlan.artifacts.some((artifact) => (
            artifact.kind === 'editable_document' && artifact.path.endsWith('\\PSD\\800.psb')
        ))
        && explicitVariantAssetsMainImageBundle.deliveryPlan.artifacts.filter((artifact) => (
            artifact.kind === 'raster_export'
        )).map((artifact) => artifact.path).join('|')
            === 'C:\\shop\\主图\\800\\800-1.jpg|C:\\shop\\主图\\800\\800-2.jpg',
    JSON.stringify({
        implicitStatus: implicitFanoutMainImageBundle.productionExecutionPlan.status,
        explicitStatus: explicitVariantAssetsMainImageBundle.productionExecutionPlan.status,
        expectedAssignmentSemantics: expectedMainImageAssignmentSemantics,
        actualAssignmentSemantics: actualMainImageAssignmentSemantics,
        expectedOperationMapping: expectedMainImageContentOperationMapping,
        actualOperationMapping: actualMainImageContentOperationMapping,
        structure: explicitVariantAssetsMainImageBundle.productionDocumentStructure,
        artifacts: explicitVariantAssetsMainImageBundle.deliveryPlan.artifacts,
        operations: explicitVariantOperations
    })
);
const firstExplicitMainImageAssignment = explicitMainImageSlotAssignments[0];
const secondExplicitMainImageAssignment = explicitMainImageSlotAssignments[1];
const { asset: _removedSecondMainImageAsset, ...secondMainImageAssignmentWithoutAsset } = (
    secondExplicitMainImageAssignment
);
const { placement: _removedSecondMainImagePlacement, ...secondMainImageAssignmentWithoutPlacement } = (
    secondExplicitMainImageAssignment
);
const missingSecondAssetMainImageBundle = buildMainImageStrategyInputs({
    ...multiVariantMainImageInput,
    slotAssignments: [firstExplicitMainImageAssignment, secondMainImageAssignmentWithoutAsset]
});
const missingSecondPlacementMainImageBundle = buildMainImageStrategyInputs({
    ...multiVariantMainImageInput,
    slotAssignments: [firstExplicitMainImageAssignment, secondMainImageAssignmentWithoutPlacement]
});
check(
    '主图第二槽缺 asset 或 placement 时整体拒绝内容写入，不能用第一槽或候选第一项补位',
    [missingSecondAssetMainImageBundle, missingSecondPlacementMainImageBundle].every((bundle) => (
        bundle.productionDocumentStructure.status === 'blocked_invalid_slot_assignments'
        && bundle.productionDocumentStructure.blockers.some((blocker) => (
            blocker.includes('slot_assignment_2_')
        ))
        && hasZeroMainImageProductionWritePlan(bundle)
        && collectMainImagePlannedOperations(bundle).length === 0
    )),
    JSON.stringify({
        missingAsset: {
            structure: missingSecondAssetMainImageBundle.productionDocumentStructure,
            execution: missingSecondAssetMainImageBundle.productionExecutionPlan,
            liveRequest: missingSecondAssetMainImageBundle.liveExecutorRequestPackage
        },
        missingPlacement: {
            structure: missingSecondPlacementMainImageBundle.productionDocumentStructure,
            execution: missingSecondPlacementMainImageBundle.productionExecutionPlan,
            liveRequest: missingSecondPlacementMainImageBundle.liveExecutorRequestPackage
        }
    })
);
let forgedMainImageDeliveryDispatchCount = 0;
const forgedMainImageDeliveryAuthority = {
    freeze() {
        forgedMainImageDeliveryDispatchCount += 1;
        return { status: 'blocked', blockers: ['forged-authority-must-not-run'] };
    },
    executeStagedArtifacts() {
        forgedMainImageDeliveryDispatchCount += 1;
        return Promise.resolve({ success: false });
    },
    acceptExternalCommit() {
        forgedMainImageDeliveryDispatchCount += 1;
        return { status: 'blocked', blockers: ['forged-authority-must-not-run'] };
    }
};
function createBrandedMainImageHarness(label) {
    const hostCalls = [];
    const executor = createGuardedAtomicToolExecutor({
        userRequest: label,
        async executeTool(toolName, params) {
            hostCalls.push({ toolName, params: { ...params } });
            return { success: true };
        }
    });
    const scope = beginRuntimeOwnedSkillToolLedgerScope(executor);
    const authority = createRuntimeOwnedSkillDeliveryPlanAuthority({ scope, executor });
    return { hostCalls, executor, scope, authority };
}

const invalidMixedMainImageHarness = createBrandedMainImageHarness(
    '无效逐槽声明不能借白底图分支发生部分写入。'
);
const invalidMixedMainImageResult = await mainImageExecutor.execute({
    params: {
        mainImageExecutionMode: 'product-disposable-live',
        imageType: 'white-bg',
        sourceAssetKind: 'project-sku-material',
        outputDirPolicy: 'project-main-image-dir',
        mainImageCapability: 'main-image.white-bg-from-sku-material',
        slotAssignments: [firstExplicitMainImageAssignment, secondMainImageAssignmentWithoutAsset]
    },
    context: {
        userInput: '按逐槽声明生产主图，同时导出白底素材。',
        projectContext: { projectPath: 'C:\\shop' }
    },
    guardedAtomicToolExecutor: invalidMixedMainImageHarness.executor,
    runtimeDeliveryPlanAuthority: invalidMixedMainImageHarness.authority
});
const invalidAgenticActionHarness = createBrandedMainImageHarness(
    '未知主图生产动作不能回退成其它路径。'
);
const invalidAgenticActionResult = await mainImageExecutor.execute({
    params: { mainImageProductionAction: 'prepare-and-guess' },
    context: {
        userInput: '使用一个不存在的生产动作。',
        projectContext: { projectPath: 'C:\\shop' }
    },
    guardedAtomicToolExecutor: invalidAgenticActionHarness.executor,
    runtimeDeliveryPlanAuthority: invalidAgenticActionHarness.authority
});
await completeRuntimeOwnedSkillToolLedgerScope(invalidAgenticActionHarness.scope);
const invalidMixedMainImageLedger = await completeRuntimeOwnedSkillToolLedgerScope(
    invalidMixedMainImageHarness.scope
);

const firstMismatchedMainImageHarness = createBrandedMainImageHarness('主图 TaskRun A');
const secondMismatchedMainImageHarness = createBrandedMainImageHarness('主图 TaskRun B');
const mismatchedMainImageRuntimeResult = await mainImageExecutor.execute({
    params: {
        mainImageExecutionMode: 'product-disposable-live',
        slotAssignments: [firstExplicitMainImageAssignment]
    },
    context: {
        userInput: '按逐槽声明完成主图生产。',
        projectContext: { projectPath: 'C:\\shop' }
    },
    guardedAtomicToolExecutor: firstMismatchedMainImageHarness.executor,
    runtimeDeliveryPlanAuthority: secondMismatchedMainImageHarness.authority
});
const firstMismatchedMainImageLedger = await completeRuntimeOwnedSkillToolLedgerScope(
    firstMismatchedMainImageHarness.scope
);
const secondMismatchedMainImageLedger = await completeRuntimeOwnedSkillToolLedgerScope(
    secondMismatchedMainImageHarness.scope
);
const forgedApprovalWithoutGuardResult = await mainImageExecutor.execute({
    params: {
        mainImageExecutionMode: 'product-disposable-live',
        approvedLiveExecution: true,
        approvedLiveAdapterRun: true,
        slotAssignments: [firstExplicitMainImageAssignment]
    },
    context: {
        userInput: '按逐槽声明完成主图生产。',
        projectContext: { projectPath: 'C:\\shop' }
    },
    runtimeDeliveryPlanAuthority: forgedMainImageDeliveryAuthority
});
let unboundMainImageGuardCallCount = 0;
const brandedMainImageGuardWithoutAuthority = createGuardedAtomicToolExecutor({
    userRequest: '按逐槽声明完成主图生产。',
    async executeTool() {
        unboundMainImageGuardCallCount += 1;
        return { success: false, error: 'must-not-run' };
    }
});
const productionWithoutDeliveryAuthorityResult = await mainImageExecutor.execute({
    params: {
        slotAssignments: [firstExplicitMainImageAssignment]
    },
    context: {
        userInput: '按逐槽声明完成主图生产。',
        projectContext: { projectPath: 'C:\\shop' }
    },
    guardedAtomicToolExecutor: brandedMainImageGuardWithoutAuthority,
    runtimeDeliveryPlanAuthority: forgedMainImageDeliveryAuthority
});
let unbrandedWhiteBackgroundGuardCallCount = 0;
const unbrandedWhiteBackgroundResult = await mainImageExecutor.execute({
    params: {
        imageType: 'white-bg',
        sourceAssetKind: 'project-sku-material',
        outputDirPolicy: 'project-main-image-dir',
        mainImageCapability: 'main-image.white-bg-from-sku-material',
        mainImageExecutionMode: 'product-disposable-live'
    },
    context: {
        userInput: '使用 SKU 素材导出白底图。',
        projectContext: { projectPath: 'C:\\shop' }
    },
    guardedAtomicToolExecutor: async () => {
        unbrandedWhiteBackgroundGuardCallCount += 1;
        return { success: true, data: { success: true, saved: true } };
    }
});
const whiteBackgroundToolSuccessWithoutFile = {
    success: true,
    data: {
        success: true,
        readback: { saved: true }
    }
};
const unavailableWhiteBackgroundProbe = [{
    path: 'C:\\shop\\主图\\白底.jpg',
    status: 'unavailable',
    exists: undefined,
    isFile: undefined,
    rawImagesRedacted: true
}];
const verifiedWhiteBackgroundProbe = [{
    path: 'C:\\shop\\主图\\白底.jpg',
    status: 'ok',
    exists: true,
    isFile: true,
    byteLength: 128,
    rawImagesRedacted: true
}];
const mainImageProductionPreflightInput = {
    userText: '按当前逐槽声明生产主图。',
    route: 'skill_execution',
    routeSource: 'model_router',
    skillId: 'main-image-design',
    params: {
        slotAssignments: [firstExplicitMainImageAssignment]
    },
    projectContext: { projectPath: 'C:\\shop' }
};
const mainImageProductionPreflightWithoutLegacyApprovals = buildAgentDesignExecutionPreflight(
    mainImageProductionPreflightInput
);
const mainImageProductionPreflightWithLegacyApprovals = buildAgentDesignExecutionPreflight({
    ...mainImageProductionPreflightInput,
    params: {
        ...mainImageProductionPreflightInput.params,
        approvedLiveExecution: true,
        approvedLiveAdapterRun: true,
        userCheckpointApproved: true
    }
});
check(
    '主图模型参数不能伪造执行授权，缺 guarded executor 或交付事务时必须在首个 Host 调用前停止',
    forgedApprovalWithoutGuardResult.success === false
        && forgedApprovalWithoutGuardResult.error === 'main_image_guarded_atomic_executor_required'
        && forgedMainImageDeliveryDispatchCount === 0
        && productionWithoutDeliveryAuthorityResult.success === false
        && productionWithoutDeliveryAuthorityResult.error === 'main_image_runtime_delivery_authority_required'
        && unboundMainImageGuardCallCount === 0
        && unbrandedWhiteBackgroundResult.success === false
        && unbrandedWhiteBackgroundResult.error === 'main_image_guarded_atomic_executor_required'
        && unbrandedWhiteBackgroundGuardCallCount === 0
        && hasVerifiedMainImageWhiteBackgroundExport(
            whiteBackgroundToolSuccessWithoutFile,
            unavailableWhiteBackgroundProbe
        ) === false
        && hasVerifiedMainImageWhiteBackgroundExport(
            whiteBackgroundToolSuccessWithoutFile,
            verifiedWhiteBackgroundProbe
        ) === true
        && JSON.stringify(mainImageProductionPreflightWithoutLegacyApprovals)
            === JSON.stringify(mainImageProductionPreflightWithLegacyApprovals)
        && mainImageProductionPreflightWithoutLegacyApprovals.status === 'context_ready',
    JSON.stringify({
        forgedApprovalWithoutGuardResult,
        forgedMainImageDeliveryDispatchCount,
        productionWithoutDeliveryAuthorityResult,
        unboundMainImageGuardCallCount,
        unbrandedWhiteBackgroundResult,
        unbrandedWhiteBackgroundGuardCallCount,
        whiteBackgroundToolSuccessWithoutFile,
        unavailableWhiteBackgroundProbe,
        verifiedWhiteBackgroundProbe,
        mainImageProductionPreflightWithoutLegacyApprovals,
        mainImageProductionPreflightWithLegacyApprovals
    })
);
check(
    '无效逐槽声明与跨 TaskRun 真 authority 均在任何 Host 调用前整体失败关闭',
    invalidMixedMainImageResult.success === false
        && invalidMixedMainImageResult.data?.status === 'blocked_invalid_slot_assignments'
        && invalidMixedMainImageHarness.hostCalls.length === 0
        && invalidMixedMainImageLedger?.entries.length === 0
        && invalidAgenticActionResult.error === 'main_image_agentic_production_action_invalid'
        && invalidAgenticActionHarness.hostCalls.length === 0
        && mismatchedMainImageRuntimeResult.success === false
        && mismatchedMainImageRuntimeResult.error === 'runtime_delivery_authority_executor_mismatch'
        && firstMismatchedMainImageHarness.hostCalls.length === 0
        && secondMismatchedMainImageHarness.hostCalls.length === 0
        && firstMismatchedMainImageLedger?.entries.length === 0
        && secondMismatchedMainImageLedger?.entries.length === 0,
    JSON.stringify({
        invalidMixedMainImageResult,
        invalidMixedMainImageHostCalls: invalidMixedMainImageHarness.hostCalls,
        invalidMixedMainImageLedger,
        invalidAgenticActionResult,
        invalidAgenticActionHostCalls: invalidAgenticActionHarness.hostCalls,
        mismatchedMainImageRuntimeResult,
        firstMismatchedMainImageHostCalls: firstMismatchedMainImageHarness.hostCalls,
        secondMismatchedMainImageHostCalls: secondMismatchedMainImageHarness.hostCalls,
        firstMismatchedMainImageLedger,
        secondMismatchedMainImageLedger
    })
);
const invalidMainImageGeometryBundle = buildMainImageStrategyInputs({
    ...multiVariantMainImageInput,
    slotAssignments: [makeMainImageSlotAssignment({
        sizeKey: '800',
        imageType: 'click',
        slotName: '800-1',
        variantId: 'click-invalid-geometry',
        objective: '几何反例',
        asset: standardMainImageAsset,
        subjectBounds: { left: 100, top: 100, right: 1100, bottom: 1500, width: 1000, height: 1400 },
        safeBox: { x: 100, y: 100, width: 500, height: 500 },
        targetBox: { x: 400, y: 400, width: 500, height: 500 }
    })]
});
check(
    '主图逐槽几何越过 Agent 声明的 safeBox 时写前阻断，Harness 不静默 clamp 或移动',
    invalidMainImageGeometryBundle.productionDocumentStructure.status === 'blocked_invalid_slot_assignments'
        && invalidMainImageGeometryBundle.productionDocumentStructure.slotAssignments.length === 0
        && invalidMainImageGeometryBundle.productionDocumentStructure.blockers.some((blocker) => (
            blocker.includes('slot_assignment_1_target_box_outside_safe_box')
        ))
        && invalidMainImageGeometryBundle.productionExecutionPlan.documents.length === 0,
    JSON.stringify({
        structure: invalidMainImageGeometryBundle.productionDocumentStructure,
        execution: invalidMainImageGeometryBundle.productionExecutionPlan
    })
);

const fullMainImageSlotAssignments = MAIN_IMAGE_DELIVERY_DOCUMENTS.flatMap((document) => (
    [...document.slots.click, ...document.slots.conversion].map((slot) => makeMainImageSlotAssignment({
        sizeKey: document.folderKey,
        imageType: slot.imageType,
        slotName: slot.name,
        variantId: `${document.folderKey}-${slot.imageType}-${slot.name}`,
        objective: `${document.folderKey} ${slot.imageType} ${slot.name} 的 Agent 声明方向`,
        visualHook: `Agent hook ${document.folderKey}/${slot.imageType}/${slot.name}`,
        layoutFocus: '该槽位使用自己的显式几何；复用素材不等于复用旧槽位决定。',
        asset: standardMainImageAsset,
        subjectBounds: { left: 100, top: 100, right: 1100, bottom: 1500, width: 1000, height: 1400 },
        targetBox: {
            x: 100,
            y: 100,
            width: document.canvasSize.width - 200,
            height: document.canvasSize.height - 200
        }
    }))
));
const fullMainImageBundle = buildMainImageStrategyInputs({
    userText: '按本轮提交的逐槽声明完成三份标准工作文档。',
    projectPath: 'C:\\shop',
    selectedAsset: standardMainImageAsset,
    projectAssets: [standardMainImageAsset],
    slotAssignments: fullMainImageSlotAssignments,
    subjectBounds: { left: 100, top: 100, right: 1100, bottom: 1500, width: 1000, height: 1400 },
    sizePlans: MAIN_IMAGE_DELIVERY_DOCUMENTS.map((document) => ({
        sizeKey: document.folderKey,
        targetSize: document.canvasSize,
        subjectSize: { width: 1000, height: 1400 },
        scale: 0.8,
        targetX: 100,
        targetY: 100,
        decisionReason: `Agent 为 ${document.folderKey} 声明当前工作画布。`,
        smartLayoutPlanned: true,
        quickExportPlanned: true
    })),
    visionSignal: {
        source: 'vision-model',
        assetRef: { id: standardMainImageAsset.id, path: standardMainImageAsset.path },
        productType: 'socks',
        subjectSummary: '袜子摄影素材',
        backgroundSummary: '棚拍背景',
        styleHints: []
    },
    agentDesignDecision: {
        clickVisualHooks: ['点击方向由每个 slotAssignment 细化'],
        conversionVisualHooks: ['转化方向由每个 slotAssignment 细化'],
        clickLayoutFocus: '逐槽声明',
        conversionLayoutFocus: '逐槽声明'
    },
    toolNames: standardMainImageToolNames,
    userCheckpointApproved: true
});
const fullMainImageCheckpoint = buildMainImageLiveExecutorCheckpoint({
    requestPackage: fullMainImageBundle.liveExecutorRequestPackage,
    approvedLiveExecution: true,
    photoshopConnection: {
        connected: true,
        documentWriteAvailable: true
    },
    executionScope: 'disposable-document'
});
const undersizedFullMainImageCheckpoint = buildMainImageLiveExecutorCheckpoint({
    requestPackage: fullMainImageBundle.liveExecutorRequestPackage,
    approvedLiveExecution: true,
    photoshopConnection: {
        connected: true,
        documentWriteAvailable: true
    },
    executionScope: 'disposable-document',
    maxOperationCount: 100
});
const fullMainImageOperations = fullMainImageBundle.productionExecutionPlan.documents
    .flatMap((document) => document.operations);
check(
    '三规格 27 个槽全部显式分配时形成 120 步冻结计划，动态预算不会把合法满槽任务误杀',
    fullMainImageSlotAssignments.length === 27
        && fullMainImageBundle.productionDocumentStructure.slotAssignments.length === 27
        && fullMainImageBundle.productionDocumentStructure.exportSpecs.length === 27
        && fullMainImageBundle.productionExecutionPlan.status === 'ready_execution_plan'
        && fullMainImageBundle.productionExecutionPlan.plannedOperationCount === 120
        && fullMainImageOperations.filter((operation) => operation.tool === 'createDocument').length === 3
        && fullMainImageOperations.filter((operation) => operation.tool === 'createGroup').length === 33
        && fullMainImageOperations.filter((operation) => operation.tool === 'placeImage').length === 27
        && fullMainImageOperations.filter((operation) => operation.tool === 'transformLayer').length === 27
        && fullMainImageOperations.filter((operation) => operation.tool === 'exportGroup').length === 27
        && fullMainImageOperations.filter((operation) => operation.tool === 'saveDocument').length === 3
        && new Set(fullMainImageOperations.filter((operation) => operation.tool === 'placeImage')
            .map((operation) => operation.assignmentKey)).size === 27
        && fullMainImageBundle.liveExecutorRequestPackage.status === 'ready_for_executor_dispatch'
        && fullMainImageBundle.liveExecutorRequestPackage.operationRequests.length === 120
        && fullMainImageCheckpoint.status === 'ready_for_live_executor_run'
        && fullMainImageCheckpoint.operationCount === 120
        && fullMainImageCheckpoint.runGuard.maxOperationCount === 120
        && undersizedFullMainImageCheckpoint.status === 'blocked_operation_budget_exceeded'
        && undersizedFullMainImageCheckpoint.runGuard.maxOperationCount === 100
        && undersizedFullMainImageCheckpoint.operationRequests.length === 0,
    JSON.stringify({
        structureStatus: fullMainImageBundle.productionDocumentStructure.status,
        assignmentCount: fullMainImageBundle.productionDocumentStructure.slotAssignments.length,
        exportCount: fullMainImageBundle.productionDocumentStructure.exportSpecs.length,
        executionStatus: fullMainImageBundle.productionExecutionPlan.status,
        plannedOperationCount: fullMainImageBundle.productionExecutionPlan.plannedOperationCount,
        requestStatus: fullMainImageBundle.liveExecutorRequestPackage.status,
        requestCount: fullMainImageBundle.liveExecutorRequestPackage.operationRequests.length,
        checkpointStatus: fullMainImageCheckpoint.status,
        runGuard: fullMainImageCheckpoint.runGuard,
        undersizedCheckpoint: {
            status: undersizedFullMainImageCheckpoint.status,
            runGuard: undersizedFullMainImageCheckpoint.runGuard,
            blockers: undersizedFullMainImageCheckpoint.blockers
        }
    })
);

const pendingMainImageDraft = buildMainImageAgentDraftPlan({
    ...multiVariantMainImageInput,
    slotAssignments: explicitVariantAssetsMainImageBundle.productionDocumentStructure.slotAssignments
});
const authoredMainImageDraft = buildMainImageAgentDraftPlan({
    ...multiVariantMainImageInput,
    slotAssignments: explicitVariantAssetsMainImageBundle.productionDocumentStructure.slotAssignments,
    designDsl: {
        dslVersion: 'design-agent-os/v0',
        scenario: 'main-image',
        canvas: { width: 1500, height: 1500 },
        layoutType: 'agent-authored-asymmetric-layout',
        regions: [{
            id: 'agent-hero-region',
            kind: 'image-slot',
            role: 'hero-subject',
            box: { x: 137, y: 211, width: 911, height: 1043 },
            styleKeys: ['agent-authored']
        }],
        constraints: ['Agent 声明的非对称构图'],
        sourceRefs: []
    }
});
const mainImageAlignmentToolResults = [
    { toolName: 'getDocumentInfo', result: { success: true } },
    { toolName: 'getSubjectBounds', result: { success: true } },
    { toolName: 'transformLayer', result: { success: true } },
    { toolName: 'moveLayer', result: { success: true } }
];
const pendingMainImageAlignment = buildMainImageExecutionAlignment({
    agentDraft: pendingMainImageDraft,
    toolResults: mainImageAlignmentToolResults,
    sizePlans: multiVariantMainImageInput.sizePlans
});
const authoredMainImageAlignment = buildMainImageExecutionAlignment({
    agentDraft: authoredMainImageDraft,
    toolResults: mainImageAlignmentToolResults,
    sizePlans: multiVariantMainImageInput.sizePlans
});
const proposedMainImageFacts = applyDesignProjectFactOperations({
    upsertFacts: [{
        claimType: 'product_fact',
        statement: '用户确认：商品为四双装袜子',
        source: { kind: 'user_statement', sourceRef: 'user-instruction:current-turn' }
    }],
    authority: 'agent_proposal',
    updatedBy: 'agent',
    now: '2026-08-31T00:00:00.000Z'
});
const confirmedMainImageFacts = applyDesignProjectFactOperations({
    current: proposedMainImageFacts,
    reviewFacts: [{ factId: proposedMainImageFacts[0].factId, decision: 'confirm' }],
    authority: 'user_review',
    updatedBy: 'user',
    now: '2026-08-31T00:01:00.000Z'
});
const mainImageFactsWithUnverifiedClaim = applyDesignProjectFactOperations({
    current: confirmedMainImageFacts,
    upsertFacts: [{
        claimType: 'selling_point',
        statement: '未经确认的神奇保暖',
        source: { kind: 'agent_inference' }
    }],
    authority: 'agent_proposal',
    updatedBy: 'agent',
    now: '2026-08-31T00:02:00.000Z'
});
const legacyMainImageStateContext = buildMainImageStateContext({
    state: {
        updatedAt: '2026-08-31T00:00:00.000Z',
        targetUser: '旧状态自动人群',
        visualDirection: '旧状态固定视觉方向',
        brandStyle: '旧状态固定品牌风格',
        painPoints: ['担心袜口勒脚'],
        sellingPoints: ['旧无来源卖点'],
        copywriting: [{ slot: '标题', text: '旧状态标题' }],
        factRecords: mainImageFactsWithUnverifiedClaim
    },
    imageType: 'click',
    requestedVersionCount: 3
});
const keywordOnlyMainImageCopy = buildMainImageCopyStrategy({
    userText: '春夏透气通勤主图',
    projectStyleStrategy: explicitVariantAssetsMainImageBundle.projectStyleStrategy,
    copyCandidates: ['轻盈透气']
});
const pendingMainImageStandards = buildMainImageDesignStandards({
    projectStyleStrategy: emptyStandardMainImageBundle.projectStyleStrategy
});
const authoredMainImageStandards = buildMainImageDesignStandards({
    projectStyleStrategy: explicitVariantAssetsMainImageBundle.projectStyleStrategy
});
check(
    '主图模型投影缺少 Agent 声明时保持 pending，不能从旧状态、关键词或本地 recipe 补出版式和文案答案',
    pendingMainImageDraft.designDsl.layoutType === 'pending-agent-layout-decision'
        && pendingMainImageDraft.designDsl.regions.length === 0
        && !pendingMainImageDraft.executionPlan.steps.some((step) => (
            step.operation === 'composeDesignDsl' || step.operation === 'fitCopyToDeclaredTextRegions'
        ))
        && authoredMainImageDraft.designDsl.layoutType === 'agent-authored-asymmetric-layout'
        && authoredMainImageDraft.designDsl.regions.length === 1
        && authoredMainImageDraft.designDsl.regions[0]?.box.x === 137
        && authoredMainImageDraft.designDsl.regions[0]?.box.width === 911
        && authoredMainImageDraft.executionPlan.steps.some((step) => step.operation === 'composeDesignDsl')
        && pendingMainImageAlignment.checks.find((item) => item.id === 'dsl.regions')?.status === 'watch'
        && authoredMainImageAlignment.checks.find((item) => item.id === 'dsl.regions')?.status === 'aligned'
        && !pendingMainImageAlignment.checks.find((item) => item.id === 'dsl.regions')
            ?.expectedInputs.some((value) => /safe-area|headline|benefit-tag/.test(value))
        && legacyMainImageStateContext.compositionStatus === 'pending_agent_declaration'
        && legacyMainImageStateContext.compositionVersions.length === 0
        && legacyMainImageStateContext.copyCandidates.length === 0
        && legacyMainImageStateContext.referenceHints.length === 0
        && legacyMainImageStateContext.targetUser === ''
        && legacyMainImageStateContext.visualDirection === ''
        && legacyMainImageStateContext.confirmedProductFacts.join('|') === '用户确认：商品为四双装袜子'
        && legacyMainImageStateContext.confirmedSellingPoints.length === 0
        && keywordOnlyMainImageCopy.status === 'needs_copy_assignment'
        && keywordOnlyMainImageCopy.pendingCandidateTexts.join('|') === '轻盈透气'
        && keywordOnlyMainImageCopy.candidates.length === 0
        && keywordOnlyMainImageCopy.textSlotPlan.length === 0
        && keywordOnlyMainImageCopy.recommendedTemplates.length === 0
        && keywordOnlyMainImageCopy.productCopyContext.userScenes.length === 0
        && keywordOnlyMainImageCopy.productCopyContext.userProblems.length === 0
        && pendingMainImageStandards.status === 'pending_agent_design_decision'
        && pendingMainImageStandards.recipeCandidates.length === 0
        && pendingMainImageStandards.canGuideDesignPlan === false
        && authoredMainImageStandards.status === 'ready_for_design_strategy'
        && authoredMainImageStandards.clickImageGoals.join('|')
            === '方向一|方向二|两个方向分别保留自己的素材和构图关系'
        && authoredMainImageStandards.recipeCandidates.length === 0,
    JSON.stringify({
        pendingDsl: pendingMainImageDraft.designDsl,
        authoredDsl: authoredMainImageDraft.designDsl,
        pendingAlignment: pendingMainImageAlignment,
        authoredAlignment: authoredMainImageAlignment,
        stateContext: legacyMainImageStateContext,
        keywordCopy: keywordOnlyMainImageCopy,
        pendingStandards: pendingMainImageStandards,
        authoredStandards: authoredMainImageStandards
    })
);

const conversion1200MainImageBundle = buildMainImageStrategyInputs({
    userText: '为 1200 转化图明确设计一个方向。',
    imageType: 'conversion',
    projectPath: 'C:\\shop',
    selectedAsset: secondStandardMainImageAsset,
    slotAssignments: [makeMainImageSlotAssignment({
        sizeKey: '1200',
        imageType: 'conversion',
        slotName: '2',
        variantId: 'conversion-1',
        objective: '厚实保暖的可见证据',
        visualHook: '厚实保暖的可见证据',
        layoutFocus: '由 Agent 组织商品证据、信息层级与留白',
        asset: secondStandardMainImageAsset,
        subjectBounds: { left: 80, top: 90, right: 1320, bottom: 1700, width: 1240, height: 1610 },
        targetBox: { x: 140, y: 160, width: 1160, height: 1840 },
        preset: { targetFill: 0.76, minFill: 0.58, maxFill: 0.9 }
    })],
    projectAssets: [standardMainImageAsset, secondStandardMainImageAsset],
    subjectBounds: { left: 80, top: 90, right: 1320, bottom: 1700, width: 1240, height: 1610 },
    sizePlans: [{
        sizeKey: '1200',
        targetSize: { width: 1440, height: 2160 },
        subjectSize: { width: 1240, height: 1610 },
        scale: 0.86,
        targetX: 180,
        targetY: 130,
        decisionReason: 'Agent 明确选择 1200 转化方向与对应素材。',
        smartLayoutPlanned: true,
        quickExportPlanned: true
    }],
    visionSignal: {
        source: 'vision-model',
        assetRef: { id: secondStandardMainImageAsset.id, path: secondStandardMainImageAsset.path },
        productType: 'socks',
        subjectSummary: '袜子穿着与厚度展示素材',
        backgroundSummary: '棚拍背景',
        styleHints: []
    },
    agentDesignDecision: {
        conversionVisualHooks: ['厚实保暖的可见证据'],
        conversionLayoutFocus: '由 Agent 组织商品证据、信息层级与留白'
    },
    toolNames: multiVariantMainImageInput.toolNames,
    userCheckpointApproved: true
});
const conversion1200Document = conversion1200MainImageBundle.productionDocumentStructure.documents[0];
const conversion1200Operations = conversion1200MainImageBundle.productionExecutionPlan.documents
    .flatMap((document) => document.operations);
check(
    '1200 工作文档允许 Agent 显式分配转化槽，并按 2:3 原画布与子组名交付',
    conversion1200MainImageBundle.productionDocumentStructure.status === 'ready_production_document_structure'
        && conversion1200MainImageBundle.productionExecutionPlan.status === 'ready_execution_plan'
        && conversion1200MainImageBundle.productionDocumentStructure.documents.length === 1
        && conversion1200Document?.name === '1200'
        && conversion1200Document?.canvasSize.width === 1440
        && conversion1200Document?.canvasSize.height === 2160
        && conversion1200Document?.parentGroups.find((group) => group.name === '点击图')
            ?.childGroups.every((group) => group.populationStatus === 'unassigned')
        && conversion1200Document?.parentGroups.find((group) => group.name === '转化图')
            ?.childGroups.find((group) => group.name === '2')?.populationStatus === 'assigned'
        && conversion1200MainImageBundle.productionDocumentStructure.exportSpecs.length === 1
        && conversion1200MainImageBundle.productionDocumentStructure.exportSpecs[0]?.groupPath.join('/') === '转化图/2'
        && conversion1200MainImageBundle.productionDocumentStructure.exportSpecs[0]?.fileName === '2.jpg'
        && conversion1200Operations.find((operation) => operation.tool === 'createDocument')?.resolutionPpi === 72
        && conversion1200Operations.find((operation) => operation.tool === 'createDocument')?.colorMode === 'RGB'
        && conversion1200Operations.find((operation) => operation.tool === 'createDocument')?.bitDepth === 8
        && conversion1200Operations.find((operation) => operation.tool === 'createDocument')?.backgroundColor === 'white'
        && conversion1200Operations.find((operation) => operation.tool === 'placeImage')?.asset?.path
            === secondStandardMainImageAsset.path
        && conversion1200Operations.find((operation) => operation.tool === 'exportGroup')?.canvasPolicy
            === 'preserve_document_canvas'
        && conversion1200MainImageBundle.deliveryPlan.artifacts.some((artifact) => (
            artifact.kind === 'raster_export' && artifact.path.endsWith('\\主图\\1200\\2.jpg')
        )),
    JSON.stringify(conversion1200MainImageBundle)
);

const mainImageLiveCheckpoint = buildMainImageLiveExecutorCheckpoint({
    requestPackage: explicitVariantAssetsMainImageBundle.liveExecutorRequestPackage,
    approvedLiveExecution: true,
    photoshopConnection: {
        connected: true,
        documentWriteAvailable: true
    },
    executionScope: 'disposable-document',
    maxOperationCount: 80
});
const mainImageAdapterToolNames = [
    ...multiVariantMainImageInput.toolNames,
    'getDocumentInfo',
    'getLayerHierarchy',
    'getLayerProperties',
    'getAcceptanceSnapshot'
];
const mainImageAdapterContract = buildMainImageLivePhotoshopAdapterContract({
    checkpoint: mainImageLiveCheckpoint,
    availableToolNames: mainImageAdapterToolNames
});
const rootGroupMappings = mainImageAdapterContract.mappings.filter((mapping) => (
    mapping.sourceTool === 'createGroup'
    && Array.isArray(mapping.paramsPreview.groupPath)
    && mapping.paramsPreview.groupPath.length === 1
));
const nestedGroupMappings = mainImageAdapterContract.mappings.filter((mapping) => (
    mapping.sourceTool === 'createGroup'
    && Array.isArray(mapping.paramsPreview.groupPath)
    && mapping.paramsPreview.groupPath.length === 2
));
const adapterToolCalls = [];
let nextFakeGroupId = 500;
let fakeHierarchyFault = 'none';
const fakeHierarchyState = {
    documentId: 900,
    backgroundLayerId: 1,
    roots: [],
    pendingGroups: new Map()
};

function findFakeHierarchyGroup(groups, layerId) {
    for (const group of groups) {
        if (group.id === layerId) return group;
        const nested = findFakeHierarchyGroup(group.children, layerId);
        if (nested) return nested;
    }
    return undefined;
}

function buildFakeHierarchyFlatList() {
    const nodes = [];
    function appendGroups(groups, parent, depth, parentPath) {
        groups.forEach((group, index) => {
            const pathParts = [...parentPath, group.name];
            nodes.push({
                id: group.id,
                name: group.name,
                path: pathParts.join('/'),
                kind: 'group',
                parentId: parent?.id ?? null,
                parentName: parent?.name ?? null,
                depth,
                index,
                locked: false,
                isBackgroundLayer: false
            });
            appendGroups(group.children, group, depth + 1, pathParts);
        });
    }
    appendGroups(fakeHierarchyState.roots, null, 0, []);
    nodes.push({
        id: fakeHierarchyState.backgroundLayerId,
        name: 'Background',
        path: 'Background',
        kind: 'background',
        parentId: null,
        parentName: null,
        depth: 0,
        index: fakeHierarchyState.roots.length,
        locked: true,
        isBackgroundLayer: true
    });

    const cloned = nodes.map((node) => ({ ...node }));
    const byPath = (pathValue) => cloned.find((node) => node.path === pathValue);
    switch (fakeHierarchyFault) {
        case 'wrong-parent': {
            const node = byPath('转化图/2');
            if (node) {
                node.parentId = 999;
                node.parentName = '错误父组';
            }
            break;
        }
        case 'wrong-root-order': {
            const conversion = byPath('转化图');
            const click = byPath('点击图');
            if (conversion && click) {
                conversion.index = 1;
                click.index = 0;
            }
            break;
        }
        case 'wrong-child-order': {
            const five = byPath('转化图/5');
            const four = byPath('转化图/4');
            if (five && four) {
                five.index = 1;
                four.index = 0;
            }
            break;
        }
        case 'wrong-background-id': {
            const background = cloned.find((node) => node.isBackgroundLayer === true);
            if (background) background.id = 999;
            break;
        }
        case 'wrong-background-role': {
            const background = cloned.find((node) => node.id === fakeHierarchyState.backgroundLayerId);
            if (background) background.isBackgroundLayer = false;
            break;
        }
        case 'wrong-background-lock': {
            const background = cloned.find((node) => node.id === fakeHierarchyState.backgroundLayerId);
            if (background) background.locked = false;
            break;
        }
        case 'background-above-groups': {
            const background = cloned.find((node) => node.id === fakeHierarchyState.backgroundLayerId);
            if (background) background.index = 0;
            cloned.filter((node) => node.depth === 0 && node.kind === 'group')
                .forEach((node) => { node.index += 1; });
            break;
        }
        default:
            break;
    }
    return cloned;
}

const mainImageAdapterBuild = createMainImageLivePhotoshopToolAdapter({
    adapterContract: mainImageAdapterContract,
    approvedLiveAdapterRun: true,
    executionScope: 'disposable-document',
    async executeTool(toolName, params) {
        adapterToolCalls.push({ toolName, params: { ...params } });
        if (toolName === 'createDocument') {
            fakeHierarchyState.roots = [];
            fakeHierarchyState.pendingGroups.clear();
            return {
                success: true,
                documentId: fakeHierarchyState.documentId,
                name: params.name,
                width: params.width,
                height: params.height,
                resolution: params.resolution,
                backgroundLayer: {
                    id: fakeHierarchyState.backgroundLayerId,
                    name: 'Background',
                    isBackgroundLayer: true,
                    locked: true
                },
                document: {
                    id: fakeHierarchyState.documentId,
                    name: params.name,
                    width: params.width,
                    height: params.height,
                    resolution: params.resolution,
                    backgroundLayer: {
                        id: fakeHierarchyState.backgroundLayerId,
                        name: 'Background',
                        isBackgroundLayer: true,
                        locked: true
                    }
                }
            };
        }
        if (toolName === 'createGroup') {
            nextFakeGroupId += 1;
            fakeHierarchyState.pendingGroups.set(nextFakeGroupId, {
                id: nextFakeGroupId,
                name: params.groupName,
                children: []
            });
            return { success: true, layerId: nextFakeGroupId, groupName: params.groupName };
        }
        if (toolName === 'moveLayerToGroup') {
            const group = fakeHierarchyState.pendingGroups.get(params.layerId);
            if (!group) return { success: false, error: 'fake_pending_group_missing' };
            fakeHierarchyState.pendingGroups.delete(params.layerId);
            if (params.targetGroupId === 0) {
                fakeHierarchyState.roots.unshift(group);
            } else {
                const parent = findFakeHierarchyGroup(fakeHierarchyState.roots, params.targetGroupId);
                if (!parent) return { success: false, error: 'fake_parent_group_missing' };
                parent.children.push(group);
            }
            return {
                success: true,
                layerId: params.layerId,
                targetGroupId: params.targetGroupId
            };
        }
        if (toolName === 'getLayerHierarchy') {
            return {
                success: true,
                historyStateRef: {
                    documentId: fakeHierarchyFault === 'wrong-document'
                        ? fakeHierarchyState.documentId + 1
                        : fakeHierarchyState.documentId,
                    historyStateId: 20
                },
                flatList: buildFakeHierarchyFlatList()
            };
        }
        return { success: true };
    }
});
const hierarchyExecutionRequests = mainImageLiveCheckpoint.operationRequests.filter((request) => (
    request.documentName === '800'
    && (request.tool === 'createDocument' || request.tool === 'createGroup')
));
const hierarchyOperationResults = new Map();
const validHierarchyReadbacks = [];
for (const request of hierarchyExecutionRequests) {
    const operationResult = mainImageAdapterBuild.adapter
        ? await mainImageAdapterBuild.adapter.executeOperation(request)
        : null;
    hierarchyOperationResults.set(request.id, operationResult);
    if (request.tool === 'createGroup' && mainImageAdapterBuild.adapter) {
        const readback = await mainImageAdapterBuild.adapter.readbackAfterOperation?.(
            request,
            'getLayerHierarchy',
            operationResult
        );
        validHierarchyReadbacks.push({ request, readback });
    }
}
const finalNestedGroupRequest = [...hierarchyExecutionRequests].reverse().find((request) => (
    request.tool === 'createGroup' && request.groupPath?.join('/') === '转化图/2'
));
const finalNestedOperationResult = finalNestedGroupRequest
    ? hierarchyOperationResults.get(finalNestedGroupRequest.id)
    : null;
const hierarchyFaultReadbacks = {};
for (const fault of [
    'wrong-document',
    'wrong-parent',
    'wrong-root-order',
    'wrong-child-order',
    'wrong-background-id',
    'wrong-background-role',
    'wrong-background-lock',
    'background-above-groups'
]) {
    fakeHierarchyFault = fault;
    hierarchyFaultReadbacks[fault] = finalNestedGroupRequest && mainImageAdapterBuild.adapter
        ? await mainImageAdapterBuild.adapter.readbackAfterOperation?.(
            finalNestedGroupRequest,
            'getLayerHierarchy',
            finalNestedOperationResult
        )
        : null;
}
fakeHierarchyFault = 'none';
check(
    '主图父组显式归位文档根级，子组显式归位父组，不能依赖 Photoshop 当前活动图层碰巧正确',
    mainImageLiveCheckpoint.status === 'ready_for_live_executor_run'
        && mainImageAdapterContract.status === 'ready_for_disposable_photoshop_adapter'
        && rootGroupMappings.length === 2
        && rootGroupMappings.every((mapping) => {
            const sequence = mapping.paramsPreview.operationSequence;
            return Array.isArray(sequence)
                && sequence[0]?.toolName === 'createGroup'
                && sequence[1]?.toolName === 'moveLayerToGroup'
                && sequence[1]?.params?.targetGroupId === 0
                && mapping.paramsPreview.expectedRootPanelOrderTopDown?.join('|') === '转化图|点击图';
        })
        && nestedGroupMappings.length === 9
        && nestedGroupMappings.every((mapping) => {
            const sequence = mapping.paramsPreview.operationSequence;
            return Array.isArray(sequence)
                && sequence[1]?.toolName === 'moveLayerToGroup'
                && String(sequence[1]?.params?.targetGroupId || '').startsWith('parent_group_id_from_path:')
                && Array.isArray(mapping.paramsPreview.expectedPanelOrderTopDown)
                && mapping.paramsPreview.expectedPanelOrderTopDown.length >= 4;
        })
        && hierarchyExecutionRequests.length === 12
        && hierarchyOperationResults.size === 12
        && Array.from(hierarchyOperationResults.values()).every((result) => result?.success === true)
        && validHierarchyReadbacks.length === 11
        && validHierarchyReadbacks.every((item) => item.readback?.success === true)
        && fakeHierarchyState.roots.map((group) => group.name).join('|') === '转化图|点击图'
        && fakeHierarchyState.roots.find((group) => group.name === '点击图')
            ?.children.map((group) => group.name).join('|') === '800-5|800-4|800-3|800-2|800-1'
        && fakeHierarchyState.roots.find((group) => group.name === '转化图')
            ?.children.map((group) => group.name).join('|') === '5|4|3|2'
        && Object.values(hierarchyFaultReadbacks).length === 8
        && Object.values(hierarchyFaultReadbacks).every((readback) => readback?.success === false)
        && String(hierarchyFaultReadbacks['wrong-document']?.error || '').includes('document mismatch')
        && /parent mismatch|depth mismatch/.test(String(hierarchyFaultReadbacks['wrong-parent']?.error || ''))
        && String(hierarchyFaultReadbacks['wrong-root-order']?.error || '').includes('root panel order mismatch')
        && String(hierarchyFaultReadbacks['wrong-child-order']?.error || '').includes('child panel order mismatch')
        && ['wrong-background-id', 'wrong-background-role', 'wrong-background-lock']
            .every((fault) => String(hierarchyFaultReadbacks[fault]?.error || '').includes('Background layer'))
        && String(hierarchyFaultReadbacks['background-above-groups']?.error || '')
            .includes('below the Background layer')
        && adapterToolCalls.filter((call) => (
            call.toolName === 'createGroup' || call.toolName === 'moveLayerToGroup'
        )).length === 22
        && adapterToolCalls.filter((call) => (
            call.toolName === 'moveLayerToGroup' && call.params.targetGroupId === 0
        )).length === 2
        && adapterToolCalls.filter((call) => (
            call.toolName === 'moveLayerToGroup' && call.params.targetGroupId > 0
        )).length === 9,
    JSON.stringify({
        checkpointStatus: mainImageLiveCheckpoint.status,
        contractStatus: mainImageAdapterContract.status,
        rootGroupMappings,
        nestedGroupMappings,
        adapterToolCalls,
        hierarchyExecutionRequests,
        hierarchyOperationResults: Array.from(hierarchyOperationResults.entries()),
        validHierarchyReadbacks,
        hierarchyFaultReadbacks,
        finalRoots: fakeHierarchyState.roots
    })
);

const positiveMainImageProjectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'designecho-main-image-staged-')
);
const positiveMainImageOriginalWindow = global.window;
const positiveMainImageHadOwnWindow = Object.prototype.hasOwnProperty.call(global, 'window');
const positiveMainImageOriginalLocalStorage = global.localStorage;
const positiveMainImageHadOwnLocalStorage = Object.prototype.hasOwnProperty.call(global, 'localStorage');
let positiveMainImageResult;
let positiveMainImageLedger;
let positiveMainImagePlan;
let positiveMainImageToolCalls = [];
let positiveMainImageFinalFilesVerified = false;
let positiveMainImageStagingCleaned = false;
let positiveMainImageDriftResults = null;
let positiveMainImageFixtureError = '';
try {
    const environment = createMainImageStagedDeliveryTestEnvironment(
        positiveMainImageProjectRoot
    );
    positiveMainImageToolCalls = environment.toolCalls;
    global.window = {
        ...(positiveMainImageOriginalWindow || {}),
        designEcho: environment.designEcho
    };
    global.localStorage = {
        getItem() {
            return null;
        },
        setItem() {},
        removeItem() {},
        clear() {}
    };
    const guardedExecutor = createGuardedAtomicToolExecutor({
        userRequest: '按本轮一个明确槽位完成三规格主图生产。',
        executeTool: environment.executeTool
    });
    const ledgerScope = beginRuntimeOwnedSkillToolLedgerScope(guardedExecutor);
    const deliveryAuthority = createRuntimeOwnedSkillDeliveryPlanAuthority({
        scope: ledgerScope,
        executor: guardedExecutor
    });
    positiveMainImageResult = await mainImageExecutor.execute({
        params: {
            mainImageExecutionMode: 'product-disposable-live',
            executionScope: 'disposable-document',
            slotAssignments: [firstExplicitMainImageAssignment],
            photoshopConnection: {
                connected: true,
                documentWriteAvailable: true,
                source: 'design-authorship-positive-staged-fixture'
            }
        },
        context: {
            userInput: '按本轮一个明确槽位完成三规格主图生产。',
            projectContext: { projectPath: positiveMainImageProjectRoot }
        },
        guardedAtomicToolExecutor: guardedExecutor,
        runtimeDeliveryPlanAuthority: deliveryAuthority
    });
    positiveMainImageLedger = await completeRuntimeOwnedSkillToolLedgerScope(ledgerScope);
    positiveMainImagePlan = positiveMainImageLedger?.deliveryPlanBinding?.plan;
    const plannedArtifacts = positiveMainImagePlan?.artifacts || [];
    positiveMainImageFinalFilesVerified = plannedArtifacts.length === 2
        && plannedArtifacts.every((artifact) => {
            if (!fs.existsSync(artifact.path)) return false;
            const identity = readTestFileIdentity(artifact.path);
            return identity.byteLength > 0 && /^[a-f0-9]{64}$/.test(identity.sha256);
        });
    positiveMainImageStagingCleaned = Array.from(environment.transactions.values()).every(
        (transaction) => !fs.existsSync(transaction.stagingRoot)
            && !fs.existsSync(transaction.stagingParent)
    );

    const driftHostCalls = [];
    const driftExecutor = createGuardedAtomicToolExecutor({
        userRequest: '交付身份漂移必须在 Host 前失败关闭。',
        async executeTool(toolName, params) {
            driftHostCalls.push({ toolName, params: { ...params } });
            return { success: true };
        }
    });
    const driftScope = beginRuntimeOwnedSkillToolLedgerScope(driftExecutor);
    const driftAuthority = createRuntimeOwnedSkillDeliveryPlanAuthority({
        scope: driftScope,
        executor: driftExecutor
    });
    const driftFreeze = driftAuthority?.freeze({
        projectPath: positiveMainImageProjectRoot,
        convention: positiveMainImagePlan.convention,
        artifacts: positiveMainImagePlan.artifacts
    });
    if (!driftAuthority || !driftFreeze || driftFreeze.status !== 'frozen') {
        throw new Error('positive_main_image_drift_authority_not_frozen');
    }
    const driftStagingRoot = path.join(positiveMainImageProjectRoot, '.drift-staging');
    const driftMappings = positiveMainImagePlan.artifacts.map((artifact) => ({
        artifactId: artifact.artifactId,
        stagedPath: path.join(
            driftStagingRoot,
            path.relative(positiveMainImageProjectRoot, artifact.path)
        ),
        finalPath: artifact.path
    }));
    const validDriftLease = issueRuntimeOwnedSkillStagingLease({
        deliveryPlanDigest: positiveMainImagePlan.digest,
        stagingRoot: driftStagingRoot,
        destinationRoot: positiveMainImageProjectRoot,
        artifactMappings: driftMappings
    });
    const wrongDigestLease = issueRuntimeOwnedSkillStagingLease({
        deliveryPlanDigest: '0'.repeat(64),
        stagingRoot: driftStagingRoot,
        destinationRoot: positiveMainImageProjectRoot,
        artifactMappings: driftMappings
    });
    const firstEditableArtifact = positiveMainImagePlan.artifacts.find((artifact) => (
        artifact.kind === 'editable_document'
    ));
    const firstEditableMapping = driftMappings.find((mapping) => (
        mapping.artifactId === firstEditableArtifact?.artifactId
    ));
    if (!firstEditableArtifact || !firstEditableMapping) {
        throw new Error('positive_main_image_drift_editable_artifact_missing');
    }
    const validSaveParams = {
        path: firstEditableMapping.stagedPath,
        format: firstEditableArtifact.format,
        asCopy: true,
        conflictPolicy: 'fail_if_exists'
    };
    const wrongArtifactIdResult = await driftAuthority.executeStagedArtifacts({
        lease: validDriftLease,
        artifactIds: ['main-image-artifact-does-not-exist'],
        toolName: 'saveDocument',
        params: validSaveParams
    });
    const wrongStagedPathResult = await driftAuthority.executeStagedArtifacts({
        lease: validDriftLease,
        artifactIds: [firstEditableArtifact.artifactId],
        toolName: 'saveDocument',
        params: {
            ...validSaveParams,
            path: path.join(driftStagingRoot, 'wrong', 'wrong.psb')
        }
    });
    const wrongLeaseDigestResult = await driftAuthority.executeStagedArtifacts({
        lease: wrongDigestLease,
        artifactIds: [firstEditableArtifact.artifactId],
        toolName: 'saveDocument',
        params: validSaveParams
    });
    const incompleteCommitReceipt = issueRuntimeOwnedSkillExternalDeliveryCommitReceipt({
        deliveryPlanDigest: positiveMainImagePlan.digest,
        committedFiles: positiveMainImagePlan.artifacts.slice(0, -1).map((artifact) => {
            const identity = readTestFileIdentity(artifact.path);
            return {
                artifactId: artifact.artifactId,
                path: artifact.path,
                byteLength: identity.byteLength,
                sha256: identity.sha256
            };
        })
    });
    const incompleteCommitDecision = driftAuthority.acceptExternalCommit({
        artifactIds: positiveMainImagePlan.artifacts.map((artifact) => artifact.artifactId),
        receipt: incompleteCommitReceipt
    });
    const driftLedger = await completeRuntimeOwnedSkillToolLedgerScope(driftScope);
    positiveMainImageDriftResults = {
        wrongArtifactIdResult,
        wrongStagedPathResult,
        wrongLeaseDigestResult,
        incompleteCommitDecision,
        hostCallCount: driftHostCalls.length,
        ledgerEntryCount: driftLedger?.entries.length ?? -1
    };
} catch (error) {
    positiveMainImageFixtureError = error instanceof Error ? error.stack || error.message : String(error);
} finally {
    if (positiveMainImageHadOwnWindow) {
        global.window = positiveMainImageOriginalWindow;
    } else {
        delete global.window;
    }
    if (positiveMainImageHadOwnLocalStorage) {
        global.localStorage = positiveMainImageOriginalLocalStorage;
    } else {
        delete global.localStorage;
    }
    const normalizedTemporaryRoot = path.resolve(positiveMainImageProjectRoot);
    const normalizedOsTemporaryRoot = path.resolve(os.tmpdir());
    if (path.dirname(normalizedTemporaryRoot) === normalizedOsTemporaryRoot
        && path.basename(normalizedTemporaryRoot).startsWith('designecho-main-image-staged-')) {
        fs.rmSync(normalizedTemporaryRoot, { recursive: true, force: true });
    } else {
        positiveMainImageFixtureError = positiveMainImageFixtureError
            || 'positive_main_image_fixture_cleanup_scope_rejected';
    }
}
const positiveMainImageSaveExportCalls = positiveMainImageToolCalls.filter((call) => (
    call.toolName === 'saveDocument' || call.toolName === 'exportGroup'
));
const positiveMainImageFinalPathKeys = new Set(
    (positiveMainImagePlan?.artifacts || []).map((artifact) => (
        String(artifact.path).replace(/\\/g, '/').toLowerCase()
    ))
);
check(
    '主图正向 staged 交付以同一真实 guard、冻结计划、暂存映射和 external commit 闭合整组文件',
    !positiveMainImageFixtureError
        && positiveMainImageResult?.success === true
        && positiveMainImageResult?.data?.runtimeDeliveryReceipt?.status === 'ready'
        && positiveMainImageResult?.data?.mainImageDeliveryTransaction?.status === 'committed'
        && positiveMainImageResult?.data?.mainImageDeliveryTransaction?.stagingCleanupComplete === true
        && positiveMainImageLedger?.deliveryPlanBinding?.status === 'ready'
        && positiveMainImagePlan?.artifacts.length === 2
        && positiveMainImageLedger?.deliveryPlanBinding?.artifactExecutions.length === 1
        && positiveMainImageLedger.deliveryPlanBinding.artifactExecutions[0]?.toolName
            === 'runtimeExternalFileTransaction'
        && positiveMainImageFinalFilesVerified
        && positiveMainImageStagingCleaned
        && positiveMainImageToolCalls.filter((call) => call.toolName === 'createDocument').length === 1
        && positiveMainImageToolCalls.filter((call) => call.toolName === 'createGroup').length === 11
        && positiveMainImageToolCalls.filter((call) => call.toolName === 'placeImage').length === 1
        && positiveMainImageToolCalls.filter((call) => call.toolName === 'transformLayer').length === 1
        && positiveMainImageSaveExportCalls.length === 2
        && positiveMainImageSaveExportCalls.every((call) => {
            const targetPath = String(
                call.toolName === 'saveDocument' ? call.params.path : call.params.outputPath
            );
            const targetKey = targetPath.replace(/\\/g, '/').toLowerCase();
            return targetKey.includes('/.designecho-staging/')
                && !positiveMainImageFinalPathKeys.has(targetKey);
        }),
    JSON.stringify({
        error: positiveMainImageFixtureError,
        resultSuccess: positiveMainImageResult?.success,
        resultError: positiveMainImageResult?.error,
        runtimeDeliveryReceiptStatus: positiveMainImageResult?.data?.runtimeDeliveryReceipt?.status,
        transactionStatus: positiveMainImageResult?.data?.mainImageDeliveryTransaction?.status,
        ledgerStatus: positiveMainImageLedger?.deliveryPlanBinding?.status,
        artifactCount: positiveMainImagePlan?.artifacts.length,
        artifactExecutionCount: positiveMainImageLedger?.deliveryPlanBinding?.artifactExecutions.length,
        toolCallCounts: Object.fromEntries(
            Array.from(new Set(positiveMainImageToolCalls.map((call) => call.toolName))).map((toolName) => [
                toolName,
                positiveMainImageToolCalls.filter((call) => call.toolName === toolName).length
            ])
        ),
        finalFilesVerified: positiveMainImageFinalFilesVerified,
        stagingCleaned: positiveMainImageStagingCleaned
    })
);
check(
    '主图 staged authority 对 artifact、路径、lease digest 与 external commit 集合漂移均零 Host 失败关闭',
    positiveMainImageDriftResults?.wrongArtifactIdResult?.code
        === 'runtime_delivery_artifact_order_mismatch'
        && positiveMainImageDriftResults?.wrongStagedPathResult?.code
            === 'runtime_delivery_artifact_path_mismatch'
        && positiveMainImageDriftResults?.wrongLeaseDigestResult?.code
            === 'runtime_delivery_staging_lease_untrusted'
        && positiveMainImageDriftResults?.incompleteCommitDecision?.code
            === 'runtime_delivery_external_commit_mismatch'
        && positiveMainImageDriftResults?.hostCallCount === 0
        && positiveMainImageDriftResults?.ledgerEntryCount === 0,
    JSON.stringify(positiveMainImageDriftResults)
);

const agenticMainImageProjectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'designecho-main-image-agentic-')
);
const agenticMainImageOriginalWindow = global.window;
const agenticMainImageHadOwnWindow = Object.prototype.hasOwnProperty.call(global, 'window');
const agenticMainImageOriginalLocalStorage = global.localStorage;
const agenticMainImageHadOwnLocalStorage = Object.prototype.hasOwnProperty.call(global, 'localStorage');
let agenticMainImageFixtureError = '';
let agenticMainImageEvidence = null;
try {
    const environment = createMainImageStagedDeliveryTestEnvironment(agenticMainImageProjectRoot);
    global.window = {
        ...(agenticMainImageOriginalWindow || {}),
        designEcho: environment.designEcho
    };
    global.localStorage = {
        getItem() {
            return null;
        },
        setItem() {},
        removeItem() {},
        clear() {}
    };
    const assetPath = path.join(agenticMainImageProjectRoot, '摄影素材', 'hero.jpg');
    fs.mkdirSync(path.dirname(assetPath), { recursive: true });
    fs.writeFileSync(assetPath, Buffer.from('agent-authored-main-image-fixture'));
    const guardedExecutor = createGuardedAtomicToolExecutor({
        userRequest: '准备一个 800 主图工作文档，由 Agent 自主设计后交付。',
        executeTool: environment.executeTool
    });
    const ledgerScope = beginRuntimeOwnedSkillToolLedgerScope(guardedExecutor);
    const deliveryAuthority = createRuntimeOwnedSkillDeliveryPlanAuthority({
        scope: ledgerScope,
        executor: guardedExecutor
    });
    const runtimeTaskIdentity = {
        version: 'runtime-session-identity/v0',
        sessionId: 'runtime-agentic-main-image-session',
        runId: 'run-agentic-main-image-generation-1',
        generation: 1,
        issuedAt: '2026-08-31T00:00:00.000Z',
        skillId: 'main-image-design',
        taskType: 'ecommerce.main_image',
        boundaries: {
            identityOnly: true,
            grantsPermission: false,
            executesTools: false,
            changesTaskResult: false,
            categoryNeutral: true
        }
    };
    const commonParams = {
        executionScope: 'disposable-document',
        photoshopConnection: {
            connected: true,
            documentWriteAvailable: true,
            source: 'design-authorship-agentic-fixture'
        }
    };
    const commonContext = {
        userInput: '准备一个 800 主图工作文档，由 Agent 自主设计后交付。',
        projectContext: { projectPath: agenticMainImageProjectRoot }
    };
    const beforeInvalidPrepareIdentityCallCount = environment.toolCalls.length;
    const invalidPrepareIdentityResult = await mainImageExecutor.execute({
        params: {
            ...commonParams,
            mainImageProductionAction: 'prepare',
            size: '800'
        },
        context: commonContext,
        guardedAtomicToolExecutor: guardedExecutor,
        runtimeDeliveryPlanAuthority: deliveryAuthority,
        runtimeTaskIdentity: {
            ...runtimeTaskIdentity,
            boundaries: {
                ...runtimeTaskIdentity.boundaries,
                grantsPermission: true
            }
        }
    });
    const invalidPrepareIdentityHostCallDelta = environment.toolCalls.length
        - beforeInvalidPrepareIdentityCallCount;
    const prepareResult = await mainImageExecutor.execute({
        params: {
            ...commonParams,
            mainImageProductionAction: 'prepare',
            size: '800'
        },
        context: commonContext,
        guardedAtomicToolExecutor: guardedExecutor,
        runtimeDeliveryPlanAuthority: deliveryAuthority,
        runtimeTaskIdentity
    });
    const workspace = prepareResult?.data?.mainImageAgenticWorkspace;
    const prepareCallCount = environment.toolCalls.length;
    const prepareSaveExportCalls = environment.toolCalls.filter((call) => (
        call.toolName === 'saveDocument' || call.toolName === 'exportGroup'
    )).length;
    const unchangedFinalizeResult = await mainImageExecutor.execute({
        params: {
            ...commonParams,
            mainImageProductionAction: 'finalize',
            mainImageWorkspaceRef: workspace?.workspaceRef
        },
        context: commonContext,
        guardedAtomicToolExecutor: guardedExecutor,
        runtimeDeliveryPlanAuthority: deliveryAuthority,
        runtimeTaskIdentity
    });
    const saveExportAfterUnchanged = environment.toolCalls.filter((call) => (
        call.toolName === 'saveDocument' || call.toolName === 'exportGroup'
    )).length;
    const beforeWrongIdentityCallCount = environment.toolCalls.length;
    const wrongRuntimeTaskResult = await mainImageExecutor.execute({
        params: {
            ...commonParams,
            mainImageProductionAction: 'finalize',
            mainImageWorkspaceRef: workspace?.workspaceRef
        },
        context: commonContext,
        guardedAtomicToolExecutor: guardedExecutor,
        runtimeDeliveryPlanAuthority: deliveryAuthority,
        runtimeTaskIdentity: {
            ...runtimeTaskIdentity,
            sessionId: 'runtime-different-agentic-main-image-session',
            runId: 'run-different-agentic-main-image-generation-1'
        }
    });
    const wrongIdentityHostCallDelta = environment.toolCalls.length - beforeWrongIdentityCallCount;
    const targetGroup = workspace?.document?.groups?.find((group) => (
        group.path?.join('/') === '点击图/800-1'
    ));
    const placed = await guardedExecutor('placeImage', { filePath: assetPath });
    const placedLayerId = Number(placed?.layerId || placed?.data?.layerId);
    const moved = await guardedExecutor('moveLayerToGroup', {
        layerId: placedLayerId,
        targetGroupId: targetGroup?.layerId,
        position: 'inside-bottom'
    });
    const prepareLedger = await completeRuntimeOwnedSkillToolLedgerScope(ledgerScope);
    const activeDocument = environment.getActiveDocument();
    const targetLayer = activeDocument?.layers?.get(targetGroup?.layerId);
    const originalTargetLayerName = targetLayer?.name;
    if (targetLayer) targetLayer.name = '被替换的标准组';
    const groupDriftExecutor = createGuardedAtomicToolExecutor({
        userRequest: '组身份漂移必须在文件写入前停止。',
        executeTool: environment.executeTool
    });
    const groupDriftScope = beginRuntimeOwnedSkillToolLedgerScope(groupDriftExecutor);
    const groupDriftAuthority = createRuntimeOwnedSkillDeliveryPlanAuthority({
        scope: groupDriftScope,
        executor: groupDriftExecutor
    });
    const saveExportBeforeGroupDrift = environment.toolCalls.filter((call) => (
        call.toolName === 'saveDocument' || call.toolName === 'exportGroup'
    )).length;
    const groupDriftResult = await mainImageExecutor.execute({
        params: {
            ...commonParams,
            mainImageProductionAction: 'finalize',
            mainImageWorkspaceRef: workspace?.workspaceRef
        },
        context: commonContext,
        guardedAtomicToolExecutor: groupDriftExecutor,
        runtimeDeliveryPlanAuthority: groupDriftAuthority,
        runtimeTaskIdentity
    });
    const saveExportAfterGroupDrift = environment.toolCalls.filter((call) => (
        call.toolName === 'saveDocument' || call.toolName === 'exportGroup'
    )).length;
    await completeRuntimeOwnedSkillToolLedgerScope(groupDriftScope);
    if (targetLayer) targetLayer.name = originalTargetLayerName;

    const originalDocumentId = activeDocument?.id;
    if (activeDocument) activeDocument.id = originalDocumentId + 9000;
    const wrongDocumentExecutor = createGuardedAtomicToolExecutor({
        userRequest: '文档身份漂移必须在文件写入前停止。',
        executeTool: environment.executeTool
    });
    const wrongDocumentScope = beginRuntimeOwnedSkillToolLedgerScope(wrongDocumentExecutor);
    const wrongDocumentAuthority = createRuntimeOwnedSkillDeliveryPlanAuthority({
        scope: wrongDocumentScope,
        executor: wrongDocumentExecutor
    });
    const saveExportBeforeWrongDocument = environment.toolCalls.filter((call) => (
        call.toolName === 'saveDocument' || call.toolName === 'exportGroup'
    )).length;
    const wrongDocumentResult = await mainImageExecutor.execute({
        params: {
            ...commonParams,
            mainImageProductionAction: 'finalize',
            mainImageWorkspaceRef: workspace?.workspaceRef
        },
        context: commonContext,
        guardedAtomicToolExecutor: wrongDocumentExecutor,
        runtimeDeliveryPlanAuthority: wrongDocumentAuthority,
        runtimeTaskIdentity
    });
    const saveExportAfterWrongDocument = environment.toolCalls.filter((call) => (
        call.toolName === 'saveDocument' || call.toolName === 'exportGroup'
    )).length;
    await completeRuntimeOwnedSkillToolLedgerScope(wrongDocumentScope);
    if (activeDocument) activeDocument.id = originalDocumentId;

    const finalExecutor = createGuardedAtomicToolExecutor({
        userRequest: '同一 TaskRun 的新 Skill 调用完成主图交付。',
        executeTool: environment.executeTool
    });
    const finalScope = beginRuntimeOwnedSkillToolLedgerScope(finalExecutor);
    const finalAuthority = createRuntimeOwnedSkillDeliveryPlanAuthority({
        scope: finalScope,
        executor: finalExecutor
    });
    const nextGenerationRuntimeTaskIdentity = {
        ...runtimeTaskIdentity,
        runId: 'run-agentic-main-image-generation-2',
        generation: 2,
        parentRunId: runtimeTaskIdentity.runId,
        issuedAt: '2026-08-31T00:01:00.000Z'
    };
    const finalizeResult = await mainImageExecutor.execute({
        params: {
            ...commonParams,
            mainImageProductionAction: 'finalize',
            mainImageWorkspaceRef: workspace?.workspaceRef
        },
        context: commonContext,
        guardedAtomicToolExecutor: finalExecutor,
        runtimeDeliveryPlanAuthority: finalAuthority,
        runtimeTaskIdentity: nextGenerationRuntimeTaskIdentity
    });
    const ledger = await completeRuntimeOwnedSkillToolLedgerScope(finalScope);
    const beforeRepeatedFinalizeCallCount = environment.toolCalls.length;
    const repeatedExecutor = createGuardedAtomicToolExecutor({
        userRequest: '已经消费的 workspace 不能重复提交。',
        executeTool: environment.executeTool
    });
    const repeatedScope = beginRuntimeOwnedSkillToolLedgerScope(repeatedExecutor);
    const repeatedAuthority = createRuntimeOwnedSkillDeliveryPlanAuthority({
        scope: repeatedScope,
        executor: repeatedExecutor
    });
    const repeatedFinalizeResult = await mainImageExecutor.execute({
        params: {
            ...commonParams,
            mainImageProductionAction: 'finalize',
            mainImageWorkspaceRef: workspace?.workspaceRef
        },
        context: commonContext,
        guardedAtomicToolExecutor: repeatedExecutor,
        runtimeDeliveryPlanAuthority: repeatedAuthority,
        runtimeTaskIdentity: nextGenerationRuntimeTaskIdentity
    });
    await completeRuntimeOwnedSkillToolLedgerScope(repeatedScope);
    const repeatedFinalizeHostCallDelta = environment.toolCalls.length - beforeRepeatedFinalizeCallCount;
    const plan = ledger?.deliveryPlanBinding?.plan;
    const finalFilesVerified = plan?.artifacts?.length === 2
        && plan.artifacts.every((artifact) => (
            fs.existsSync(artifact.path)
            && readTestFileIdentity(artifact.path).byteLength > 0
        ));
    const saveExportCalls = environment.toolCalls.filter((call) => (
        call.toolName === 'saveDocument' || call.toolName === 'exportGroup'
    ));
    agenticMainImageEvidence = {
        prepareResult,
        invalidPrepareIdentityResult,
        invalidPrepareIdentityHostCallDelta,
        workspace,
        prepareCallCount,
        prepareSaveExportCalls,
        unchangedFinalizeResult,
        saveExportAfterUnchanged,
        wrongRuntimeTaskResult,
        wrongIdentityHostCallDelta,
        placed,
        moved,
        prepareLedger,
        groupDriftResult,
        groupDriftSaveExportDelta: saveExportAfterGroupDrift - saveExportBeforeGroupDrift,
        wrongDocumentResult,
        wrongDocumentSaveExportDelta: saveExportAfterWrongDocument - saveExportBeforeWrongDocument,
        finalizeResult,
        repeatedFinalizeResult,
        repeatedFinalizeHostCallDelta,
        ledger,
        plan,
        finalFilesVerified,
        saveExportCalls,
        toolCalls: environment.toolCalls,
        stagingCleaned: Array.from(environment.transactions.values()).every((transaction) => (
            !fs.existsSync(transaction.stagingRoot)
            && !fs.existsSync(transaction.stagingParent)
        ))
    };
} catch (error) {
    agenticMainImageFixtureError = error instanceof Error ? error.stack || error.message : String(error);
} finally {
    if (agenticMainImageHadOwnWindow) {
        global.window = agenticMainImageOriginalWindow;
    } else {
        delete global.window;
    }
    if (agenticMainImageHadOwnLocalStorage) {
        global.localStorage = agenticMainImageOriginalLocalStorage;
    } else {
        delete global.localStorage;
    }
    const normalizedTemporaryRoot = path.resolve(agenticMainImageProjectRoot);
    const normalizedOsTemporaryRoot = path.resolve(os.tmpdir());
    if (path.dirname(normalizedTemporaryRoot) === normalizedOsTemporaryRoot
        && path.basename(normalizedTemporaryRoot).startsWith('designecho-main-image-agentic-')) {
        fs.rmSync(normalizedTemporaryRoot, { recursive: true, force: true });
    } else {
        agenticMainImageFixtureError = agenticMainImageFixtureError
            || 'agentic_main_image_fixture_cleanup_scope_rejected';
    }
}
check(
    '主图 prepare 只建单规格文档与标准组，Agent 通用工具完成内容后 finalize 才提交真实非空组',
    !agenticMainImageFixtureError
        && agenticMainImageEvidence?.prepareResult?.success === true
        && agenticMainImageEvidence?.invalidPrepareIdentityResult?.success === false
        && agenticMainImageEvidence?.invalidPrepareIdentityResult?.error
            === 'main_image_agentic_prepare_runtime_task_identity_required'
        && agenticMainImageEvidence?.invalidPrepareIdentityHostCallDelta === 0
        && agenticMainImageEvidence?.workspace?.status === 'prepared'
        && agenticMainImageEvidence?.workspace?.boundaries?.grantsPermission === false
        && agenticMainImageEvidence?.toolCalls?.filter((call) => call.toolName === 'createDocument').length === 1
        && agenticMainImageEvidence?.toolCalls?.filter((call) => call.toolName === 'createGroup').length === 11
        && agenticMainImageEvidence?.prepareSaveExportCalls === 0
        && agenticMainImageEvidence?.unchangedFinalizeResult?.success === false
        && agenticMainImageEvidence?.unchangedFinalizeResult?.error
            === 'main_image_agentic_finalize_design_revision_unchanged'
        && agenticMainImageEvidence?.saveExportAfterUnchanged === 0
        && agenticMainImageEvidence?.wrongRuntimeTaskResult?.success === false
        && agenticMainImageEvidence?.wrongRuntimeTaskResult?.error
            === 'main_image_workspace_runtime_task_identity_mismatch'
        && agenticMainImageEvidence?.wrongIdentityHostCallDelta === 0
        && agenticMainImageEvidence?.placed?.success !== false
        && agenticMainImageEvidence?.moved?.success !== false
        && agenticMainImageEvidence?.groupDriftResult?.success === false
        && String(agenticMainImageEvidence?.groupDriftResult?.error || '')
            .startsWith('main_image_agentic_finalize_group_identity_mismatch:')
        && agenticMainImageEvidence?.groupDriftSaveExportDelta === 0
        && agenticMainImageEvidence?.wrongDocumentResult?.success === false
        && agenticMainImageEvidence?.wrongDocumentResult?.error
            === 'main_image_agentic_finalize_document_mismatch'
        && agenticMainImageEvidence?.wrongDocumentSaveExportDelta === 0
        && agenticMainImageEvidence?.finalizeResult?.success === true
        && agenticMainImageEvidence?.finalizeResult?.data?.runtimeDeliveryReceipt?.status === 'ready'
        && agenticMainImageEvidence?.finalizeResult?.data?.mainImageDeliveryTransaction?.workspaceConsumed === true
        && agenticMainImageEvidence?.finalizeResult?.data?.resultImagePaths?.length === 1
        && agenticMainImageEvidence?.plan?.artifacts?.length === 2
        && agenticMainImageEvidence?.finalFilesVerified === true
        && agenticMainImageEvidence?.saveExportCalls?.length === 2
        && agenticMainImageEvidence?.saveExportCalls?.every((call) => (
            String(call.toolName === 'saveDocument' ? call.params.path : call.params.outputPath)
                .replace(/\\/g, '/').toLowerCase().includes('/.designecho-staging/')
        ))
        && agenticMainImageEvidence?.saveExportCalls?.filter((call) => (
            call.toolName === 'saveDocument'
        )).every((call) => call.params.asCopy === true)
        && agenticMainImageEvidence?.ledger?.deliveryPlanBinding?.status === 'ready'
        && agenticMainImageEvidence?.repeatedFinalizeResult?.success === false
        && agenticMainImageEvidence?.repeatedFinalizeResult?.error
            === 'main_image_workspace_not_found_or_expired'
        && agenticMainImageEvidence?.repeatedFinalizeHostCallDelta === 0
        && agenticMainImageEvidence?.stagingCleaned === true,
    JSON.stringify({
        error: agenticMainImageFixtureError,
        prepareStatus: agenticMainImageEvidence?.prepareResult?.data?.status,
        invalidPrepareIdentityError: agenticMainImageEvidence?.invalidPrepareIdentityResult?.error,
        invalidPrepareIdentityHostCallDelta: agenticMainImageEvidence?.invalidPrepareIdentityHostCallDelta,
        prepareError: agenticMainImageEvidence?.prepareResult?.error,
        prepareBlockers: agenticMainImageEvidence?.prepareResult?.data?.blockers,
        workspace: agenticMainImageEvidence?.workspace,
        unchangedError: agenticMainImageEvidence?.unchangedFinalizeResult?.error,
        wrongTaskError: agenticMainImageEvidence?.wrongRuntimeTaskResult?.error,
        wrongIdentityHostCallDelta: agenticMainImageEvidence?.wrongIdentityHostCallDelta,
        placed: agenticMainImageEvidence?.placed,
        moved: agenticMainImageEvidence?.moved,
        groupDriftError: agenticMainImageEvidence?.groupDriftResult?.error,
        groupDriftSaveExportDelta: agenticMainImageEvidence?.groupDriftSaveExportDelta,
        wrongDocumentError: agenticMainImageEvidence?.wrongDocumentResult?.error,
        wrongDocumentSaveExportDelta: agenticMainImageEvidence?.wrongDocumentSaveExportDelta,
        finalizeSuccess: agenticMainImageEvidence?.finalizeResult?.success,
        finalizeError: agenticMainImageEvidence?.finalizeResult?.error,
        finalizeReceipt: agenticMainImageEvidence?.finalizeResult?.data?.runtimeDeliveryReceipt,
        transaction: agenticMainImageEvidence?.finalizeResult?.data?.mainImageDeliveryTransaction,
        repeatedFinalizeError: agenticMainImageEvidence?.repeatedFinalizeResult?.error,
        repeatedFinalizeHostCallDelta: agenticMainImageEvidence?.repeatedFinalizeHostCallDelta,
        toolCalls: agenticMainImageEvidence?.toolCalls,
        artifacts: agenticMainImageEvidence?.plan?.artifacts,
        finalFilesVerified: agenticMainImageEvidence?.finalFilesVerified,
        stagingCleaned: agenticMainImageEvidence?.stagingCleaned
    })
);
check(
    'Skill 的 TaskRun 身份只由 Harness 晚绑定透传，模型同名参数与子 Skill 覆盖都不能创建新身份',
    skillToolsSource.includes("'runtimeTaskIdentity'")
        && skillToolsSource.includes('runtimeTaskIdentity: options.runtimeTaskIdentity')
        && autonomousExecutor.includes('getRuntimeTaskIdentity?.()')
        && autonomousExecutor.includes('() => runtimeSessionIdentity')
        && skillExecutorRegistrySource.includes('runtimeTaskIdentity: executeParams.runtimeTaskIdentity')
        && !skillExecutorRegistrySource.includes(
            'runtimeTaskIdentity: childExecuteParams.runtimeTaskIdentity'
        )
);
const mainImageProductionStructure = {
    status: 'ready_production_document_structure',
    documents: [{
        id: 'main-image-document-800',
        name: '主图-800',
        ratio: '1:1',
        canvasSize: { width: 1440, height: 1440 },
        exportSize: { width: 800, height: 800 },
        sizeProfileId: 'tmall-800-main-image',
        parentGroups: []
    }, {
        id: 'main-image-document-750',
        name: '主图-750',
        ratio: '3:4',
        canvasSize: { width: 1440, height: 1920 },
        exportSize: { width: 750, height: 1000 },
        sizeProfileId: 'tmall-750-main-image',
        parentGroups: []
    }],
    exportSpecs: [{
        id: 'main-image-document-800-click-1-export',
        documentId: 'main-image-document-800',
        documentName: '主图-800',
        groupPath: ['点击图', '点击图-1'],
        exportSize: { width: 800, height: 800 },
        fileName: '点击图-1.jpg',
        imageType: 'click'
    }, {
        id: 'main-image-document-800-conversion-1-export',
        documentId: 'main-image-document-800',
        documentName: '主图-800',
        groupPath: ['转化图', '转化图-1'],
        exportSize: { width: 800, height: 800 },
        fileName: '转化图-1.jpg',
        imageType: 'conversion'
    }, {
        id: 'main-image-document-750-click-1-export',
        documentId: 'main-image-document-750',
        documentName: '主图-750',
        groupPath: ['点击图', '点击图-1'],
        exportSize: { width: 750, height: 1000 },
        fileName: '点击图-1.jpg',
        imageType: 'click'
    }]
};
const mainImageDeliveryPlan = buildMainImageSkillDeliveryPlan({
    projectPath: 'C:\\shop',
    deliveryConvention: mainImageDeliveryConvention,
    deliveryVersion: 'v2',
    productionDocumentStructure: mainImageProductionStructure
});
const mainImageMissingVersionPlan = buildMainImageSkillDeliveryPlan({
    projectPath: 'C:\\shop',
    deliveryConvention: mainImageDeliveryConvention,
    productionDocumentStructure: mainImageProductionStructure
});
const mainImageUnsupportedPairingPlan = buildMainImageSkillDeliveryPlan({
    projectPath: 'C:\\shop',
    deliveryConvention: {
        ...mainImageDeliveryConvention,
        pairing: 'one_editable_per_raster'
    },
    deliveryVersion: 'v2',
    productionDocumentStructure: mainImageProductionStructure
});
const sameWidthCustomMainImagePlan = buildMainImageSkillDeliveryPlan({
    projectPath: 'C:\\shop',
    deliveryConvention: mainImageDeliveryConvention,
    deliveryVersion: 'v3',
    productionDocumentStructure: {
        status: 'ready_production_document_structure',
        documents: [{
            id: 'custom-800x1000', name: 'custom-800x1000', ratio: 'custom-a',
            canvasSize: { width: 800, height: 1000 }, exportSize: { width: 800, height: 1000 },
            sizeProfileId: 'custom-a', parentGroups: []
        }, {
            id: 'custom-800x1200', name: 'custom-800x1200', ratio: 'custom-b',
            canvasSize: { width: 800, height: 1200 }, exportSize: { width: 800, height: 1200 },
            sizeProfileId: 'custom-b', parentGroups: []
        }],
        exportSpecs: [{
            id: 'custom-800x1000-click-1-export', documentId: 'custom-800x1000',
            documentName: 'custom-800x1000', groupPath: ['点击图', '点击图-1'],
            exportSize: { width: 800, height: 1000 }, fileName: '点击图-1.jpg', imageType: 'click'
        }, {
            id: 'custom-800x1200-click-1-export', documentId: 'custom-800x1200',
            documentName: 'custom-800x1200', groupPath: ['点击图', '点击图-1'],
            exportSize: { width: 800, height: 1200 }, fileName: '点击图-1.jpg', imageType: 'click'
        }]
    }
});
const posixMainImageDeliveryPlan = buildMainImageSkillDeliveryPlan({
    projectPath: '/Volumes/Design Disk/shop',
    deliveryConvention: mainImageDeliveryConvention,
    deliveryVersion: 'v2',
    productionDocumentStructure: mainImageProductionStructure
});
const naturalMainImageStrategy = buildMainImageStrategyInputs({
    userText: '用这个项目里的素材帮我做一张 800×800 的商品主图。',
    imageType: 'click',
    projectPath: 'C:\\shop',
    deliveryConvention: mainImageDeliveryConvention,
    deliveryVersion: 'v2',
    selectedAsset: {
        id: 'asset-01',
        path: 'C:\\shop\\摄影图\\01.jpg',
        name: '01.jpg',
        width: 1200,
        height: 1600
    },
    slotAssignments: [makeMainImageSlotAssignment({
        sizeKey: '800',
        imageType: 'click',
        slotName: '800-1',
        variantId: 'click-1',
        objective: '完整穿着效果',
        visualHook: '完整穿着效果',
        layoutFocus: '主体清晰与留白平衡',
        asset: standardMainImageAsset,
        subjectBounds: { left: 100, top: 100, right: 1100, bottom: 1500, width: 1000, height: 1400 },
        targetBox: { x: 220, y: 150, width: 980, height: 1220 }
    })],
    projectAssets: [{
        id: 'asset-01',
        path: 'C:\\shop\\摄影图\\01.jpg',
        name: '01.jpg',
        width: 1200,
        height: 1600
    }],
    subjectBounds: { left: 100, top: 100, right: 1100, bottom: 1500, width: 1000, height: 1400 },
    sizePlans: [{
        sizeKey: '800',
        targetSize: { width: 800, height: 800 },
        subjectSize: { width: 1000, height: 1400 },
        scale: 0.5,
        targetX: 150,
        targetY: 50,
        decisionReason: 'Agent 根据用户明确 800×800 交付要求选定。',
        smartLayoutPlanned: true,
        quickExportPlanned: true
    }],
    copyCandidates: ['秋冬日常穿搭'],
    outputDir: 'C:\\shop\\交付\\主图',
    visionSignal: {
        source: 'vision-model',
        assetRef: { id: 'asset-01', path: 'C:\\shop\\摄影图\\01.jpg' },
        productType: 'socks',
        subjectSummary: '一组袜子穿着展示',
        backgroundSummary: '纯色棚拍背景',
        styleHints: ['清爽', '日常']
    },
    agentDesignDecision: {
        styleKeywords: ['清爽', '商品主体突出'],
        recommendedTone: '暖中性',
        clickVisualHooks: ['完整穿着效果'],
        clickLayoutFocus: '主体清晰与留白平衡'
    },
    toolNames: ['createDocument', 'createGroup', 'moveLayerToGroup', 'placeImage', 'transformLayer', 'moveLayer', 'exportGroup', 'saveDocument', 'getDocumentInfo', 'getLayerHierarchy', 'getLayerProperties', 'getAcceptanceSnapshot'],
    allowPendingRatioExecution: true,
    userCheckpointApproved: true
});
const naturalMainImageOperations = naturalMainImageStrategy.productionExecutionPlan.documents
    .flatMap((document) => document.operations);
const firstNaturalMainImageExportIndex = naturalMainImageOperations
    .findIndex((operation) => operation.tool === 'exportGroup');
const lastNaturalMainImageTransformIndex = naturalMainImageOperations
    .map((operation) => operation.tool)
    .lastIndexOf('transformLayer');
const naturalMainImageSaveIndex = naturalMainImageOperations
    .findIndex((operation) => operation.tool === 'saveDocument');
check(
    '主图 Skill 把用户/Agent 选定约定编译为跨平台 exact raster/editable 计划，Harness 不作视觉决策',
    mainImageDeliveryPlan.status === 'ready'
        && mainImageDeliveryPlan.typedPlan?.artifacts.length === 5
        && isCurrentSkillDeliveryPlanDigest(mainImageDeliveryPlan.deliveryPlanDigest)
        && mainImageDeliveryPlan.typedPlan.artifacts.filter((artifact) => artifact.kind === 'editable_document').length === 2
        && mainImageDeliveryPlan.typedPlan.artifacts.filter((artifact) => artifact.kind === 'raster_export').length === 3
        && new Set(mainImageDeliveryPlan.typedPlan.artifacts.map((artifact) => artifact.pairId)).size === 2
        && mainImageDeliveryPlan.typedPlan.artifacts.every((artifact) => (
            artifact.path.startsWith('C:\\shop\\')
            && artifact.sourceHistoryRole === 'same_document_revision'
        ))
        && mainImageMissingVersionPlan.status === 'blocked_invalid_convention'
        && mainImageMissingVersionPlan.blockers.some((message) => message.includes('deliveryVersion'))
        && mainImageUnsupportedPairingPlan.status === 'blocked_unsupported_pairing'
        && mainImageUnsupportedPairingPlan.blockers.some((message) => message.includes('逐图可编辑稿'))
        && sameWidthCustomMainImagePlan.status === 'ready'
        && new Set(sameWidthCustomMainImagePlan.artifacts.map((artifact) => artifact.path)).size === 4
        && sameWidthCustomMainImagePlan.artifacts.some((artifact) => artifact.path.includes('800x1000-v3'))
        && sameWidthCustomMainImagePlan.artifacts.some((artifact) => artifact.path.includes('800x1200-v3'))
        && posixMainImageDeliveryPlan.status === 'ready'
        && posixMainImageDeliveryPlan.artifacts.every((artifact) => (
            artifact.path.startsWith('/Volumes/Design Disk/shop/')
        ))
        && naturalMainImageStrategy.deliveryPlan.status === 'ready'
        && naturalMainImageStrategy.deliveryPlan.projectPath === 'C:\\shop'
        && naturalMainImageStrategy.deliveryPlan.convention?.provenance === 'agent_selected'
        && naturalMainImageStrategy.productionExecutionPlan.documents.flatMap((document) => document.operations)
            .some((operation) => operation.tool === 'saveDocument' && operation.outputPath?.endsWith('.psb'))
        && naturalMainImageStrategy.productionExecutionPlan.documents.flatMap((document) => document.operations)
            .filter((operation) => operation.tool === 'exportGroup')
            .every((operation) => operation.outputPath?.endsWith('.jpg') && operation.conflictPolicy === 'fail_if_exists')
        && firstNaturalMainImageExportIndex > lastNaturalMainImageTransformIndex
        && naturalMainImageSaveIndex > firstNaturalMainImageExportIndex
        && mainImageExecutionPlanSource.includes("tool: 'saveDocument'")
        && mainImageExecutionPlanSource.includes("conflictPolicy: 'fail_if_exists'")
        && mainImageAdapterContractSource.includes('const outputPath = cleanString(payload.outputPath)')
        && !mainImageAdapterContractSource.includes('function buildOutputPath(')
        && mainImageDeliveryRuntimeSource.includes('expectedDeliveryPlan: input.plan.typedPlan')
        && mainImageDeliveryRuntimeSource.includes('mainImageSourceHistoryRolesSatisfied')
        && mainImageExecutorSource.includes('runtimeDeliveryPlanAuthority?.freeze({')
        && mainImageExecutorSource.includes('runtimeDeliveryPlanAuthority.executeStagedArtifacts({')
        && mainImageExecutorSource.includes('prepareRuntimeStagedDelivery({')
        && mainImageExecutorSource.includes('promoteRuntimeStagedDelivery({')
        && mainImageExecutorSource.includes('runtimeDeliveryPlanAuthority.acceptExternalCommit({')
        && mainImageExecutorSource.includes('resultImagePaths: controlledResultPaths')
        && mainImageExecutorSource.includes('buildPublicMainImageRunnerSummary(runner)')
        && mainImageExecutorSource.includes('return input.guardedAtomicToolExecutor(toolName, toolParams);')
        && mainImageExecutorSource.includes('approvedLiveExecution: runtimeExecutionAuthorized')
        && mainImageExecutorSource.includes('approvedLiveAdapterRun: runtimeExecutionAuthorized')
        && !mainImageExecutorSource.includes("from '../tool-executor.service'")
        && !mainImageExecutorSource.includes('runtimeDeliveryPlanAuthority.executeArtifacts({')
        && !mainImageExecutorSource.includes('mainImageDeliveryPlan: strategy.deliveryPlan')
        && !mainImageExecutorSource.includes('function buildMainImageQuickExportOutputPath(')
        && uxpExportGroupSource.includes("type ExportGroupFormat = 'png' | 'jpg'")
        && uxpExportGroupSource.includes("CONFLICT_POLICY === 'fail_if_exists' && targetFile.exists")
        && uxpExportGroupSource.includes('sourceHistoryStateRef = readActiveHistoryStateRef(doc)')
        && skillDeclarations.includes("strParam('deliveryVersion'"),
    JSON.stringify({
        planStatus: mainImageDeliveryPlan.status,
        planBlockers: mainImageDeliveryPlan.blockers,
        artifactCount: mainImageDeliveryPlan.typedPlan?.artifacts.length,
        missingVersionStatus: mainImageMissingVersionPlan.status,
        unsupportedPairingStatus: mainImageUnsupportedPairingPlan.status,
        naturalDeliveryStatus: naturalMainImageStrategy.deliveryPlan.status,
        naturalDeliveryBlockers: naturalMainImageStrategy.deliveryPlan.blockers,
        naturalExecutionStatus: naturalMainImageStrategy.productionExecutionPlan.status,
        naturalOperations: naturalMainImageStrategy.productionExecutionPlan.documents
            .flatMap((document) => document.operations)
            .map((operation) => ({ tool: operation.tool, path: operation.outputPath }))
    })
);
check(
    '主图生产完成与 Agent 视觉判断分轴，不把内部交接伪装成用户任务 needs_review',
    mainImageExecutorSource.includes("data.status = deliveryComplete ? 'production_completed' : 'failed'")
        && mainImageExecutorSource.includes("status: 'executed'")
        && mainImageExecutorSource.includes('data.agentReActContinuation = {')
        && mainImageExecutorSource.includes("status: 'needs_decision'")
        && mainImageExecutorSource.includes("sourceStatus: 'main_image_production_completed'")
        && !mainImageExecutorSource.includes("data.status = deliveryComplete ? 'needs_review' : 'failed'"),
    '主图文件生产完成必须通过通用 Skill Outcome + Agent continuation 交还判断，而不是输出任务 needs_review。'
);
const mainImageStagedPathsByArtifactId = Object.fromEntries(
    mainImageDeliveryPlan.artifacts.map((artifact) => [
        artifact.artifactId,
        artifact.path.replace(
            'C:\\shop\\',
            'C:\\shop\\.designecho-staging\\main-image-fixture\\'
        )
    ])
);
const mainImageDocumentHistoryRefs = new Map(
    mainImageDeliveryPlan.documents.map((document, index) => [
        document.documentId,
        { documentId: 501 + index, historyStateId: 701 + index }
    ])
);
const mainImageFixtureProbes = new Map();
const mainImageFixtureOperationResults = mainImageDeliveryPlan.artifacts.map((artifact, index) => {
    const stagedPath = mainImageStagedPathsByArtifactId[artifact.artifactId];
    const sourceHistoryStateRef = mainImageDocumentHistoryRefs.get(artifact.documentId);
    const sha256 = String(index + 1).padStart(64, 'a');
    const byteLength = 12000 + index;
    mainImageFixtureProbes.set(stagedPath.toLowerCase(), {
        success: true,
        path: stagedPath,
        status: artifact.kind === 'raster_export' ? 'ok' : 'unsupported',
        exists: true,
        isFile: true,
        byteLength,
        sha256,
        format: artifact.format,
        dimensions: artifact.kind === 'raster_export'
            ? { width: 800, height: 800 }
            : undefined,
        rawImagesRedacted: true
    });
    const actualResult = artifact.kind === 'raster_export'
        ? {
            success: true,
            outputPath: stagedPath,
            sourceHistoryStateRef
        }
        : {
            success: true,
            format: artifact.format,
            savedPath: stagedPath,
            sourceHistoryStateRef,
            editableDocumentArtifact: {
                version: 'runtime-editable-document-artifact/v1',
                basis: 'uxp_post_save_file_metadata',
                path: stagedPath,
                format: artifact.format,
                byteLength,
                modifiedAt: 9000 + index,
                documentId: sourceHistoryStateRef.documentId,
                canvas: { width: 800, height: 800 }
            }
        };
    return {
        requestId: `main-image-result-${index + 1}`,
        sourceRequestId: artifact.kind === 'raster_export'
            ? `fixture-${artifact.exportSpecId}`
            : `fixture-${artifact.documentId}-save-editable`,
        tool: artifact.kind === 'raster_export' ? 'exportGroup' : 'saveDocument',
        phase: artifact.kind === 'raster_export' ? 'export' : 'save',
        success: true,
        summary: 'fixture operation complete',
        actualResult,
        readbackResults: []
    };
});
const mainImageFixtureRunner = {
    version: 'main-image-live-executor-runner/v0',
    skillId: 'main-image-design',
    scene: 'ecommerce-socks',
    status: 'completed_requires_review',
    executionScope: 'disposable-document',
    executedWithAdapter: true,
    mayWritePhotoshop: true,
    operationCount: mainImageFixtureOperationResults.length,
    executedOperationCount: mainImageFixtureOperationResults.length,
    successfulOperationCount: mainImageFixtureOperationResults.length,
    failedOperationCount: 0,
    failedReadbackCount: 0,
    operationResults: mainImageFixtureOperationResults,
    finalAcceptanceSnapshot: {
        toolName: 'getAcceptanceSnapshot',
        success: true,
        summary: 'fixture final snapshot',
        data: {}
    },
    canClaimOutputQuality: false,
    canClaimDesignComplete: false,
    requiresManualReviewBeforeQualityClaim: true,
    blockers: [],
    warnings: [],
    limitations: [],
    verificationReport: {
        reportId: 'fixture',
        scenario: 'main-image',
        status: 'needs_review',
        scope: 'task',
        summary: 'fixture',
        checks: [],
        blockers: [],
        warnings: [],
        limitations: []
    }
};
const mainImageStagedRasterPaths = mainImageDeliveryPlan.artifacts
    .filter((artifact) => artifact.kind === 'raster_export')
    .map((artifact) => mainImageStagedPathsByArtifactId[artifact.artifactId]);
const previousMainImageWindow = global.window;
global.window = {
    ...(previousMainImageWindow || {}),
    designEcho: {
        ...(previousMainImageWindow?.designEcho || {}),
        probeImageFile: async (filePath) => mainImageFixtureProbes.get(String(filePath).toLowerCase())
            || {
                success: false,
                path: filePath,
                status: 'missing',
                exists: false,
                isFile: false,
                rawImagesRedacted: true
            }
    }
};
let mainImageStagedReadiness;
let mainImageSwappedStagedReadiness;
let mainImageCommittedEvidence;
let mainImageSwappedCommitEvidence;
try {
    mainImageStagedReadiness = await inspectMainImageStagedDeliveryBeforePromotion({
        plan: mainImageDeliveryPlan,
        runner: mainImageFixtureRunner,
        actualRasterPaths: mainImageStagedRasterPaths,
        stagedPathsByArtifactId: mainImageStagedPathsByArtifactId
    });
    mainImageSwappedStagedReadiness = await inspectMainImageStagedDeliveryBeforePromotion({
        plan: mainImageDeliveryPlan,
        runner: mainImageFixtureRunner,
        actualRasterPaths: [
            mainImageStagedRasterPaths[1],
            mainImageStagedRasterPaths[0],
            ...mainImageStagedRasterPaths.slice(2)
        ],
        stagedPathsByArtifactId: mainImageStagedPathsByArtifactId
    });
    const committedFiles = mainImageDeliveryPlan.artifacts.map((artifact, index) => ({
        path: artifact.path,
        byteLength: 12000 + index,
        sha256: String(index + 1).padStart(64, 'a')
    }));
    mainImageCommittedEvidence = await buildMainImageDeliveryRuntimeEvidence({
        plan: mainImageDeliveryPlan,
        runner: mainImageFixtureRunner,
        actualRasterPaths: mainImageStagedRasterPaths,
        stagedPathsByArtifactId: mainImageStagedPathsByArtifactId,
        stagedFileProbes: mainImageStagedReadiness.allFileProbes,
        committedFiles,
        externalCommitAccepted: true
    });
    mainImageSwappedCommitEvidence = await buildMainImageDeliveryRuntimeEvidence({
        plan: mainImageDeliveryPlan,
        runner: mainImageFixtureRunner,
        actualRasterPaths: mainImageStagedRasterPaths,
        stagedPathsByArtifactId: mainImageStagedPathsByArtifactId,
        stagedFileProbes: mainImageStagedReadiness.allFileProbes,
        committedFiles: [committedFiles[1], committedFiles[0], ...committedFiles.slice(2)],
        externalCommitAccepted: true
    });
} finally {
    global.window = previousMainImageWindow;
}
check(
    '主图 PSD 与导出图只能在完整暂存集合、同版本与 Main 整组提交后形成交付收据',
    mainImageStagedReadiness.ready === true
        && mainImageStagedReadiness.runtimeArtifacts.length === mainImageDeliveryPlan.artifacts.length
        && mainImageSwappedStagedReadiness.ready === false
        && mainImageSwappedStagedReadiness.actualRasterPathsMatchPlan === false
        && mainImageCommittedEvidence.receipt.status === 'ready'
        && mainImageCommittedEvidence.receipt.artifacts.length === mainImageDeliveryPlan.artifacts.length
        && mainImageCommittedEvidence.receipt.artifacts.every((artifact) => (
            !artifact.path.includes('.designecho-staging')
        ))
        && mainImageSwappedCommitEvidence.receipt.status === 'incomplete'
        && mainImageSwappedCommitEvidence.receipt.issues.some((issue) => issue.includes('主进程提交')),
    JSON.stringify({
        stagedReady: mainImageStagedReadiness.ready,
        stagedIssues: mainImageStagedReadiness.issues,
        swappedStageIssues: mainImageSwappedStagedReadiness.issues,
        committedStatus: mainImageCommittedEvidence.receipt.status,
        swappedCommitIssues: mainImageSwappedCommitEvidence.receipt.issues
    })
);
const selectedDeliveryResolution = resolveSkillDeliveryConvention(agentSelectedDeliveryConvention);
const visualDecisionDeliveryResolution = resolveSkillDeliveryConvention({
    ...agentSelectedDeliveryConvention,
    colorPalette: ['粉色']
});
const absoluteDeliveryResolution = resolveSkillDeliveryConvention({
    ...agentSelectedDeliveryConvention,
    raster: {
        ...agentSelectedDeliveryConvention.raster,
        projectRelativeRoot: 'D:\\成品\\SKU'
    }
});
const absoluteProjectFileRefResolution = resolveSkillDeliveryConvention({
    ...agentSelectedDeliveryConvention,
    supportRefs: ['project-file:D:\\成品\\SKU\\2双组合.psb']
});
const disguisedAbsoluteDocumentRefResolution = resolveSkillDeliveryConvention({
    ...agentSelectedDeliveryConvention,
    supportRefs: ['document:C:/Users/12611/private.psb']
});
const disguisedUrlDocumentRefResolution = resolveSkillDeliveryConvention({
    ...agentSelectedDeliveryConvention,
    supportRefs: ['document:https://example.invalid/private.psb']
});
const disguisedRelativePathDocumentRefResolution = resolveSkillDeliveryConvention({
    ...agentSelectedDeliveryConvention,
    supportRefs: ['document:Users/12611/private.psb']
});
const disguisedSensitivePrefixResolution = resolveSkillDeliveryConvention({
    ...agentSelectedDeliveryConvention,
    supportRefs: ['api-key:sk-example-secret']
});
const genericSensitiveSourceRefsBlocked = [
    'api-key:sk-example',
    'secret:opaque-id',
    'document:access-token',
    'bearer:opaque-id'
].every((reference) => normalizeStableSourceReference(reference) === undefined);
const genericStableSourceRefAccepted = normalizeStableSourceReference('document:stable-id')
    === 'document:stable-id';
const unauthorizedReplaceDeliveryResolution = resolveSkillDeliveryConvention({
    ...agentSelectedDeliveryConvention,
    provenance: 'user',
    supportRefs: ['user-instruction:current-turn'],
    versionPolicy: 'replace_exact_set'
});
const forgedUserDeliveryResolution = resolveSkillDeliveryConvention({
    ...agentSelectedDeliveryConvention,
    provenance: 'user',
    supportRefs: ['user-instruction:current-turn'],
    versionPolicy: 'fail_if_exists'
});
const unboundAgentExamplesDeliveryResolution = resolveSkillDeliveryConvention({
    ...agentSelectedDeliveryConvention,
    provenance: 'agent_examples'
});
const customDeliveryInventory = buildSkuExpectedExportInventory({
    outputDir: 'C:\\project\\SKU',
    projectPath: 'C:\\project',
    deliveryConvention: agentSelectedDeliveryConvention,
    specs: [{
        size: 2,
        combos: [['奶白', '黑色']],
        comboTemplateName: '2双组合.psd'
    }]
});
const compatibilityDeliveryInventory = buildSkuExpectedExportInventory({
    outputDir: 'C:\\project\\SKU',
    specs: [{
        size: 2,
        combos: [['奶白', '黑色']],
        comboTemplateName: '2双组合.psd'
    }]
});
const posixDeliveryInventory = buildSkuExpectedExportInventory({
    projectPath: '/Users/designer/Project',
    deliveryConvention: agentSelectedDeliveryConvention,
    specs: [{
        size: 2,
        combos: [['奶白', '黑色']],
        comboTemplateName: '2双组合.psd'
    }]
});
const posixVolumeFallbackInventory = buildSkuExpectedExportInventory({
    outputDir: '/Volumes/Design Disk/Project/SKU',
    specs: [{
        size: 2,
        combos: [['奶白', '黑色']],
        comboTemplateName: '2双组合.psd'
    }]
});
const siblingRootDeliveryInventory = buildSkuExpectedExportInventory({
    projectPath: 'C:\\project',
    deliveryConvention: {
        ...agentSelectedDeliveryConvention,
        raster: {
            ...agentSelectedDeliveryConvention.raster,
            projectRelativeRoot: '交付/JPG'
        },
        editable: {
            ...agentSelectedDeliveryConvention.editable,
            projectRelativeRoot: '交付/PSD'
        }
    },
    specs: [{
        size: 2,
        combos: [['奶白', '黑色']],
        comboTemplateName: '2双组合.psd'
    }]
});
const jpegSkuDeliveryInventory = buildSkuExpectedExportInventory({
    projectPath: 'C:\\project',
    deliveryConvention: {
        ...agentSelectedDeliveryConvention,
        raster: { ...agentSelectedDeliveryConvention.raster, format: 'jpeg' }
    },
    specs: [{
        size: 2,
        combos: [['奶白', '黑色']],
        comboTemplateName: '2双组合.psd'
    }]
});
const windowsDigestUpper = buildSkillDeliveryPlanDigest({
    convention: agentSelectedDeliveryConvention,
    artifactPaths: ['C:\\Project\\SKU\\A.jpg']
});
const windowsDigestLower = buildSkillDeliveryPlanDigest({
    convention: agentSelectedDeliveryConvention,
    artifactPaths: ['c:/project/sku/a.jpg']
});
const posixDigestUpper = buildSkillDeliveryPlanDigest({
    convention: agentSelectedDeliveryConvention,
    artifactPaths: ['/Users/Designer/Project/SKU/A.jpg']
});
const posixDigestLower = buildSkillDeliveryPlanDigest({
    convention: agentSelectedDeliveryConvention,
    artifactPaths: ['/Users/Designer/Project/SKU/a.jpg']
});
const multiMasterConvention = {
    ...agentSelectedDeliveryConvention,
    pairing: 'one_master_many_rasters'
};
const multiMasterPlanResolution = buildSkillDeliveryPlan({
    projectPath: 'C:\\project',
    convention: multiMasterConvention,
    artifacts: [
        {
            artifactId: 'master:a', kind: 'editable_document', pairId: 'pair:a', order: 0,
            path: 'C:\\project\\客户交付\\色卡成品\\源稿\\规格2双\\A.psb',
            format: 'psb', sourceHistoryRole: 'same_document_revision'
        },
        {
            artifactId: 'raster:a', kind: 'raster_export', pairId: 'pair:a', order: 1,
            path: 'C:\\project\\客户交付\\色卡成品\\规格2双\\A.jpg',
            format: 'jpg', sourceHistoryRole: 'same_document_revision'
        },
        {
            artifactId: 'master:b', kind: 'editable_document', pairId: 'pair:b', order: 2,
            path: 'C:\\project\\客户交付\\色卡成品\\源稿\\规格2双\\B.psb',
            format: 'psb', sourceHistoryRole: 'same_document_revision'
        },
        {
            artifactId: 'raster:b', kind: 'raster_export', pairId: 'pair:b', order: 3,
            path: 'C:\\project\\客户交付\\色卡成品\\规格2双\\B.jpg',
            format: 'jpg', sourceHistoryRole: 'same_document_revision'
        }
    ]
});
const missingRasterPlanResolution = buildSkillDeliveryPlan({
    projectPath: 'C:\\project',
    convention: multiMasterConvention,
    artifacts: [{
        artifactId: 'master:orphan', kind: 'editable_document', pairId: 'pair:orphan', order: 0,
        path: 'C:\\project\\客户交付\\色卡成品\\源稿\\规格2双\\orphan.psb',
        format: 'psb', sourceHistoryRole: 'same_document_revision'
    }]
});
function findPlanBinding(inventory, artifactPath, kind) {
    const artifact = inventory.deliveryPlan?.artifacts.find((candidate) => (
        candidate.path === artifactPath && candidate.kind === kind
    ));
    if (!artifact) return undefined;
    return {
        artifactId: artifact.artifactId,
        pairId: artifact.pairId,
        order: artifact.order,
        format: artifact.format,
        sourceHistoryRole: artifact.sourceHistoryRole
    };
}
const customDeliveryArtifacts = customDeliveryInventory.items.flatMap((item, index) => ([{
    path: item.path,
    kind: 'raster_export',
    proof: 'file_probe',
    planBinding: findPlanBinding(customDeliveryInventory, item.path, 'raster_export'),
    fileIdentity: { sha256: (index + 1).toString(16).padStart(64, '0'), byteLength: 10_001 + index },
    sourceHistoryStateRef: { documentId: index + 1, historyStateId: 101 + index }
}, {
    path: item.editablePath,
    kind: 'editable_document',
    proof: 'staged_editable_document_promotion',
    planBinding: findPlanBinding(customDeliveryInventory, item.editablePath, 'editable_document'),
    fileIdentity: { sha256: (index + 101).toString(16).padStart(64, '0'), byteLength: 20_001 + index },
    sourceHistoryStateRef: { documentId: index + 1, historyStateId: 101 + index }
}]));
const customDeliveryReceipt = buildRuntimeDeliveryReceipt({
    status: 'ready',
    settlementScope: 'multi_document_task',
    outputs: ['sku_images', 'editable_sku_batch_documents'],
    resultRefs: ['sku-custom-row'],
    resultRefProofs: [{ resultRef: 'sku-custom-row', effect: 'save_export' }],
    artifacts: customDeliveryArtifacts,
    expectedDeliveryPlan: {
        digest: customDeliveryInventory.deliveryPlanDigest,
        convention: customDeliveryInventory.deliveryConvention,
        artifacts: customDeliveryInventory.deliveryPlan?.artifacts || []
    }
});
const pairTamperedDeliveryReceipt = buildRuntimeDeliveryReceipt({
    status: 'ready',
    settlementScope: 'multi_document_task',
    outputs: ['sku_images', 'editable_sku_batch_documents'],
    resultRefs: ['sku-pair-tamper'],
    resultRefProofs: [{ resultRef: 'sku-pair-tamper', effect: 'save_export' }],
    artifacts: customDeliveryArtifacts.map((artifact, index) => (
        index === 0
            ? {
                ...artifact,
                planBinding: {
                    ...artifact.planBinding,
                    pairId: 'forged-pair'
                }
            }
            : artifact
    )),
    expectedDeliveryPlan: {
        digest: customDeliveryInventory.deliveryPlanDigest,
        convention: customDeliveryInventory.deliveryConvention,
        artifacts: customDeliveryInventory.deliveryPlan?.artifacts || []
    }
});
const mismatchedDeliveryReceipt = buildRuntimeDeliveryReceipt({
    status: 'ready',
    settlementScope: 'multi_document_task',
    outputs: ['sku_images'],
    resultRefs: ['sku-wrong-row'],
    resultRefProofs: [{ resultRef: 'sku-wrong-row', effect: 'save_export' }],
    artifacts: [{
        path: 'C:\\project\\SKU\\unrelated.jpg',
        kind: 'raster_export',
        proof: 'file_probe',
        fileIdentity: { sha256: 'f'.repeat(64), byteLength: 999 },
        sourceHistoryStateRef: { documentId: 99, historyStateId: 999 }
    }],
    expectedDeliveryPlan: {
        digest: customDeliveryInventory.deliveryPlanDigest,
        convention: customDeliveryInventory.deliveryConvention,
        artifacts: customDeliveryInventory.deliveryPlan?.artifacts || []
    }
});
const roundTrippedCustomDeliveryReceipt = readRuntimeDeliveryReceipt({
    data: { runtimeDeliveryReceipt: customDeliveryReceipt }
});
const matchingDeliveryPlanVerification = verifyRuntimeDelivery({
    requiredOutputs: ['sku_images', 'editable_sku_batch_documents'],
    receipt: roundTrippedCustomDeliveryReceipt,
    receiptTarget: undefined,
    multiDocumentTaskBound: true,
    expectedDeliveryPlanDigest: customDeliveryInventory.deliveryPlanDigest
});
const missingExpectedDeliveryPlanVerification = verifyRuntimeDelivery({
    requiredOutputs: ['sku_images', 'editable_sku_batch_documents'],
    receipt: roundTrippedCustomDeliveryReceipt,
    receiptTarget: undefined,
    multiDocumentTaskBound: true
});
const mismatchedDeliveryPlanVerification = verifyRuntimeDelivery({
    requiredOutputs: ['sku_images'],
    receipt: roundTrippedCustomDeliveryReceipt,
    receiptTarget: undefined,
    multiDocumentTaskBound: true,
    expectedDeliveryPlanDigest: `skill-delivery-plan/v0:${'f'.repeat(64)}`
});
check(
    'Skill 交付约定严格绑定来源、跨平台路径、exact artifact 与非覆盖授权',
    selectedDeliveryResolution.status === 'ready'
        && visualDecisionDeliveryResolution.status === 'blocked'
        && visualDecisionDeliveryResolution.blockers.some((message) => message.includes('不允许字段 colorPalette'))
        && absoluteDeliveryResolution.status === 'blocked'
        && absoluteProjectFileRefResolution.status === 'blocked'
        && disguisedAbsoluteDocumentRefResolution.status === 'blocked'
        && disguisedUrlDocumentRefResolution.status === 'blocked'
        && disguisedRelativePathDocumentRefResolution.status === 'blocked'
        && disguisedSensitivePrefixResolution.status === 'blocked'
        && genericSensitiveSourceRefsBlocked
        && genericStableSourceRefAccepted
        && unauthorizedReplaceDeliveryResolution.status === 'blocked'
        && unauthorizedReplaceDeliveryResolution.blockers.some((message) => message.includes('不能授权覆盖同名文件'))
        && forgedUserDeliveryResolution.status === 'blocked'
        && forgedUserDeliveryResolution.blockers.some((message) => message.includes('只能声明 agent_selected'))
        && unboundAgentExamplesDeliveryResolution.status === 'blocked'
        && unboundAgentExamplesDeliveryResolution.blockers.some((message) => message.includes('Runtime 观察收据'))
        && customDeliveryInventory.status === 'ready'
        && customDeliveryInventory.outputDir === 'C:\\project\\客户交付\\色卡成品'
        && customDeliveryInventory.items[0]?.path === 'C:\\project\\客户交付\\色卡成品\\规格2双\\第 1 组 - 奶白+黑色.jpg'
        && customDeliveryInventory.items[0]?.editablePath === 'C:\\project\\客户交付\\色卡成品\\源稿\\规格2双\\源稿 1 - 奶白+黑色.psb'
        && customDeliveryInventory.items[0]?.stagedRasterRelativePath === '2双组合\\1奶白+黑色.jpg'
        && customDeliveryInventory.items[0]?.stagedEditableRelativePath === '可编辑\\2双组合\\1奶白+黑色.psb'
        && compatibilityDeliveryInventory.items[0]?.path === 'C:\\project\\SKU\\2双组合\\1奶白+黑色.jpg'
        && posixDeliveryInventory.items[0]?.path === '/Users/designer/Project/客户交付/色卡成品/规格2双/第 1 组 - 奶白+黑色.jpg'
        && posixDeliveryInventory.items[0]?.editablePath === '/Users/designer/Project/客户交付/色卡成品/源稿/规格2双/源稿 1 - 奶白+黑色.psb'
        && posixDeliveryInventory.items[0]?.stagedRasterRelativePath === '2双组合\\1奶白+黑色.jpg'
        && posixDeliveryInventory.items[0]?.stagedEditableRelativePath === '可编辑\\2双组合\\1奶白+黑色.psb'
        && posixVolumeFallbackInventory.status === 'ready'
        && posixVolumeFallbackInventory.outputDir === '/Volumes/Design Disk/Project/SKU'
        && posixVolumeFallbackInventory.items[0]?.path === '/Volumes/Design Disk/Project/SKU/2双组合/1奶白+黑色.jpg'
        && siblingRootDeliveryInventory.status === 'ready'
        && siblingRootDeliveryInventory.outputDir === 'C:\\project\\交付\\JPG'
        && siblingRootDeliveryInventory.editableOutputDir === 'C:\\project\\交付\\PSD'
        && skuBatchExecutorSource.includes("joinSkuExportPath(projectContext.projectPath, '模板文件')")
        && skuBatchExecutorSource.includes("joinSkuExportPath(projectContext.projectPath, 'SKU')")
        && !skuBatchExecutorSource.includes('`${projectContext.projectPath}\\\\SKU`')
        && jpegSkuDeliveryInventory.status === 'blocked'
        && windowsDigestUpper === windowsDigestLower
        && posixDigestUpper !== posixDigestLower
        && multiMasterPlanResolution.status === 'ready'
        && multiMasterPlanResolution.plan?.artifacts.length === 4
        && missingRasterPlanResolution.status === 'blocked'
        && missingRasterPlanResolution.blockers.some((message) => message.includes('至少一份导出图'))
        && isSkillDeliveryPlanDigest(customDeliveryInventory.deliveryPlanDigest)
        && isCurrentSkillDeliveryPlanDigest(customDeliveryInventory.deliveryPlanDigest)
        && /^skill-delivery-plan\/v1:[a-f0-9]{64}$/.test(customDeliveryInventory.deliveryPlanDigest || '')
        && customDeliveryReceipt.status === 'ready'
        && customDeliveryReceipt.deliveryPlanDigest === customDeliveryInventory.deliveryPlanDigest
        && customDeliveryReceipt.deliveryPlanConvention?.version === 'skill-delivery-convention/v0'
        && roundTrippedCustomDeliveryReceipt?.status === 'ready'
        && matchingDeliveryPlanVerification.status === 'passed'
        && matchingDeliveryPlanVerification.deliveryPlanBound === true
        && missingExpectedDeliveryPlanVerification.status === 'incomplete'
        && missingExpectedDeliveryPlanVerification.deliveryPlanBound === false
        && mismatchedDeliveryPlanVerification.status === 'incomplete'
        && mismatchedDeliveryPlanVerification.deliveryPlanBound === false
        && mismatchedDeliveryReceipt.status === 'incomplete'
        && mismatchedDeliveryReceipt.deliveryPlanDigest === undefined
        && mismatchedDeliveryReceipt.issues.some((message) => message.includes('artifact 集合不一致'))
        && pairTamperedDeliveryReceipt.status === 'incomplete'
        && pairTamperedDeliveryReceipt.deliveryPlanDigest === undefined
        && pairTamperedDeliveryReceipt.issues.some((message) => message.includes('artifact 集合不一致'))
        && !skillDeclarations.includes('colorPalette: deliveryConvention')
);
const detailDeliveryConvention = {
    version: 'skill-delivery-convention/v0',
    provenance: 'agent_selected',
    supportRefs: ['user-instruction:current-turn'],
    editable: {
        projectRelativeRoot: '交付/详情页源稿',
        folderPattern: '{version}',
        fileNamePattern: '{defaultName}-{version}',
        format: 'psb'
    },
    raster: {
        projectRelativeRoot: '交付/详情页切片',
        folderPattern: '{version}',
        fileNamePattern: '{index}-{screen}',
        format: 'jpg'
    },
    pairing: 'one_master_many_rasters',
    versionPolicy: 'new_version'
};
const detailDeliveryScreens = [
    { id: 101, name: '首屏', type: 'hero', index: 0, bounds: { left: 0, top: 0, right: 750, bottom: 1000, width: 750, height: 1000 }, visible: true },
    { id: 102, name: '卖点屏', type: 'benefit', index: 1, bounds: { left: 0, top: 1000, right: 750, bottom: 2000, width: 750, height: 1000 }, visible: true }
];
const detailDeliveryPlanResolution = buildDetailPageDeliveryPlan({
    projectPath: 'C:\\project',
    screens: detailDeliveryScreens,
    documentName: '详情页.psb',
    deliveryConvention: detailDeliveryConvention,
    deliveryVersion: 'v2',
    exportQuality: 12
});
const detailDeliveryPlan = detailDeliveryPlanResolution.plan;
const missingDetailVersion = validateDetailPageDeliveryRequest({
    projectPath: 'C:\\project',
    deliveryConvention: detailDeliveryConvention
});
const outsideDetailOutput = validateDetailPageDeliveryRequest({
    projectPath: 'C:\\project',
    outputDir: 'D:\\outside'
});
const inferredDetailOutputPlan = buildDetailPageDeliveryPlan({
    projectPath: 'C:\\project',
    outputDir: 'C:\\project\\客户交付\\详情页',
    screens: detailDeliveryScreens,
    documentName: '详情页.psb'
});
const editOnlyDetailPlan = buildDetailPageDeliveryPlan({
    projectPath: 'C:\\project',
    screens: detailDeliveryScreens,
    documentName: '详情页.psb',
    workMode: 'edit_existing',
    exportSlices: false
});
const editAndSliceDetailPlan = buildDetailPageDeliveryPlan({
    projectPath: 'C:\\project',
    screens: detailDeliveryScreens,
    documentName: '详情页.psb',
    workMode: 'edit_existing',
    exportSlices: true
});
const exportOnlyDetailPlan = buildDetailPageDeliveryPlan({
    projectPath: 'C:\\project',
    screens: detailDeliveryScreens,
    documentName: '详情页.psb',
    workMode: 'export_only',
    exportSlices: true
});
const duplicateDetailSlicePlan = buildDetailPageDeliveryPlan({
    projectPath: 'C:\\project',
    screens: detailDeliveryScreens,
    documentName: '详情页.psb',
    deliveryConvention: {
        ...detailDeliveryConvention,
        raster: {
            ...detailDeliveryConvention.raster,
            folderPattern: undefined,
            fileNamePattern: '同名切片'
        },
        editable: {
            ...detailDeliveryConvention.editable,
            folderPattern: undefined,
            fileNamePattern: '详情页母稿'
        }
    },
    deliveryVersion: 'v2'
});
const tifDetailDeliveryRequest = validateDetailPageDeliveryRequest({
    projectPath: 'C:\\project',
    deliveryConvention: {
        ...detailDeliveryConvention,
        editable: { ...detailDeliveryConvention.editable, format: 'tif' }
    },
    deliveryVersion: 'v2'
});
function buildDetailDeliveryIntake(workMode, userIntent, params = {}) {
    return buildDetailPageAgentIntake({
        params: {
            agentMode: 'execute',
            projectPath: 'C:\\project',
            userIntent,
            ...params
        },
        context: {
            userInput: userIntent,
            projectContext: { projectPath: 'C:\\project' },
            photoshopContext: { hasDocument: true, documentName: '详情页.psb' }
        },
        runtimeDesignBriefDeclaration: {
            readiness: 'ready',
            payload: {
                workMode,
                taskGoal: userIntent,
                inputCoverage: [],
                contextRefs: []
            }
        }
    });
}
const naturalCreateDeliveryIntake = buildDetailDeliveryIntake('create_new', '帮我做一套详情页');
const naturalRedesignDeliveryIntake = buildDetailDeliveryIntake('redesign', '把这套详情页重新设计一下');
const naturalTemplateFillDeliveryIntake = buildDetailDeliveryIntake('template_fill', '用当前模板完成详情页');
const exportOnlyDeliveryIntake = buildDetailDeliveryIntake('export_only', '把当前成品交付给我');
const analyzeOnlyDeliveryIntake = buildDetailDeliveryIntake('analyze_only', '分析一下当前详情页', {
    exportSlices: true
});
const editOnlyDeliveryIntake = buildDetailDeliveryIntake('edit_existing', '把第 2 屏标题改短一些');
const editAndSliceDeliveryIntake = buildDetailDeliveryIntake('edit_existing', '把第 2 屏标题改短并重新切片');
const detailContinuationResult = detailDeliveryPlan ? {
    success: true,
    data: {
        status: 'needs_review',
        deliveryCandidate: {
            version: 'detail-page-delivery-candidate/v1',
            status: 'awaiting_visual_review',
            deterministicChecksPassed: true,
            requiresVisualPass: true,
            completeOnVisualPass: false,
            exportRequested: true,
            workMode: 'template_fill',
            targetScreenIds: [101, 102],
            targetLayerIds: [],
            repairAllowedToolNames: [],
            reviewAllowedToolNames: ['getScreenSnapshots'],
            deliveryToolNames: ['detail-page-design'],
            deliveryPlanDigest: detailDeliveryPlan.deliveryPlanDigest,
            expectedArtifactCount: detailDeliveryPlan.artifacts.length,
            failedChecks: []
        },
        visualReviewRequest: {
            toolName: 'getScreenSnapshots',
            params: { screens: detailDeliveryScreens, maxWidth: 1200 }
        },
        agentReActContinuation: {
            status: 'needs_decision',
            summary: '画面通过后按冻结计划交付。',
            details: [],
            blockers: [],
            warnings: [],
            nextAction: 'decide_next',
            sourceStatus: 'needs_review',
            recovery: {
                mode: 'allowlist',
                purpose: 'deliver',
                allowedToolNames: ['detail-page-design'],
                reviewAllowedToolNames: ['getScreenSnapshots'],
                repairAllowedToolNames: [],
                requiresVisualPass: true,
                completeOnVisualPass: false,
                toolArgumentConstraints: {
                    'detail-page-design': detailDeliveryPlan.toolArgumentConstraints['detail-page-design']
                },
                reason: '只执行 Skill 已编译并冻结的项目内交付计划。'
            }
        }
    }
} : undefined;
const detailContinuationUpdate = detailContinuationResult
    ? resolveAgentWorkflowContinuationScopeUpdate({
        workflowEntryTools: ['detail-page-design'],
        toolCalls: [{ id: 'detail-owner-call', name: 'detail-page-design', arguments: {} }],
        toolResults: [{ callId: 'detail-owner-call', success: true, output: detailContinuationResult }],
        availableToolNames: [
            'detail-page-design',
            'getScreenSnapshots',
            'saveDocument',
            'exportDetailPageSlices'
        ],
        visualDeliveryStatusByCallId: { 'detail-owner-call': 'passed' },
        visualDeliveryIdentityByCallId: {
            'detail-owner-call': { documentId: '77', historyStateId: '88' }
        }
    })
    : { kind: 'none' };
const detailDeliveryScope = detailContinuationUpdate.kind === 'activate'
    ? detailContinuationUpdate.scope
    : undefined;
const exactDetailWorkflowAccess = evaluateAgentWorkflowContinuationToolAccess({
    scope: detailDeliveryScope,
    toolName: 'detail-page-design',
    args: detailDeliveryPlan?.workflowCommit.params
});
const changedDetailWorkflowAccess = evaluateAgentWorkflowContinuationToolAccess({
    scope: detailDeliveryScope,
    toolName: 'detail-page-design',
    args: detailDeliveryPlan ? {
        ...detailDeliveryPlan.workflowCommit.params,
        exportQuality: 9
    } : undefined
});
const directDetailSaveAccess = evaluateAgentWorkflowContinuationToolAccess({
    scope: detailDeliveryScope,
    toolName: 'saveDocument',
    args: detailDeliveryPlan?.toolCalls.saveDocument
});
const trustedDetailWorkflowReentry = issueRuntimeWorkflowDeliveryReentry({
    scope: detailDeliveryScope,
    toolName: 'detail-page-design',
    args: detailDeliveryPlan?.workflowCommit.params
});
const forgedDetailWorkflowReentry = peekRuntimeWorkflowDeliveryReentry({
    version: 'runtime-workflow-delivery-reentry/v0',
    workflowToolName: 'detail-page-design',
    argumentsDigest: detailDeliveryPlan?.toolArgumentConstraints['detail-page-design']?.argumentsDigest
}, 'detail-page-design');
const detailDeliveryHistoryStateRef = { documentId: 77, historyStateId: 88 };
const detailStagedPathsByArtifactId = detailDeliveryPlan
    ? Object.fromEntries(detailDeliveryPlan.artifacts.map((artifact) => [
        artifact.artifactId,
        artifact.path.replace('C:\\project\\', 'C:\\project\\.designecho-staging\\fixture\\')
    ]))
    : {};
const detailCommittedFiles = detailDeliveryPlan
    ? detailDeliveryPlan.artifacts.map((artifact, index) => ({
        path: artifact.path,
        byteLength: 8000 + index,
        sha256: String(index + 41).padStart(64, '0')
    }))
    : [];
const detailEditableResult = detailDeliveryPlan ? {
    success: true,
    format: 'psb',
    savedPath: detailStagedPathsByArtifactId[detailDeliveryPlan.editable.artifactId],
    sourceHistoryStateRef: detailDeliveryHistoryStateRef,
    editableDocumentArtifact: {
        version: 'runtime-editable-document-artifact/v1',
        basis: 'uxp_post_save_file_metadata',
        path: detailStagedPathsByArtifactId[detailDeliveryPlan.editable.artifactId],
        format: 'psb',
        byteLength: 8192,
        modifiedAt: 100,
        documentId: 77,
        canvas: { width: 750, height: 2000 }
    }
} : undefined;
const detailSliceResult = detailDeliveryPlan ? {
    success: true,
    sourceHistoryStateRef: detailDeliveryHistoryStateRef,
    screens: detailDeliveryPlan.slices.map((slice) => ({
        screenId: slice.screenId,
        path: detailStagedPathsByArtifactId[slice.artifactId],
        success: true,
        fileSize: 2048
    })),
    screenSetArtifact: {
        version: 'runtime-screen-set-artifact/v1',
        basis: 'uxp_full_document_screen_parse',
        documentId: 77,
        expectedScreenIds: detailDeliveryPlan.slices.map((slice) => slice.screenId),
        exportedScreenIds: detailDeliveryPlan.slices.map((slice) => slice.screenId)
    },
    sliceDeliveryArtifact: {
        version: 'runtime-detail-page-slice-delivery-artifact/v1',
        basis: 'uxp_exact_no_replace_slice_export',
        documentId: 77,
        sourceHistoryStateRef: detailDeliveryHistoryStateRef,
        deliveryPlanDigest: detailDeliveryPlan.deliveryPlanDigest,
        conflictPolicy: 'new_version',
        expectedPaths: detailDeliveryPlan.slices.map((slice) => detailStagedPathsByArtifactId[slice.artifactId]),
        exportedPaths: detailDeliveryPlan.slices.map((slice) => detailStagedPathsByArtifactId[slice.artifactId]),
        exactArtifactSet: true
    }
} : undefined;
const detailDeliveryRuntimeEvidence = detailDeliveryPlan
    ? buildDetailPageDeliveryRuntimeEvidence({
        plan: detailDeliveryPlan,
        workMode: 'template_fill',
        expectedSourceHistoryStateRef: detailDeliveryHistoryStateRef,
        saveResult: detailEditableResult,
        sliceResult: detailSliceResult,
        stagedPathsByArtifactId: detailStagedPathsByArtifactId,
        committedFiles: detailCommittedFiles
    })
    : undefined;
const tamperedDetailDeliveryRuntimeEvidence = detailDeliveryPlan && detailSliceResult
    ? buildDetailPageDeliveryRuntimeEvidence({
        plan: detailDeliveryPlan,
        workMode: 'template_fill',
        expectedSourceHistoryStateRef: detailDeliveryHistoryStateRef,
        saveResult: detailEditableResult,
        sliceResult: {
            ...detailSliceResult,
            sliceDeliveryArtifact: {
                ...detailSliceResult.sliceDeliveryArtifact,
                exportedPaths: [...detailSliceResult.sliceDeliveryArtifact.exportedPaths].reverse()
            }
        },
        stagedPathsByArtifactId: detailStagedPathsByArtifactId,
        committedFiles: detailCommittedFiles
    })
    : undefined;
check(
    '详情页 Skill 将用户交付习惯编译为 project-bound master+slices，并由通用 continuation 锁定完整参数',
    detailDeliveryPlanResolution.status === 'ready'
        && detailDeliveryPlan?.artifacts.length === 3
        && detailDeliveryPlan?.editable.kind === 'editable_document'
        && detailDeliveryPlan?.editable.path === 'C:\\project\\交付\\详情页源稿\\v2\\详情页-v2.psb'
        && detailDeliveryPlan?.slices[0]?.path === 'C:\\project\\交付\\详情页切片\\v2\\1-首屏.jpg'
        && detailDeliveryPlan?.slices[1]?.path === 'C:\\project\\交付\\详情页切片\\v2\\2-卖点屏.jpg'
        && detailDeliveryPlan?.artifacts.every((artifact) => artifact.pairId === 'detail-page-set')
        && detailDeliveryPlan?.artifacts.every((artifact) => artifact.sourceHistoryRole === 'same_document_revision')
        && /^skill-delivery-plan\/v1:[a-f0-9]{64}$/.test(detailDeliveryPlan?.deliveryPlanDigest || '')
        && detailDeliveryPlan?.toolCalls.saveDocument.conflictPolicy === 'fail_if_exists'
        && detailDeliveryPlan?.toolCalls.exportDetailPageSlices.config.conflictPolicy === 'new_version'
        && detailDeliveryPlan?.toolCalls.exportDetailPageSlices.config.expectedFiles.length === 2
        && missingDetailVersion.status === 'blocked'
        && outsideDetailOutput.status === 'blocked'
        && inferredDetailOutputPlan.status === 'ready'
        && inferredDetailOutputPlan.plan?.editable.path === 'C:\\project\\客户交付\\详情页\\详情页.psb'
        && inferredDetailOutputPlan.plan?.slices[0]?.path === 'C:\\project\\客户交付\\详情页\\1_首屏.jpg'
        && editOnlyDetailPlan.status === 'ready'
        && editOnlyDetailPlan.plan?.artifacts.length === 1
        && editOnlyDetailPlan.plan?.convention.pairing === 'editable_only'
        && editOnlyDetailPlan.plan?.toolCalls.saveDocument !== undefined
        && editOnlyDetailPlan.plan?.toolCalls.exportDetailPageSlices === undefined
        && editAndSliceDetailPlan.plan?.artifacts.length === 3
        && editAndSliceDetailPlan.plan?.convention.pairing === 'one_master_many_rasters'
        && exportOnlyDetailPlan.status === 'ready'
        && exportOnlyDetailPlan.plan?.artifacts.length === 2
        && exportOnlyDetailPlan.plan?.convention.pairing === 'raster_only'
        && exportOnlyDetailPlan.plan?.editable === undefined
        && exportOnlyDetailPlan.plan?.toolCalls.saveDocument === undefined
        && duplicateDetailSlicePlan.status === 'blocked'
        && tifDetailDeliveryRequest.status === 'blocked'
        && naturalCreateDeliveryIntake.params.exportSlices === true
        && naturalRedesignDeliveryIntake.params.exportSlices === true
        && naturalTemplateFillDeliveryIntake.params.exportSlices === true
        && exportOnlyDeliveryIntake.params.exportSlices === true
        && analyzeOnlyDeliveryIntake.params.exportSlices === false
        && editOnlyDeliveryIntake.params.exportSlices === false
        && editAndSliceDeliveryIntake.params.exportSlices === true
        && detailContinuationUpdate.kind === 'activate'
        && detailDeliveryScope?.purpose === 'deliver'
        && detailDeliveryScope?.workflowDeliveryOwner?.toolName === 'detail-page-design'
        && exactDetailWorkflowAccess.allowed === true
        && changedDetailWorkflowAccess.allowed === false
        && directDetailSaveAccess.allowed === false
        && peekRuntimeWorkflowDeliveryReentry(
            trustedDetailWorkflowReentry,
            'detail-page-design'
        ) === trustedDetailWorkflowReentry
        && forgedDetailWorkflowReentry === undefined
        && detailDeliveryRuntimeEvidence?.receipt.status === 'ready'
        && detailDeliveryRuntimeEvidence?.receipt.deliveryPlanDigest === detailDeliveryPlan?.deliveryPlanDigest
        && detailDeliveryRuntimeEvidence?.receipt.artifacts.length === 3
        && detailDeliveryRuntimeEvidence?.receipt.outputs.includes('template_fill_report')
        && detailDeliveryRuntimeEvidence?.sourceHistoryStateRef?.documentId === 77
        && tamperedDetailDeliveryRuntimeEvidence?.receipt.status === 'incomplete'
        && tamperedDetailDeliveryRuntimeEvidence?.issues.some((message) => message.includes('切片缺少'))
        && detailPageExecutor.includes('runtimeWorkflowDeliveryReentry')
        && detailPageExecutor.includes('runtimeDeliveryPlanAuthority.freeze({')
        && detailPageExecutor.includes("toolName: 'saveDocument'")
        && detailPageExecutor.includes("toolName: 'exportDetailPageSlices'")
        && detailPageExecutor.includes('const exportRequested = params.exportSlices === true')
        && !detailPageExecutor.includes('shouldExportFromRequest')
        && !detailPageExecutor.includes('expectedDeliveryPlanDigest: detailPageDeliveryPlan.deliveryPlanDigest')
        && detailPageExecutor.includes('buildDetailPageDeliveryRuntimeEvidence({')
        && detailPageExecutor.includes('runtimeDeliveryReceipt: deliveryEvidence.receipt')
        && detailPageDeliveryPlanSource.includes('buildSkillDeliveryPlan({')
        && toolSchemas.includes("enum: ['fail_if_exists', 'new_version']")
        && !uxpDetailPageSliceExporter.includes('removeExistingExportFile')
        && uxpDetailPageSliceExporter.includes('createFile(fileName, { overwrite: false })')
        && uxpDetailPageSliceExporter.includes('rollbackCreatedExportFiles')
        && uxpDetailPageSliceContract.includes('pre-existing sentinel must never') === false
        && uxpDetailPageSliceContract.includes('拒绝把运行前已存在的文件加入回滚')
);
const openAiUnknownTerminal = new OpenAIAdapter('deepseek').parseResponse({
    choices: [{
        finish_reason: null,
        message: {
            content: '这句话有句号，但 Provider 没有给出终态。',
            tool_calls: [{ id: 'partial-call', function: { name: 'saveDocument', arguments: '{}' } }]
        }
    }]
});
const validDsmlBatch = parseDsmlToolCallBatch(
    '<｜｜DSML｜｜tool_calls>'
    + '<｜｜DSML｜｜invoke name="saveDocument">'
    + '<｜｜DSML｜｜parameter name="path" string="true">output.psd</｜｜DSML｜｜parameter>'
    + '</｜｜DSML｜｜invoke>'
    + '</｜｜DSML｜｜tool_calls>'
);
const mixedMalformedDsmlBatch = parseDsmlToolCallBatch(
    '<｜｜DSML｜｜tool_calls>'
    + '<｜｜DSML｜｜invoke name="saveDocument"></｜｜DSML｜｜invoke>'
    + '<｜｜DSML｜｜invoke><｜｜DSML｜｜parameter name="path">"x"</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke>'
    + '</｜｜DSML｜｜tool_calls>'
);
const partialDsmlBatch = parseDsmlToolCallBatch(
    '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="saveDocument">'
);
const validPromptToolBatch = parseToolCallsFromText(
    '<tool_call>{"name":"saveDocument","arguments":{"path":"output.psd"}}</tool_call>'
);
const mixedPartialPromptToolBatch = parseToolCallsFromText(
    '<tool_call>{"name":"saveDocument","arguments":{}}</tool_call>'
    + '<tool_call>{"name":"getDocumentInfo","arguments":{}}'
);
const whitespacePromptMarkerBatch = parseToolCallsFromText(
    '<tool_call >{"name":"saveDocument","arguments":{}}</tool_call>'
);
check(
    '文本 Tool 协议按整批解析：完整 DSML/XML 可用，混合残缺或变体一律零执行',
    validDsmlBatch.valid === true
        && validDsmlBatch.candidates.length === 1
        && validDsmlBatch.candidates[0].name === 'saveDocument'
        && validDsmlBatch.candidates[0].arguments.path === 'output.psd'
        && mixedMalformedDsmlBatch.valid === false
        && mixedMalformedDsmlBatch.candidates.length === 0
        && partialDsmlBatch.valid === false
        && partialDsmlBatch.candidates.length === 0
        && validPromptToolBatch.valid === true
        && validPromptToolBatch.toolCalls.length === 1
        && mixedPartialPromptToolBatch.valid === false
        && mixedPartialPromptToolBatch.toolCalls.length === 0
        && whitespacePromptMarkerBatch.valid === false
        && whitespacePromptMarkerBatch.toolCalls.length === 0
);
const anthropicLengthTerminal = new AnthropicAdapter().parseResponse({
    stop_reason: 'max_tokens',
    content: [{ type: 'tool_use', id: 'partial-call', name: 'saveDocument', input: {} }]
});
const geminiSafetyTerminal = new GeminiAdapter().parseResponse({
    candidates: [{
        finishReason: 'SAFETY',
        content: { parts: [{ functionCall: { name: 'saveDocument', args: {} } }] }
    }]
});
const ollamaLengthTerminal = new OllamaAdapter('qwen3').parseResponse({
    done: true,
    done_reason: 'length',
    message: { content: '看似完整。', tool_calls: [{ function: { name: 'saveDocument', arguments: {} } }] }
});
const ollamaFalseDoneTerminal = new OllamaAdapter('qwen3').parseResponse({
    done: false,
    done_reason: 'stop',
    message: { content: '', tool_calls: [{ function: { name: 'saveDocument', arguments: {} } }] }
});
const openAiMissingChoice = new OpenAIAdapter('openai').parseResponse({ choices: [] });
const openAiMalformedToolArguments = new OpenAIAdapter('openai').parseResponse({
    choices: [{
        finish_reason: 'tool_calls',
        message: {
            content: '',
            tool_calls: [{
                id: 'malformed-call',
                function: { name: 'saveDocument', arguments: '{"path":' }
            }]
        }
    }]
});
const geminiMissingCandidateBlocked = new GeminiAdapter().parseResponse({
    candidates: [],
    promptFeedback: { blockReason: 'SAFETY' }
});
const openAiRefusalTerminal = new OpenAIAdapter('openai').parseResponse({
    choices: [{
        finish_reason: 'stop',
        message: { content: null, refusal: 'blocked by policy' }
    }],
    usage: { prompt_tokens: 11, completion_tokens: 3 }
});
const deepSeekCacheUsage = new OpenAIAdapter('deepseek').parseResponse({
    choices: [{
        finish_reason: 'stop',
        message: { content: '完成' }
    }],
    usage: {
        prompt_tokens: 100,
        completion_tokens: 10,
        prompt_cache_hit_tokens: 75,
        prompt_cache_miss_tokens: 25
    }
});
const deepSeekPartialCacheUsage = new OpenAIAdapter('deepseek').parseResponse({
    choices: [{
        finish_reason: 'stop',
        message: { content: '完成' }
    }],
    usage: {
        prompt_tokens: 100,
        completion_tokens: 10,
        prompt_cache_hit_tokens: 75
    }
});
const deepSeekInconsistentCacheUsage = new OpenAIAdapter('deepseek').parseResponse({
    choices: [{
        finish_reason: 'stop',
        message: { content: '完成' }
    }],
    usage: {
        prompt_tokens: 100,
        completion_tokens: 10,
        prompt_cache_hit_tokens: 80,
        prompt_cache_miss_tokens: 25
    }
});
const openAiNamedCacheUsage = new OpenAIAdapter('openai').parseResponse({
    choices: [{
        finish_reason: 'stop',
        message: { content: '完成' }
    }],
    usage: {
        prompt_tokens: 100,
        completion_tokens: 10,
        prompt_cache_hit_tokens: 75,
        prompt_cache_miss_tokens: 25
    }
});
const validProviderTransportMetrics = buildProviderTransportMetrics({
    startedAtMs: 1_000,
    serializedRequestBytes: 120_000,
    imageDataUrlBytes: 80_000,
    adapterFormatMs: 4,
    payloadMeasurementMs: 2,
    streamOpenedAtMs: 1_120,
    firstChunkAtMs: 1_180,
    firstSemanticDeltaAtMs: 1_240,
    completedAtMs: 2_500
});
const nonMonotonicProviderTransportMetrics = readProviderTransportMetrics({
    ...validProviderTransportMetrics,
    firstSemanticDeltaMs: 100,
    firstChunkMs: 180
});
const unknownProviderTransportMetrics = readProviderTransportMetrics({
    ...validProviderTransportMetrics,
    rawRequest: 'must-not-cross-boundary'
});
check(
    '各 Provider 非完整终态优先隔离残缺 Tool，不能被句号或已解析参数升级为成功',
    openAiUnknownTerminal.stopReason === 'stream_incomplete'
        && openAiUnknownTerminal.toolCalls.length === 0
        && openAiUnknownTerminal.incompleteToolCallNames[0] === 'saveDocument'
        && anthropicLengthTerminal.stopReason === 'max_tokens'
        && anthropicLengthTerminal.toolCalls.length === 0
        && geminiSafetyTerminal.stopReason === 'content_blocked'
        && geminiSafetyTerminal.toolCalls.length === 0
        && ollamaLengthTerminal.stopReason === 'max_tokens'
        && ollamaLengthTerminal.toolCalls.length === 0
        && ollamaLengthTerminal.incompleteToolCallNames[0] === 'saveDocument'
        && ollamaFalseDoneTerminal.stopReason === 'stream_incomplete'
        && ollamaFalseDoneTerminal.toolCalls.length === 0
        && openAiMissingChoice.stopReason === 'stream_incomplete'
        && openAiMissingChoice.toolCalls.length === 0
        && openAiMalformedToolArguments.stopReason === 'stream_incomplete'
        && openAiMalformedToolArguments.toolCalls.length === 0
        && geminiMissingCandidateBlocked.stopReason === 'content_blocked'
        && geminiMissingCandidateBlocked.toolCalls.length === 0
        && openAiRefusalTerminal.stopReason === 'content_blocked'
        && openAiRefusalTerminal.toolCalls.length === 0
        && openAiRefusalTerminal.usage.inputTokens === 11
        && openAiRefusalTerminal.usage.outputTokens === 3
        && agentRuntime.includes('(response.incompleteToolCallNames || [])')
        && agentRuntime.includes('.filter((name) => visibleToolNames.has(name))')
);
check(
    'DeepSeek 缓存用量只在完整守恒时贯穿普通与流式模型传输',
    deepSeekCacheUsage.usage.inputTokens === 100
        && deepSeekCacheUsage.usage.outputTokens === 10
        && deepSeekCacheUsage.usage.cacheHitInputTokens === 75
        && deepSeekCacheUsage.usage.cacheMissInputTokens === 25
        && deepSeekPartialCacheUsage.usage.cacheHitInputTokens === undefined
        && deepSeekPartialCacheUsage.usage.cacheMissInputTokens === undefined
        && deepSeekInconsistentCacheUsage.usage.cacheHitInputTokens === undefined
        && deepSeekInconsistentCacheUsage.usage.cacheMissInputTokens === undefined
        && openAiNamedCacheUsage.usage.cacheHitInputTokens === undefined
        && openAiNamedCacheUsage.usage.cacheMissInputTokens === undefined
        && (modelServiceSource.match(/readOpenAICompatibleTokenUsage\(/g) || []).length === 2
        && openAiCompatibleToolStreamSource.includes("provider === 'deepseek' ? {")
        && openAiCompatibleToolStreamSource.includes('stream_options: { include_usage: true }')
        && openAiCompatibleToolStreamSource.indexOf('if (chunk.usage) {')
            < openAiCompatibleToolStreamSource.indexOf('if (!delta) continue;')
);
check(
    'Provider transport 只保存单调时间与有界负载规模，Main 流式边界真实采集后随终态返回',
    validProviderTransportMetrics?.serializedRequestBytes === 120_000
        && validProviderTransportMetrics.imageDataUrlBytes === 80_000
        && validProviderTransportMetrics.streamOpenMs === 120
        && validProviderTransportMetrics.firstChunkMs === 180
        && validProviderTransportMetrics.firstSemanticDeltaMs === 240
        && validProviderTransportMetrics.completedMs === 1_500
        && nonMonotonicProviderTransportMetrics === undefined
        && unknownProviderTransportMetrics === undefined
        && openAiCompatibleToolStreamSource.includes('const requestBody = {')
        && openAiCompatibleToolStreamSource.includes('measureProviderRequestPayload(requestBody, formatted)')
        && openAiCompatibleToolStreamSource.indexOf('firstChunkAtMs = firstChunkAtMs ?? chunkObservedAtMs')
            < openAiCompatibleToolStreamSource.indexOf('if (chunk.usage) {')
        && openAiCompatibleToolStreamSource.includes('hasOpenAICompatibleSemanticDelta(choice)')
        && openAiCompatibleToolStreamSource.includes('buildProviderTransportMetrics({')
        && openAiCompatibleToolStreamSource.includes('...(providerTransportMetrics ? { providerTransportMetrics } : {})'),
    JSON.stringify(validProviderTransportMetrics)
);
let providerRecoveryLedger = recordRuntimeProviderOutputRecoveryAttempt(
    createRuntimeAccountingLedger('2026-08-26T00:00:00.000Z'),
    '2026-08-26T00:00:01.000Z'
);
providerRecoveryLedger = recordRuntimeProviderOutputRecoveryOutcome(
    providerRecoveryLedger,
    'succeeded',
    '2026-08-26T00:00:02.000Z'
);
providerRecoveryLedger = recordRuntimeProviderOutputRecoveryAttempt(
    providerRecoveryLedger,
    '2026-08-26T00:00:03.000Z'
);
providerRecoveryLedger = recordRuntimeProviderOutputRecoveryOutcome(
    providerRecoveryLedger,
    'stream_incomplete',
    '2026-08-26T00:00:04.000Z'
);
const providerRecoveryDigest = buildRuntimeAccountingDigest({
    ledger: providerRecoveryLedger,
    now: '2026-08-26T00:00:04.000Z'
});
const historicalRuntimeAccountingDigest = {
    version: 'runtime-accounting-digest/v0',
    modelCallCount: 1,
    modelFailureCount: 0,
    modelDurationMs: 1200,
    inputTokens: 320,
    outputTokens: 90,
    unreportedUsageCallCount: 0,
    toolCallCount: 1,
    toolFailureCount: 0,
    toolDurationMs: 80,
    recoveryAttemptCount: 0,
    reflexionCount: 0,
    wallTimeMs: 1500,
    stageBuckets: [],
    costEstimate: { status: 'not_configured' },
    boundaries: {
        digestOnly: true,
        observationOnly: true,
        reportedUsageOnly: true,
        missingUsageNotEstimated: true,
        enforcesBudget: false,
        grantsPermission: false,
        changesTaskResult: false
    }
};
check(
    'Provider 输出恢复分别记录真实请求、成功与失败，真实历史 v0 摘要保持可读',
    providerRecoveryDigest.providerOutputRecoveryAttemptCount === 2
        && providerRecoveryDigest.providerOutputRecoverySuccessCount === 1
        && providerRecoveryDigest.providerOutputRecoveryFailureCount === 1
        && providerRecoveryDigest.providerOutputRecoveryFailureCounts.stream_incomplete === 1
        && providerRecoveryDigest.recoveryAttemptCount === 2
        && validateRuntimeAccountingDigest(providerRecoveryDigest).ok === true
        && validateRuntimeAccountingDigest(historicalRuntimeAccountingDigest).ok === false
        && validatePersistedRuntimeAccountingDigest(historicalRuntimeAccountingDigest).ok === true
);
const unclosedProviderRecoveryDigest = buildRuntimeAccountingDigest({
    ledger: recordRuntimeProviderOutputRecoveryAttempt(
        createRuntimeAccountingLedger('2026-08-26T00:00:00.000Z'),
        '2026-08-26T00:00:01.000Z'
    ),
    now: '2026-08-26T00:00:01.000Z'
});
const forgedRecoveryDigest = {
    ...providerRecoveryDigest,
    providerOutputRecoveryAttemptCount: providerRecoveryDigest.recoveryAttemptCount + 1
};
check(
    'Provider 输出恢复子计数不能超过总恢复事实，staged Run 复用同一严格校验器',
    validateRuntimeAccountingDigest(forgedRecoveryDigest).ok === false
        && validateRuntimeAccountingDigest(unclosedProviderRecoveryDigest).ok === false
        && agentRunRecordSource.includes('validatePersistedRuntimeAccountingDigest(\n            r.runtimeSession.accounting')
);
const noSpaceSse = new ProviderSseDecoder();
const noSpaceEvents = noSpaceSse.push('data:{"choices":[{"finish_reason":"stop"}]}\n\n');
const tailSse = new ProviderSseDecoder();
const tailEventsBeforeEnd = tailSse.push('data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"}"}}]}}]}');
const tailEventsAfterEnd = tailSse.finish();
const bomSse = new ProviderSseDecoder();
const bomEvents = bomSse.push('\ufeffdata: {"choices":[{"delta":{"content":"首帧"}}]}\n\n');
const utf8Sse = new ProviderSseDecoder();
const utf8StringDecoder = new StringDecoder('utf8');
const utf8Payload = Buffer.from('data: {"choices":[{"delta":{"content":"中文"}}]}\n\n', 'utf8');
const firstChineseByte = utf8Payload.indexOf(Buffer.from('中', 'utf8'));
const utf8Events = [
    ...utf8Sse.push(utf8StringDecoder.write(utf8Payload.subarray(0, firstChineseByte + 1))),
    ...utf8Sse.push(utf8StringDecoder.write(utf8Payload.subarray(firstChineseByte + 1))),
    ...utf8Sse.push(utf8StringDecoder.end()),
    ...utf8Sse.finish()
];
let oversizedSseRejected = false;
try {
    new ProviderSseDecoder().push(`data: ${'x'.repeat(4 * 1024 * 1024 + 1)}`);
} catch (error) {
    oversizedSseRejected = error?.code === 'provider_sse_frame_too_large';
}
check(
    '共享 SSE 解码器保留 BOM 首帧、跨 Buffer 中文并在 HTTP end 消费无尾换行帧',
    noSpaceEvents.length === 1
        && JSON.parse(noSpaceEvents[0]).choices[0].finish_reason === 'stop'
        && tailEventsBeforeEnd.length === 0
        && tailEventsAfterEnd.length === 1
        && JSON.parse(tailEventsAfterEnd[0]).choices[0].delta.tool_calls[0].function.arguments === '}'
        && JSON.parse(bomEvents[0]).choices[0].delta.content === '首帧'
        && JSON.parse(utf8Events[0]).choices[0].delta.content === '中文'
        && oversizedSseRejected === true
        && streamAdapterSource.includes("import { ProviderSseDecoder } from './provider-sse-decoder'")
        && modelServiceSource.includes("import { ProviderSseDecoder } from './provider-sse-decoder'")
        && streamAdapterSource.includes('SSE 响应无效')
        && modelServiceSource.includes("fail(error instanceof Error ? error : new Error('OpenRouter SSE 响应无效'))")
);
class TerminalProbeAdapter extends BaseStreamAdapter {
    stream() {
        this.beginStream();
        this.emitDone({ text: '完整', stopReason: 'end_turn' });
        this.emitError('迟到错误');
    }
}
const terminalProbe = new TerminalProbeAdapter();
const terminalProbeChunks = [];
terminalProbe.on('chunk', (chunk) => terminalProbeChunks.push(chunk));
terminalProbe.stream();
check(
    '普通 Provider 流只允许一个终态，done 后迟到 error 不会再次发出',
    terminalProbeChunks.length === 1 && terminalProbeChunks[0].type === 'done'
);
const abortProbe = new TerminalProbeAdapter();
const abortProbeChunks = [];
abortProbe.on('chunk', (chunk) => abortProbeChunks.push(chunk));
abortProbe.abort();
abortProbe.abort();
check(
    '主动取消只发出一个 error 终态，不把取消伪装成 done',
    abortProbeChunks.length === 1
        && abortProbeChunks[0].type === 'error'
        && abortProbeChunks[0].error.includes('已取消')
);
check(
    'Agent 运行级取消直接终止当前 renderer 流句柄，不把 AbortSignal 经 IPC 序列化',
    agentToolStreamSource.includes("signal?.addEventListener('abort', handleAbort, { once: true })")
        && agentToolStreamSource.includes('void handle.abort().catch(() => undefined)')
        && agentToolStreamSource.includes('if (signal?.aborted) handleAbort()')
        && autonomousExecutor.includes('signal: runSignal')
        && autonomousExecutor.includes('if (runSignal?.aborted) throw createAutonomousModelStreamAbortError()')
        && autonomousExecutor.includes('runtimeActivity,\n                    signal')
        && agentRuntime.includes('if (this.config.signal?.aborted) continue agentLoop;')
        && !preloadSource.includes('signal: AbortSignal')
);
check(
    '普通文本流只在明确完整终态后一次性提交 Message Store，失败时丢弃临时缓冲',
    streamChatSource.includes('Provider 原始内容增量不进入 Message Store')
        && streamChatSource.includes('const committedText = response.text;')
        && !streamChatSource.includes('response.text || fullContent')
        && streamChatSource.indexOf('onProgress?.(committedText, committedText)')
            > streamChatSource.indexOf('isProviderStreamOutputBlocked(response.stopReason)')
        && !streamChatSource.slice(
            streamChatSource.indexOf('onContent: (content) =>'),
            streamChatSource.indexOf('refreshStreamInactivityTimeout();', streamChatSource.indexOf('onThinking:'))
        ).includes('onProgress?.(')
);
check(
    '带工具模型流同样不把原始 content delta 回退晋升为终稿',
    agentToolStreamSource.includes('content: response.content,')
        && !agentToolStreamSource.includes('response.content ?? fullContent')
        && !agentToolStreamSource.includes('response.content || fullContent')
);
const previousWindow = global.window;
let privateReasoningStreamListener = null;
const privateReasoningContentCommits = [];
const privateReasoningThinkingCommits = [];
global.window = {
    designEcho: {
        onStreamChunk(listener) {
            privateReasoningStreamListener = listener;
        },
        async chatStream({ requestId }) {
            queueMicrotask(() => {
                privateReasoningStreamListener?.({
                    requestId,
                    chunk: {
                        type: 'content',
                        content: '<think>私有推理</think>'
                    }
                });
                privateReasoningStreamListener?.({
                    requestId,
                    chunk: {
                        type: 'done',
                        fullResponse: {
                            text: '',
                            thinking: '私有推理',
                            stopReason: 'end_turn'
                        }
                    }
                });
            });
            return { success: true };
        },
        async abortStream() {}
    }
};
let privateReasoningStreamResult;
try {
    const { streamChatAsync } = require(path.join(root, 'src/renderer/services/stream-chat.service.ts'));
    privateReasoningStreamResult = await streamChatAsync(
        'private-reasoning-probe',
        [{ role: 'user', content: '测试' }],
        {
            onProgress(content, chunk) {
                privateReasoningContentCommits.push({ content, chunk });
            },
            onThinkingProgress(thinking, chunk) {
                privateReasoningThinkingCommits.push({ thinking, chunk });
            }
        }
    );
} finally {
    global.window = previousWindow;
}
check(
    '终态清洗正文为空时不回退提交原始 think 增量，私有推理只进入 thinking 通道',
    privateReasoningStreamResult?.text === ''
        && privateReasoningStreamResult?.thinking === '私有推理'
        && privateReasoningContentCommits.length === 0
        && privateReasoningThinkingCommits.length === 1
        && privateReasoningThinkingCommits[0].thinking === '私有推理'
        && privateReasoningThinkingCommits[0].chunk === '私有推理',
    JSON.stringify({
        result: privateReasoningStreamResult,
        contentCommits: privateReasoningContentCommits,
        thinkingCommits: privateReasoningThinkingCommits
    })
);
let toolStreamListener = null;
const toolStreamRawDeltas = [];
global.window = {
    designEcho: {
        onStreamChunk(listener) {
            toolStreamListener = listener;
        },
        async chatWithToolsStream({ requestId }) {
            queueMicrotask(() => {
                toolStreamListener?.({
                    requestId,
                    chunk: { type: 'content_delta', content: 'RAW_PARTIAL' }
                });
                toolStreamListener?.({
                    requestId,
                    chunk: {
                        type: 'done',
                        response: { stopReason: 'end_turn', toolCalls: [] }
                    }
                });
            });
            return { success: true };
        },
        async abortStream() {}
    }
};
let toolStreamMissingTerminalContentResult;
try {
    const toolStreamModulePath = require.resolve(path.join(
        root,
        'src/renderer/services/agent-tool-stream.service.ts'
    ));
    delete require.cache[toolStreamModulePath];
    const { streamChatWithToolsAsync } = require(toolStreamModulePath);
    toolStreamMissingTerminalContentResult = await streamChatWithToolsAsync(
        'tool-stream-commit-probe',
        [{ role: 'user', content: '测试' }],
        [],
        {
            onContentDelta(fullContent, delta) {
                toolStreamRawDeltas.push({ fullContent, delta });
            }
        }
    );
} finally {
    global.window = previousWindow;
}
check(
    '工具流终态缺少 content 时丢弃原始增量，不把 RAW_PARTIAL 写回 Agent 响应',
    toolStreamRawDeltas.length === 1
        && toolStreamRawDeltas[0].fullContent === 'RAW_PARTIAL'
        && toolStreamRawDeltas[0].delta === 'RAW_PARTIAL'
        && toolStreamMissingTerminalContentResult?.content === undefined,
    JSON.stringify({
        result: toolStreamMissingTerminalContentResult,
        rawDeltas: toolStreamRawDeltas
    })
);
check(
    'Claude 订阅文本必须有显式 success，Tool 只能消费 MCP handler 捕获的完整参数',
    claudeSubscriptionSource.includes("resultSubtype !== 'success'")
        && claudeSubscriptionSource.includes('const toolCalls = benignEnd ? handlerToolCalls : []')
        && claudeSubscriptionSource.includes("missingTerminal ? 'model_output_incomplete'")
        && !claudeSubscriptionSource.includes(': blockToolCalls.map((call) => ({')
);
check(
    'Plain Provider 的结构化不完整错误跨外围 catch 保留，HTTP 200 error 帧不会伪装成截断',
    modelServiceSource.includes('if (isModelOutputIncompleteError(e))')
        && modelServiceSource.includes('if (isModelOutputIncompleteError(error)) throw error;')
        && modelServiceSource.includes('if (parsed?.error)')
        && modelServiceSource.includes('transportComplete: input.transportComplete')
        && (modelServiceSource.match(/transportComplete: parsed\.done === true/g) || []).length === 2
        && modelServiceSource.includes('transportComplete: data.done === true')
        && streamAdapterSource.includes('流返回错误')
);
const reasoningPromptShape = measureRuntimePromptShape({
    messages: [{ role: 'assistant', content: '公开内容', reasoningContent: '隐藏推理内容' }],
    tools: []
});
check(
    'Prompt 体量诊断把 Provider reasoning_content 计入历史而不是低报上下文',
    reasoningPromptShape.reasoningChars === '隐藏推理内容'.length
        && reasoningPromptShape.historyChars === '公开内容'.length + '隐藏推理内容'.length
);

const narrowUniformScaleMetrics = buildSkuRetouchUniformScaleMetrics({
    originalSubjectWidth: 100,
    originalSubjectHeight: 200,
    outputSubjectWidth: 75,
    outputSubjectHeight: 150,
    targetSubjectHeight: 150
});
const wideUniformScaleMetrics = buildSkuRetouchUniformScaleMetrics({
    originalSubjectWidth: 80,
    originalSubjectHeight: 100,
    outputSubjectWidth: 120,
    outputSubjectHeight: 150,
    targetSubjectHeight: 150
});
check(
    'SKU v2 只做等比统一尺度，并以结构化指标证明同高、保比例和无旧精修参数',
    narrowUniformScaleMetrics.subjectHeightUniform === true
        && narrowUniformScaleMetrics.aspectRatioPreserved === true
        && wideUniformScaleMetrics.subjectHeightUniform === true
        && wideUniformScaleMetrics.aspectRatioPreserved === true
        && narrowUniformScaleMetrics.outputSubjectWidth !== wideUniformScaleMetrics.outputSubjectWidth
        && skuRetouchContractSource.includes("sku-retouch-report/v2")
        && skuRetouchServiceSource.includes('buildSubjectCropPlan(item, referenceSubjectHeight)')
        && skuRetouchServiceSource.includes('.resize({ height: cropPlan.targetHeight')
        && skuRetouchServiceSource.includes('Math.abs(subjectHeight - referenceSubjectHeight) > 1')
        && skuRetouchServiceSource.includes('sourcePixelsPreserved')
        && skuRetouchServiceSource.includes('outputEdgesClear')
        && !skuRetouchServiceSource.includes('warpSkuRetouchSource')
        && !skuRetouchServiceSource.includes('shapeStrength')
        && !skuRetouchServiceSource.includes('lightingStrength')
        && !skuRetouchServiceSource.includes('shadowPath')
        && !skuRetouchServiceSource.includes('neutralGrayPath')
        && skuColorCardExecutorSource.includes('uniformScalePlacementVerified')
        && manualSkuColorCardBridgeSource.includes('card.uniformScalePlacementVerified === true')
        && !skuRetouchToolSchemaSlice.includes('shapeStrength')
        && !skuRetouchToolSchemaSlice.includes('lightingStrength')
        && !skuColorCardManifestSource.includes('独立原影')
        && !skuColorCardRetouchStrategySource.includes("id: 'light_retouch'")
        && !skuColorCardRetouchStrategySource.includes("id: 'shadow_isolation'")
        && !skuColorCardRetouchStrategySource.includes('minor_warp_for_body_axis')
        && !skuVisualReviewIntakeSource.includes('核对中性灰式光影修正后')
        && !toolDependenciesSource.includes('形态、原影和中性灰精修资产')
);
check(
    'SKU 色卡在首次 Photoshop 写入前检查全部源文件，flat 剪切保持 not_applicable，置入身份要求新版 UXP 证明',
    skuColorCardExecutorSource.indexOf('const sourceFilePreflight = await preflightSkuSourceFilesBeforePhotoshopWrite(')
        < skuColorCardExecutorSource.indexOf("callTool('createDocument'")
        && skuColorCardExecutorSource.includes("'source-file-preflight'")
        && skuColorCardExecutorSource.includes('probeImageFile(source.filePath)')
        && skuColorCardExecutorSource.includes('analyzePsdDesignSource(source.filePath)')
        && skuColorCardExecutorSource.includes('clippingRequired: false')
        && skuColorCardExecutorSource.includes('clippingVerified: false')
        && skuColorCardExecutorSource.includes('resolveClippingStructureCheck(preparedCards)')
        && skuColorCardContractSource.includes("identityProofVersion === 'place-image-source-identity/v1'")
        && skuColorCardContractSource.includes('input.placedSource.identityVerified === true')
        && skuColorCardContractSource.includes('Number.isSafeInteger(input.observedDocumentId)'),
    'SKU source preflight, clipping N/A, or current UXP placement identity proof is missing.'
);
check(
    'SKU 色卡公开失败说明只交代用户可理解的进度与文件状态，工程诊断仍保留在 error 和报告中',
    skuColorCardExecutorSource.includes('buildSkuColorCardPublicFailureMessage')
        && skuColorCardExecutorSource.includes('detail: userMessage')
        && skuColorCardExecutorSource.includes('message: userMessage')
        && skuColorCardExecutorSource.includes('error: userMessage')
        && !skuColorCardExecutorSource.includes('message: `SKU 色卡没有完成：${error}`')
);
const producerArtifactReceipt = buildRuntimeDeliveryReceipt({
    status: 'ready',
    settlementScope: 'single_document_revision',
    outputs: ['main_image_preview'],
    resultRefs: ['producer-export'],
    sourceHistoryStateRef: { documentId: 7, historyStateId: 20 },
    artifacts: [{
        path: 'C:/fixture/SKU/最终-1.jpg',
        kind: 'raster_export',
        proof: 'file_probe'
    }]
});
const oldProducerArtifactReceipt = buildRuntimeDeliveryReceipt({
    status: 'ready',
    settlementScope: 'single_document_revision',
    outputs: ['main_image_preview'],
    resultRefs: ['old-producer-export'],
    sourceHistoryStateRef: { documentId: 7, historyStateId: 19 },
    artifacts: [{
        path: 'C:/fixture/SKU/旧候选.jpg',
        kind: 'raster_export',
        proof: 'file_probe'
    }]
});
const wrongTargetProducerArtifactReceipt = buildRuntimeDeliveryReceipt({
    status: 'ready',
    settlementScope: 'single_document_revision',
    outputs: ['main_image_preview'],
    resultRefs: ['wrong-target-export'],
    sourceHistoryStateRef: { documentId: 8, historyStateId: 20 },
    artifacts: [{
        path: 'C:/fixture/SKU/其他文档候选.jpg',
        kind: 'raster_export',
        proof: 'file_probe'
    }]
});
const finalArtifactSettlementEntries = [{
    callId: 'old-skill-call',
    name: 'main-image-design',
    result: {
        success: true,
        data: { runtimeDeliveryReceipt: oldProducerArtifactReceipt }
    }
}, {
    callId: 'skill-call',
    name: 'main-image-design',
    result: {
        success: true,
        data: {
            runtimeDeliveryReceipt: producerArtifactReceipt,
            unrelatedPreviewPath: 'C:/fixture/SKU/过程预览.jpg'
        }
    }
}, {
    callId: 'psd-save-call',
    name: 'saveDocument',
    result: {
        success: true,
        sourceHistoryStateRef: { documentId: 7, historyStateId: 20 },
        savedPath: 'C:/fixture/SKU/最终可编辑.psd',
        editableDocumentArtifact: {
            path: 'C:/fixture/SKU/最终可编辑.psd'
        }
    }
}, {
    callId: 'unselected-call',
    name: 'quickExport',
    result: { success: true, outputPath: 'C:/fixture/SKU/未声明.jpg' }
}];
const collectedFinalArtifactPaths = collectRuntimeFinalArtifactPaths({
    entries: finalArtifactSettlementEntries,
    resultRefs: ['psd-save-call'],
    producerReceiptCallRefs: ['old-skill-call', 'skill-call'],
    includeProducerReceipts: true
});
const collectedBatchArtifactPaths = collectRuntimeFinalArtifactPaths({
    entries: [{
        callId: 'batch-export-call',
        name: 'batchExport',
        result: {
            success: true,
            sourceHistoryStateRef: { documentId: 7, historyStateId: 20 },
            data: {
                exportedFiles: [
                    { filePath: 'C:/fixture/SKU/最终-2.jpg' },
                    { path: 'C:/fixture/SKU/最终-3.png' }
                ]
            }
        }
    }],
    resultRefs: ['batch-export-call'],
    includeProducerReceipts: false
});
const collectedSingleCompositePaths = collectRuntimeFinalArtifactPaths({
    entries: [finalArtifactSettlementEntries[1]],
    resultRefs: ['producer-export'],
    producerReceiptCallRefs: ['skill-call'],
    producerReceiptE2CallRefs: ['skill-call'],
    includeProducerReceipts: true
});
function buildSkuInventoryBoundaryFixture(rowCount) {
    return buildSkuExpectedExportInventory({
        outputDir: 'C:\\fixture\\SKU',
        specs: [{
            size: 2,
            comboTemplateName: '2双装',
            combos: Array.from({ length: rowCount }, (_, index) => ([
                `颜色${index + 1}甲`,
                `颜色${index + 1}乙`
            ]))
        }]
    });
}
function buildSkuReceiptBoundaryFixture(rowCount) {
    const resultRefs = Array.from({ length: rowCount }, (_, index) => `sku-row-${index + 1}`);
    return buildRuntimeDeliveryReceipt({
        status: 'ready',
        settlementScope: 'multi_document_task',
        outputs: ['sku_images', 'editable_sku_batch_documents'],
        resultRefs,
        resultRefProofs: resultRefs.map((resultRef) => ({ resultRef, effect: 'save_export' })),
        artifacts: resultRefs.flatMap((_, index) => ([{
            path: `C:/fixture/SKU/${index + 1}.jpg`,
            kind: 'raster_export',
            proof: 'file_probe',
            fileIdentity: { sha256: (index + 1).toString(16).padStart(64, '0'), byteLength: 10_000 + index },
            sourceHistoryStateRef: { documentId: index + 1, historyStateId: 101 + index }
        }, {
            path: `C:/fixture/SKU/可编辑/${index + 1}.psb`,
            kind: 'editable_document',
            proof: 'staged_editable_document_promotion',
            fileIdentity: { sha256: (index + 101).toString(16).padStart(64, '0'), byteLength: 20_000 + index },
            sourceHistoryStateRef: { documentId: index + 1, historyStateId: 101 + index }
        }]))
    });
}
const skuInventory32 = buildSkuInventoryBoundaryFixture(32);
const skuInventory33 = buildSkuInventoryBoundaryFixture(33);
const skuInventory48 = buildSkuInventoryBoundaryFixture(48);
const skuInventory49 = buildSkuInventoryBoundaryFixture(49);
const skuReceipt32 = buildSkuReceiptBoundaryFixture(32);
const skuReceipt33 = buildSkuReceiptBoundaryFixture(33);
const skuReceipt48 = buildSkuReceiptBoundaryFixture(48);
const skuReceipt49 = buildSkuReceiptBoundaryFixture(49);
const emptyMultiDocumentReceipt = buildRuntimeDeliveryReceipt({
    status: 'ready',
    settlementScope: 'multi_document_task',
    outputs: ['sku_images'],
    resultRefs: ['sku-empty'],
    resultRefProofs: [{ resultRef: 'sku-empty', effect: 'save_export' }],
    artifacts: []
});
check(
    'SKU 2N 交付容量在 32/33/48 行保持完整，49 行与空 artifact fail closed',
    skuInventory32.status === 'ready'
        && skuInventory33.status === 'ready'
        && skuInventory48.status === 'ready'
        && skuInventory48.items.length === 48
        && skuInventory49.status === 'blocked'
        && skuInventory49.blockers.some((message) => message.includes('最多支持 48 行'))
        && skuReceipt32.status === 'ready'
        && skuReceipt32.artifacts.length === 64
        && skuReceipt33.status === 'ready'
        && skuReceipt33.artifacts.length === 66
        && skuReceipt48.status === 'ready'
        && skuReceipt48.artifacts.length === 96
        && skuReceipt49.status === 'incomplete'
        && emptyMultiDocumentReceipt.status === 'incomplete'
);
check(
    'SKU 文件安全故障保留私有诊断与恢复位置，但公开说明不口播主进程、基线或事务术语',
    skuBatchExecutorSource.includes('无法安全准备本次 SKU 输出，本次尚未开始制作。')
        && skuBatchExecutorSource.includes('为避免误覆盖，本次尚未开始制作。')
        && skuBatchExecutorSource.includes('已保留可恢复文件')
        && skuBatchExecutorSource.includes('error: userMessage')
        && !skuBatchExecutorSource.includes('受主进程保护的 SKU 文件事务')
        && !skuBatchExecutorSource.includes('SKU 导出文件的执行前基线')
        && !skuBatchExecutorSource.includes('stagingCleanupNotices.join(')
);
const skuBatchRasterPaths = Array.from(
    { length: 19 },
    (_, index) => `C:/fixture/SKU/${String(index + 1).padStart(2, '0')}.jpg`
);
const skuBatchEditablePaths = skuBatchRasterPaths.map((artifactPath, index) => (
    `C:/fixture/SKU/可编辑/${String(index + 1).padStart(2, '0')}.psb`
));
const skuRuntimeDeliveryResultRefs = skuBatchRasterPaths.map((_, index) => (
    `workflow:sku-batch:export:${index + 1}`
));
const multiDocumentSkuReceipt = buildRuntimeDeliveryReceipt({
    status: 'ready',
    settlementScope: 'multi_document_task',
    outputs: ['editable_sku_batch_documents', 'sku_images'],
    resultRefs: skuRuntimeDeliveryResultRefs,
    resultRefProofs: skuRuntimeDeliveryResultRefs.map((resultRef) => ({
        resultRef,
        effect: 'save_export'
    })),
    artifacts: skuBatchRasterPaths.flatMap((artifactPath, index) => ([{
        path: artifactPath,
        kind: 'raster_export',
        proof: 'file_probe',
        fileIdentity: { sha256: (index + 1).toString(16).padStart(64, '0'), byteLength: 10_000 + index },
        sourceHistoryStateRef: { documentId: index + 1, historyStateId: 101 + index }
    }, {
        path: skuBatchEditablePaths[index],
        kind: 'editable_document',
        proof: 'staged_editable_document_promotion',
        fileIdentity: { sha256: (index + 101).toString(16).padStart(64, '0'), byteLength: 20_000 + index },
        sourceHistoryStateRef: { documentId: index + 1, historyStateId: 101 + index }
    }]))
});
const multiDocumentSkuEntries = [{
    callId: 'sku-batch-producer',
    name: 'sku-batch',
    result: {
        success: true,
        data: { runtimeDeliveryReceipt: multiDocumentSkuReceipt }
    }
}, {
    callId: 'sku-psd-save',
    name: 'saveDocument',
    result: {
        success: true,
        sourceHistoryStateRef: { documentId: 88, historyStateId: 901 },
        savedPath: 'C:/fixture/SKU/SKU批量可编辑.psb',
        editableDocumentArtifact: { path: 'C:/fixture/SKU/SKU批量可编辑.psb' }
    }
}];
const collectedMultiDocumentSkuPaths = collectRuntimeFinalArtifactPaths({
    entries: multiDocumentSkuEntries,
    resultRefs: ['sku-psd-save'],
    producerReceiptCallRefs: ['sku-batch-producer'],
    includeProducerReceipts: true
});
const collectedStagedSkuPaths = collectRuntimeFinalArtifactPaths({
    entries: [multiDocumentSkuEntries[0]],
    resultRefs: skuRuntimeDeliveryResultRefs,
    producerReceiptCallRefs: ['sku-batch-producer'],
    producerReceiptE2CallRefs: ['sku-batch-producer'],
    includeProducerReceipts: true
});
check(
    '单文档按最终 revision、多文档按最后 mutation + E2 save/export 结算，旧收据不会混入',
    collectedFinalArtifactPaths.length === 2
        && collectedFinalArtifactPaths.includes('C:/fixture/SKU/最终-1.jpg')
        && collectedFinalArtifactPaths.includes('C:/fixture/SKU/最终可编辑.psd')
        && !collectedFinalArtifactPaths.includes('C:/fixture/SKU/旧候选.jpg')
        && !collectedFinalArtifactPaths.includes('C:/fixture/SKU/过程预览.jpg')
        && !collectedFinalArtifactPaths.includes('C:/fixture/SKU/未声明.jpg')
        && collectedBatchArtifactPaths.length === 2
        && collectedBatchArtifactPaths.includes('C:/fixture/SKU/最终-2.jpg')
        && collectedBatchArtifactPaths.includes('C:/fixture/SKU/最终-3.png')
        && collectedSingleCompositePaths.length === 1
        && collectedSingleCompositePaths[0] === 'C:/fixture/SKU/最终-1.jpg'
        && collectedMultiDocumentSkuPaths.length === 1
        && !skuBatchRasterPaths.some((artifactPath) => (
            collectedMultiDocumentSkuPaths.includes(artifactPath)
        ))
        && !skuBatchEditablePaths.some((artifactPath) => (
            collectedMultiDocumentSkuPaths.includes(artifactPath)
        ))
        && collectedMultiDocumentSkuPaths.includes('C:/fixture/SKU/SKU批量可编辑.psb')
        && collectedStagedSkuPaths.length === 38
        && skuBatchRasterPaths.every((artifactPath) => collectedStagedSkuPaths.includes(artifactPath))
        && skuBatchEditablePaths.every((artifactPath) => collectedStagedSkuPaths.includes(artifactPath))
        && !collectedStagedSkuPaths.includes('C:/fixture/SKU/SKU批量可编辑.psb')
        && collectRuntimeFinalArtifactPaths({
            entries: [multiDocumentSkuEntries[0]],
            resultRefs: skuRuntimeDeliveryResultRefs,
            producerReceiptCallRefs: ['sku-batch-producer'],
            includeProducerReceipts: true
        }).length === 0
        && !collectRuntimeFinalArtifactPaths({
            entries: [
                ...multiDocumentSkuEntries,
                {
                    callId: 'sku-later-content-write',
                    name: 'setTextContent',
                    result: { success: true, activeDocumentId: 88 }
                }
            ],
            resultRefs: ['sku-psd-save'],
            producerReceiptCallRefs: ['sku-batch-producer'],
            includeProducerReceipts: true
        }).includes(skuBatchRasterPaths[0])
        && !collectRuntimeFinalArtifactPaths({
            entries: [
                multiDocumentSkuEntries[0],
                {
                    callId: 'not-a-delivery-result',
                    name: 'getDocumentInfo',
                    result: {
                        success: true,
                        historyStateRef: { documentId: 88, historyStateId: 901 }
                    }
                }
            ],
            resultRefs: ['not-a-delivery-result'],
            producerReceiptCallRefs: ['sku-batch-producer'],
            includeProducerReceipts: true
        }).includes(skuBatchRasterPaths[0])
        && collectRuntimeFinalArtifactPaths({
            entries: [finalArtifactSettlementEntries[1]],
            resultRefs: [],
            producerReceiptCallRefs: ['skill-call'],
            includeProducerReceipts: true
        }).includes('C:/fixture/SKU/最终-1.jpg')
        && !collectRuntimeFinalArtifactPaths({
            entries: [finalArtifactSettlementEntries[1]],
            resultRefs: [],
            producerReceiptCallRefs: [],
            includeProducerReceipts: true
        }).includes('C:/fixture/SKU/最终-1.jpg')
        && !collectRuntimeFinalArtifactPaths({
            entries: [
                ...finalArtifactSettlementEntries.slice(1, 3),
                {
                    callId: 'later-mutation',
                    name: 'createRectangle',
                    result: { success: true, activeDocumentId: 7 }
                }
            ],
            resultRefs: ['psd-save-call'],
            producerReceiptCallRefs: ['skill-call'],
            includeProducerReceipts: true
        }).includes('C:/fixture/SKU/最终-1.jpg')
        && !collectRuntimeFinalArtifactPaths({
            entries: [{
                callId: 'wrong-target-skill',
                name: 'main-image-design',
                result: {
                    success: true,
                    data: { runtimeDeliveryReceipt: wrongTargetProducerArtifactReceipt }
                }
            }, finalArtifactSettlementEntries[2]],
            resultRefs: ['psd-save-call'],
            producerReceiptCallRefs: ['wrong-target-skill'],
            includeProducerReceipts: true
        }).includes('C:/fixture/SKU/其他文档候选.jpg')
        && collectRuntimeFinalArtifactPaths({
            entries: [{
                callId: 'skill-call',
                name: 'main-image-design',
                result: { success: true, data: { runtimeDeliveryReceipt: producerArtifactReceipt } }
            }],
            resultRefs: [],
            producerReceiptCallRefs: ['skill-call'],
            includeProducerReceipts: false
        }).length === 0
);

const editableExpectedItem = {
    id: 'combo:2:1',
    kind: 'combo',
    size: 2,
    rowIndex: 1,
    combination: ['白色', '黑色'],
    templateName: '2双装',
    fileName: '1白色+黑色.jpg',
    path: 'C:\\fixture\\SKU\\2双装\\1白色+黑色.jpg',
    editableFileName: '1白色+黑色.psb',
    editablePath: 'C:\\fixture\\SKU\\可编辑\\2双装\\1白色+黑色.psb'
};
const currentPairedEditableCapability = {
    success: true,
    data: {
        pairedEditableDelivery: {
            revision: 'sku-paired-editable-delivery/v1',
            deliveryPlanVersion: 'sku-layout-delivery-plan/v1',
            actions: ['execute', 'arrangeDynamic'],
            savesAfterGeometryQa: true,
            savesBeforeCopiedLayerCleanup: true,
            returnsEditableDocumentArtifact: true,
            returnsStructureReadback: true,
            bindsRasterAndEditableHistory: true
        }
    }
};
check(
    '旧 UXP 未声明逐行 JPG/PSB 配对能力时必须在首次写入前失败关闭',
    supportsSkuPairedEditableDelivery(currentPairedEditableCapability) === true
        && supportsSkuPairedEditableDelivery({ success: true, data: {} }) === false
        && supportsSkuPairedEditableDelivery({
            ...currentPairedEditableCapability,
            data: {
                pairedEditableDelivery: {
                    ...currentPairedEditableCapability.data.pairedEditableDelivery,
                    bindsRasterAndEditableHistory: false
                }
            }
        }) === false
);
const editableStagedPath = 'C:\\fixture\\SKU\\.designecho-staging\\run-1\\可编辑\\2双装\\1白色+黑色.psb';
const editableToolRecord = {
    success: true,
    deliveryItemId: editableExpectedItem.id,
    savedPath: editableStagedPath,
    format: 'psb',
    sourceHistoryStateRef: { documentId: 91, historyStateId: 707 },
    rasterSourceHistoryStateRef: { documentId: 91, historyStateId: 707 },
    editableDocumentArtifact: {
        version: 'runtime-editable-document-artifact/v1',
        basis: 'uxp_post_save_file_metadata',
        path: editableStagedPath,
        format: 'psb',
        byteLength: 4096,
        modifiedAt: Date.now(),
        documentId: 91,
        canvas: { width: 1000, height: 1000 }
    },
    structureReadback: {
        schema: 'sku-editable-structure-readback/v1',
        templateName: '2双装',
        combination: ['白色', '黑色'],
        copiedLayerIds: [301, 302],
        copiedLayerNames: ['SKU_01_白色', 'SKU_02_黑色'],
        flattened: false,
        autoLayoutQaStatus: 'ready'
    }
};
const editableValidationHost = {
    invoke: async (channel) => {
        if (channel === 'fs:exists') return true;
        if (channel === 'fs:getFileInfo') {
            return {
                isFile: true,
                size: 4096,
                modified: new Date().toISOString()
            };
        }
        throw new Error(`unexpected editable validation channel: ${channel}`);
    }
};
const editableValidation = await validateSkuEditableDeliveryResult({
    expected: editableExpectedItem,
    toolResult: {
        success: true,
        data: { editableDocuments: [editableToolRecord] }
    },
    baseline: { path: editableExpectedItem.editablePath, exists: false },
    stagedEditablePath: editableStagedPath,
    host: editableValidationHost
});
const forgedEditableValidation = await validateSkuEditableDeliveryResult({
    expected: editableExpectedItem,
    toolResult: {
        success: true,
        data: {
            editableDocuments: [{
                ...editableToolRecord,
                deliveryItemId: 'combo:2:2'
            }]
        }
    },
    baseline: { path: editableExpectedItem.editablePath, exists: false },
    stagedEditablePath: editableStagedPath,
    host: editableValidationHost
});
const editableRasterIdentity = {
    path: editableExpectedItem.path,
    byteLength: 2048,
    sha256: 'a'.repeat(64)
};
const editableDocumentIdentity = {
    path: editableExpectedItem.editablePath,
    byteLength: 4096,
    sha256: 'b'.repeat(64)
};
const editableCommittedFiles = new Map([
    [normalizeSkuExportPathForCompare(editableExpectedItem.path), editableRasterIdentity],
    [normalizeSkuExportPathForCompare(editableExpectedItem.editablePath), editableDocumentIdentity]
]);
const finalizedEditableValidation = await finalizeSkuEditableDeliveryReceipts({
    receipts: new Map(editableValidation.success
        ? [[editableExpectedItem.id, editableValidation.receipt]]
        : []),
    baselines: new Map([[
        normalizeSkuExportPathForCompare(editableExpectedItem.editablePath),
        { path: editableExpectedItem.editablePath, exists: false }
    ]]),
    committedFiles: editableCommittedFiles,
    host: editableValidationHost
});
const editableReadback = buildSkuEditableDeliveryReadback({
    expectedItems: [editableExpectedItem],
    receipts: finalizedEditableValidation.receipts
});
const provisionalEditableArtifacts = buildSkuRuntimeDeliveryArtifacts({
    expectedItems: [editableExpectedItem],
    rasterFileProbes: [{
        success: true,
        path: editableExpectedItem.path,
        status: 'ok',
        rawImagesRedacted: true,
        freshnessVerified: true,
        byteLength: editableRasterIdentity.byteLength,
        sha256: editableRasterIdentity.sha256
    }],
    editableReceipts: new Map(editableValidation.success
        ? [[editableExpectedItem.id, editableValidation.receipt]]
        : []),
    committedFiles: editableCommittedFiles
});
const finalizedEditableArtifacts = buildSkuRuntimeDeliveryArtifacts({
    expectedItems: [editableExpectedItem],
    rasterFileProbes: [{
        success: true,
        path: editableExpectedItem.path,
        status: 'ok',
        rawImagesRedacted: true,
        freshnessVerified: true,
        byteLength: editableRasterIdentity.byteLength,
        sha256: editableRasterIdentity.sha256
    }],
    editableReceipts: finalizedEditableValidation.receipts,
    committedFiles: editableCommittedFiles
});
const failedRasterProbeArtifacts = buildSkuRuntimeDeliveryArtifacts({
    expectedItems: [editableExpectedItem],
    rasterFileProbes: [{
        success: false,
        path: editableExpectedItem.path,
        status: 'decode_failed',
        rawImagesRedacted: true,
        freshnessVerified: false
    }],
    editableReceipts: finalizedEditableValidation.receipts,
    committedFiles: editableCommittedFiles
});
const replacedRasterProbeArtifacts = buildSkuRuntimeDeliveryArtifacts({
    expectedItems: [editableExpectedItem],
    rasterFileProbes: [{
        success: true,
        path: editableExpectedItem.path,
        status: 'ok',
        rawImagesRedacted: true,
        freshnessVerified: true,
        byteLength: editableRasterIdentity.byteLength,
        sha256: 'c'.repeat(64)
    }],
    editableReceipts: finalizedEditableValidation.receipts,
    committedFiles: editableCommittedFiles
});
const malformedRasterProbeArtifacts = buildSkuRuntimeDeliveryArtifacts({
    expectedItems: [editableExpectedItem],
    rasterFileProbes: [{
        success: true,
        path: editableExpectedItem.path,
        status: 'decode_failed',
        rawImagesRedacted: false,
        freshnessVerified: true
    }],
    editableReceipts: new Map(),
    committedFiles: editableCommittedFiles
});
check(
    'SKU 可编辑源稿必须逐行绑定冻结路径、完整文件身份、组合、图层结构、Photoshop revision 与本轮新鲜度',
    editableValidation.success === true
        && editableReadback.status === 'ready'
        && editableReadback.verifiedCount === 1
        && editableReadback.items.length === 1
        && editableReadback.items[0]?.rasterPath === editableExpectedItem.path
        && editableReadback.items[0]?.editablePath === editableExpectedItem.editablePath
        && editableReadback.items[0]?.sourceHistoryStateRef?.historyStateId === 707
        && forgedEditableValidation.success === false
        && provisionalEditableArtifacts.length === 1
        && provisionalEditableArtifacts[0]?.kind === 'raster_export'
        && finalizedEditableArtifacts.length === 2
        && finalizedEditableArtifacts[1]?.kind === 'editable_document'
        && finalizedEditableArtifacts[1]?.proof === 'staged_editable_document_promotion'
        && failedRasterProbeArtifacts.length === 1
        && failedRasterProbeArtifacts[0]?.kind === 'editable_document'
        && replacedRasterProbeArtifacts.length === 1
        && replacedRasterProbeArtifacts[0]?.kind === 'editable_document'
        && malformedRasterProbeArtifacts.length === 0
);

const skuColorCardSources = [{
    filePath: 'C:\\fixture\\粉色.jpg',
    colorName: '粉色',
    colorNameSource: 'provided'
}, {
    filePath: 'C:\\fixture\\咖色.jpg',
    colorName: '咖色',
    colorNameSource: 'provided'
}];
const missingSkuColorCardDesign = buildSkuColorCardPlan({
    sources: skuColorCardSources,
    outputPath: 'C:\\fixture\\PSD\\SKU.psb'
});
check(
    '正常 SKU 色卡缺少 Agent 设计声明时保持零写入计划',
    missingSkuColorCardDesign.canExecute === false
        && missingSkuColorCardDesign.status === 'blocked_missing_design_spec'
        && missingSkuColorCardDesign.canvas === null
        && missingSkuColorCardDesign.cardStyle === null
        && missingSkuColorCardDesign.imagePlacement === null
        && missingSkuColorCardDesign.slots.length === 0
);
const forgedLegacySkuColorCardDesign = buildSkuColorCardPlan({
    sources: skuColorCardSources,
    outputPath: 'C:\\fixture\\PSD\\SKU.psb',
    designSpec: {
        provenance: 'explicit_legacy_profile'
    }
});
check(
    '模型参数不能伪造手工面板 legacy Profile 授权',
    forgedLegacySkuColorCardDesign.canExecute === false
        && forgedLegacySkuColorCardDesign.status === 'blocked_invalid_design_spec'
        && skuColorCardExecutorSource.includes('MANUAL_SKU_COLOR_CARD_LEGACY_PROFILE_CAPABILITY')
        && skuColorCardExecutorSource.includes('trustedCapabilities.manualLegacyProfile === MANUAL_SKU_COLOR_CARD_LEGACY_PROFILE_CAPABILITY')
        && !skuColorCardExecutorSource.includes('params.__manualPanelLegacyProfileAuthorized')
        && manualSkuColorCardBridgeSource.includes('MANUAL_SKU_COLOR_CARD_LEGACY_PROFILE_CAPABILITY')
        && !manualSkuColorCardBridgeSource.includes('__manualPanelLegacyProfileAuthorized: true')
        && skillToolsSource.includes("'__manualPanelLegacyProfileAuthorized'")
);

check(
    '手工 SKU 色卡桥与结果协议同版本握手，旧 Renderer/UXP 不能冒充 v2 成功',
    manualSkuColorCardContractSource.includes("manual-sku-color-card-result/v2")
        && manualSkuColorCardContractSource.includes("manual-sku-color-card-bridge/v2")
        && manualSkuColorCardHandlerSource.includes('payload.version !== MANUAL_SKU_COLOR_CARD_RESULT_VERSION')
        && uxpIndexSource.includes("MANUAL_SKU_COLOR_CARD_BRIDGE_VERSION = 'manual-sku-color-card-bridge/v2'")
        && uxpIndexSource.includes("MANUAL_SKU_COLOR_CARD_RESULT_VERSION = 'manual-sku-color-card-result/v2'")
        && uxpIndexSource.includes('normalizedResult?.version !== MANUAL_SKU_COLOR_CARD_RESULT_VERSION'),
    'Manual SKU card protocol versions must fail closed across Main, Renderer, and UXP.'
);

const authoredSkuColorCardDesignSpec = {
        provenance: 'agent_authored',
        presentationMode: 'card',
        canvasWidth: 1200,
        canvasHeight: 900,
        canvasBackground: 'transparent',
        cardWidth: 220,
        cardHeight: 320,
        cardCornerRadius: 18,
        columns: 2,
        columnGap: 56,
        rowGap: 44,
        gridAlignment: {
            horizontal: 'end',
            vertical: 'start',
            lastRow: 'center'
        },
        showIndexNumbers: false,
        cardFillColorHex: '#F4EFE8',
        labelFillColorHex: '#FFFFFF',
        labelTextColorHex: '#3A302B',
        internalLabel: {
            xRatio: 0.1,
            yRatio: 0.78,
            widthRatio: 0.8,
            heightRatio: 0.14,
            cornerRadiusToWidthRatio: 0.04,
            fontSizeToHeightRatio: 0.52
        },
        labelTypography: {
            fontName: 'Noto Sans CJK SC',
            tracking: 24,
            leadingToFontSizeRatio: 1.15,
            alignment: 'right',
            horizontalPaddingRatio: 0.1,
            verticalPaddingRatio: 0.08
        },
        imagePlacement: {
            subjectFillRatio: 0.74,
            anchor: 'bottom-center'
        }
};
const authoredSkuColorCardDesign = buildSkuColorCardPlan({
    sources: skuColorCardSources,
    outputPath: 'C:\\fixture\\PSD\\SKU.psb',
    designSpec: authoredSkuColorCardDesignSpec
});
check(
    'Agent 声明的 SKU 画布、对齐、排版、配色、主体占比与锚点原样进入计划',
    authoredSkuColorCardDesign.canExecute === true
        && authoredSkuColorCardDesign.designProvenance === 'agent_authored'
        && authoredSkuColorCardDesign.presentationMode === 'card'
        && authoredSkuColorCardDesign.canvas?.width === 1200
        && authoredSkuColorCardDesign.canvas?.backgroundColor === 'transparent'
        && authoredSkuColorCardDesign.slots[0]?.cardBounds.x === 704
        && authoredSkuColorCardDesign.slots[0]?.cardBounds.y === 0
        && authoredSkuColorCardDesign.slots[0]?.cardBounds.width === 220
        && authoredSkuColorCardDesign.cardStyle?.cornerRadius === 18
        && authoredSkuColorCardDesign.cardStyle?.fillColorHex === '#F4EFE8'
        && authoredSkuColorCardDesign.cardStyle?.labelTextColorHex === '#3A302B'
        && authoredSkuColorCardDesign.cardStyle?.labelTypography.fontName === 'Noto Sans CJK SC'
        && authoredSkuColorCardDesign.cardStyle?.labelTypography.alignment === 'right'
        && authoredSkuColorCardDesign.imagePlacement?.subjectFillRatio === 0.74
        && authoredSkuColorCardDesign.imagePlacement?.anchor === 'bottom-center'
        && authoredSkuColorCardDesign.indexReference.enabled === false
);
const runtimeSelectionReceipt = createSkuColorCardRuntimeSelectionReceipt([{
    assetId: 'asset-selected-by-agent',
    filePath: 'C:\\fixture\\DSC0001.jpg',
    relativePath: '摄影图/DSC0001.jpg'
}]);
const runtimeSelectionBinding = bindSkuColorCardRuntimeSelection([{
    assetId: 'asset-selected-by-agent',
    filePath: 'C:\\fixture\\DSC0001.jpg',
    colorName: '浅灰',
    colorNameSource: 'inferred_candidate'
}], runtimeSelectionReceipt);
check(
    'Runtime assetId 选择收据精确绑定路径，色名不能再次替 Agent 换图',
    runtimeSelectionBinding.applied === true
        && runtimeSelectionBinding.blockers.length === 0
        && runtimeSelectionBinding.sources[0]?.filePath === 'C:\\fixture\\DSC0001.jpg'
        && skuBatchExecutorSource.includes('createSkuColorCardRuntimeSelectionReceipt(')
        && skuColorCardExecutorSource.includes('runtimeSelectionBinding.applied')
        && skuColorCardExecutorSource.includes("method: 'runtime_asset_selection'")
);
const forgedRuntimeSelectionBinding = bindSkuColorCardRuntimeSelection([{
    assetId: 'asset-forged-by-model',
    filePath: 'C:\\fixture\\浅灰.jpg',
    colorName: '浅灰'
}], runtimeSelectionReceipt);
check(
    '模型参数不能伪造或改写 Runtime SKU 素材选择收据',
    forgedRuntimeSelectionBinding.applied === true
        && forgedRuntimeSelectionBinding.sources.length === 0
        && forgedRuntimeSelectionBinding.blockers.length > 0
);
const flatSkuColorCardDesign = buildSkuColorCardPlan({
    sources: skuColorCardSources,
    outputPath: 'C:\\fixture\\PSD\\SKU-flat.psb',
    designSpec: {
        ...authoredSkuColorCardDesignSpec,
        presentationMode: 'flat'
    }
});
check(
    'SKU flat/card 视觉结构由 Agent 显式声明，retouch 结果不再暗中选版式',
    flatSkuColorCardDesign.canExecute === true
        && flatSkuColorCardDesign.presentationMode === 'flat'
        && skuColorCardExecutorSource.includes("if (plan.presentationMode === 'flat')")
        && skuColorCardExecutorSource.includes("'blocked_flat_assets_not_ready'")
        && !skuColorCardExecutorSource.includes('if (isPreparedSkuRetouchSource(earlyRetouchSource))')
        && skuColorCardExecutorSource.includes('retouchedCardImageBounds')
        && !skuColorCardExecutorSource.includes('本子分支实际不可达')
        && !skuColorCardContractSource.includes('C-1183')
        && !skuColorCardContractSource.includes('C-1248')
        && skuColorCardContractSource.includes('presentationQualityCriteria')
        && skillDeclarations.includes("strParam('presentationMode'")
);
check(
    'SKU 文件名与保存边界不再绕过事实和版本安全',
    skuColorCardExecutorSource.includes("name.normalize('NFKC').toLocaleLowerCase('zh-Hans-CN')")
        && skuColorCardExecutorSource.includes("conflictPolicy: 'fail_if_exists'")
        && skuColorCardExecutorSource.includes('afterColorName')
        && skuColorCardExecutorSource.includes("'verify-flat-label-text-fit'")
        && !skuColorCardExecutorSource.includes('labelTextFitVerified: true')
);
const indexedSkuColorCardDesign = buildSkuColorCardPlan({
    sources: skuColorCardSources,
    outputPath: 'C:\\fixture\\PSD\\SKU-indexed.psb',
    designSpec: {
        ...authoredSkuColorCardDesignSpec,
        columns: 3,
        showIndexNumbers: true,
        indexStyle: {
            colorHex: '#6A5147',
            fontName: 'Noto Sans CJK SC',
            tracking: 40,
            leadingToFontSizeRatio: 1.1,
            fontSizeToCardWidthRatio: 0.18,
            xRatio: 0.5,
            yRatio: -0.2,
            alignment: 'center'
        }
    }
});
check(
    'Agent 声明的 SKU 序号样式与位置进入计划，Harness 不再写死大小与颜色',
    indexedSkuColorCardDesign.canExecute === true
        && indexedSkuColorCardDesign.indexReference.style?.colorHex === '#6A5147'
        && indexedSkuColorCardDesign.indexReference.style?.fontSizeToCardWidthRatio === 0.18
        && indexedSkuColorCardDesign.slots[0]?.cardBounds.x === 566
        && indexedSkuColorCardDesign.slots[0]?.indexText?.fontSize === 40
        && indexedSkuColorCardDesign.slots[0]?.indexText?.y === -64
);
check(
    '普通 SKU source preparation 不再写死视觉首稿',
    skuSourcePreparationSlice.includes('colorCardDesignSpec,')
        && skuSourcePreparationSlice.includes('requestedSourceAssetIds')
        && !/canvasWidth:\s*1500|canvasHeight:\s*1500|cardWidth:\s*250|cardHeight:\s*380|cardCornerRadius:\s*10/.test(skuSourcePreparationSlice)
        && skuBatchExecutorSource.includes("status: 'needs_agent_design_spec'")
        && skuBatchExecutorSource.includes('toolResults: []')
        && skuColorCardExecutorSource.includes('subjectFillRatio: plan.imagePlacement.subjectFillRatio')
        && skuColorCardExecutorSource.includes('anchor: plan.imagePlacement.anchor')
        && skuColorCardExecutorSource.includes('targetAnchor: plan.imagePlacement.anchor')
        && !/targetFit:\s*'contain',\s*layerOrder:/.test(skuColorCardExecutorSource)
        && !skuColorCardContractSource.includes('const DEFAULT_CANVAS_WIDTH')
        && skuColorCardContractSource.includes('backgroundColor: designSpec.canvasBackground')
        && skuColorCardContractSource.includes('gridAlignment: { ...designSpec.gridAlignment }')
        && skuColorCardExecutorSource.includes('fontName: plan.cardStyle.labelTypography.fontName')
        && skuColorCardExecutorSource.includes('colorHex: plan.indexReference.style.colorHex')
        && !skuColorCardExecutorSource.includes('colorCardFormatPriority')
        && !skuColorCardExecutorSource.includes('dedupedImages.push(sorted[0])')
        && skuColorCardExecutorSource.includes("status: 'needs_agent_source_selection'")
        && !skillDeclarations.includes("boolParam('colorNamesFromFilename'")
        && !skillDeclarations.includes("numParam('canvasWidth', 'stage=color-card only")
        && skuCardSourcePreparationSource.includes("status: 'ready_for_design_decision'")
        && skuCardSourcePreparationSource.includes('canRunPhotoshopWrites: false')
        && !skuCardSourcePreparationSource.includes('toolRequests')
        && !skuCardSourcePreparationSource.includes("toolName: 'createRectangle'")
        && !skuCardSourcePreparationSource.includes('right.score - left.score')
);

check(
    '内置版式配方实现已删除',
    !fs.existsSync(path.join(root, 'src/shared/layout/layout-recipes.ts'))
);
check(
    '布局引擎不再按 role 固定层级或无条件吸附文字区域',
    !layoutEngineSource.includes('const ROLE_Z')
        && !layoutEngineSource.includes('shouldSnapRegionToColumns(')
        && layoutEngineSource.includes('columnPlacement')
        && toolExecutor.includes('moveModelAuthoredLayerByStackLedger')
        && toolExecutor.includes("position: 'inside-top'")
);
const authoredRegionOrder = solveRegionLayout({
    canvas: { width: 1_000, height: 1_000 },
    regions: [
        { id: '文字在底', role: 'title', content: '标题', hAlign: 'left', bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 } },
        { id: '图片在中', role: 'main-image', content: 'C:/fixture/product.jpg', bounds: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 } },
        { id: '装饰在顶', role: 'decoration', content: 'C:/fixture/decor.png', bounds: { x: 0.7, y: 0.05, width: 0.2, height: 0.2 } },
        { id: '背景', role: 'background', content: '#ffffff', bounds: { x: 0, y: 0, width: 1, height: 1 } }
    ]
});
check(
    '二维正式布局按 Agent 数组顺序叠放非背景图层，背景仅作为公开机械底层例外',
    authoredRegionOrder.blocks.map((block) => block.id).join('|') === '背景|文字在底|图片在中|装饰在顶',
    JSON.stringify(authoredRegionOrder.blocks.map((block) => ({ id: block.id, z: block.z })))
);
const lateBackgroundValidation = validateModelAuthoredLayout({
    mode: 'regions',
    regions: [
        { id: '标题', role: 'title', content: '标题', hAlign: 'left', bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 } },
        { id: '背景', role: 'background', content: '#ffffff', bounds: { x: 0, y: 0, width: 1, height: 1 } }
    ]
});
check(
    'model_authored 背景若不是数组底层会写前失败，不由 Harness 静默重排',
    lateBackgroundValidation.valid === false
        && lateBackgroundValidation.issues.includes('regions[1].role:background_must_precede_visual_layers'),
    JSON.stringify(lateBackgroundValidation)
);
const boundsOwnedRegion = {
    id: '自由标题',
    role: 'title',
    content: '自由构图',
    hAlign: 'left',
    bounds: { x: 0.123, y: 0.15, width: 0.333, height: 0.12 }
};
const noColumnPlacement = solveRegionLayout({
    canvas: { width: 1_000, height: 1_000 },
    columns: 4,
    marginScale: 2,
    gutterScale: 2,
    regions: [boundsOwnedRegion]
});
const explicitColumnPlacement = solveRegionLayout({
    canvas: { width: 1_000, height: 1_000 },
    columns: 4,
    marginScale: 2,
    gutterScale: 2,
    regions: [{ ...boundsOwnedRegion, columnPlacement: { start: 2, span: 2 } }]
});
check(
    'columns 只建立网格；没有 columnPlacement 时 Harness 不改 Agent 的 x/width',
    noColumnPlacement.blocks[0]?.x === 123
        && noColumnPlacement.blocks[0]?.width === 333
        && explicitColumnPlacement.blocks[0]?.x !== 123
        && explicitColumnPlacement.blocks[0]?.width !== 333,
    JSON.stringify({ noColumnPlacement, explicitColumnPlacement })
);
const invalidColumnPlacement = validateModelAuthoredLayout({
    mode: 'regions',
    columns: 4,
    marginScale: 2,
    gutterScale: 2,
    regions: [{ ...boundsOwnedRegion, columnPlacement: { start: 4, span: 2 } }]
});
check(
    '显式列落位越界会在写前失败，不由执行层猜最近列',
    invalidColumnPlacement.valid === false
        && invalidColumnPlacement.issues.includes('regions[0].columnPlacement:must_fit_declared_columns'),
    JSON.stringify(invalidColumnPlacement)
);
const authoredBlockOrder = solveLayout({
    canvas: { width: 1_000, height: 1_000 },
    marginScale: 2,
    gapScale: 2,
    blocks: [
        { id: '装饰先叠', role: 'decoration', content: 'C:/fixture/decor.png', heightRatio: 0.1, widthRatio: 0.2 },
        { id: '主体后叠', role: 'main-image', content: 'C:/fixture/product.jpg', heightRatio: 0.6, widthRatio: 0.8 },
        { id: '标题最上', role: 'title', content: '标题', heightRatio: 0.1, widthRatio: 0.8, hAlign: 'left' }
    ]
});
check(
    '垂直 blocks 的非背景层序同样保持 Agent 数组顺序',
    authoredBlockOrder.blocks.map((block) => block.id).join('|') === '装饰先叠|主体后叠|标题最上'
);
const stackPlan = buildRenderLayoutStackPlan([
    { blockId: '已置入摄影主体', stackOrder: 0, layerIdsBottomToTop: [10] },
    { blockId: '实底卖点', stackOrder: 2, layerIdsBottomToTop: [20, 21] },
    { blockId: '裁切图片', stackOrder: 1, layerIdsBottomToTop: [30, 31] }
]);
check(
    'model_authored 堆叠账本同时保持区域顺序和裁切/底块原子内部关系',
    stackPlan.valid
        && stackPlan.layerIdsBottomToTop.join(',') === '10,30,31,20,21'
        && stackPlan.layerIdsTopToBottom.join(',') === '21,20,31,30,10',
    JSON.stringify(stackPlan)
);

function simulateModelAuthoredStackLedger(input) {
    const plan = buildRenderLayoutStackPlan(input.units);
    const actualLayerIdsTopToBottom = [...(input.initialLayerIdsTopToBottom || [])];
    const moveCalls = [];
    let failedMove;

    if (plan.valid) {
        for (const layerId of plan.layerIdsBottomToTop) {
            const call = {
                layerId,
                targetGroupId: input.targetGroupId,
                position: 'inside-top'
            };
            moveCalls.push(call);
            if (layerId === input.failOnLayerId) {
                failedMove = call;
                break;
            }
            const previousIndex = actualLayerIdsTopToBottom.indexOf(layerId);
            if (previousIndex >= 0) actualLayerIdsTopToBottom.splice(previousIndex, 1);
            actualLayerIdsTopToBottom.unshift(layerId);
        }
    }

    const movesCompleted = plan.valid && !failedMove;
    const readbackRequested = movesCompleted;
    const readbackLayerIdsTopToBottom = readbackRequested
        ? [...(input.readbackLayerIdsTopToBottom || actualLayerIdsTopToBottom)]
        : [];
    const orderVerified = readbackRequested
        && readbackLayerIdsTopToBottom.length === plan.layerIdsTopToBottom.length
        && readbackLayerIdsTopToBottom.every((layerId, index) => (
            layerId === plan.layerIdsTopToBottom[index]
        ));

    return {
        plan,
        moveCalls,
        failedMove,
        movesCompleted,
        readbackRequested,
        actualLayerIdsTopToBottom,
        readbackLayerIdsTopToBottom,
        orderVerified
    };
}

const stackLedgerUnits = [
    { blockId: '摄影主体', stackOrder: 0, layerIdsBottomToTop: [101] },
    { blockId: '裁切复合块', stackOrder: 1, layerIdsBottomToTop: [201, 202] },
    { blockId: '模型已拥有图层', stackOrder: 2, layerIdsBottomToTop: [301] }
];
const successfulStackLedgerRun = simulateModelAuthoredStackLedger({
    units: stackLedgerUnits,
    targetGroupId: 900,
    initialLayerIdsTopToBottom: [301]
});
check(
    'model-authored stack ledger 把复合 block 与 owned layer 合成唯一底到顶账本',
    successfulStackLedgerRun.plan.unitsBottomToTop[1]?.blockId === '裁切复合块'
        && successfulStackLedgerRun.plan.unitsBottomToTop[1]?.layerIdsBottomToTop.join(',') === '201,202'
        && successfulStackLedgerRun.plan.unitsBottomToTop[2]?.layerIdsBottomToTop.join(',') === '301'
        && successfulStackLedgerRun.plan.layerIdsBottomToTop.join(',') === '101,201,202,301',
    JSON.stringify(successfulStackLedgerRun)
);
check(
    'stack ledger 按底到顶顺序逐层 inside-top 移动后得到期望的顶到底读回',
    successfulStackLedgerRun.moveCalls.every((call) => (
        call.targetGroupId === 900 && call.position === 'inside-top'
    ))
        && successfulStackLedgerRun.moveCalls.map((call) => call.layerId).join(',') === '101,201,202,301'
        && successfulStackLedgerRun.actualLayerIdsTopToBottom.join(',') === '301,202,201,101'
        && successfulStackLedgerRun.orderVerified,
    JSON.stringify(successfulStackLedgerRun)
);

const interruptedStackLedgerRun = simulateModelAuthoredStackLedger({
    units: stackLedgerUnits,
    targetGroupId: 900,
    initialLayerIdsTopToBottom: [301],
    failOnLayerId: 202
});
check(
    'stack ledger 移动中途失败会立即停止，不继续移动 owned layer 或伪造完整读回',
    interruptedStackLedgerRun.movesCompleted === false
        && interruptedStackLedgerRun.failedMove?.layerId === 202
        && interruptedStackLedgerRun.moveCalls.map((call) => call.layerId).join(',') === '101,201,202'
        && !interruptedStackLedgerRun.moveCalls.some((call) => call.layerId === 301)
        && interruptedStackLedgerRun.readbackRequested === false
        && interruptedStackLedgerRun.orderVerified === false,
    JSON.stringify(interruptedStackLedgerRun)
);

const wrongReadbackStackLedgerRun = simulateModelAuthoredStackLedger({
    units: stackLedgerUnits,
    targetGroupId: 900,
    initialLayerIdsTopToBottom: [301],
    readbackLayerIdsTopToBottom: [301, 201, 202, 101]
});
check(
    'stack ledger 即使所有 inside-top 移动成功，读回顺序错误仍不得通过',
    wrongReadbackStackLedgerRun.movesCompleted
        && wrongReadbackStackLedgerRun.readbackRequested
        && wrongReadbackStackLedgerRun.readbackLayerIdsTopToBottom.join(',') === '301,201,202,101'
        && wrongReadbackStackLedgerRun.plan.layerIdsTopToBottom.join(',') === '301,202,201,101'
        && wrongReadbackStackLedgerRun.orderVerified === false,
    JSON.stringify(wrongReadbackStackLedgerRun)
);
check(
    'renderLayout 不再动态展开 recipe',
    !/expandLayoutRecipe|describeLayoutRecipesForModel|recipeExpansion/.test(toolExecutor)
);
check(
    '工具 schema 不再暴露固定版式 id',
    !/headline-top-left-subject-right|four-grid|closeup-caption-bottom/.test(toolSchemas)
);
check(
    '主体缩放不再包含品类、角色或意图预设表',
    !/DESIGN_PRESETS|ROLE_PRESETS|INTENT_PRESETS|DEFAULT_SMART_SCALING_PRESET/.test(scalingPolicy)
        && /presetOverride: SmartScalingPreset/.test(scalingPolicy)
);
check(
    '主图变体不再按点击/转化类型偷偷改主体尺寸或预留文案区',
    !/0\.78|0\.56|0\.22|1\.04|0\.94/.test(mainImagePlacement)
        && /assignment\.placement\.targetBox/.test(mainImagePlacement)
        && /input\.assignment\.subjectBounds/.test(mainImagePlacement)
        && /presetOverride:\s*input\.assignment\.placement\.preset/.test(mainImagePlacement)
);
check(
    '智能布局 Skill 不再注入主体占比和居中默认',
    !/numParam\('fillRatio',[\s\S]{0,120}default:/.test(skillDeclarations)
        && !/strParam\('alignment',[\s\S]{0,120}default:/.test(skillDeclarations)
);
check(
    '参考复刻不再伪造统一阴影和描边参数',
    !/opacity:\s*28|angle:\s*120|referenceSize \* 0\.012|position:\s*'inside',/.test(referenceStyleRecipes)
        && /不使用内置阴影配方/.test(referenceStyleRecipes)
        && /不使用内置描边配方/.test(referenceStyleRecipes)
);
check(
    '参考缺项不再补固定彩色占位块或角色坐标',
    !/createSupplementalPlaceholderByRole|#BFD7EA|#C7E9B4|#E8DFF5/.test(referenceApply)
        && /未用固定坐标、颜色或占位文案补造/.test(referenceApply)
);
check(
    'composeDesign 不再把阴影标签和颜色名换成内置视觉参数',
    !/SHADOW_KINDS|NAMED_COLORS|opacity:\s*32|angle:\s*120/.test(composeSpec)
        && /完整 drop-shadow 参数/.test(composeSpec)
);
check(
    '活动 Prompt 不再注入固定栅格、字号比例或任意 batchPlay 方案',
    !/3:1\.5:1|batchPlayCommands/.test(prompts)
        && !/必须(?:使用|遵循).*8px|8px grid:/.test(prompts)
);
check(
    'agentic 主图与详情页 Manifest 不再绑定内置标准模板',
    /template_families:\s*\[\]/.test(mainImageManifest)
        && /template_families:\s*\[\]/.test(detailPageManifest)
        && !/main_image\.standard|detail_page\.standard/.test(`${mainImageManifest}\n${detailPageManifest}`)
);
check(
    '开放主体缩放缺显式占比时会失败',
    toolExecutor.includes('Harness 不再按品类套用内置占比')
        && toolExecutor.includes('Harness 不替 Agent 选择视觉重心')
);
check(
    'composeDesign 不再隐藏调用独立评审',
    !/executeToolCall\(['"]evaluateDesign['"]/.test(composeExecutor)
);
check(
    'composeDesign 不再固定轮询 Photoshop 落定',
    !/等待 Photoshop 落定/.test(composeExecutor)
);
check(
    'composeDesign 在首次 Photoshop 写入前完成视觉样式预检',
    composeExecutor.includes('resolveRenderLayoutVisualStyle')
        && composeExecutor.indexOf('resolveRenderLayoutVisualStyle({') < composeExecutor.indexOf("run('建画布'")
);
check(
    '默认正式保存使用用户可读文档名，恢复点与交付目录隔离',
    toolExecutor.includes('return `${root}\\\\${safeName}.${ext}`')
        && toolExecutor.includes('\\\\.designecho`')
        && toolExecutor.includes('countsAsDelivery: false')
        && !toolExecutor.includes('_autosave_')
);
check(
    '内部恢复点不向 Agent 暴露路径且不能写入正式目录',
    toolSchemas.includes("name: 'smartSave'")
        && !/name: 'smartSave',[\s\S]{0,400}path:\s*\{/.test(toolSchemas)
        && toolExecutor.includes("if (toolName === 'smartSave'")
        && toolExecutor.includes('normalizeRecoverySaveFormat')
        && autonomousExecutor.includes("const AGENT_INTERNAL_PROVIDER_TOOL_NAMES = new Set(['smartSave'])")
);
check(
    '设计基础能力直接包含建档与图层读回，不预载固定方法论或交付工具',
    capabilitySession.includes("'photoshop.read.getLayerHierarchy'")
        && capabilitySession.includes("'photoshop.sandbox.createDocument'")
        && !capabilitySession.includes("'knowledge.read.getDesignPrinciples'")
        && !capabilitySession.includes("'delivery.export.saveDocument'")
        && !capabilitySession.includes("'delivery.export.quickExport'")
);
check(
    'composeDesign 不用结构/几何通过冒充视觉终审并污染近期成稿记忆',
    composeExecutor.includes("reviewStatus: 'candidate_unreviewed'")
        && composeExecutor.includes('candidateFingerprint: fingerprint')
        && composeExecutor.includes('composeDesign 只生产候选，不拥有视觉终审')
        && !composeExecutor.includes("invokeMain('designWorkshop:writeRecentDesigns'")
);
check(
    '内部恢复点不能满足正式交付完成条件',
    /const DOCUMENT_SAVE_TOOLS = new Set\(\[\s*'saveDocument',\s*'quickExport'/m.test(taskCompletion)
        && !/const DOCUMENT_SAVE_TOOLS = new Set\(\[[\s\S]{0,180}'smartSave'/m.test(taskCompletion)
);
check(
    '订阅模型用 name.const 原生参数对象消除二次 JSON 编码，Tool 级修复仍同线程并累计真实用量',
    codexSubscription.includes('REPAIRABLE_STRUCTURED_OUTPUT_ERROR_CODES')
        && codexSubscription.includes('buildCodexStructuredOutputRepairInput(error)')
        && codexSubscription.includes('buildCodexDirectToolArgumentsRepairInput(')
        && codexSubscription.includes('outputSchema: buildDirectToolArgumentsOutputSchema(tool)')
        && codexSubscription.includes('buildCodexStrictOutputSchema(input.outputSchema)')
        && codexSubscription.includes('restoreCodexStrictOutputValue(wireValue, outputSchema)')
        && codexSubscription.includes('anyOf: tools.map(buildStructuredToolCallOutputSchema)')
        && codexSubscription.includes('buildCodexHostEnvelopeOutputSchema(tools)')
        && codexSubscription.includes('arguments: Record<string, unknown>')
        && codexStrictOutputSchema.includes('readRecoverableDiscriminatedObjectUnion(')
        && codexSubscription.includes('combineTokenUsage(firstUsage, repairedUsage)')
        && !codexSubscription.includes('argumentsJson')
        && !codexSubscription.includes('codex-tool-arguments-local-repair')
        && !codexSubscription.includes('JSON5.parse')
        && codexSubscription.includes('if (!isRepairableCodexStructuredOutputError(error) || signal?.aborted) throw error;')
);
check(
    '订阅桥按持续进度刷新空闲超时并保留独立总上限',
    codexSubscription.includes("notification.method.endsWith('/delta')")
        && codexSubscription.includes(
            'const accepted = this.refreshActiveTurnIdleDeadline(active, notification.method);'
        )
        && codexSubscription.includes('if (!accepted) return;')
        && codexSubscription.includes('this.scheduleActiveTurnIdleCheck(active);')
        && codexSubscription.includes('MAX_TURN_WALL_CLOCK_TIMEOUT_MS')
        && codexSubscription.includes('codex_subscription_turn_idle_timeout')
        && codexSubscription.includes('codex_subscription_turn_wall_clock_timeout')
);
check(
    '相同 content 与 text block 不会重复送入订阅模型',
    codexSubscription.includes('const seen = new Set<string>()')
        && codexSubscription.includes('if (!text || seen.has(text)) return;')
);
check(
    'Provider 失败保持结构化归因，不再被循环压成普通质量返工',
    agentRuntime.includes('rethrowKnownModelProviderFailure(this.config.modelId, error)')
        && modelProviderFailureBoundary.includes("if (providerFailure.kind !== 'unknown')")
        && autonomousExecutor.includes('shouldRetryAutonomousModelTransport({')
        && modelProviderTransportPolicy.includes("code === CODEX_SUBSCRIPTION_WALL_CLOCK_TIMEOUT) return false")
        && modelProviderTransportPolicy.includes('code === CODEX_SUBSCRIPTION_IDLE_TIMEOUT')
        && autonomousExecutor.includes("if (result.stopReason === 'error') break;")
);
check(
    '已完成成品的审美建议不会被 Harness 改写成红色自动返工失败',
    !autonomousExecutor.includes('自动调整无法安全接着进行')
);
check(
    '新成品任务不因当前正好打开旧稿就默认续做',
    !designerAutonomyPrinciples.includes('设计文件优先续做')
        && designerAutonomyPrinciples.includes('新成品请求应把旧稿作为可选参考并建立独立新稿')
        && designerAutonomyPrinciples.includes('不按文件名、分辨率排名或当前画面惯性代替看图')
);
check(
    '生产提示不再要求设计开始或首次写入前例行公开说明',
    !autonomousExecutor.includes('视觉设计开始前，用一句自然的设计语言')
        && !autonomousExecutor.includes('首次进行会改变设计结果的动作前')
        && !designerAutonomyPrinciples.includes('首次写入前，用一小段面向用户的说明')
        && !autonomousExecutor.includes("title: '设计判断准备'")
        && !autonomousExecutor.includes("title: '专业团队准备'")
);
check(
    '通用设计决策契约不再内置 SKU 路径或品类预设',
    !designerDecisionContractSource.includes('buildSkuDecisionOptions')
        && !designerDecisionContractSource.includes('通用 SKU 模板默认推进方式')
        && !designerDecisionContractSource.includes('2/3/4 双装')
);
check(
    '通用设计知识不再把候选短名单冒充对象理解',
    designMethodKnowledgeSource.includes('候选短名单只回答')
        && designArtifactKnowledgeSource.includes('候选短名单只是在一个已声明需求或素材角色下比较可用性')
        && designPrinciplesSource.includes('一次素材候选结果只证明若干图对某个已声明角色的相对适配')
        && toolSchemas.includes('one page or one selected image is not project-wide understanding')
        && toolSchemas.includes('The Agent chooses after viewing pixels')
);
check(
    '参考一瞥挂定方向前（2026-08-23 用户裁决），保留豁免出口且不形成强制仪式',
    designMethodKnowledgeSource.includes('是否检索 Eagle 或其他参考资源由 Agent 按信息增益判断')
        && designArtifactKnowledgeSource.includes('是否调用 Eagle 等参考工具、查什么以及何时停止由 Agent 决定')
        && designPrinciplesSource.includes('参考研究由 Agent 按信息增益决定')
        && toolSchemas.includes('no explicit reference, governed brand material or relevant project work already answers it')
        && toolSchemas.includes('optional evidence, not a fixed opening ritual')
        && !toolSchemas.includes('七步思考脚手架')
        && !toolSchemas.includes('先说明要解决的构图、色彩、字体或表达问题')
);
check(
    '回复纪律不再把 Eagle 或其他参考来源变成固定开工步骤',
    agentMessageContext.includes('参考研究由你按信息增益决定')
        && agentMessageContext.includes('不把任何参考来源变成固定开工步骤')
        && !agentMessageContext.includes('先检索 Eagle 同品类参考并真看一两张画面再定方向')
);
check(
    '隔离 Runtime 的连接事实与实际 Photoshop 调用绑定同一个 owner',
    preloadSource.includes("ipcRenderer.invoke('runtime:getMcpHostEndpoint') as Promise<string>")
        && !preloadSource.includes("from './config/network-ports'")
        && mcpHostClient.includes('fetch(await resolveMcpHostEndpoint()')
        && mcpHostClient.includes('Electron 内必须对当前 Runtime owner fail closed')
        && !mcpHostClient.includes("const MCP_HOST_ENDPOINT = 'http://127.0.0.1:8768/mcp'")
);
check(
    '详情页素材排序只生成候选，缺少 Agent / 用户选择收据不能进入 Photoshop',
    detailPageAssetRanker.includes('buildDetailAssetCandidateSet(')
        && detailPageAssetRanker.includes('findExplicitDetailAssetSelection(')
        && detailPageAssetRanker.includes('requiresModelAssetDecision: !explicitSelection')
        && detailPageAssetRanker.includes('排序第一名不是生产选定')
        && !detailPageAssetRanker.includes('selectDetailAssetCandidate(')
        && detailPageExecutor.includes('buildDetailAssetSelectionHandoffResult({')
        && detailPagePlanUtils.includes('hasValidDetailAssetSelectionReceipt(')
        && toolExecutor.includes("code: 'detail_asset_selection_receipt_required'")
        && uxpDetailPageFiller.includes("'asset_selection_required'")
        && uxpDetailPageFiller.includes('hasValidAssetSelectionReceipt(item, screenId)')
);
const detailCandidateSetId = 'detail-candidates:7:42:fixture';
const detailAssetCandidates = [
    {
        candidateSetId: detailCandidateSetId,
        candidateId: `${detailCandidateSetId}:1`,
        imagePath: 'C:/fixture/first.jpg'
    },
    {
        candidateSetId: detailCandidateSetId,
        candidateId: `${detailCandidateSetId}:2`,
        imagePath: 'C:/fixture/second.jpg'
    }
];
const explicitlySelectedSecondDetailAsset = {
    layerId: 42,
    layerName: '商品图片区',
    imagePath: 'C:/fixture/second.jpg',
    fillMode: 'contain',
    assetType: 'product',
    assetCandidates: detailAssetCandidates,
    selectionReceipt: {
        version: 'detail-asset-selection-receipt/v0',
        screenId: 7,
        placeholderLayerId: 42,
        candidateSetId: detailCandidateSetId,
        candidateId: `${detailCandidateSetId}:2`,
        selectedAssetPath: 'C:/fixture/second.jpg',
        selectedBy: 'agent',
        decisionId: 'agent-choice-second'
    }
};
check(
    '详情页 Agent 明确选择第二候选时，Harness 尊重该选择而不是改回规则第一名',
    hasValidDetailAssetSelectionReceipt(explicitlySelectedSecondDetailAsset, 7)
        && resolveDetailImageExecutionDeferral(explicitlySelectedSecondDetailAsset, 7) === null
        && !detailPageAssetRanker.includes('candidate.score >= 0.55\n                    && assetUsageDecision.automaticPlacementEligible'),
    JSON.stringify(explicitlySelectedSecondDetailAsset)
);
const forgedDetailAssetPath = {
    ...explicitlySelectedSecondDetailAsset,
    imagePath: 'C:/fixture/unlisted.jpg'
};
check(
    '详情页选择收据不能被换路径、旧屏或候选集外素材复用',
    hasValidDetailAssetSelectionReceipt(forgedDetailAssetPath, 7) === false
        && hasValidDetailAssetSelectionReceipt(explicitlySelectedSecondDetailAsset, 8) === false
        && resolveDetailImageExecutionDeferral(forgedDetailAssetPath, 7)?.code === 'asset_selection_required'
);
const multiSlotScreen = {
    id: 17,
    name: '多图片区稳定候选测试',
    type: 'PRODUCT',
    copyPlaceholders: [],
    imagePlaceholders: [101, 102, 103].map((layerId) => ({
        layerId,
        layerName: `图片区 ${layerId}`,
        bounds: { left: 0, top: 0, right: 320, bottom: 320 }
    }))
};
const multiSlotAssets = ['a', 'b', 'c'].map((name, index) => ({
    path: `C:/fixture/detail-${name}.jpg`,
    type: 'model',
    width: 1_200,
    height: 1_200,
    sizeBytes: 10_000 + index,
    modifiedTimeMs: 1_700_000_000_000 + index,
    visionSignal: {
        visualObserved: true,
        assetNature: 'raw_photo',
        shotType: 'on_model',
        backgroundType: 'scene'
    }
}));
const multiSlotBaseDecision = {
    screenId: 17,
    screenName: multiSlotScreen.name,
    screenRole: 'hero',
    mainMessage: '展示商品',
    supportingPoints: [],
    copyStrategy: 'none',
    imageStrategy: 'hero',
    visualPriority: 'image-first'
};
const multiSlotBasePlan = {
    ...multiSlotBaseDecision,
    decisionSource: 'agent',
    requiresModelDecision: false,
    confidence: 1,
    agentDecision: { ...multiSlotBaseDecision }
};
const firstMultiSlotMatch = await matchDetailPageContentPlans({
    screens: [multiSlotScreen],
    projectAssets: { images: multiSlotAssets },
    screenPlans: [multiSlotBasePlan],
    aiCopyGeneration: false
});
const firstMultiSlotImages = firstMultiSlotMatch.plans[0]?.images || [];
const imageSelections = firstMultiSlotImages.map((image, index) => {
    const candidates = image.assetCandidates || [];
    const selected = candidates[(index + 1) % candidates.length];
    return {
        placeholderLayerId: image.layerId,
        candidateSetId: selected.candidateSetId,
        candidateId: selected.candidateId,
        imagePath: selected.imagePath,
        decisionId: `agent-multi-slot-${image.layerId}`,
        rationale: '按各图片区叙事职责一次性完成选择'
    };
});
const secondMultiSlotMatch = await matchDetailPageContentPlans({
    screens: [multiSlotScreen],
    projectAssets: { images: multiSlotAssets },
    screenPlans: [{
        ...multiSlotBasePlan,
        agentDecision: {
            ...multiSlotBaseDecision,
            imageSelections
        }
    }],
    aiCopyGeneration: false
});
const secondMultiSlotImages = secondMultiSlotMatch.plans[0]?.images || [];
check(
    '详情页 3 个图片区首轮签发稳定候选，第二轮一次提交全部选择后全部晋升',
    firstMultiSlotImages.length === 3
        && imageSelections.length === 3
        && secondMultiSlotImages.length === 3
        && secondMultiSlotImages.every((image, index) => (
            image.requiresModelAssetDecision === false
            && image.executionDeferred === false
            && image.imagePath === imageSelections[index].imagePath
            && image.selectionReceipt?.candidateSetId === imageSelections[index].candidateSetId
        ))
        && secondMultiSlotMatch.plans.every((plan) => (
            !(plan.images || []).some((image) => image.requiresModelAssetDecision === true)
        )),
    JSON.stringify({ imageSelections, secondMultiSlotImages })
);
check(
    '主图风格策略不再把项目扫描列表第一项冒充已选素材',
    mainImageProjectStyleStrategy.includes('项目素材存在不等于已经选定')
        && !mainImageProjectStyleStrategy.includes('return normalizeAssets(input.projectAssets)[0]')
);
check(
    'SKU 模板以 agentic 执行并且普通 handoff 不注入固定参考顺序或版式数值',
    skuTemplateManifest.includes("execution_model: 'agentic'")
        && skuTemplateDesignLoop.includes('input.includeMechanicalLayoutCandidate !== true')
        && skuTemplateDesignLoop.includes('顺序和工具由你决定')
        && skuTemplateDesignLoop.includes('Harness 不提供默认版式数值')
        && !skuTemplateDesignLoop.includes('先找现成再新建：')
        && !skuTemplateDesignLoop.includes('项目模板目录 → Eagle')
);
check(
    '图片 contain/cover 的验收框来自 Agent 选择的 fit 与真实宽高比，不强迫填满占位框',
    uxpTemplateTool.includes('let plannedRect = destinationRect;')
        && uxpTemplateTool.includes('plannedRect = {\n                        left: desiredLeft,')
        && !uxpTemplateTool.includes(': transformVisibleRect || targetBounds;')
);
check(
    '思考步骤左侧缩进计入可用宽度，不再固定横向溢出 4px',
    /\.thinking-steps\s*\{[\s\S]*?width:\s*auto;[\s\S]*?inline-size:\s*auto;/.test(messageRendererCss)
        && !/\.thinking-steps\s*\{[\s\S]*?width:\s*100%;[\s\S]*?margin-left:\s*4px;/.test(messageRendererCss)
);
check(
    '失败熔断只累计相同原因，不再按工具名误杀逐步修正',
    failureBreaker.includes('areEquivalentToolFailureReasons')
        && agentRuntime.includes('areEquivalentToolFailureReasons(this.lastToolFailureReasonByName.get(name), failureReason) ? failures + 1 : 1')
);
check(
    '摄影优先的纯图片设计可只整理既有图层，不逼 Agent 虚构文字区域',
    toolExecutor.includes('const ownedLayerOnlyMode = specBlocks.length === 0')
        && toolExecutor.includes('if (specBlocks.length === 0 && !ownedLayerOnlyMode)')
        && toolExecutor.includes('if (ownedLayerOnlyMode)')
        && toolExecutor.includes('createdLayerIds.push(ownedLayer.layerId)')
        && toolExecutor.includes('requiresVisualReview: retainedCreatedLayerIds.length > 0')
        && composeExecutor.includes('layoutRendered: steps.some((item) => item.ok && item.tool === \'renderLayout\')')
);
check(
    'composeDesign 新建文档按真实模式与部分成功回执记账',
    taskCompletion.includes("if (documentMode !== 'new') return false;")
        && taskCompletion.includes('item.result?.data?.createdDocument === true')
        && taskCompletion.includes('timeline.entries[index]?.photoshopMutationObserved === true')
        && composeExecutor.includes('...latestMutationEvidence')
);
const placePathTransportBlock = toolExecutor.slice(
    toolExecutor.indexOf('// 项目内显式路径直接交给 UXP 创建会话 token'),
    toolExecutor.indexOf('// replaceLayerContent 预处理')
);
check(
    '项目图片路径不再转成超大 Base64 文本帧，未知置入只做读回结算',
    placePathTransportBlock.includes('sourcePath: finalParams.sourcePath || resolvedFilePath')
        && !placePathTransportBlock.includes('readImageBase64')
        && toolExecutor.includes("if (toolName === 'placeImage') {")
        && toolExecutor.includes('captureAcceptanceAfterUnknownOperation')
        && toolExecutor.includes('photoshop_place_image_reconciled_applied')
);
check(
    '用户界面不再承诺一次成稿或替 Agent 宣布固定检查步骤',
    !source('src/renderer/services/tool-display-info.ts').includes("composeDesign: { name: '一次成稿'")
        && source('src/renderer/services/tool-display-info.ts').includes("composeDesign: { name: '制作首稿'")
        && !source('src/renderer/services/agent-visible-feedback.ts').includes('正在检查当前项目与 Photoshop 状态')
);
check(
    '视觉观察卡不再提供固定详情页结构草案',
    !/VIEW_STRUCTURE_SKELETON|structure-only\.skeleton/.test(observationCard)
        && !fs.existsSync(path.join(root, 'src/shared/agent-runtime-v5/manifests/detail-page.structure-preset.ts'))
);

const { resolveRenderLayoutVisualStyle } = require(path.join(root, 'src/shared/layout/render-layout-style.ts'));
const { buildAgentToolExecutionPreflight } = require(path.join(root, 'src/shared/agent-tool-execution-preflight.ts'));
const { sanitizeUserVisibleDiagnosticText } = require(path.join(root, 'src/shared/chat-response-cleaner.ts'));
const { getDefaultAgentTools } = require(path.join(root, 'src/renderer/services/agent-runtime/tool-schemas.ts'));
const { areEquivalentToolFailureReasons } = require(path.join(root, 'src/renderer/services/agent-runtime/tool-failure-breaker.ts'));
const { classifyPlaceImageOperationReconciliation } = require(path.join(root, 'src/shared/place-image-operation-reconciliation.ts'));
const {
    decideQualityAwareReflexionReentry,
    evaluateCompletedReflexionWriteFreshness,
    evaluateReflexionReviewProvenance
} = require(path.join(root, 'src/shared/reflexion-reentry-policy.ts'));
const {
    DESIGN_ASSERTIONS,
    buildVlmJudgeContextMessage,
    scoreDesignAssertions
} = require(path.join(root, 'src/shared/design-quality-assertion.ts'));
const {
    buildNeutralAssetCandidateId,
    buildNeutralAssetCandidatePage,
    diversifyAssetRecommendationShortlist
} = require(path.join(root, 'src/shared/asset-recommendation-shortlist.ts'));
const { selectMainImageAssetCandidate } = require(path.join(root, 'src/shared/main-image-asset-selection.ts'));
const { buildAgentCapabilityBaseline, createAgentCapabilitySession } = require(path.join(root, 'src/renderer/services/agent-runtime/capability-session.ts'));
const { buildDesignerAgentDecisionContract } = require(path.join(root, 'src/shared/designer-agent-decision-contract.ts'));
const {
    DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
    DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
    MAIN_IMAGE_METHOD_KNOWLEDGE_ID,
    buildDesignMethodKnowledgeContext
} = require(path.join(root, 'src/shared/agent-runtime-v5/design-method-knowledge.ts'));
const { buildMainImageFrameworkSummary } = require(path.join(
    root,
    'src/shared/knowledge/main-image-framework.ts'
));
const { designMemoryItemToKnowledgeResult } = require(path.join(
    root,
    'src/shared/design-memory-knowledge.ts'
));
const {
    governDesignKnowledgeResult,
    selectDesignKnowledgeResultsForUse
} = require(path.join(
    root,
    'src/shared/design-knowledge-governance.ts'
));
const generalDesignMethodContext = buildDesignMethodKnowledgeContext({
    knowledgeRefs: [
        DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
        DESIGN_ART_DIRECTION_KNOWLEDGE_ID
    ],
    manifestSkillId: 'design.general'
});
check(
    '计划中立的通用方法上下文会把对象理解与参考信息增益交给模型',
    generalDesignMethodContext.issues.length === 0
        && generalDesignMethodContext.boundaries.advisoryOnly === true
        && generalDesignMethodContext.boundaries.grantsPermission === false
        && generalDesignMethodContext.content.includes('候选短名单只回答')
        && generalDesignMethodContext.content.includes('是否检索 Eagle 或其他参考资源由 Agent 按信息增益判断')
        && generalDesignMethodContext.content.includes('无需按固定格式公开'),
    JSON.stringify(generalDesignMethodContext)
);
const mainImageMethodContext = buildDesignMethodKnowledgeContext({
    knowledgeRefs: [
        DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
        DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
        MAIN_IMAGE_METHOD_KNOWLEDGE_ID
    ],
    manifestSkillId: 'ecommerce.main_image'
});
const productionDesignKnowledgeText = [
    mainImageMethodContext.content,
    buildMainImageFrameworkSummary('all')
].join('\n');
const mainImageSkillDeclarationStart = skillDeclarations.indexOf('export const MainImageSkill: SkillDeclaration = {');
const mainImageSkillDeclarationEnd = skillDeclarations.indexOf(
    '\nexport const ',
    mainImageSkillDeclarationStart + 1
);
const mainImageSkillRuntimeText = [
    mainImageSkillDeclarationStart >= 0
        ? skillDeclarations.slice(
            mainImageSkillDeclarationStart,
            mainImageSkillDeclarationEnd > mainImageSkillDeclarationStart
                ? mainImageSkillDeclarationEnd
                : skillDeclarations.length
        )
        : '',
    mainImageSkillPlaybook
].join('\n');
const allAgentConsumedMainImageKnowledgeText = [
    productionDesignKnowledgeText,
    mainImageSkillRuntimeText
].join('\n');
const benchmarkAnswerPatterns = [
    /\bH\d+\b/u,
    /盲评/u,
    /(?:全面)?胜出|\d+\s*\/\s*\d+\s*判对/u,
    /\b(?:DSC|IMG)[-_]?\d{3,}\b/iu,
    /\b(?:run-\d{8}|revision\s+[0-9]+)\b/iu,
    /\b[A-Z]:[\\/][^\s]+/u
];
check(
    '生产设计知识不携带 H3、盲评赢家、具体 Case 或文件名等 benchmark 答案',
    mainImageMethodContext.issues.length === 0
        && benchmarkAnswerPatterns.every((pattern) => !pattern.test(allAgentConsumedMainImageKnowledgeText)),
    allAgentConsumedMainImageKnowledgeText
);
const narrowSamplePresetPatterns = [
    /摄影优先/u,
    /场景\s*[/／]\s*穿着优先/u,
    /真实项目里有一类点击图变体组只用了\s*4\s*层/u,
    /摄影主视觉[\s\S]{0,120}大字文字[\s\S]{0,120}卖点句[\s\S]{0,120}复用组件/u
];
check(
    '主图 Skill 只提供业务与交付边界，不把窄样本的素材角色、层数或组件组合当常驻答案',
    mainImageSkillDeclarationStart >= 0
        && narrowSamplePresetPatterns.every((pattern) => !pattern.test(mainImageSkillRuntimeText))
        && mainImageSkillRuntimeText.includes('没有默认图层数、主素材角色、文字数量、版式或组件组合')
        && mainImageSkillRuntimeText.includes('素材没有全局优先级'),
    mainImageSkillRuntimeText
);
const benchmarkMemoryResult = designMemoryItemToKnowledgeResult({
    id: 'benchmark-only-case',
    kind: 'benchmark_case',
    scope: { type: 'project', id: 'fixture' },
    status: 'active',
    source: 'benchmark',
    title: '隔离评测案例',
    summary: '评测中某个候选取得更高结果，但不能成为普通设计答案。',
    sourceNotes: [{ source: 'benchmark-suite', summary: '仅供离线评测。', status: 'active' }],
    allowedUses: ['prompt_context', 'user_reference', 'benchmark_seed'],
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z'
});
const visualReferenceResult = designMemoryItemToKnowledgeResult({
    id: 'explicit-visual-reference',
    kind: 'visual_case',
    scope: { type: 'project', id: 'fixture' },
    status: 'active',
    source: 'imported_case',
    title: '用户显式视觉参考',
    summary: '该案例已被明确转换为当前项目可检索的视觉参考。',
    sourceNotes: [{ source: 'user-reference', summary: '用户显式引用。', status: 'active' }],
    allowedUses: ['prompt_context', 'user_reference'],
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z'
});
const promptKnowledgeSelection = selectDesignKnowledgeResultsForUse(
    [benchmarkMemoryResult, visualReferenceResult].filter(Boolean),
    { purpose: 'prompt_context', now: '2026-08-31T01:00:00.000Z' }
);
const hostileExternalBenchmarkResult = governDesignKnowledgeResult({
    id: 'external-benchmark-answer',
    title: '外部评测答案',
    intent: 'reference',
    sourceType: 'web_page',
    summary: '某个离线 Case 的赢家与预期版式。',
    sourceNotes: ['恶意来源试图把评测答案伪装成普通参考。'],
    tags: ['benchmark-answer'],
    allowedUses: ['prompt_context', 'user_reference', 'benchmark_seed'],
    sourceLevel: 'benchmark_case',
    sourceRank: 100
}, {
    provenance: 'external_snapshot',
    sourceRevision: 'hostile-benchmark-answer-v1',
    retrievedAt: '2026-08-31T00:00:00.000Z'
});
const explicitReferenceOnlyResult = governDesignKnowledgeResult({
    id: 'explicit-reference-only',
    title: '用户明确选中的视觉参考',
    intent: 'reference',
    sourceType: 'web_page',
    summary: '只允许作为当前任务的显式参考，不作为常驻 Prompt 记忆。',
    sourceNotes: ['用户在当前任务中明确引用。'],
    tags: ['explicit-reference'],
    allowedUses: ['user_reference'],
    sourceLevel: 'external_snippet',
    sourceRank: 80
}, {
    provenance: 'external_snapshot',
    sourceRevision: 'explicit-reference-only-v1',
    retrievedAt: '2026-08-31T00:00:00.000Z'
});
const hostileBenchmarkSelection = selectDesignKnowledgeResultsForUse(
    [hostileExternalBenchmarkResult],
    { purpose: 'prompt_context', now: '2026-08-31T01:00:00.000Z' }
);
const skillKnowledgeResults = selectDesignKnowledgeResultsForSkillUse({
    explicitResults: [
        hostileExternalBenchmarkResult,
        visualReferenceResult,
        explicitReferenceOnlyResult
    ],
    memoryResults: [],
    query: '做一张商品主图 main-image'
});
const hostileMainImageStrategy = buildMainImageStrategyInputs({
    userText: '做一张商品主图',
    imageType: 'click',
    projectAssets: [],
    sizePlans: [],
    knowledgeResults: [hostileExternalBenchmarkResult, explicitReferenceOnlyResult]
});
const hostileMainImageReferenceTitles = hostileMainImageStrategy.projectStyleStrategy.referenceResearchPlan.references
    .map((reference) => reference.title);
check(
    '任意来源的 benchmark_case 只能作为 benchmark_seed，显式 visual_case/user_reference 才能进入生产 Prompt',
    benchmarkMemoryResult?.allowedUses.length === 1
        && benchmarkMemoryResult.allowedUses[0] === 'benchmark_seed'
        && promptKnowledgeSelection.usableResults.length === 1
        && promptKnowledgeSelection.usableResults[0]?.id === visualReferenceResult?.id
        && promptKnowledgeSelection.blockedResults.some((item) => item.id === benchmarkMemoryResult.id)
        && hostileExternalBenchmarkResult.allowedUses.length === 1
        && hostileExternalBenchmarkResult.allowedUses[0] === 'benchmark_seed'
        && hostileBenchmarkSelection.usableResults.length === 0
        && hostileBenchmarkSelection.blockedResults[0]?.id === hostileExternalBenchmarkResult.id
        && !skillKnowledgeResults.some((result) => result.id === hostileExternalBenchmarkResult.id)
        && skillKnowledgeResults.some((result) => result.id === explicitReferenceOnlyResult.id)
        && hostileMainImageReferenceTitles.length === 1
        && hostileMainImageReferenceTitles[0] === explicitReferenceOnlyResult.title,
    JSON.stringify({
        benchmarkAllowedUses: benchmarkMemoryResult?.allowedUses,
        usableIds: promptKnowledgeSelection.usableResults.map((item) => item.id),
        blockedIds: promptKnowledgeSelection.blockedResults.map((item) => item.id),
        hostileAllowedUses: hostileExternalBenchmarkResult.allowedUses,
        hostileBlockedIds: hostileBenchmarkSelection.blockedResults.map((item) => item.id),
        skillKnowledgeIds: skillKnowledgeResults.map((item) => item.id),
        hostileMainImageReferenceTitles
    })
);
let learningLedger = createDesignLearningLedger('2026-08-31T00:00:00.000Z');
const learningInvokeChannels = [];
const learningInvoke = async (channel, payload) => {
    learningInvokeChannels.push(channel);
    if (channel === 'designWorkshop:readLearningLedger') {
        return { success: true, ledger: learningLedger };
    }
    if (channel === 'designWorkshop:writeLearningLedger') {
        learningLedger = payload.ledger;
        return { success: true, filePath: 'C:/fixture/.designecho/learning-candidates.json' };
    }
    if (channel === 'skillPackage:applyImprovement') {
        return { success: true };
    }
    throw new Error(`unexpected learning channel: ${channel}`);
};
const recordedVerdictCandidate = await executeRecordDesignVerdict(
    learningInvoke,
    'C:/fixture',
    { verdict: 'keep', why: '用户说主体清楚但标题不要再加大', ref: '主图.jpg' },
    'run:test-boundary'
);
const skillImprovementCandidate = await executeProposeSkillImprovement(
    learningInvoke,
    'C:/fixture',
    {
        skillId: 'main-image-design',
        file: 'SKILL.md',
        find: '旧的手册片段',
        replace: '新的手册片段',
        rationale: '离线测试认为某个样板表现更好，但尚未经过用户审核。'
    }
);
const timelineBeforeAttemptedDecision = JSON.stringify(learningLedger);
const timelineRead = await executeGetDesignLearningTimeline(
    learningInvoke,
    'C:/fixture',
    {
        limit: 20,
        decideId: skillImprovementCandidate.candidateId,
        decision: 'published',
        note: '模型或测试桥尝试发布'
    }
);
check(
    '模型与测试桥只能写学习候选和读取时间线，不能发布评审校准或改写 Skill',
    recordedVerdictCandidate.success === true
        && recordedVerdictCandidate.requiresUserReview === true
        && recordedVerdictCandidate.candidate?.status === 'candidate'
        && skillImprovementCandidate.success === true
        && timelineRead.readOnly === true
        && JSON.stringify(learningLedger) === timelineBeforeAttemptedDecision
        && !learningInvokeChannels.includes('skillPackage:applyImprovement')
        && learningLedger.candidates.every((candidate) => candidate.status !== 'published'),
    JSON.stringify({
        recordedVerdictCandidate,
        skillImprovementCandidate,
        timelineRead,
        learningInvokeChannels,
        statuses: learningLedger.candidates.map((candidate) => ({ id: candidate.id, status: candidate.status }))
    })
);
const defaultAgentTools = getDefaultAgentTools();
const browseAssetCandidatesDescription = defaultAgentTools
    .find((tool) => tool.name === 'browseAssetCandidates')?.description || '';
const legacyRecommendAssetsVisible = defaultAgentTools.some((tool) => tool.name === 'recommendAssets');
const searchEagleReferencesDescription = defaultAgentTools.find((tool) => tool.name === 'searchEagleReferences')?.description || '';
check(
    '素材候选与 Eagle 工具各自保留模型所有的判断边界',
    browseAssetCandidatesDescription.includes('one selected image is not project-wide understanding')
        && browseAssetCandidatesDescription.includes('stable neutral candidate page')
        && browseAssetCandidatesDescription.includes('information value')
        && !legacyRecommendAssetsVisible
        && searchEagleReferencesDescription.includes('A search hit is not visual understanding')
        && searchEagleReferencesDescription.includes('optional evidence, not a fixed opening ritual'),
    JSON.stringify({ browseAssetCandidatesDescription, legacyRecommendAssetsVisible, searchEagleReferencesDescription })
);
check(
    'browseAssetCandidates 主 Agent 路径只返回中性分页，legacy Skill 内部视觉推荐保持兼容',
    resourceManagerSource.includes('sheet?: ProjectContactSheetOverviewResult[\'sheet\']')
        && resourceManagerSource.includes('agentSelectsFinalAsset: true')
        && resourceManagerSource.includes("visualConsumptionOwner?: 'calling_agent'")
        && resourceManagerSource.includes("if (visualConsumptionOwner === 'calling_agent')")
        && resourceManagerSource.includes('return await this.buildCallingAgentCandidateSheet(candidates, {')
        && resourceManagerSource.indexOf("if (visualConsumptionOwner === 'calling_agent')")
            < resourceManagerSource.indexOf('const requirementKeywords = this.getRequirementKeywords')
        && resourceManagerSource.includes("version: 'asset-candidate-page/v1'")
        && resourceManagerSource.includes('ranked: false')
        && resourceManagerSource.includes('winnerSelected: false')
        && resourceManagerSource.includes('recommendations: modelVisibleRecommendations')
        && resourceManagerSource.includes('diversifyAssetRecommendationShortlist(')
        && toolExecutor.includes("visualConsumptionOwner: 'calling_agent' as const")
        && autonomousExecutor.includes("visualConsumptionOwner: 'calling_agent'")
        && !autonomousExecutor.includes('() => !runtimeContractBundle')
        && toolExecutor.includes('本结果不包含推荐分、推荐理由或赢家')
        && toolExecutor.includes('...(candidatePage ? { candidatePage } : {})')
        && toolExecutor.includes('comparisonItems,')
        && !toolExecutor.slice(
            toolExecutor.indexOf("case 'recommendAssets':"),
            toolExecutor.indexOf("case 'measureReferenceComposition':")
        ).includes('...result,')
        && toolResultSanitizerSource.includes("'sheet'")
        && !resourceManagerSource.includes('selectedAsset: modelVisibleRecommendations[0]')
        && resolveToolVisualConsumptionOwner('browseAssetCandidates') === 'calling_agent'
        && resolveToolVisualConsumptionOwner('browseAssetCandidates', 'calling_agent') === 'calling_agent'
        && resolveToolVisualConsumptionOwner('recommendAssets') === undefined
        && resolveToolVisualConsumptionOwner('recommendAssets', 'calling_agent') === 'calling_agent'
);
check(
    '素材扫描缓存覆盖全部行为参数，候选编号只表示身份而非排名',
    resourceManagerSource.includes('`${targetPath}:${recursive}:${includeDesignFiles}:${maxDepth}:${generateThumbnails}`')
        && resourceManagerSource.includes('编号只用于绑定图片身份，不表示推荐顺序、排名或优先级')
        && browseAssetCandidatesDescription.includes('identities within candidatePage.candidateSetId, never priority')
        && browseAssetCandidatesDescription.includes('does not infer category from requirement text')
        && toolDisplayInfoSource.includes("browseAssetCandidates: { name: '浏览候选素材'")
);
const neutralCandidates = [
    { file: { path: 'D:/project/模特/Z.jpg', relativePath: '模特/Z.jpg', dimensions: { width: 1200, height: 1800 } } },
    { file: { path: 'D:/project/模特/M.jpg', relativePath: '模特/M.jpg', dimensions: { width: 1200, height: 1800 } } },
    { file: { path: 'D:/project/平铺/Z.jpg', relativePath: '平铺/Z.jpg', dimensions: { width: 1800, height: 1200 } } },
    { file: { path: 'D:/project/模特/A.jpg', relativePath: '模特/A.jpg', dimensions: { width: 1200, height: 1800 } } },
    { file: { path: 'D:/project/平铺/M.jpg', relativePath: '平铺/M.jpg', dimensions: { width: 1800, height: 1200 } } },
    { file: { path: 'D:/project/平铺/A.jpg', relativePath: '平铺/A.jpg', dimensions: { width: 1800, height: 1200 } } }
];
const neutralPageOne = buildNeutralAssetCandidatePage(neutralCandidates, {
    page: 1,
    pageSize: 2,
    candidateSetScope: 'D:/project|all'
});
const neutralPageOneReversed = buildNeutralAssetCandidatePage([...neutralCandidates].reverse(), {
    page: 1,
    pageSize: 2,
    candidateSetScope: 'D:/project|all'
});
const neutralPageTwo = buildNeutralAssetCandidatePage(neutralCandidates, {
    page: 2,
    pageSize: 2,
    candidateSetScope: 'D:/project|all'
});
const neutralOtherScopePage = buildNeutralAssetCandidatePage(neutralCandidates, {
    page: 1,
    pageSize: 2,
    candidateSetScope: 'D:/project|references'
});
const neutralChangedFileVersionPage = buildNeutralAssetCandidatePage(
    neutralCandidates.map((candidate, index) => ({
        file: {
            ...candidate.file,
            size: 4096 + index,
            modifiedTime: index === 0 ? 2_000 : 1_000
        }
    })),
    {
        page: 1,
        pageSize: 2,
        candidateSetScope: 'D:/project|all'
    }
);
const neutralOriginalFileVersionPage = buildNeutralAssetCandidatePage(
    neutralCandidates.map((candidate, index) => ({
        file: {
            ...candidate.file,
            size: 4096 + index,
            modifiedTime: 1_000
        }
    })),
    {
        page: 1,
        pageSize: 2,
        candidateSetScope: 'D:/project|all'
    }
);
const neutralDateFileVersionPage = buildNeutralAssetCandidatePage(
    neutralCandidates.map((candidate, index) => ({
        file: {
            ...candidate.file,
            size: 4096 + index,
            modifiedTime: new Date(1_000)
        }
    })),
    {
        page: 1,
        pageSize: 2,
        candidateSetScope: 'D:/project|all'
    }
);
const neutralPageOneIds = neutralPageOne.itemOrdinals.map(buildNeutralAssetCandidateId);
const neutralPageTwoIds = neutralPageTwo.itemOrdinals.map(buildNeutralAssetCandidateId);
check(
    '主 Agent 候选分页对输入排列稳定、首屏跨来源和桶内跨度覆盖且不产生赢家',
    neutralPageOne.ranked === false
        && neutralPageOne.winnerSelected === false
        && neutralPageOne.hasMore === true
        && neutralPageOne.nextPage === 2
        && neutralPageOne.ordering === 'stable_source_aspect_span_round_robin'
        && /^candidate-set-v1-[a-f0-9]{16}$/.test(neutralPageOne.candidateSetId)
        && neutralPageOne.candidateSetId === neutralPageOneReversed.candidateSetId
        && neutralPageOne.candidateSetId === neutralPageTwo.candidateSetId
        && neutralPageOne.candidateSetId !== neutralOtherScopePage.candidateSetId
        && neutralOriginalFileVersionPage.candidateSetId === neutralDateFileVersionPage.candidateSetId
        && neutralOriginalFileVersionPage.candidateSetId !== neutralChangedFileVersionPage.candidateSetId
        && neutralPageOne.items.map((item) => item.file.path).join('|')
            === neutralPageOneReversed.items.map((item) => item.file.path).join('|')
        && new Set(neutralPageOne.items.map((item) => item.file.relativePath.split('/')[0])).size === 2
        && neutralPageOne.items.every((item) => item.file.relativePath.endsWith('/M.jpg'))
        && neutralPageOneIds.every(Boolean)
        && neutralPageTwoIds.every(Boolean)
        && neutralPageOneIds.every((id) => !neutralPageTwoIds.includes(id))
        && neutralPageTwo.items.length === 2
        && neutralPageTwo.items.every((item) => !neutralPageOne.items.includes(item)),
    JSON.stringify({ neutralPageOne, neutralPageTwo })
);
const liftedContactSheetImages = extractImagesFromToolResult({
    success: true,
    sheet: {
        imageData: 'A'.repeat(600),
        mediaType: 'image/jpeg',
        width: 960,
        height: 720
    }
}, 3);
check(
    '项目总览观察只在 Agent 调用边界把 sheet 交给当前多模态模型，避免 Tool 内重复看图',
    toolExecutor.includes("options.visualConsumptionOwner === 'calling_agent'")
        && toolExecutor.includes('const contactSheet = await designEcho.createProjectContactSheetOverview?.({')
        && toolExecutor.includes('...(presentationSheet ? { sheet: presentationSheet } : {})')
        && toolExecutor.includes("owner: 'calling_agent'")
        && liftedContactSheetImages.length === 1
        && liftedContactSheetImages[0].mediaType === 'image/jpeg',
    JSON.stringify(liftedContactSheetImages.map((item) => ({ mediaType: item.mediaType, resultPath: item.resultPath })))
);
check(
    'placeImage 只执行 Agent 明确选择的来源，不能在工具内部把推荐 Top1 变成设计决定',
    toolSchemas.includes('This execution tool never scans, ranks, or chooses project assets')
        && !toolSchemas.includes("autoSelect: { type: 'boolean', description: 'true 时按 requirement/designRole 自动匹配候选置入")
        && toolExecutor.includes('function resolveExplicitPlaceImageSource')
        && toolExecutor.includes('__placeImageSourceBlocked: true')
        && toolExecutor.includes("nextTool: 'browseAssetCandidates'")
        && !toolExecutor.includes('autoResolvePlaceImageSource')
        && !toolExecutor.includes('filePath: topCandidate.path')
);
check(
    '项目总览在截断前按角色和桶内跨度稳定抽样，不再把目录 first-N 当成重要性排序',
    toolExecutor.includes('const uniqueCandidates = selectDiverseProjectVisualCandidates(')
        && toolExecutor.includes('const images = selectDiverseProjectVisualCandidates(uniqueCandidates, maxImages)')
        && toolExecutor.includes('candidateUniverseCount: uniqueCandidates.length')
        && projectVisualSamplingSource.includes('doesNotRank: true')
        && projectVisualSamplingSource.includes('doesNotSelectWinner: true')
        && !/filter\(\(file: any\) => file\?\.type === 'image'[\s\S]{0,160}\.slice\(0, params\.maxImages \|\| 40\)/.test(toolExecutor)
);
const heuristicMainImageSelection = selectMainImageAssetCandidate({
    userText: '帮我做一张主图',
    projectAssets: [
        { path: 'D:/project/平铺细节/A01.jpg', role: 'raw-product-still' },
        { path: 'D:/project/模特场景/B01.jpg', role: 'raw-model-wear' }
    ]
});
const explicitMainImageSelection = selectMainImageAssetCandidate({
    userText: '用我选中的图片做主图',
    selectedAsset: { path: 'D:/project/模特场景/B01.jpg', role: 'selected-project-image' },
    projectAssets: [{ path: 'D:/project/平铺细节/A01.jpg', role: 'raw-product-still' }]
});
const currentDocumentMainImageSelection = selectMainImageAssetCandidate({
    userText: '做一张新主图',
    currentDocument: { name: '旧稿.psd', path: 'D:/project/旧稿.psd' }
});
check(
    '主图 Skill 不再把规则第一名或当前旧文档冒充 Agent 选图，明确选择仍可直接承接',
    heuristicMainImageSelection.requiresModelAssetDecision === true
        && heuristicMainImageSelection.selectedAsset === undefined
        && heuristicMainImageSelection.readiness === 'needs_context'
        && heuristicMainImageSelection.preflightGate === 'needs_input'
        && heuristicMainImageSelection.candidates.length === 2
        && currentDocumentMainImageSelection.requiresModelAssetDecision === true
        && currentDocumentMainImageSelection.selectedAsset === undefined
        && currentDocumentMainImageSelection.selectionMode === 'active-document-fallback'
        && currentDocumentMainImageSelection.readiness === 'needs_context'
        && currentDocumentMainImageSelection.preflightGate === 'needs_input'
        && explicitMainImageSelection.selectedAsset?.path.endsWith('/B01.jpg')
        && explicitMainImageSelection.requiresModelAssetDecision === false,
    JSON.stringify({ heuristicMainImageSelection, currentDocumentMainImageSelection, explicitMainImageSelection })
);
const composeDesignSchema = defaultAgentTools.find((tool) => tool.name === 'composeDesign')?.inputSchema;
const composeDesignProperties = composeDesignSchema?.properties || {};
const composeRegionSchema = composeDesignProperties.layout?.properties?.regions?.items;
const unstructuredDecisionSupport = buildDesignerAgentDecisionContract({
    userTask: '用项目摄影图做一张新的视觉设计。',
    scenario: 'general-design'
});
const partialDecisionSupport = buildDesignerAgentDecisionContract({
    userTask: '用项目摄影图做一张新的视觉设计。',
    scenario: 'general-design',
    agentDecision: {
        source: 'model-agent',
        designGoal: '让摄影主体成为第一视觉',
        hierarchy: {
            primarySubject: '摄影主体'
        }
    }
});
check(
    '缺少预填设计表或项目视觉缓存不再构成自主执行门禁',
    unstructuredDecisionSupport.status === 'ready'
        && unstructuredDecisionSupport.blockers.length === 0
        && unstructuredDecisionSupport.publicObservationGoals.length === 0
        && partialDecisionSupport.status === 'ready'
        && partialDecisionSupport.blockers.length === 0
        && partialDecisionSupport.publicDesignIntent.includes('让摄影主体成为第一视觉')
        && !partialDecisionSupport.promptSection.includes('先补齐设计判断')
        && !partialDecisionSupport.promptSection.includes('工具阶段和验收标准'),
    JSON.stringify(partialDecisionSupport)
);
check(
    '移除准备门禁后仍保留目标、revision、权限与写后必要读回边界',
    partialDecisionSupport.toolUseGuidance.some((item) => item.includes('目标文档') && item.includes('revision'))
        && partialDecisionSupport.toolUseGuidance.some((item) => item.includes('权限') && item.includes('写入目标'))
        && partialDecisionSupport.toolUseGuidance.some((item) => item.includes('画面修改后') && item.includes('必要结构或画面读回'))
);
check(
    'composeDesign 模型说明书覆盖执行器真实嵌套必填项',
    ['width', 'height'].every((key) => composeDesignProperties.canvas?.required?.includes(key))
        && composeDesignProperties.subject?.oneOf?.some((branch) => (
            ['treatment', 'shadow'].every((key) => branch.required?.includes(key))
                && branch.properties?.treatment?.enum?.includes('photo')
                && !branch.required?.includes('fillRatio')
        ))
        && composeDesignProperties.subject?.oneOf?.some((branch) => ['treatment', 'shadow', 'cutout'].every((key) => branch.required?.includes(key)))
        && ['mode', 'regions', 'groupName', 'visualStyle'].every((key) => composeDesignProperties.layout?.required?.includes(key))
        && ['id', 'role', 'content', 'bounds'].every((key) => composeRegionSchema?.required?.includes(key))
        && ['x', 'y', 'width', 'height'].every((key) => composeRegionSchema?.properties?.bounds?.required?.includes(key))
        && ['backgroundHex', 'textHex'].every((key) => composeDesignProperties.palette?.required?.includes(key))
        && ['angle', 'purpose', 'claim', 'materials', 'structure']
            .every((key) => composeDesignProperties.rationale?.properties?.[key]?.type === 'string')
        && /只有需要精确控制商品主体占比时才填写 fillRatio/.test(composeDesignProperties.subject?.properties?.treatment?.description || '')
        && /声明后执行前必须取得可靠主体框/.test(composeDesignProperties.subject?.properties?.fillRatio?.description || ''),
    JSON.stringify(composeDesignSchema)
);
check(
    'composeDesign 把设计意图带入候选收据，并区分另建候选与当前文档修订',
    /进入收据与候选比较/.test(composeDesignProperties.rationale?.description || '')
        && /mode=new 会另建候选/.test(composeDesignProperties.document?.properties?.name?.description || '')
        && /另建文档产生独立候选/.test(defaultAgentTools.find((tool) => tool.name === 'composeDesign')?.description || '')
        && composeExecutor.includes("version: 'compose-design-artifact-facts/v1'")
        && composeExecutor.includes("code: 'candidate_structural_reduction_not_compared'")
        && composeExecutor.includes("closureKind: 'comparison'")
        && taskCompletion.includes("entry.name === 'renderLayout' || entry.name === 'composeDesign'")
        && !taskCompletion.includes("entry.name === 'evaluateDesign'")
        && !taskCompletion.includes("entry.result?.evaluationAuthority === 'advisory_visual_critique'"),
    JSON.stringify(composeDesignProperties.document)
);
check(
    'composeDesign 把 regions 暴露为可重复的多视觉元素，而不是单素材固定槽位',
    composeDesignProperties.layout?.properties?.regions?.type === 'array'
        && composeDesignProperties.layout?.properties?.regions?.maxItems === undefined
        && composeDesignProperties.layout?.properties?.regions?.uniqueItems !== true
        && composeRegionSchema?.properties?.role?.enum?.includes('main-image')
        && composeRegionSchema?.properties?.imagePlacement?.type === 'object'
        && /从下到上/.test(composeDesignProperties.layout?.properties?.regions?.description || '')
        && /不限制 regions/.test(composeDesignProperties.subject?.description || ''),
    JSON.stringify(composeDesignProperties.layout?.properties?.regions)
);
check(
    'composeDesign 要求模型给用户可读语义图层名，不由 Harness 生成实现标识',
    /用户可读/.test(composeRegionSchema?.properties?.id?.description || '')
        && /headline/.test(composeRegionSchema?.properties?.id?.description || '')
        && /Harness 不会代为改名/.test(composeRegionSchema?.properties?.id?.description || '')
        && /IMPLEMENTATION_REGION_ID/.test(composeSpec)
        && composeExecutor.includes('const photoLayerName = String(spec.layout.regions[primarySubjectRegionIndex]!.id).trim()')
        && composeExecutor.includes('name: photoLayerName')
        && !composeExecutor.includes("`主视觉·${sourceStem || '摄影素材'}`"),
    composeRegionSchema?.properties?.id?.description || ''
);
check(
    '摄影主素材只消费自己的定位区域，其他独立 main-image 不再被整批过滤',
    composeExecutor.includes('index !== primarySubjectRegionIndex')
        && !composeExecutor.includes("renderRegions.filter((region) => region.role !== 'main-image')")
        && composeExecutor.includes('const regionSources = spec.layout.regions'),
    composeExecutor.slice(composeExecutor.indexOf('const renderRegions'), composeExecutor.indexOf('const renderLayoutParams'))
);
check(
    '不同校验问题代表修正进展，相同问题才计入重复失败',
    areEquivalentToolFailureReasons('缺少阴影', '缺少主体占比') === false
        && areEquivalentToolFailureReasons('缺少阴影', '  缺少阴影  ') === true
);
check(
    '设计参数校验不会把工具名与字段路径直接展示给用户',
    sanitizeUserVisibleDiagnosticText('composeDesign 设计稿不完整：layout.regions[2]：需要 role 与 content')
        === '设计方案还不完整：排版方案中的第 3 个区域还没有说明用途和内容'
);
const completedAestheticAssertions = DESIGN_ASSERTIONS
    .filter((assertion) => assertion.method === 'vlm_judge')
    .slice(0, 2);
const completedAestheticScorecard = scoreDesignAssertions(
    completedAestheticAssertions.map((assertion) => ({
        id: assertion.id,
        status: 'pass',
        score: 0.96,
        confidence: 0.95,
        reason: '当前版本事实交付完成，但仍有一条可靠定向观察。'
    })),
    {
        assertions: completedAestheticAssertions,
        passThreshold: 85,
        minCoverage: 0.8
    }
);
const completedAestheticPerformanceCapacity = {
    usage: {
        modelCalls: 2,
        toolCalls: 3,
        iterations: 2,
        visionCandidates: 0,
        visualAnalyses: 0,
        activeElapsedMs: 1_000,
        observationKeys: []
    },
    budget: {
        maxModelCalls: 10,
        maxToolCalls: 12,
        maxIterations: 10,
        maxVisionCandidates: 4,
        maxInitialVisionCandidates: 0,
        maxVisualAnalyses: 3,
        maxFullResolutionImageReads: 0,
        softTimeBudgetMs: 1_000_000
    }
};
const completedAestheticDecision = decideQualityAwareReflexionReentry({
    handoff: {
        status: 'reflexion_required',
        sourceOwner: 'R5',
        targetStage: 'R4',
        trigger: 'completed_aesthetic_improvement',
        reviewBinding: {
            documentId: 23,
            historyStateId: 45,
            observationKeys: ['observation:hero']
        },
        issueConstraints: [{
            issueId: 'focus-1',
            description: '陪体略抢眼',
            expectedFix: '由 Agent 判断如何收弱陪体并保留主体',
            observationKey: 'observation:hero'
        }],
        failureAnalysis: ['陪体略抢眼'],
        strategyAdjustments: ['泛化策略不得进入 completed handoff-only'],
        nextRoundConstraints: ['泛化 warning 不得重复进入 completed handoff-only']
    },
    priorReentryCount: 0,
    scorecardHistory: [completedAestheticScorecard],
    stopReason: 'final_response',
    constraintMode: 'handoff_only',
    performanceCapacity: completedAestheticPerformanceCapacity
});
check(
    '已完成版本的可靠审美观察只唤醒 Agent 一次，不由 Harness 选择或扩大修改内容',
    completedAestheticDecision.shouldReenter === true
        && completedAestheticDecision.reason === 'reentry'
        && completedAestheticDecision.injectedConstraints.length === 1
        && completedAestheticDecision.injectedConstraints[0]
            === '问题 focus-1；陪体略抢眼；对应修法：由 Agent 判断如何收弱陪体并保留主体',
    JSON.stringify(completedAestheticDecision)
);
const completedAestheticHandoff = {
    status: 'reflexion_required',
    sourceOwner: 'R5',
    targetStage: 'R4',
    trigger: 'completed_aesthetic_improvement',
    reviewBinding: {
        documentId: 23,
        historyStateId: 45,
        observationKeys: ['observation:hero']
    },
    issueConstraints: [{
        issueId: 'focus-1',
        description: '陪体略抢眼',
        expectedFix: '由 Agent 判断如何收弱陪体并保留主体',
        observationKey: 'observation:hero'
    }]
};
const trustedReviewProvenance = evaluateReflexionReviewProvenance({
    handoff: completedAestheticHandoff,
    artifact: {
        historyStateRef: { documentId: 23, historyStateId: 45 },
        observationKeys: ['observation:hero']
    }
});
const forgedReviewProvenance = evaluateReflexionReviewProvenance({
    handoff: completedAestheticHandoff,
    artifact: {
        historyStateRef: { documentId: 23, historyStateId: 46 },
        observationKeys: ['observation:hero']
    }
});
check(
    '完成态审美反馈只接受与可信 ReviewSet 完全一致的版本来源',
    trustedReviewProvenance.valid === true
        && trustedReviewProvenance.status === 'match'
        && forgedReviewProvenance.valid === false
        && forgedReviewProvenance.status === 'revision_mismatch'
);
const unboundCompletedAestheticDecision = decideQualityAwareReflexionReentry({
    handoff: {
        ...completedAestheticHandoff,
        reviewBinding: undefined
    },
    priorReentryCount: 0,
    scorecardHistory: [completedAestheticScorecard],
    stopReason: 'final_response',
    constraintMode: 'handoff_only'
});
check(
    '缺少结构化版本绑定的完成态反馈不能靠描述文字触发返工',
    unboundCompletedAestheticDecision.shouldReenter === false
        && unboundCompletedAestheticDecision.reason === 'no_actionable_constraints'
);
const sameRevisionFirstWrite = evaluateCompletedReflexionWriteFreshness({
    handoff: completedAestheticHandoff,
    executionKind: 'photoshop_write',
    hasGenerationMutation: false,
    targetRevision: { documentId: 23, historyStateId: 45 }
});
const staleRevisionFirstWrite = evaluateCompletedReflexionWriteFreshness({
    handoff: completedAestheticHandoff,
    executionKind: 'photoshop_write',
    hasGenerationMutation: false,
    targetRevision: { documentId: 23, historyStateId: 46 }
});
const reobservedRevisionFirstWrite = evaluateCompletedReflexionWriteFreshness({
    handoff: completedAestheticHandoff,
    executionKind: 'photoshop_write',
    hasGenerationMutation: false,
    targetRevision: { documentId: 23, historyStateId: 46 },
    currentVisualReview: {
        historyStateRef: { documentId: 23, historyStateId: 46 },
        observationKeys: ['observation:current'],
        fullyReviewed: true
    }
});
const subsequentGenerationWrite = evaluateCompletedReflexionWriteFreshness({
    handoff: completedAestheticHandoff,
    executionKind: 'photoshop_write',
    hasGenerationMutation: true,
    targetRevision: { documentId: 23, historyStateId: 46 }
});
check(
    '旧画面反馈只约束下一代第一项写入，版本变化后由 Agent 完整重看即可重新判断',
    sameRevisionFirstWrite.allowed === true
        && staleRevisionFirstWrite.allowed === false
        && staleRevisionFirstWrite.status === 'current_revision_observation_required'
        && reobservedRevisionFirstWrite.allowed === true
        && reobservedRevisionFirstWrite.status === 'current_revision_reobserved'
        && subsequentGenerationWrite.allowed === true
        && subsequentGenerationWrite.status === 'subsequent_generation_write'
);
const implicitBriefJudgeContext = buildVlmJudgeContextMessage({
    task: '帮我用项目里的素材做一张主图。',
    brief: ''
});
check(
    '缺少结构化 Brief 时只按用户原文评审，不把未要求信息判成缺项',
    implicitBriefJudgeContext.includes('用户未明确要求的信息、文案、渠道或尺寸不是缺失项')
        && implicitBriefJudgeContext.includes('帮我用项目里的素材做一张主图')
);
function acceptanceLayer(id, name, kind) {
    return {
        id,
        name,
        kind,
        visible: true,
        locked: false,
        depth: 0,
        index: id,
        parentId: null,
        parentName: null,
        path: name,
        selected: false,
        bounds: { left: 0, top: 0, right: 800, bottom: 800, width: 800, height: 800 }
    };
}
function acceptanceSnapshot(documentId, historyStateId, layers) {
    return {
        success: true,
        hasDocument: true,
        document: { id: documentId, name: '置入读回测试', width: 800, height: 800 },
        historyStateRef: { documentId, historyStateId },
        layers,
        selectedLayerIds: [],
        summary: {
            totalLayers: layers.length,
            selectedLayers: 0,
            hiddenLayers: 0,
            lockedLayers: 0,
            textLayers: 0,
            groupLayers: 0,
            smartObjectLayers: layers.filter((layer) => layer.kind === 'smartObject').length,
            shapeLayers: 0,
            pixelLayers: layers.filter((layer) => layer.kind === 'pixel').length,
            truncated: false
        },
        warnings: []
    };
}
const beforePlaceImage = acceptanceSnapshot(41, 100, [acceptanceLayer(1, '背景', 'pixel')]);
const afterPlaceImage = acceptanceSnapshot(41, 103, [
    acceptanceLayer(2, '商品摄影', 'smartObject'),
    acceptanceLayer(1, '背景', 'pixel')
]);
const appliedPlaceImage = classifyPlaceImageOperationReconciliation({
    before: beforePlaceImage,
    after: afterPlaceImage
});
const unchangedPlaceImage = classifyPlaceImageOperationReconciliation({
    before: beforePlaceImage,
    after: beforePlaceImage
});
const ambiguousPlaceImage = classifyPlaceImageOperationReconciliation({
    before: beforePlaceImage,
    after: acceptanceSnapshot(41, 104, [
        acceptanceLayer(3, '商品摄影 B', 'smartObject'),
        acceptanceLayer(2, '商品摄影 A', 'smartObject'),
        acceptanceLayer(1, '背景', 'pixel')
    ])
});
check(
    '未知 placeImage 只在同文档唯一新增图片层时结算成功，不会盲目重放',
    appliedPlaceImage.classification === 'applied'
        && appliedPlaceImage.layer?.id === 2
        && unchangedPlaceImage.classification === 'not_applied'
        && ambiguousPlaceImage.classification === 'ambiguous',
    JSON.stringify({ appliedPlaceImage, unchangedPlaceImage, ambiguousPlaceImage })
);
const missingStyle = resolveRenderLayoutVisualStyle({ backgroundHex: '#FFFFFF' });
const explicitWireframe = resolveRenderLayoutVisualStyle({
    backgroundHex: '#FFFFFF',
    visualStyle: { mode: 'neutral_wireframe' }
});
check(
    '缺失 visualStyle 时 fail closed',
    missingStyle.ok === false && missingStyle.issues.includes('visualStyle:required_use_model_authored_or_explicit_neutral_wireframe'),
    JSON.stringify(missingStyle)
);
check(
    '显式结构预览仍可使用 neutral_wireframe',
    explicitWireframe.ok === true && explicitWireframe.style?.mode === 'neutral_wireframe',
    JSON.stringify(explicitWireframe)
);
const newDocumentComposePreflight = buildAgentToolExecutionPreflight({
    assistantContent: '我会新建独立文档完成首稿，完成后读取图层与画面复核。',
    toolCalls: [{ name: 'composeDesign', arguments: { document: { mode: 'new', name: '主图' } } }],
    completedToolCalls: []
});
const activeDocumentComposePreflight = buildAgentToolExecutionPreflight({
    assistantContent: '我会继续修改当前文档，完成后读取图层与画面复核。',
    toolCalls: [{ name: 'composeDesign', arguments: { document: { mode: 'active', name: '主图' } } }],
    completedToolCalls: []
});
check(
    '新建独立文档的 composeDesign 不被旧画面检查越权拦截',
    newDocumentComposePreflight.ready === true
        && activeDocumentComposePreflight.ready === false,
    JSON.stringify({ newDocumentComposePreflight, activeDocumentComposePreflight })
);
const invalidTypography = resolveRenderLayoutVisualStyle({
    backgroundHex: '#FFFFFF',
    visualStyle: {
        mode: 'model_authored',
        palette: {
            primaryTextColorHex: '#111111',
            secondaryTextColorHex: '#333333',
            accentColorHex: '#AA5500',
            placeholderFillColorHex: '#EEEEEE',
            sellingPointTextColorHex: '#111111'
        },
        typography: {
            title: { fontSizeRatio: 1.2, minFontSizeRatio: 0.2, fitMode: 'none', tracking: 0, leadingRatio: 1.1 },
            subtitle: { fontSizeRatio: 0.3, minFontSizeRatio: 0.1, fitMode: 'none', tracking: 0, leadingRatio: 1.1 },
            body: { fontSizeRatio: 0.3, minFontSizeRatio: 0.1, fitMode: 'none', tracking: 0, leadingRatio: 1.1 },
            sellingPoint: { fontSizeRatio: 0.3, minFontSizeRatio: 0.1, fitMode: 'none', tracking: 0, leadingRatio: 1.1 }
        },
        sellingPoint: { treatment: 'text_only', cornerRadiusRatio: 0, paddingRatio: 0 }
    }
});
check(
    '模型可见范围与运行时字号范围一致',
    invalidTypography.ok === false
        && invalidTypography.issues.includes('visualStyle.typography.title.fontSizeRatio:out_of_range'),
    JSON.stringify(invalidTypography)
);

const diversifiedShortlist = diversifyAssetRecommendationShortlist([
    ...Array.from({ length: 8 }, (_, index) => ({
        file: { relativePath: `图片素材/平铺/flat-${index}.jpg`, dimensions: { width: 4284, height: 4284 } },
        score: 90 - index
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
        file: { relativePath: `图片素材/模特/model-${index}.jpg`, dimensions: { width: 3024, height: 4032 } },
        score: 70 - index
    }))
], 6);
check(
    '素材联系表按来源轮转，不让高分辨率平铺图垄断 Agent 视野',
    diversifiedShortlist.filter((item) => item.file.relativePath.includes('/平铺/')).length === 3
        && diversifiedShortlist.filter((item) => item.file.relativePath.includes('/模特/')).length === 3,
    JSON.stringify(diversifiedShortlist.map((item) => item.file.relativePath))
);

const designCapabilitySession = createAgentCapabilitySession({
    candidateTools: getDefaultAgentTools(),
    baselineCapabilityIds: buildAgentCapabilityBaseline(true)
});
const hierarchySearchResult = designCapabilitySession.searchCapabilities('读取图层结构', 8);
const activeHierarchyMatch = hierarchySearchResult.matches
    .find((match) => match.providerToolNames.includes('getLayerHierarchy'));
const projectOverviewTool = designCapabilitySession.activeTools
    .find((tool) => tool.name === 'analyzeProjectContactSheetOverview');
const browseAssetCandidatesTool = designCapabilitySession.activeTools
    .find((tool) => tool.name === 'browseAssetCandidates');
const evaluateDesignTool = designCapabilitySession.activeTools
    .find((tool) => tool.name === 'evaluateDesign');
const projectOverviewContract = defaultAgentTools
    .find((tool) => tool.name === 'analyzeProjectContactSheetOverview');
const browseAssetCandidatesContract = defaultAgentTools
    .find((tool) => tool.name === 'browseAssetCandidates');
const evaluateDesignContract = defaultAgentTools
    .find((tool) => tool.name === 'evaluateDesign');
const localRevisionToolNames = new Set(designCapabilitySession.activeTools.map((tool) => tool.name));
const legacyRecommendationActivation = designCapabilitySession.requestCapabilities([
    'project.read.recommendAssets',
    'legacy.tool.recommendAssets'
]);
check(
    '项目总览、候选比较、独立评价与最小局部修订手柄首轮可见，但仍由 Agent 决定是否和何时使用',
    activeHierarchyMatch?.availability === 'active'
        && Boolean(projectOverviewTool)
        && Boolean(browseAssetCandidatesTool)
        && Boolean(evaluateDesignTool)
        && projectOverviewTool?.description.includes('bounded visual inventory')
        && projectOverviewContract?.description.includes('not a mandatory first step')
        && projectOverviewContract?.description.includes('does not prove the project is complete, choose a hero, prescribe a design direction')
        && browseAssetCandidatesContract?.description.includes('one selected image is not project-wide understanding')
        && browseAssetCandidatesContract?.description.includes('The Agent chooses after viewing pixels')
        && legacyRecommendationActivation.status === 'rejected'
        && legacyRecommendationActivation.activatedToolNames.length === 0
        && evaluateDesignContract?.description.includes('首轮可见不表示固定开工或强制验收')
        && evaluateDesignContract?.description.includes('只在隔离批评比直接修订或参考比较更有信息增益时调用')
        && ['placeImage', 'transformLayer', 'createRectangle', 'createEllipse', 'setTextStyle']
            .every((toolName) => localRevisionToolNames.has(toolName)),
    JSON.stringify({
        hierarchySearchResult,
        activeTools: designCapabilitySession.activeTools.map((tool) => tool.name),
        contractDescriptions: {
            projectOverview: projectOverviewContract?.description,
            browseAssetCandidates: browseAssetCandidatesContract?.description,
            legacyRecommendationActivation,
            evaluateDesign: evaluateDesignContract?.description
        }
    })
);

const normalizedProjectVisualInventory = normalizeContactSheetObservation(JSON.stringify({
    productResolution: {
        status: 'resolved',
        primaryProduct: '商品 A',
        candidates: ['商品 A'],
        basisImageIds: ['A99']
    },
    sellingPoints: [],
    imageRoles: [
        { id: 'A01', role: '场景' },
        { id: 'A02', role: '不应采用失败编号' },
        { id: 'A99', role: '不应采用不存在编号' }
    ],
    visualInventory: {
        visibleSubjectGroups: [
            { label: '主体组', visibleTraits: ['正面'], basisImageIds: ['a01', 'A99'], certainty: 'clear' },
            { label: '无证据主体', visibleTraits: [], basisImageIds: ['A99'], certainty: 'clear' }
        ],
        visibleVariantGroups: [
            { label: '颜色变体', visibleVariants: ['浅色', '深色'], basisImageIds: ['A01'], certainty: 'tentative' }
        ],
        shootingCoverage: [
            { shotType: 'scene', description: '场景展示', basisImageIds: ['A01'], certainty: 'clear' },
            { shotType: 'hero', description: '非法类型', basisImageIds: ['A01'], certainty: 'clear' }
        ],
        uncertainCoverage: [
            { topic: '变体是否齐全', reason: '总览不能证明完整库存', basisImageIds: [] }
        ]
    },
    nextSingleImageChecks: ['A01', 'A02', 'A99']
}), [
    { id: 'A01', status: 'rendered' },
    { id: 'A02', status: 'failed' }
]);
check(
    '项目视觉库存只接受本次成功渲染编号，并把无有效依据的 resolved 降为 ambiguous',
    normalizedProjectVisualInventory.productResolution.status === 'ambiguous'
        && normalizedProjectVisualInventory.productResolution.primaryProduct === undefined
        && normalizedProjectVisualInventory.productResolution.basisImageIds.length === 0
        && normalizedProjectVisualInventory.imageRoles.length === 1
        && normalizedProjectVisualInventory.visualInventory?.scope.renderedImageIds.join(',') === 'A01'
        && normalizedProjectVisualInventory.visualInventory?.scope.failedImageIds.join(',') === 'A02'
        && normalizedProjectVisualInventory.visualInventory?.visibleSubjectGroups.length === 1
        && normalizedProjectVisualInventory.visualInventory.visibleSubjectGroups[0].basisImageIds.join(',') === 'A01'
        && normalizedProjectVisualInventory.visualInventory.visibleVariantGroups.length === 1
        && normalizedProjectVisualInventory.visualInventory.shootingCoverage.length === 1
        && normalizedProjectVisualInventory.visualInventory.shootingCoverage[0].shotType === 'scene'
        && normalizedProjectVisualInventory.visualInventory.uncertainCoverage.length === 1
        && normalizedProjectVisualInventory.nextSingleImageChecks.join(',') === 'A01',
    JSON.stringify(normalizedProjectVisualInventory)
);

if (failures.length > 0) {
    console.error(`\n设计作者权边界验证失败：${failures.length} 项`);
    process.exit(1);
}

console.log('\n设计作者权边界验证通过。');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
