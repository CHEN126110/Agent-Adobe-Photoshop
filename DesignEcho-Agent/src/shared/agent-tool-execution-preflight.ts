import { shouldCollectAcceptanceVerification } from './acceptance/tool-acceptance';
import { DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME } from './agent-runtime-v5/runtime-action-plan-control';
import { DECLARE_DESIGN_BRIEF_TOOL_NAME } from './agent-runtime-v5/runtime-design-brief-declaration';
import { DECLARE_REFERENCE_BRIEF_TOOL_NAME } from './agent-runtime-v5/runtime-reference-context';
import { DECLARE_DESIGN_STRATEGY_TOOL_NAME } from './agent-runtime-v5/runtime-design-strategy-declaration';
import {
    classifyPhotoshopToolSkillExecution,
    getPhotoshopToolSkillSemantics
} from './photoshop-tool-skill';
import { canAgentToolStartWithoutOpenDocument } from './document-optional-tools';
import { getSkillById } from './skills/skill-declarations';
import {
    readPhotoshopHistoryStateRef,
    readPhotoshopHistoryTransition,
    readPhotoshopMutationCommit,
    type PhotoshopHistoryStateRef
} from './photoshop-history-state-ref';

export type AgentToolExecutionKind =
    | 'read_only_observation'
    | 'knowledge_search'
    | 'photoshop_write'
    | 'save_export'
    | 'external_generation'
    | 'stateful_context'
    | 'unknown';

export interface AgentToolExecutionPreflightTool {
    name: string;
    kind: AgentToolExecutionKind;
    guarded: boolean;
}

export const DESIGN_ECHO_TARGET_GUARD_ARGUMENT = '__designEchoTargetGuard';

export interface AgentToolExecutionTargetGuard {
    expectedDocumentId: number;
    expectedActiveLayerId?: number;
    expectedHistoryStateRef?: PhotoshopHistoryStateRef;
    observationTool: string;
}

export interface AgentToolExecutionPreflight {
    status: 'ready' | 'blocked' | 'not_applicable';
    ready: boolean;
    issue?: string;
    message?: string;
    blockedTool?: AgentToolExecutionPreflightTool;
    tools: AgentToolExecutionPreflightTool[];
    preconditions: {
        hasPriorDocumentRead: boolean;
        priorReadTools: string[];
        hasUserVisiblePreActionRationale: boolean;
        /** @deprecated use hasUserVisiblePreActionRationale */
        hasPublicPlan: boolean;
        hasVerificationTarget: boolean;
        knownLayerIds: number[];
        /**
         * 最近一次携带明确文档身份的成功读取/建文档结果。
         * 仅用于在真正的 Photoshop 写执行边界生成私有 target guard；不授予执行权限。
         */
        targetGuard?: AgentToolExecutionTargetGuard;
    };
    blockers: string[];
    warnings: string[];
    clarification?: {
        reason: 'property_ambiguous' | 'source_value_not_found';
        question: string;
    };
}

export interface AgentToolExecutionPreflightLogEntry {
    name: string;
    arguments?: any;
    result?: any;
}

export interface AgentToolExecutionPreflightInput {
    userRequest?: string;
    assistantContent?: string;
    toolCalls: Array<{ name: string; arguments?: any }>;
    verificationToolCalls?: Array<{ name: string; arguments?: any }>;
    completedToolCalls?: AgentToolExecutionPreflightLogEntry[];
    requiresUserVisiblePreActionRationale?: boolean;
    /** @deprecated use requiresUserVisiblePreActionRationale */
    requiresPublicPlan?: boolean;
}

const READ_ONLY_OBSERVATION_TOOLS = new Set([
    'getDocumentInfo',
    'getDocumentSnapshot',
    'getAcceptanceSnapshot',
    'getCanvasSnapshot',
    'getAnnotatedSnapshot',
    'getLayerHierarchy',
    'findLayers',
    'getAllTextLayers',
    'getLayerBounds',
    'getLayerProperties',
    'exportLayerAsBase64',
    'getTextContent',
    'getTextStyle',
    'getElementMapping',
    'analyzeLayout',
    'parseDetailPageTemplate',
    'detectLayerIssues',
    'getScreenSnapshots',
    'getScreenSnapshotsWithOverlay',
    'auditDetailPagePlacement',
    'describeImage',
    'diagnoseState'
]);

const PRIOR_DOCUMENT_READ_TOOLS = new Set([
    'getDocumentInfo',
    'getDocumentSnapshot',
    'getAcceptanceSnapshot',
    'getCanvasSnapshot',
    'getAnnotatedSnapshot',
    'getLayerHierarchy',
    'findLayers',
    'getAllTextLayers',
    'getLayerBounds',
    'getLayerProperties',
    'exportLayerAsBase64',
    'getTextContent',
    'getTextStyle',
    'getElementMapping',
    'analyzeLayout',
    'parseDetailPageTemplate',
    'getScreenSnapshots',
    'getScreenSnapshotsWithOverlay',
    'auditDetailPagePlacement',
    'diagnoseState',
    // 治理审计(2026-07-01)补齐：形态变形所需的轮廓读取来源
    'extractShapePath',
    'getLayerContour',
    'getTemplateStructure'
]);

const CONTEXT_READ_TOOLS = new Set([
    'capturePhotoshopWindow',
    'listDocuments',
    'listProjectResources',
    'searchProjectResources',
    'createProjectContactSheetOverview',
    'analyzeProjectContactSheetOverview',
    'analyzeProjectForDetailPage',
    'matchDetailPageContent',
    'resolveFontName',
    'getDesignProjectState',
    'getDesignTaskCard',
    'evaluateDesign',
    'studyReference',
    // 素材理解 / 推荐：只读分析，不改 Photoshop
    'analyzeAssetContent',
    'recommendAssets',
    // 设计源解析（PSD 知识库 P0）：离线读设计师 PSD/PSB 结构，只读不落盘
    'analyzePsdDesignSource',
    // 参考构图测量：本地主体检测+纯逻辑换算，只读不落盘
    'measureReferenceComposition',
    // Eagle 条目路径仅在主进程内部解析；返回的是去路径后的视觉观察。
    'analyzeEagleReference',
    // Eagle 素材真实视觉观察（P3）：从不透明 assetRef 观察素材图像，只读、回包无本地路径
    'observeEagleAsset'
]);

export const AGENT_HARNESS_CONTROL_TOOL_NAMES: readonly string[] = Object.freeze([
    // Capability 目录检索不执行动作、不改变 schema；装载请求只改变下一轮模型可见 schema。
    'searchAgentCapabilities',
    'requestAgentCapabilities',
    // V2「意图交给 Agent 理解」：模型自主声明本轮设计任务类型（元/控制工具，只读、不写 PS）。
    // 刻意归 stateful_context 而非 read_only_observation——它声明上下文、不观察画面，绝不能被完成门禁
    // 当成"改后已复核"的观察结果（那会放过幻觉式完成）。与 photoshop-tool-skill.ts 同步。
    'declareDesignIntent',
    // R1 Design Brief 由模型声明、Harness 按 manifest 输入校验；不执行动作、不算任务进展。
    DECLARE_DESIGN_BRIEF_TOOL_NAME,
    // R2 参考决策由模型声明、Harness 按 Skill reference_policy 与真实视觉观察校验。
    DECLARE_REFERENCE_BRIEF_TOOL_NAME,
    // R3 策略由模型结构化声明；Harness 只校验并记录阶段状态，不执行 Photoshop、不算任务进展。
    DECLARE_DESIGN_STRATEGY_TOOL_NAME,
    // R4 行动计划 / Design DSL 只形成运行计划，不拥有 Capability 激活或 Tool 调度权。
    DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME
]);

export function isAgentHarnessControlTool(toolName: unknown): boolean {
    const normalized = String(toolName || '').trim();
    return AGENT_HARNESS_CONTROL_TOOL_NAMES.includes(normalized);
}

/** 缺少 R1 输入时仍可使用的用户交互动作；只收集输入，不推进 Photoshop 执行阶段。 */
export function isAgentInputCollectionTool(toolName: unknown): boolean {
    return String(toolName || '').trim() === 'createInteractiveCard';
}

export const READ_ONLY_AGENT_CONTEXT_TOOL_NAMES: readonly string[] = Object.freeze([
    'searchAgentCapabilities',
    'requestAgentCapabilities',
    'switchDocument',
    'selectLayer',
    'focusLayer'
]);

export function isReadOnlyAgentContextTool(toolName: unknown): boolean {
    const normalized = String(toolName || '').trim();
    return READ_ONLY_AGENT_CONTEXT_TOOL_NAMES.includes(normalized);
}

/**
 * 未知 Skill 副作用完成同版本视觉对账后，可安全进入的文档上下文迁移。
 * 这些动作只改变“接下来操作哪个文档”，不改已有文档内容；创建、关闭、保存以及
 * 任意一般 stateful_context 都不在此列，避免把恢复出口变成新的权限旁路。
 */
const AGENT_RECONCILIATION_CONTEXT_TRANSITION_TOOL_NAMES: ReadonlySet<string> = new Set([
    'switchDocument',
    'openProjectFile',
    'openTemplate'
]);

export function isAgentReconciliationContextTransition(toolName: unknown): boolean {
    return AGENT_RECONCILIATION_CONTEXT_TRANSITION_TOOL_NAMES.has(
        String(toolName || '').trim()
    );
}

const STATEFUL_CONTEXT_TOOLS = new Set([
    // Skill 包脚本是黑盒子进程（可能读写项目文件），强制串行、写预检可见全部前序结果。
    'runSkillScript',
    // 手册改进提议写学习候选账本（项目文件），串行防并发写乱；不写 Photoshop 不改手册本身。
    'proposeSkillImprovement',
    'createInteractiveCard',
    ...AGENT_HARNESS_CONTROL_TOOL_NAMES,
    'switchDocument',
    'openProjectFile',
    'selectLayer',
    'focusLayer',
    'delegateToAgent',
    // 写共享项目状态文件（非 Photoshop 写入），归为状态上下文类
    'updateDesignProjectState',
    // 设计任务卡（会话内计划与完成契约，非 Photoshop 写入）；与 photoshop-tool-skill.ts 同步
    'planDesignTaskCard',
    'updateDesignTaskCard',
    // 让用户帮我选（列选项、可能暂停本轮）；非 Photoshop 写入
    'askUserToChoose',
    // 学习候选区（写项目 .designecho，非 Photoshop 写入）
    'recordDesignVerdict',
    'getDesignLearningTimeline',
    'learnTasteFromEagle',
    // 设计知识笔记写入（写本地笔记库 Markdown，非 Photoshop 写入）；与 photoshop-tool-skill.ts 同步
    'writeDesignNote',
    // Eagle 素材复制进项目（P3）：写项目目录（非 Photoshop 写入），需串行；与 photoshop-tool-skill.ts 同步
    'importEagleAssetToProject',
    // 撤销/重做：改变历史与文档状态，需串行执行，但不要求前置文档读取
    'undo',
    'redo',
    // 浏览器扩展写/状态工具（改变用户浏览器视图或页面状态，需串行；与 photoshop-tool-skill.ts 同步）
    'captureBrowserTab',
    'navigateBrowserTab',
    'interactWithBrowserPage'
]);

const SAVE_EXPORT_TOOLS = new Set([
    'saveDocument',
    'smartSave',
    'quickExport',
    'exportGroup',
    'exportMainImageDocuments',
    'exportDetailPageSlices',
    'exportWhiteBgFromSkuMaterial',
    // 治理审计(2026-07-01)补齐：与 photoshop-tool-skill.ts 的 SAVE_EXPORT_TOOLS 保持同步
    'exportToSkuDir',
    'batchExport'
]);

const EXTERNAL_GENERATION_TOOLS = new Set([
    'generateImage',
    'prepareSkuRetouchAssets'
]);

const KNOWLEDGE_SEARCH_TOOLS = new Set([
    'searchDesigns',
    'fetchWebPageDesignContent',
    'getDesignKnowledge',
    'getMainImageDesignFramework',
    'getDetailPageDesignFramework',
    'getDesignPrinciples',
    'searchEagleReferences',
    'webSearch',
    'searchDesignKnowledge',
    'readSkillPlaybook',
    // 设计知识笔记只读工具（与 photoshop-tool-skill.ts 的 KNOWLEDGE_SEARCH_TOOLS 保持同步，audit:tools 校验）
    'searchDesignNotes',
    'readDesignNote',
    // 浏览器扩展只读工具（与 photoshop-tool-skill.ts 的 KNOWLEDGE_SEARCH_TOOLS 保持同步，audit:tools 校验）
    'listBrowserTabs',
    'readBrowserPage'
]);

const EXTRA_PHOTOSHOP_WRITE_TOOLS = new Set([
    'fixLayerIssues',
    // 团队流水线含 executor 写入阶段，按写类工具纳入读后写纪律
    'runDesignTeamPipeline',
    // 主体感知缩放：组合工具（读主体/图框 → 求解 → alignToReference 写入），按写类纳入读后写纪律
    'fitLayerSubjectToRegion'
]);

const DOCUMENT_CONTEXT_BARRIER_TOOLS = new Set([
    'createDocument',
    // 一次成稿车间默认新建画布并切为活动文档
    'composeDesign',
    'switchDocument',
    'openProjectFile',
    'openTemplate',
    'editSmartObjectContents',
    'closeDocument'
]);

/**
 * 会改变 Photoshop 活动文档的操作。参数化的 Smart Object 读取只有 autoOpen=true
 * 才是上下文屏障；集中在这里，避免 preflight、Completion 与视觉 Judge 各自维护白名单。
 */
export function isAgentDocumentContextBarrier(toolName: unknown, params: any = {}): boolean {
    const name = normalizeToolName(toolName);
    if (name === 'getSmartObjectLayers') return params?.autoOpen === true;
    return DOCUMENT_CONTEXT_BARRIER_TOOLS.has(name);
}

const ACTIVE_LAYER_CONTEXT_MUTATION_TOOLS = new Set([
    'selectLayer',
    'focusLayer',
    'undo',
    'redo'
]);

/**
 * 会使 Agent 本轮只读缓存中的某个事实域失效的状态变化。
 *
 * 文档切换复用统一 document-context barrier；其余项复用本文件现有的副作用分类，
 * 避免缓存层再维护一份不完整的 Tool 名单。这里只描述失效，不改变 Tool 权限或分类。
 */
export function isAgentReadCacheInvalidatingContext(toolName: unknown, params: any = {}): boolean {
    const name = normalizeToolName(toolName);
    return isAgentDocumentContextBarrier(name, params)
        || ACTIVE_LAYER_CONTEXT_MUTATION_TOOLS.has(name)
        || name === 'updateDesignProjectState'
        || name === 'importEagleAssetToProject'
        || EXTERNAL_GENERATION_TOOLS.has(name);
}

const PRE_ACTION_RATIONALE_KEYWORDS = /(计划|准备|我会|我将|将要|继续|生成|需要|先|然后|接着|下一步|读取|确认|检查|创建|修改|放置|执行|保存|导出|判断|依据|复核|plan|next|first|then)/i;
const VERIFICATION_KEYWORDS = /(验证|验收|复核|检查|确认|回读|截图|快照|结果|状态|图层|文档|画面|保存后|导出后|verify|check|inspect|snapshot|readback|result)/i;

export const SIMPLE_MECHANICAL_GUARDED_TOOLS = new Set([
    'createDocument',
    'createGroup',
    'createRectangle',
    'createEllipse',
    'createTextLayer',
    'setTextContent',
    'setTextStyle',
    'setLayerOpacity',
    'setBlendMode',
    'setLayerFill',
    'addStroke',
    'addDropShadow',
    'clearLayerEffects',
    'renameLayer',
    'moveLayer',
    'reorderLayer',
    'moveLayerToGroup',
    'groupLayers',
    'groupLayersSafely',
    'ungroupLayers',
    'duplicateLayer',
    'deleteLayer',
    'selectLayer',
    'focusLayer',
    'quickExport',
    'saveDocument',
    'smartSave',
    'addBrightnessContrastAdjustment',
    'addHueSaturationAdjustment',
    'addLevelsAdjustment',
    'addColorBalanceAdjustment',
    'addVibranceAdjustment',
    'addPhotoFilterAdjustment',
    'createClippingMask',
    'releaseClippingMask'
]);

function toolSucceeded(entry: AgentToolExecutionPreflightLogEntry): boolean {
    return entry.result?.success !== false;
}

function normalizeToolName(name: unknown): string {
    return String(name || '').trim();
}

function normalizeAssistantContent(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function createsOwnedDocumentBeforeWriting(
    toolCalls: Array<{ name: string; arguments?: any }>,
    toolName: string
): boolean {
    if (toolName !== 'composeDesign') return false;
    const call = toolCalls.find((candidate) => normalizeToolName(candidate?.name) === toolName);
    return String(call?.arguments?.document?.mode || '').trim().toLowerCase() === 'new';
}

function isPriorDocumentReadTool(name: string): boolean {
    return PRIOR_DOCUMENT_READ_TOOLS.has(name);
}

function isFreshDocumentCreationResult(entry: AgentToolExecutionPreflightLogEntry): boolean {
    if (normalizeToolName(entry.name) !== 'createDocument') return false;
    if (!toolSucceeded(entry)) return false;
    const result = entry.result || {};
    if (result?.acceptance?.after?.hasDocument === true) return true;
    if (result?.document && typeof result.document === 'object') return true;
    if (result?.documentId || result?.id) return true;
    return Number(result?.width) > 0 && Number(result?.height) > 0;
}

function readPositiveInteger(value: unknown): number | undefined {
    const numeric = typeof value === 'number'
        ? value
        : (typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return undefined;
    return numeric;
}

function readFirstPositiveInteger(values: unknown[]): number | undefined {
    for (const value of values) {
        const parsed = readPositiveInteger(value);
        if (parsed !== undefined) return parsed;
    }
    return undefined;
}

/**
 * 从一次真实观察结果里读出活动文档 id。
 *
 * 对外导出供 Skill workflow bridge 使用：技能启动前需要知道「当前真实活动文档是谁」，
 * 才能与模型上下文里的期望目标比对；这里是同一份读取口径，不另建第二套解析。
 */
export function readObservedDocumentId(toolName: string, result: any): number | undefined {
    return readDocumentIdFromObservationResult(toolName, result);
}

function readDocumentIdFromObservationResult(toolName: string, result: any): number | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const data = result.data && typeof result.data === 'object' ? result.data : {};
    const nestedResult = result.result && typeof result.result === 'object' ? result.result : {};
    const document = result.document && typeof result.document === 'object' ? result.document : {};
    const activeDocument = result.activeDocument && typeof result.activeDocument === 'object'
        ? result.activeDocument
        : {};
    const documentInfo = result.documentInfo && typeof result.documentInfo === 'object'
        ? result.documentInfo
        : {};
    const stateDocumentInfo = result.state?.documentInfo && typeof result.state.documentInfo === 'object'
        ? result.state.documentInfo
        : {};
    const dataDocument = data.document && typeof data.document === 'object' ? data.document : {};
    const dataDocumentInfo = data.documentInfo && typeof data.documentInfo === 'object'
        ? data.documentInfo
        : {};
    const nestedDocument = nestedResult.document && typeof nestedResult.document === 'object'
        ? nestedResult.document
        : {};
    const firstSnapshot = Array.isArray(result.snapshots) && result.snapshots[0]
        && typeof result.snapshots[0] === 'object'
        ? result.snapshots[0]
        : {};

    return readFirstPositiveInteger([
        result.documentId,
        result.activeDocumentId,
        document.documentId,
        document.id,
        activeDocument.documentId,
        activeDocument.id,
        documentInfo.documentId,
        documentInfo.id,
        data.documentId,
        data.activeDocumentId,
        dataDocument.documentId,
        dataDocument.id,
        dataDocumentInfo.documentId,
        dataDocumentInfo.id,
        nestedResult.documentId,
        nestedDocument.documentId,
        nestedDocument.id,
        stateDocumentInfo.documentId,
        stateDocumentInfo.id,
        result.debug?.documentId,
        firstSnapshot.documentId,
        result.acceptance?.after?.documentId,
        result.acceptance?.after?.document?.id,
        // historyStateRef 是 Host 在 executeAsModal 内绑定的权威文档身份，比任何平铺字段都可信。
        // 放在最后作为兜底：像 getLayerBounds 这类只返回图层数据 + historyStateRef、
        // 不带顶层 documentId 的观察工具，否则会被判为「读不出文档身份」而整条观察被跳过，
        // 于是扫描继续前溯并撞上文档切换，最终签发不出 guard——真机表现为
        // 「moveLayer 必须绑定已观察的文档历史版本」反复失败。
        readPhotoshopHistoryStateRef(result)?.documentId,
        // createDocument 的历史适配器曾把新文档 id 放在根级 id；其他读取工具的根级 id
        // 可能是图层/标注 id，绝不能泛化使用。
        toolName === 'createDocument' ? result.id : undefined
    ]);
}

function readActiveLayerIdFromObservationResult(result: any): number | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const data = result.data && typeof result.data === 'object' ? result.data : {};
    const nestedResult = result.result && typeof result.result === 'object' ? result.result : {};
    const document = result.document && typeof result.document === 'object' ? result.document : {};
    const activeDocument = result.activeDocument && typeof result.activeDocument === 'object'
        ? result.activeDocument
        : {};
    const documentInfo = result.documentInfo && typeof result.documentInfo === 'object'
        ? result.documentInfo
        : {};
    const dataDocument = data.document && typeof data.document === 'object' ? data.document : {};
    const dataDocumentInfo = data.documentInfo && typeof data.documentInfo === 'object'
        ? data.documentInfo
        : {};
    const nestedDocument = nestedResult.document && typeof nestedResult.document === 'object'
        ? nestedResult.document
        : {};

    return readFirstPositiveInteger([
        result.activeLayerId,
        result.activeLayer?.id,
        document.activeLayerId,
        document.activeLayer?.id,
        activeDocument.activeLayerId,
        activeDocument.activeLayer?.id,
        documentInfo.activeLayerId,
        documentInfo.activeLayer?.id,
        data.activeLayerId,
        data.activeLayer?.id,
        dataDocument.activeLayerId,
        dataDocument.activeLayer?.id,
        dataDocumentInfo.activeLayerId,
        dataDocumentInfo.activeLayer?.id,
        nestedResult.activeLayerId,
        nestedResult.activeLayer?.id,
        nestedDocument.activeLayerId,
        nestedDocument.activeLayer?.id
    ]);
}

interface ResolvedToolExecutionTargetGuard {
    guard?: AgentToolExecutionTargetGuard;
    logIndex: number;
}

function hasSuccessfulActiveLayerMutationAfter(
    completedToolCalls: AgentToolExecutionPreflightLogEntry[],
    observationIndex: number
): boolean {
    return completedToolCalls.slice(observationIndex + 1).some((entry) => {
        if (!toolSucceeded(entry)) return false;
        const name = normalizeToolName(entry.name);
        return ACTIVE_LAYER_CONTEXT_MUTATION_TOOLS.has(name)
            || isAgentToolExecutionGuarded(name);
    });
}

function resolveLatestToolExecutionTargetGuard(
    completedToolCalls: AgentToolExecutionPreflightLogEntry[]
): ResolvedToolExecutionTargetGuard | undefined {
    for (let index = completedToolCalls.length - 1; index >= 0; index -= 1) {
        const entry = completedToolCalls[index];
        const name = normalizeToolName(entry?.name);
        const mutationCommit = readPhotoshopMutationCommit(entry?.result);
        const historyTransition = readPhotoshopHistoryTransition(entry?.result);
        const crossedDocument = historyTransition?.documentChanged === true
            || mutationCommit?.documentChanged === true;
        if (crossedDocument) {
            const createdDocumentAfter = name === 'createDocument' && toolSucceeded(entry)
                ? (historyTransition?.after || mutationCommit?.after)
                : undefined;
            if (!createdDocumentAfter) {
                // 失败写、关闭/打开或外部切换不能把旧文档的“已读”资格搬到新文档。
                // 只有成功 createDocument 是受控的新目标生产者；其余必须重新观察。
                return { logIndex: index };
            }
            return {
                guard: {
                    expectedDocumentId: createdDocumentAfter.documentId,
                    expectedHistoryStateRef: {
                        documentId: createdDocumentAfter.documentId,
                        historyStateId: createdDocumentAfter.historyStateId
                    },
                    observationTool: `${name}:created_document_after`
                },
                logIndex: index
            };
        }
        if (historyTransition?.after) {
            const commitAfterMatchesAcceptance = Boolean(mutationCommit?.after
                && mutationCommit.after.documentId === historyTransition.after.documentId
                && mutationCommit.after.historyStateId === historyTransition.after.historyStateId);
            const matchingActiveLayerId = commitAfterMatchesAcceptance
                && typeof mutationCommit?.after?.activeLayerId === 'number'
                ? mutationCommit.after.activeLayerId
                : undefined;
            return {
                guard: {
                    expectedDocumentId: historyTransition.after.documentId,
                    expectedHistoryStateRef: historyTransition.after,
                    ...(matchingActiveLayerId === undefined
                        ? {}
                        : { expectedActiveLayerId: matchingActiveLayerId }),
                    observationTool: `${name}:acceptance_after`
                },
                logIndex: index
            };
        }
        if (mutationCommit?.after) {
            return {
                guard: {
                    expectedDocumentId: mutationCommit.after.documentId,
                    expectedHistoryStateRef: {
                        documentId: mutationCommit.after.documentId,
                        historyStateId: mutationCommit.after.historyStateId
                    },
                    ...(mutationCommit.after.activeLayerId === null
                        ? {}
                        : { expectedActiveLayerId: mutationCommit.after.activeLayerId }),
                    observationTool: `${name}:mutation_commit_after`
                },
                logIndex: index
            };
        }
        if (!toolSucceeded(entry)) continue;
        // createDocument 同时是上下文屏障和新目标生产者：若结果带稳定 id，下面仍应签发
        // 新文档 guard；其他屏障不能让更早观察跨过去继续生效。
        if (name !== 'createDocument' && isAgentDocumentContextBarrier(name, entry.arguments)) {
            return { logIndex: index };
        }
        if (!isPriorDocumentReadTool(name) && name !== 'createDocument') continue;
        const expectedDocumentId = readDocumentIdFromObservationResult(name, entry.result);
        if (expectedDocumentId === undefined) {
            // 成功 createDocument 已改变活动文档；若返回值没有稳定 id，旧目标不能跨越它继续生效。
            if (name === 'createDocument') return { logIndex: index };
            continue;
        }
        const expectedActiveLayerId = readActiveLayerIdFromObservationResult(entry.result);
        const activeLayerStillFresh = !hasSuccessfulActiveLayerMutationAfter(
            completedToolCalls,
            index
        );
        const expectedHistoryStateRef = activeLayerStillFresh
            ? readPhotoshopHistoryStateRef(entry.result)
            : undefined;
        return {
            guard: {
                expectedDocumentId,
                ...(activeLayerStillFresh && expectedActiveLayerId !== undefined
                    ? { expectedActiveLayerId }
                    : {}),
                ...(expectedHistoryStateRef?.documentId === expectedDocumentId
                    ? { expectedHistoryStateRef }
                    : {}),
                observationTool: name
            },
            logIndex: index
        };
    }
    return undefined;
}

function hasNonEmptyParam(params: any, keys: string[]): boolean {
    if (!params || typeof params !== 'object') return false;
    return keys.some((key) => {
        const value = params?.[key];
        if (Array.isArray(value)) return value.length > 0;
        return typeof value === 'string'
            ? value.trim().length > 0
            : value !== undefined && value !== null;
    });
}

function hasExplicitSaveExportTarget(toolCalls: Array<{ name: string; arguments?: any }>): boolean {
    return toolCalls.some((call) => {
        const name = normalizeToolName(call?.name);
        if (!SAVE_EXPORT_TOOLS.has(name)) return false;
        return hasNonEmptyParam(call?.arguments, [
            'outputPath',
            'path',
            'outputDir',
            'projectSubdir',
            'sourceDocumentPath'
        ]);
    });
}

function hasExplicitReadbackVerificationTarget(toolCalls: Array<{ name: string; arguments?: any }>): boolean {
    return toolCalls.some((call) => {
        const name = normalizeToolName(call?.name);
        return PRIOR_DOCUMENT_READ_TOOLS.has(name);
    });
}

export function requiresUserVisiblePreActionRationaleForToolCalls(
    toolCalls: Array<{ name: string; arguments?: any }>
): boolean {
    const guardedCalls = (Array.isArray(toolCalls) ? toolCalls : [])
        .filter((call) => isAgentToolExecutionGuarded(call?.name, call?.arguments));
    if (guardedCalls.length === 0) return false;
    return guardedCalls.some((call) => !SIMPLE_MECHANICAL_GUARDED_TOOLS.has(normalizeToolName(call?.name)));
}

interface LayerIdSourcePolicy {
    allowExplicitLayerIds: boolean;
    allowLayerTree: boolean;
}

function collectFiniteLayerIdArray(value: unknown, ids: Set<number>): void {
    if (!Array.isArray(value)) return;
    for (const candidate of value) {
        if (typeof candidate === 'number' && Number.isFinite(candidate)) ids.add(candidate);
    }
}

function collectLayerIdsFromValue(
    value: any,
    ids: Set<number>,
    policy: LayerIdSourcePolicy
): void {
    if (!value || typeof value !== 'object') return;
    if (policy.allowExplicitLayerIds
        && typeof value.layerId === 'number'
        && Number.isFinite(value.layerId)) {
        ids.add(value.layerId);
    }
    if (policy.allowExplicitLayerIds) {
        collectFiniteLayerIdArray(value.layerIds, ids);
        collectFiniteLayerIdArray(value.createdLayerIds, ids);
        collectFiniteLayerIdArray(value.subjectLayerIds, ids);
    }
    const looksLikeLayer = typeof value.name === 'string'
        && (
            value.kind !== undefined
            || value.layerKind !== undefined
            || value.bounds !== undefined
            || value.visible !== undefined
            || Array.isArray(value.children)
        );
    if (policy.allowLayerTree
        && looksLikeLayer
        && typeof value.id === 'number'
        && Number.isFinite(value.id)) {
        ids.add(value.id);
    }
    if (value.layer && typeof value.layer === 'object') {
        if (policy.allowExplicitLayerIds
            && typeof value.layer.id === 'number'
            && Number.isFinite(value.layer.id)) {
            ids.add(value.layer.id);
        }
        collectLayerIdsFromValue(value.layer, ids, policy);
    }
    if (value.data && typeof value.data === 'object') {
        collectLayerIdsFromValue(value.data, ids, policy);
    }
    if (value.result && typeof value.result === 'object') {
        collectLayerIdsFromValue(value.result, ids, policy);
    }
    if (policy.allowExplicitLayerIds && Array.isArray(value.created)) {
        value.created.forEach((item: any) => collectLayerIdsFromValue(item, ids, policy));
    }
    if (policy.allowLayerTree && Array.isArray(value.layers)) {
        value.layers.forEach((item: any) => collectLayerIdsFromValue(item, ids, policy));
    }
    if (policy.allowLayerTree && Array.isArray(value.children)) {
        value.children.forEach((item: any) => collectLayerIdsFromValue(item, ids, policy));
    }
    // getLayerHierarchy 在不同 UXP/桥版本中分别使用 hierarchy / flatList 返回图层树。
    // 已经从真实 Photoshop 读回的 ID 必须进入目标 lineage；否则 Harness 会先看见 layerId，
    // 随后又以“未确认”拦住同一 layerId 的修订动作，造成读写协议自相矛盾。
    // 但只有真实图层检索工具可以把这两个容器声明为 Photoshop lineage；
    // 其他业务/检索结果即使碰巧含同名字段，也不能借此授权后续写入任意 layerId。
    if (policy.allowLayerTree && Array.isArray(value.hierarchy)) {
        value.hierarchy.forEach((item: any) => collectLayerIdsFromValue(item, ids, policy));
    }
    if (policy.allowLayerTree && Array.isArray(value.flatList)) {
        value.flatList.forEach((item: any) => collectLayerIdsFromValue(item, ids, policy));
    }
}

function hasDirectPhotoshopMutationProof(value: unknown): boolean {
    const mutationCommit = readPhotoshopMutationCommit(value);
    if (mutationCommit?.mutationObserved === true
        && mutationCommit.toolActionCompleted
        && mutationCommit.before
        && mutationCommit.after
        && mutationCommit.before.documentId === mutationCommit.after.documentId) {
        return true;
    }
    const historyTransition = readPhotoshopHistoryTransition(value);
    return Boolean(
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && (value as Record<string, unknown>).success === true
        && historyTransition?.mutationObserved === true
        && historyTransition.before
        && historyTransition.after
        && historyTransition.before.documentId === historyTransition.after.documentId
    );
}

/**
 * Workflow 外层报告不拥有内部 Photoshop Tool 的图层身份。
 * 每个 layerId 必须与同一个结果节点上的 Host mutation proof 一起出现；
 * 不能因为某个内部 Tool 真实改过 layer 71，就顺带信任外层误报的 layer 999。
 */
function collectLayerIdsFromProvenPhotoshopWriteResults(
    value: unknown,
    ids: Set<number>,
    depth = 0
): void {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 6) return;
    const record = value as Record<string, unknown>;
    if (hasDirectPhotoshopMutationProof(record)) {
        collectLayerIdsFromValue(record, ids, {
            allowExplicitLayerIds: true,
            allowLayerTree: false
        });
    }
    if (!Array.isArray(record.toolResults)) return;
    for (const entry of record.toolResults.slice(0, 128)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const toolResult = entry as Record<string, unknown>;
        if (typeof toolResult.toolName !== 'string'
            || toolResult.toolName.trim().length === 0
            || !Object.prototype.hasOwnProperty.call(toolResult, 'result')) {
            continue;
        }
        collectLayerIdsFromProvenPhotoshopWriteResults(toolResult.result, ids, depth + 1);
    }
}

/**
 * Layer identity belongs to a Photoshop document lineage, not to the latest
 * acceptance snapshot. A same-document write advances history state but does
 * not invalidate IDs returned by earlier proven writes in that document.
 *
 * Start a new lineage only at a real document-context boundary (create/open/
 * switch/close) or after observing a different document identity.
 */
function resolveCurrentDocumentLineageStartIndex(
    completedToolCalls: AgentToolExecutionPreflightLogEntry[],
    latestTargetObservation?: ResolvedToolExecutionTargetGuard
): number {
    if (!latestTargetObservation) return 0;
    if (!latestTargetObservation.guard) return latestTargetObservation.logIndex;

    const targetDocumentId = latestTargetObservation.guard.expectedDocumentId;
    let targetIdentityStartIndex = latestTargetObservation.logIndex;
    for (let index = latestTargetObservation.logIndex; index >= 0; index -= 1) {
        const entry = completedToolCalls[index];
        const name = normalizeToolName(entry?.name);
        const mutationCommit = readPhotoshopMutationCommit(entry?.result);
        const historyTransition = readPhotoshopHistoryTransition(entry?.result);
        if (historyTransition?.documentChanged === true
            || mutationCommit?.documentChanged === true
            || isAgentDocumentContextBarrier(name, entry?.arguments)) {
            return index;
        }

        if (!toolSucceeded(entry) || !isPriorDocumentReadTool(name)) continue;
        const observedDocumentId = readDocumentIdFromObservationResult(name, entry.result);
        if (observedDocumentId === targetDocumentId) {
            targetIdentityStartIndex = index;
            continue;
        }
        if (observedDocumentId !== undefined) {
            return targetIdentityStartIndex;
        }
    }
    return 0;
}

function collectKnownLayerIds(
    completedToolCalls: AgentToolExecutionPreflightLogEntry[],
    latestTargetObservation?: ResolvedToolExecutionTargetGuard
): number[] {
    const ids = new Set<number>();
    if (latestTargetObservation?.guard?.expectedActiveLayerId !== undefined) {
        ids.add(latestTargetObservation.guard.expectedActiveLayerId);
    }
    const lineageStartIndex = resolveCurrentDocumentLineageStartIndex(
        completedToolCalls,
        latestTargetObservation
    );
    const scopedCalls = completedToolCalls.slice(lineageStartIndex);
    for (const entry of scopedCalls) {
        if (!toolSucceeded(entry)) continue;
        const sourceToolName = normalizeToolName(entry.name);
        const executionKind = classifyAgentToolExecution(sourceToolName, entry.arguments);
        const photoshopObservation = isAgentPhotoshopDocumentObservation(
            sourceToolName,
            entry.arguments
        );
        const photoshopWrite = executionKind === 'photoshop_write';
        if (photoshopObservation) {
            collectLayerIdsFromValue(entry.result, ids, {
                allowExplicitLayerIds: true,
                allowLayerTree: true
            });
            continue;
        }
        if (photoshopWrite) {
            collectLayerIdsFromProvenPhotoshopWriteResults(entry.result, ids);
        }
    }
    // 跨文档切换后恢复仍然成立的观察（2026-08-06）。
    // 线性血统在每次 switchDocument 处截断，于是「切走看一眼、再切回来」会让这份文档
    // 之前读到的图层全部作废。真机代价：做主图+详情页+SKU 要在多个文档间来回，
    // 每切一次账本清零，回来就被「这些图层未被系统登记」拦住，被迫逐个 getLayerProperties
    // 重读（实测 5 次重读 + 3 次拦截，轮次烧光后 0 产出）。多文档来回是设计任务的常态。
    collectLayerIdsStillValidAfterDocumentSwitch(
        completedToolCalls,
        latestTargetObservation?.guard?.expectedDocumentId,
        ids
    );
    return Array.from(ids).sort((a, b) => a - b);
}

/**
 * 找回「因切换文档而被作废、但事实上仍然准确」的图层 ID。
 *
 * 安全边界（宁可多读一次，也不能拿过期 ID 写真实文件）：
 * - 必须能确认当前目标文档身份，否则不恢复任何东西；
 * - 观察结果必须自报同一个 documentId，跨文档的一律不收；
 * - 任何一次成功写入都会重置恢复窗口——只有「最后一次写入之后」的观察才可信。
 *   这里刻意不区分写入发生在哪个文档：写入结果未必自报文档身份，
 *   与其猜，不如整体作废重读。只读浏览（本次要救的场景）不受影响。
 */
function collectLayerIdsStillValidAfterDocumentSwitch(
    completedToolCalls: AgentToolExecutionPreflightLogEntry[],
    targetDocumentId: number | undefined,
    ids: Set<number>
): void {
    if (targetDocumentId === undefined) return;

    let lastWriteIndex = -1;
    for (let index = 0; index < completedToolCalls.length; index += 1) {
        const entry = completedToolCalls[index];
        if (!toolSucceeded(entry)) continue;
        const kind = classifyAgentToolExecution(normalizeToolName(entry.name), entry.arguments);
        if (kind === 'photoshop_write' || kind === 'save_export') lastWriteIndex = index;
    }

    for (let index = lastWriteIndex + 1; index < completedToolCalls.length; index += 1) {
        const entry = completedToolCalls[index];
        if (!toolSucceeded(entry)) continue;
        const name = normalizeToolName(entry.name);
        if (!isAgentPhotoshopDocumentObservation(name, entry.arguments)) continue;
        if (readDocumentIdFromObservationResult(name, entry.result) !== targetDocumentId) continue;
        collectLayerIdsFromValue(entry.result, ids, {
            allowExplicitLayerIds: true,
            allowLayerTree: true
        });
    }
}

type ExactPropertyReplacementHint = 'layer_name' | 'text_content' | 'unspecified';

const EXACT_PROPERTY_REPLACEMENT_PATTERN = /[“"「『‘']([^”"」』’']{1,128})[”"」』’']\s*(?:这个|该|的)?\s*(?:图层|文字|文本|文案|内容|名字|名称)?\s*(?:改成|改为|替换为|换成|重命名为)\s*[“"「『‘']([^”"」』’']{1,128})[”"」』’']/i;

const OTHER_EXPLICIT_MUTATION_PATTERN = /(?:新建|创建|删除|移动|缩放|旋转|对齐|编组|分组|锁定|解锁|置入|添加|复制|合并|变形|裁剪|抠图|填充|描边|阴影|调色|改色|排版|改版|重做|整体\s*(?:优化|调整)|保存|另存|导出|生成|改文案|修改文案|替换文案|重命名|改成|改为|替换为|换成|(?:颜色|字号|字体|位置|尺寸|透明度|混合模式).{0,10}(?:改|设|调整))/i;

const NEGATED_MUTATION_CLAUSE_PATTERN = /(?:不要|别|无需|不用|禁止|不得|不能|保持)[^，。；;,.!?！？\n]{0,24}(?:新建|创建|删除|移动|缩放|旋转|对齐|编组|分组|锁定|解锁|置入|添加|复制|合并|变形|裁剪|抠图|填充|描边|阴影|调色|改色|排版|改版|重做|重命名|优化|调整|保存|另存|导出|生成|改动|修改|改变|变化|动)/gi;

export interface ExactPropertyReplacementRequest {
    from: string;
    to: string;
    hint: ExactPropertyReplacementHint;
}

export interface ExactPropertyExecutionScope {
    version: 'exact-property-execution-scope/v0';
    kind: 'exact_property_replacement';
    replacement: ExactPropertyReplacementRequest;
    allowedWriteTools: Array<'renameLayer' | 'setTextContent'>;
}

/**
 * 精确属性替换的完整非写工具面。一次全量 acceptance snapshot 同时提供全文档唯一性、
 * 隐藏文字与 history provenance；不再开放文件扫描、Eagle、Team 或多种同义图层读取。
 */
export const EXACT_PROPERTY_EXECUTION_CONTEXT_TOOLS: readonly string[] = Object.freeze([
    'getDocumentInfo',
    'getAcceptanceSnapshot',
    'createInteractiveCard'
]);

interface ObservedLayerProperties {
    layerId: number;
    name?: string;
    textContent?: string;
}

export type ExactPropertyTargetResolution =
    | {
        status: 'ready';
        property: 'layer_name' | 'text_content';
        layerId: number;
        currentValue: string;
        historyStateRef: PhotoshopHistoryStateRef;
      }
    | {
        status: 'needs_observation' | 'incomplete' | 'not_found' | 'ambiguous' | 'already_applied';
        reason: string;
      };

const LAYER_PROPERTY_OBSERVATION_TOOLS = new Set([
    'getAllTextLayers',
    'getTextContent',
    'getLayerProperties',
    'findLayers',
    'getLayerHierarchy',
    'getAcceptanceSnapshot',
    'getDocumentSnapshot'
]);

function normalizeObservedProperty(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    return value.replace(/\r\n?/g, '\n').trim();
}

function readLayerIdFromPropertyRecord(record: Record<string, any>): number | undefined {
    return readFirstPositiveInteger([
        record.layerId,
        record.id,
        record.layer?.id,
        record.layer?.layerId
    ]);
}

function collectObservedLayerPropertiesFromValue(
    value: unknown,
    observed: Map<number, ObservedLayerProperties>,
    sourceToolName: string,
    depth = 0
): void {
    if (!value || typeof value !== 'object' || depth > 8) return;
    if (Array.isArray(value)) {
        for (const item of value.slice(0, 256)) {
            collectObservedLayerPropertiesFromValue(item, observed, sourceToolName, depth + 1);
        }
        return;
    }

    const record = value as Record<string, any>;
    const layerId = readLayerIdFromPropertyRecord(record);
    if (layerId !== undefined) {
        const previous = observed.get(layerId) || { layerId };
        const name = normalizeObservedProperty(record.name ?? record.layerName ?? record.layer?.name);
        const textContent = normalizeObservedProperty(
            record.contents
            ?? record.textContent
            ?? record.text?.content
            ?? (sourceToolName === 'getTextContent' ? record.content : undefined)
        );
        observed.set(layerId, {
            layerId,
            name: name ?? previous.name,
            textContent: textContent ?? previous.textContent
        });
    }

    for (const [key, child] of Object.entries(record)) {
        if (key === 'image' || key === 'base64' || key === 'dataUrl') continue;
        if (!child || typeof child !== 'object') continue;
        collectObservedLayerPropertiesFromValue(child, observed, sourceToolName, depth + 1);
    }
}

function collectObservedLayerProperties(
    completedToolCalls: AgentToolExecutionPreflightLogEntry[],
    latestTargetObservation?: ResolvedToolExecutionTargetGuard
): Map<number, ObservedLayerProperties> {
    const observed = new Map<number, ObservedLayerProperties>();
    const lineageStartIndex = resolveCurrentDocumentLineageStartIndex(
        completedToolCalls,
        latestTargetObservation
    );
    let propertyObservationStartIndex = lineageStartIndex;
    for (let index = lineageStartIndex; index < completedToolCalls.length; index += 1) {
        const entry = completedToolCalls[index];
        if (!toolSucceeded(entry)) continue;
        if (classifyAgentToolExecution(entry.name, entry.arguments) === 'photoshop_write') {
            propertyObservationStartIndex = index + 1;
        }
    }
    for (const entry of completedToolCalls.slice(propertyObservationStartIndex)) {
        const sourceToolName = normalizeToolName(entry?.name);
        if (!toolSucceeded(entry) || !LAYER_PROPERTY_OBSERVATION_TOOLS.has(sourceToolName)) continue;
        collectObservedLayerPropertiesFromValue(entry.result, observed, sourceToolName);
    }
    return observed;
}

function normalizeExactPropertyCurrentValue(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    return value.replace(/\r\n?/g, '\n');
}

function hasIncompleteExactPropertySnapshotWarning(value: unknown): boolean {
    const warning = String(value || '').trim();
    if (!warning) return false;
    if (warning.includes('截断')) return true;
    if (warning.includes('文字信息')) return true;
    return warning.includes('跳过') && !warning.includes('边界信息');
}

/**
 * 用最后一次 mutation 后的完整 acceptance snapshot，在 Harness 内一次性证明旧值的
 * 全文档唯一归属。模型无需读取几百层，也不能用自己猜的 layerId 绕过唯一性与 revision。
 */
export function resolveExactPropertyReplacementTarget(input: {
    replacement: ExactPropertyReplacementRequest;
    completedToolCalls: AgentToolExecutionPreflightLogEntry[];
}): ExactPropertyTargetResolution {
    const completedToolCalls = Array.isArray(input.completedToolCalls)
        ? input.completedToolCalls
        : [];
    const latestTargetObservation = resolveLatestToolExecutionTargetGuard(completedToolCalls);
    const lineageStartIndex = resolveCurrentDocumentLineageStartIndex(
        completedToolCalls,
        latestTargetObservation
    );
    let lastMutationIndex = lineageStartIndex - 1;
    for (let index = lineageStartIndex; index < completedToolCalls.length; index += 1) {
        const entry = completedToolCalls[index];
        if (!toolSucceeded(entry)) continue;
        const kind = classifyAgentToolExecution(entry.name, entry.arguments);
        if (kind === 'photoshop_write' || kind === 'save_export') lastMutationIndex = index;
    }

    let snapshot: Record<string, any> | undefined;
    let historyStateRef: PhotoshopHistoryStateRef | undefined;
    for (let index = completedToolCalls.length - 1; index > lastMutationIndex; index -= 1) {
        const entry = completedToolCalls[index];
        if (normalizeToolName(entry?.name) !== 'getAcceptanceSnapshot' || !toolSucceeded(entry)) {
            continue;
        }
        if (entry.arguments?.includeHidden === false || entry.arguments?.includeText === false) {
            return {
                status: 'incomplete',
                reason: '验收快照未覆盖隐藏层或文字内容，不能证明旧值在全文档唯一。'
            };
        }
        const candidate = entry.result;
        const candidateHistory = readPhotoshopHistoryStateRef(candidate);
        if (!candidate || typeof candidate !== 'object' || !candidateHistory) continue;
        snapshot = candidate as Record<string, any>;
        historyStateRef = candidateHistory;
        break;
    }
    if (!snapshot || !historyStateRef) {
        return {
            status: 'needs_observation',
            reason: '需要一次包含隐藏层和文字的完整验收快照，才能确定唯一修改目标。'
        };
    }

    const latestGuard = latestTargetObservation?.guard;
    if (latestGuard?.expectedDocumentId !== undefined
        && latestGuard.expectedDocumentId !== historyStateRef.documentId) {
        return {
            status: 'needs_observation',
            reason: '验收快照不属于当前 Photoshop 文档，需要重新读取当前文档。'
        };
    }
    if (latestGuard?.expectedHistoryStateRef
        && (latestGuard.expectedHistoryStateRef.documentId !== historyStateRef.documentId
            || latestGuard.expectedHistoryStateRef.historyStateId !== historyStateRef.historyStateId)) {
        return {
            status: 'needs_observation',
            reason: '验收快照不是当前 Photoshop 历史版本，需要重新读取后再修改。'
        };
    }

    const layers = Array.isArray(snapshot.layers) ? snapshot.layers : [];
    const warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];
    const totalLayers = Number(snapshot.summary?.totalLayers);
    if (snapshot.summary?.truncated !== false
        || !Number.isInteger(totalLayers)
        || totalLayers !== layers.length
        || warnings.some(hasIncompleteExactPropertySnapshotWarning)) {
        return {
            status: 'incomplete',
            reason: '验收快照存在截断或图层/文字读取缺口，不能据此宣称旧值唯一。'
        };
    }

    const from = input.replacement.from;
    const to = input.replacement.to;
    const candidates: Array<{
        property: 'layer_name' | 'text_content';
        layerId: number;
        currentValue: string;
    }> = [];
    const appliedCandidates: Array<{ property: 'layer_name' | 'text_content'; layerId: number }> = [];
    for (const layer of layers) {
        if (!layer || typeof layer !== 'object') continue;
        const layerId = readPositiveInteger(layer.id);
        if (layerId === undefined) continue;
        const rawName = normalizeExactPropertyCurrentValue(layer.name);
        const rawText = normalizeExactPropertyCurrentValue(layer.text?.content);
        let properties: Array<{
            property: 'layer_name' | 'text_content';
            rawValue: string | undefined;
        }>;
        if (input.replacement.hint === 'layer_name') {
            properties = [{ property: 'layer_name', rawValue: rawName }];
        } else if (input.replacement.hint === 'text_content') {
            properties = [{ property: 'text_content', rawValue: rawText }];
        } else {
            properties = [
                { property: 'layer_name', rawValue: rawName },
                { property: 'text_content', rawValue: rawText }
            ];
        }
        for (const property of properties) {
            const normalized = normalizeObservedProperty(property.rawValue);
            if (normalized === from && property.rawValue !== undefined) {
                candidates.push({
                    property: property.property,
                    layerId,
                    currentValue: property.rawValue
                });
            }
            if (normalized === to) {
                appliedCandidates.push({ property: property.property, layerId });
            }
        }
    }

    if (candidates.length > 1) {
        return {
            status: 'ambiguous',
            reason: `旧值“${from}”在当前文档匹配 ${candidates.length} 个属性，必须先明确图层或属性。`
        };
    }
    if (candidates.length === 0) {
        if (appliedCandidates.length === 1) {
            return {
                status: 'already_applied',
                reason: `当前文档已存在唯一目标值“${to}”，没有找到仍需修改的旧值“${from}”。`
            };
        }
        return {
            status: 'not_found',
            reason: `完整验收快照中没有找到旧值“${from}”。`
        };
    }
    return {
        status: 'ready',
        ...candidates[0],
        historyStateRef
    };
}

function resolveCommittedExactPropertyReplacementTool(input: {
    completedToolCalls: AgentToolExecutionPreflightLogEntry[];
    layerId: number;
    replacement: ExactPropertyReplacementRequest;
}): 'renameLayer' | 'setTextContent' | undefined {
    for (const entry of input.completedToolCalls) {
        const toolName = normalizeToolName(entry?.name);
        if (toolName !== 'renameLayer' && toolName !== 'setTextContent') continue;
        if (readPositiveInteger(entry.arguments?.layerId) !== input.layerId) continue;
        const targetValue = normalizeObservedProperty(
            toolName === 'renameLayer' ? entry.arguments?.newName : entry.arguments?.content
        );
        if (targetValue !== input.replacement.to) continue;
        const mutationCommit = readPhotoshopMutationCommit(entry.result);
        if (mutationCommit?.mutationObserved === true && mutationCommit.toolActionCompleted) {
            return toolName;
        }
    }
    return undefined;
}

function removeNegativePropertyConstraints(userRequest: string): string {
    return userRequest
        .replace(/(?:图层名|图层名称|图层名字|图层命名|画面文字|可见文字|文字内容|文本内容|文案内容).{0,8}(?:别改|不改|不要改|不要动|保持不变)/gi, ' ')
        .replace(/(?:别改|不改|不要改|不要动|保持不变).{0,8}(?:图层名|图层名称|图层名字|图层命名|画面文字|可见文字|文字内容|文本内容|文案内容)/gi, ' ');
}

function resolveExactPropertyReplacementHint(
    userRequest: string,
    replacementStartIndex: number
): ExactPropertyReplacementHint {
    const positiveRequest = removeNegativePropertyConstraints(userRequest);
    const boundedContext = positiveRequest.slice(
        Math.max(0, replacementStartIndex - 32),
        Math.min(positiveRequest.length, replacementStartIndex + 192)
    );
    if (/(画面文字|可见文字|文字内容|文本内容|改文案|替换文案|文案内容)/i.test(boundedContext)) {
        return 'text_content';
    }
    if (/(图层名|图层名称|图层命名|重命名|改名|名字)/i.test(boundedContext)) {
        return 'layer_name';
    }
    return 'unspecified';
}

export function parseExactPropertyReplacementRequest(
    userRequest: unknown
): ExactPropertyReplacementRequest | undefined {
    const text = String(userRequest || '').trim();
    if (!text) return undefined;
    const quotedReplacement = text.match(EXACT_PROPERTY_REPLACEMENT_PATTERN);
    if (!quotedReplacement) return undefined;
    const from = normalizeObservedProperty(quotedReplacement[1]);
    const to = normalizeObservedProperty(quotedReplacement[2]);
    if (!from || !to || from === to) return undefined;
    return {
        from,
        to,
        hint: resolveExactPropertyReplacementHint(text, quotedReplacement.index || 0)
    };
}

/**
 * 为只有一个明确属性替换、且没有第二个正向写入要求的请求签发最小写工具上限。
 *
 * 这是既有 runtimeAllowedWriteTools 的确定性输入，不是任务类型、Skill 选择或新的权限
 * Owner。只读观察与 Harness control 仍可用；任何额外 mutation、保存或导出要求都会
 * 返回 undefined，交回完整任务计划处理，避免局部解析器错误收窄复合请求。
 */
export function resolveExactPropertyReplacementExecutionScope(
    userRequest: unknown
): ExactPropertyExecutionScope | undefined {
    const text = String(userRequest || '').trim();
    if (!text) return undefined;
    const quotedReplacement = text.match(EXACT_PROPERTY_REPLACEMENT_PATTERN);
    const replacement = parseExactPropertyReplacementRequest(text);
    if (!quotedReplacement || !replacement) return undefined;

    const replacementStart = quotedReplacement.index || 0;
    const replacementEnd = replacementStart + quotedReplacement[0].length;
    const remainder = [
        text.slice(0, replacementStart),
        text.slice(replacementEnd)
    ]
        .join(' ')
        .replace(NEGATED_MUTATION_CLAUSE_PATTERN, ' ');
    if (OTHER_EXPLICIT_MUTATION_PATTERN.test(remainder)) return undefined;

    let allowedWriteTools: Array<'renameLayer' | 'setTextContent'>;
    if (replacement.hint === 'layer_name') {
        allowedWriteTools = ['renameLayer'];
    } else if (replacement.hint === 'text_content') {
        allowedWriteTools = ['setTextContent'];
    } else {
        allowedWriteTools = ['renameLayer', 'setTextContent'];
    }
    return {
        version: 'exact-property-execution-scope/v0',
        kind: 'exact_property_replacement',
        replacement,
        allowedWriteTools
    };
}

/**
 * 正则只能在上游已经签发 Photoshop 写入信封后收窄工具面，不能凭一句示例、
 * 追问或复盘文本自行创造执行身份。
 */
export function resolveAuthorizedExactPropertyReplacementExecutionScope(input: {
    userRequest: unknown;
    toolScope?: string;
    executionAuthorization?: string;
}): ExactPropertyExecutionScope | undefined {
    if (input.toolScope !== 'write_photoshop'
        || input.executionAuthorization !== 'confirmed_tool_required') {
        return undefined;
    }
    return resolveExactPropertyReplacementExecutionScope(input.userRequest);
}

export function resolveExactPropertyReplacementWriteToolScope(
    userRequest: unknown
): string[] | undefined {
    return resolveExactPropertyReplacementExecutionScope(userRequest)?.allowedWriteTools;
}

/**
 * 对已经由当前文档读回证明有唯一属性归属的精确替换，纠正模型选错的原子 Photoshop Tool。
 * 只处理 renameLayer / setTextContent 这一对同 layerId 的属性写入；缺少双属性观察、同时匹配、
 * 都不匹配或目标值不一致时保持原调用，让正式 preflight 阻断并要求继续观察/澄清。
 */
export function normalizeExactPropertyReplacementToolCall<
    T extends { name: string; arguments?: any }
>(input: {
    userRequest?: string;
    exactPropertyScope?: ExactPropertyExecutionScope;
    toolCall: T;
    completedToolCalls?: AgentToolExecutionPreflightLogEntry[];
}): T {
    const replacement = input.exactPropertyScope?.replacement
        || parseExactPropertyReplacementRequest(input.userRequest);
    const toolName = normalizeToolName(input.toolCall?.name);
    if (!replacement || (toolName !== 'renameLayer' && toolName !== 'setTextContent')) {
        return input.toolCall;
    }
    const completedToolCalls = Array.isArray(input.completedToolCalls)
        ? input.completedToolCalls
        : [];
    const target = resolveExactPropertyReplacementTarget({
        replacement,
        completedToolCalls
    });
    if (target.status !== 'ready') return input.toolCall;

    const resolvedToolName = target.property === 'layer_name'
        ? 'renameLayer'
        : 'setTextContent';

    return {
        ...input.toolCall,
        name: resolvedToolName,
        arguments: resolvedToolName === 'renameLayer'
            ? { layerId: target.layerId, newName: replacement.to }
            : {
                layerId: target.layerId,
                content: replacement.to,
                expectedCurrentContent: target.currentValue,
                expectedDocumentId: target.historyStateRef.documentId,
                expectedHistoryStateRef: target.historyStateRef
            }
    } as T;
}

function collectExactPropertyReplacementBlockers(input: {
    userRequest?: string;
    toolCalls: Array<{ name: string; arguments?: any }>;
    observedProperties: Map<number, ObservedLayerProperties>;
    completedToolCalls: AgentToolExecutionPreflightLogEntry[];
}): string[] {
    const replacement = parseExactPropertyReplacementRequest(input.userRequest);
    if (!replacement) return [];

    const hasExactMutationCall = (input.toolCalls || []).some((call) => {
        const name = normalizeToolName(call?.name);
        return name === 'renameLayer' || name === 'setTextContent';
    });
    if (!hasExactMutationCall) return [];
    const target = resolveExactPropertyReplacementTarget({
        replacement,
        completedToolCalls: input.completedToolCalls
    });
    if (target.status !== 'ready') return [target.reason];

    const blockers: string[] = [];
    for (const call of input.toolCalls || []) {
        const toolName = normalizeToolName(call?.name);
        if (toolName !== 'renameLayer' && toolName !== 'setTextContent') continue;
        const args = call?.arguments || {};
        const updates = toolName === 'setTextContent' && Array.isArray(args.updates)
            ? args.updates
            : [args];
        for (const update of updates) {
            const layerId = readPositiveInteger(update?.layerId);
            if (layerId === undefined) {
                blockers.push(`“${replacement.from}”到“${replacement.to}”的精确替换缺少明确 layerId，不能靠当前选中图层猜目标。`);
                continue;
            }
            if (layerId !== target.layerId) {
                blockers.push(`模型选择的图层 ${layerId} 不是完整验收快照证明的唯一目标图层 ${target.layerId}。`);
                continue;
            }
            const observed = input.observedProperties.get(layerId);
            const observedName = normalizeObservedProperty(observed?.name);
            const observedText = normalizeObservedProperty(observed?.textContent);
            const nameMatches = observedName === replacement.from;
            const textMatches = observedText === replacement.from;
            const committedTool = resolveCommittedExactPropertyReplacementTool({
                completedToolCalls: input.completedToolCalls,
                layerId,
                replacement
            });
            const committedResultObserved = committedTool === 'renameLayer'
                ? observedName === replacement.to
                : (committedTool === 'setTextContent' && observedText === replacement.to);
            const proposedValue = normalizeObservedProperty(
                toolName === 'renameLayer' ? update?.newName : update?.content
            );

            if (committedResultObserved) {
                blockers.push(`“${replacement.from}”到“${replacement.to}”的替换已经写入并从当前 Photoshop 版本读回，不要重复修改。`);
                continue;
            }
            if (proposedValue !== replacement.to) {
                blockers.push(`写入值“${proposedValue || '未提供'}”与用户要求的目标值“${replacement.to}”不一致。`);
                continue;
            }
            if (replacement.hint === 'layer_name') {
                if (!nameMatches) {
                    blockers.push(`图层 ${layerId} 的当前名称不是用户给出的旧值“${replacement.from}”，不能执行重命名替换。`);
                } else if (toolName !== 'renameLayer') {
                    blockers.push(`用户明确要求修改图层名称，但当前调用会改画面可见文字；应使用 renameLayer。`);
                }
                continue;
            }
            if (replacement.hint === 'text_content') {
                if (!textMatches) {
                    blockers.push(`图层 ${layerId} 的当前可见文字不是用户给出的旧值“${replacement.from}”，不能执行文案替换。`);
                } else if (toolName !== 'setTextContent') {
                    blockers.push(`用户明确要求修改画面文字，但当前调用只会改图层面板名称；应使用 setTextContent。`);
                }
                continue;
            }

            if (observedName === undefined || observedText === undefined) {
                blockers.push(`用户未说明要改图层名称还是画面文字；需要先读回图层 ${layerId} 的名称和可见文字再判断。`);
                continue;
            }
            if (nameMatches && textMatches) {
                blockers.push(`旧值“${replacement.from}”同时匹配图层名称和画面文字；写入前需要向用户澄清要改哪一个属性。`);
                continue;
            }
            if (!nameMatches && !textMatches) {
                blockers.push(`旧值“${replacement.from}”既不匹配图层 ${layerId} 的名称，也不匹配其可见文字；不能猜测替换对象。`);
                continue;
            }
            if (nameMatches && toolName !== 'renameLayer') {
                blockers.push(`旧值“${replacement.from}”只匹配图层名称；当前调用会误改画面文字，应改用 renameLayer。`);
            }
            if (textMatches && toolName !== 'setTextContent') {
                blockers.push(`旧值“${replacement.from}”只匹配画面文字；当前调用只会改图层名称，应改用 setTextContent。`);
            }
        }
    }
    return blockers;
}

function resolveExactPropertyReplacementClarification(input: {
    userRequest?: string;
    toolCalls: Array<{ name: string; arguments?: any }>;
    observedProperties: Map<number, ObservedLayerProperties>;
    completedToolCalls: AgentToolExecutionPreflightLogEntry[];
}): AgentToolExecutionPreflight['clarification'] {
    const replacement = parseExactPropertyReplacementRequest(input.userRequest);
    if (!replacement) return undefined;
    const call = (input.toolCalls || []).find((item) => {
        const name = normalizeToolName(item?.name);
        return name === 'renameLayer' || name === 'setTextContent';
    });
    if (!call || (call.name === 'setTextContent' && Array.isArray(call.arguments?.updates))) {
        return undefined;
    }
    const target = resolveExactPropertyReplacementTarget({
        replacement,
        completedToolCalls: input.completedToolCalls
    });
    if (target.status === 'ambiguous') {
        return {
            reason: 'property_ambiguous',
            question: `${target.reason} 请告诉我要修改的图层名称或路径。`
        };
    }
    if (target.status === 'not_found') {
        return {
            reason: 'source_value_not_found',
            question: `${target.reason} 请告诉我要修改的图层名称或准确旧文字。`
        };
    }
    if (replacement.hint !== 'unspecified') return undefined;
    const layerId = readPositiveInteger(call.arguments?.layerId);
    if (layerId === undefined) return undefined;
    const observed = input.observedProperties.get(layerId);
    const observedName = normalizeObservedProperty(observed?.name);
    const observedText = normalizeObservedProperty(observed?.textContent);
    if (observedName === undefined || observedText === undefined) return undefined;
    const nameMatches = observedName === replacement.from;
    const textMatches = observedText === replacement.from;
    const committedTool = resolveCommittedExactPropertyReplacementTool({
        completedToolCalls: input.completedToolCalls,
        layerId,
        replacement
    });
    if ((committedTool === 'renameLayer' && observedName === replacement.to)
        || (committedTool === 'setTextContent' && observedText === replacement.to)) {
        return undefined;
    }
    if (nameMatches && textMatches) {
        return {
            reason: 'property_ambiguous',
            question: `我看到“${replacement.from}”既是图层名称，也是画面里显示的文字。你想把哪一个改成“${replacement.to}”：图层名称，还是画面文字？`
        };
    }
    if (!nameMatches && !textMatches) {
        return {
            reason: 'source_value_not_found',
            question: `我在当前图层名称和画面文字里都没有找到“${replacement.from}”。你想改的是哪个图层名称或哪段画面文字？`
        };
    }
    return undefined;
}

const REQUESTED_LAYER_ID_ARGUMENT_NAMES = [
    'layerId',
    'baseLayerId',
    'targetLayerId',
    'targetGroupId',
    'placeholderLayerId'
] as const;

function collectRequestedLayerIds(toolCalls: Array<{ name: string; arguments?: any }>): number[] {
    const ids = new Set<number>();
    for (const call of toolCalls || []) {
        const args = call?.arguments || {};
        for (const argumentName of REQUESTED_LAYER_ID_ARGUMENT_NAMES) {
            const id = args[argumentName];
            // moveLayerToGroup 使用 targetGroupId=0 表示文档根级；这是工具协议中的
            // 结构哨兵，不是模型猜测的 Photoshop layerId，不能要求它出现在图层读回中。
            if (argumentName === 'targetGroupId' && id === 0) continue;
            if (typeof id === 'number' && Number.isFinite(id)) ids.add(id);
        }
        if (Array.isArray(args.layerIds)) {
            for (const id of args.layerIds) {
                if (typeof id === 'number' && Number.isFinite(id)) ids.add(id);
            }
        }
        if (normalizeToolName(call?.name || '') === 'setTextContent'
            && Array.isArray(args.updates)) {
            for (const update of args.updates) {
                const id = update?.layerId;
                if (typeof id === 'number' && Number.isFinite(id)) ids.add(id);
            }
        }
    }
    return Array.from(ids).sort((a, b) => a - b);
}

/** 技能（多步工作流）在循环内以工具形式出现，按其实际行为分类 */
const READ_ONLY_SKILL_IDS = new Set(['visual-analysis', 'project-image-analysis']);
const KNOWLEDGE_SEARCH_SKILL_IDS = new Set(['design-reference-search']);

/**
 * 带参数的只读模式：
 * - detail-page-design 纯检查（inspectOnly 且不自动修复）
 * - layer-management 检查动作
 * - layer-management organize 的首轮语义观察（尚未提交 groups）
 *
 * organize 是两阶段能力：第一次只读取完整层树和分屏画面，第二次携带模型声明的
 * groups 才进入 Photoshop 写入。不能因为外层 Skill 叫“管理”就把第一次观察
 * 记成已发生交付，否则模型只给一份整理建议也会错误消除 delivery_action_missing。
 */
function isReadOnlySkillInvocation(skillId: string, params: any): boolean {
    if (READ_ONLY_SKILL_IDS.has(skillId)) return true;
    if (skillId === 'detail-page-design') {
        return params?.inspectOnly === true && params?.autoFix !== true;
    }
    if (skillId === 'layer-management') {
        if (params?.action === 'inspect') return true;
        if (params?.action === 'organize') {
            return !Array.isArray(params?.groups) || params.groups.length === 0;
        }
    }
    return false;
}

/**
 * 只有真实读取当前 Photoshop 文档的调用，才可验证一次画布写入。
 * 项目资源、Memory、附件分析和 capability/context 读取即使分类为 read_only_observation，
 * 也不能取得 Photoshop 完成信用。
 */
export function isAgentPhotoshopDocumentObservation(toolName: unknown, params: any = {}): boolean {
    const name = normalizeToolName(toolName);
    if (!name || isAgentDocumentContextBarrier(name, params)) return false;
    const semantics = getPhotoshopToolSkillSemantics(name, params);
    if (semantics) {
        return semantics.capabilityKind === 'read_only_observation'
            && semantics.sideEffect === 'photoshop_read'
            && semantics.requiresPhotoshopConnection
            && semantics.requiresOpenDocument;
    }
    return (name === 'layer-management' || name === 'detail-page-design')
        && isReadOnlySkillInvocation(name, params);
}

export function classifyAgentToolExecution(toolName: string, params: any = {}): AgentToolExecutionKind {
    const name = normalizeToolName(toolName);
    if (!name) return 'unknown';
    if (name === 'getSmartObjectLayers' && params?.autoOpen === true) return 'stateful_context';
    if (name === 'delegateToAgent' && String(params?.role || '').trim() === 'executor') {
        // executor 子 Agent 可以写 Photoshop；父日志看不到其内部原子调用时按写入保守处理，
        // 强制后续由父 Agent 重新读取最终画面，不能沿用委派前快照。
        return 'photoshop_write';
    }
    const sharedSemanticsKind = classifyPhotoshopToolSkillExecution(name, params);
    if (sharedSemanticsKind !== 'unknown') return sharedSemanticsKind;
    if (READ_ONLY_OBSERVATION_TOOLS.has(name) || CONTEXT_READ_TOOLS.has(name)) return 'read_only_observation';
    if (KNOWLEDGE_SEARCH_TOOLS.has(name)) return 'knowledge_search';
    if (SAVE_EXPORT_TOOLS.has(name)) return 'save_export';
    if (EXTERNAL_GENERATION_TOOLS.has(name)) return 'external_generation';
    if (EXTRA_PHOTOSHOP_WRITE_TOOLS.has(name)) return 'photoshop_write';
    if (shouldCollectAcceptanceVerification(name, params)) return 'photoshop_write';
    if (STATEFUL_CONTEXT_TOOLS.has(name)) return 'stateful_context';
    if (getSkillById(name)) {
        if (isReadOnlySkillInvocation(name, params)) return 'read_only_observation';
        if (KNOWLEDGE_SEARCH_SKILL_IDS.has(name)) return 'knowledge_search';
        return 'photoshop_write';
    }
    return 'unknown';
}

export function isAgentToolExecutionGuarded(toolName: string, params: any = {}): boolean {
    const kind = classifyAgentToolExecution(toolName, params);
    return kind === 'photoshop_write' || kind === 'save_export';
}

export interface RuntimeWriteToolScopeDecision {
    applicable: boolean;
    allowed: boolean;
    toolName: string;
    allowedWriteTools: string[];
    code?: 'runtime_write_tool_out_of_approved_scope';
}

/**
 * 用户批准计划恢复到自主循环后的最终写入范围。
 * undefined 表示普通任务、不适用；空数组表示明确不允许任何写入。
 */
export function evaluateRuntimeWriteToolScope(input: {
    toolName: string;
    params?: unknown;
    allowedWriteTools?: string[];
}): RuntimeWriteToolScopeDecision {
    const toolName = normalizeToolName(input.toolName);
    const allowedWriteTools = Array.isArray(input.allowedWriteTools)
        ? Array.from(new Set(input.allowedWriteTools.map(normalizeToolName).filter(Boolean)))
        : [];
    if (!Array.isArray(input.allowedWriteTools)) {
        return { applicable: false, allowed: true, toolName, allowedWriteTools };
    }
    const kind = classifyAgentToolExecution(toolName, input.params);
    if (kind !== 'photoshop_write' && kind !== 'save_export') {
        return { applicable: true, allowed: true, toolName, allowedWriteTools };
    }
    if (allowedWriteTools.includes(toolName)) {
        return { applicable: true, allowed: true, toolName, allowedWriteTools };
    }
    return {
        applicable: true,
        allowed: false,
        toolName,
        allowedWriteTools,
        code: 'runtime_write_tool_out_of_approved_scope'
    };
}

export function buildAgentToolExecutionPreflight(
    input: AgentToolExecutionPreflightInput
): AgentToolExecutionPreflight {
    const assistantContent = normalizeAssistantContent(input.assistantContent);
    const requiresUserVisiblePreActionRationale = input.requiresUserVisiblePreActionRationale
        ?? input.requiresPublicPlan
        ?? true;
    const completedToolCalls = Array.isArray(input.completedToolCalls) ? input.completedToolCalls : [];
    const verificationToolCalls = Array.isArray(input.verificationToolCalls)
        ? input.verificationToolCalls
        : input.toolCalls;
    const tools = (Array.isArray(input.toolCalls) ? input.toolCalls : [])
        .map((call) => {
            const name = normalizeToolName(call?.name);
            const kind = classifyAgentToolExecution(name, call?.arguments);
            return {
                name,
                kind,
                guarded: kind === 'photoshop_write' || kind === 'save_export'
            };
        })
        .filter((tool) => tool.name);

    const priorReadTools = completedToolCalls
        .filter((entry) => {
            const name = normalizeToolName(entry.name);
            return (isPriorDocumentReadTool(name) && toolSucceeded(entry))
                || isFreshDocumentCreationResult(entry);
        })
        .map((entry) => normalizeToolName(entry.name));
    const hasPriorDocumentRead = priorReadTools.length > 0;
    const hasUserVisiblePreActionRationale = assistantContent.length >= 12 && PRE_ACTION_RATIONALE_KEYWORDS.test(assistantContent);
    const guardedToolNames = tools
        .filter((tool) => tool.guarded)
        .map((tool) => tool.name);
    const hasOnlySimpleMechanicalGuardedTools = guardedToolNames.length > 0
        && guardedToolNames.every((name) => SIMPLE_MECHANICAL_GUARDED_TOOLS.has(name));
    const hasVerificationTarget = VERIFICATION_KEYWORDS.test(assistantContent)
        || hasExplicitSaveExportTarget(input.toolCalls || [])
        || hasExplicitReadbackVerificationTarget(verificationToolCalls || []);
    const latestTargetObservation = resolveLatestToolExecutionTargetGuard(completedToolCalls);
    const observedLayerProperties = collectObservedLayerProperties(
        completedToolCalls,
        latestTargetObservation
    );
    const exactPropertyClarification = resolveExactPropertyReplacementClarification({
        userRequest: input.userRequest,
        toolCalls: input.toolCalls || [],
        observedProperties: observedLayerProperties,
        completedToolCalls
    });

    const preconditions = {
        hasPriorDocumentRead,
        priorReadTools: Array.from(new Set(priorReadTools)),
        hasUserVisiblePreActionRationale,
        hasPublicPlan: hasUserVisiblePreActionRationale,
        hasVerificationTarget,
        knownLayerIds: collectKnownLayerIds(completedToolCalls, latestTargetObservation),
        targetGuard: latestTargetObservation?.guard
    };

    if (tools.length === 0) {
        return {
            status: 'not_applicable',
            ready: true,
            tools,
            preconditions,
            blockers: [],
            warnings: []
        };
    }

    const guardedTool = tools.find((tool) => tool.guarded);
    if (!guardedTool) {
        const warnings = tools
            .filter((tool) => tool.kind === 'external_generation' || tool.kind === 'stateful_context' || tool.kind === 'unknown')
            .map((tool) => `${tool.name} 不是普通只读工具，后续写入前仍需读取目标 Photoshop 文档。`);
        return {
            status: 'ready',
            ready: true,
            tools,
            preconditions,
            blockers: [],
            warnings
        };
    }

    const blockers: string[] = [];
    // 表达类要求降级为提醒，不再阻断执行。
    //
    // 这两条判的不是「会不会做错」，而是「有没有把话说对」——助手内容要 ≥12 字且命中
    // 计划/准备/确认…、验证/复核/回读… 这些关键词，否则整批写入被拦、白烧一轮。
    // 真机代价：49 次运行里「完成且真有写入」= 0 次，最高频的三条阻塞话术
    //（「我先看了一下现状，但还没开始动手改」等，合计 18 次）正是这个机制的产物：
    // 模型读完文档、准备动手，却因为措辞没命中正则而被拦回去，重试到预算耗尽。
    //
    // 说明写得好确实重要，但那是「产出质量」问题，该由事后验收暴露，不该当成动手的前置许可。
    // 下面三条保留为硬拦截，因为它们防的是真实错误而非表达：
    // 没读过目标文档、没有可校验的 documentId、layerId 来路不明——这些会改错文件、猜错图层。
    const expressionWarnings: string[] = [];
    if (requiresUserVisiblePreActionRationale && !hasUserVisiblePreActionRationale) {
        expressionWarnings.push('这次动手前没有给用户可见的设计判断，结果里要补上说明。');
    }
    if (!hasVerificationTarget && !hasOnlySimpleMechanicalGuardedTools) {
        expressionWarnings.push('没有说明执行后如何复核，改完记得回读或截图确认。');
    }
    const guardedToolCanStartWithoutOpenDocument = canAgentToolStartWithoutOpenDocument(guardedTool.name)
        || createsOwnedDocumentBeforeWriting(input.toolCalls || [], guardedTool.name);
    if (!hasPriorDocumentRead && !guardedToolCanStartWithoutOpenDocument) {
        blockers.push('尚未读取目标 Photoshop 文档或画面，不能确认目标文档、图层或画面状态。');
    }
    if (hasPriorDocumentRead
        && !preconditions.targetGuard
        && !guardedToolCanStartWithoutOpenDocument) {
        blockers.push('已有读取结果未包含可校验的 documentId，不能精确锁定 Photoshop 写入目标。需要先取得带文档身份的只读事实，具体观察方式由 Agent 从当前已授权能力中选择。');
    }
    const requestedLayerIds = collectRequestedLayerIds(input.toolCalls || []);
    const unknownLayerIds = requestedLayerIds.filter((id) => !preconditions.knownLayerIds.includes(id));
    if (unknownLayerIds.length > 0) {
        blockers.push(`工具参数包含未从已完成图层创建或读取结果中确认的 layerId：${unknownLayerIds.join(', ')}。不能猜测目标图层。`);
    }
    blockers.push(...collectExactPropertyReplacementBlockers({
        userRequest: input.userRequest,
        toolCalls: input.toolCalls || [],
        observedProperties: observedLayerProperties,
        completedToolCalls
    }));

    if (blockers.length > 0) {
        return {
            status: 'blocked',
            ready: false,
            issue: 'agent_tool_execution_preflight_blocked',
            message: [
                `已阻止工具执行：${guardedTool.name}。`,
                ...blockers,
                '只需补齐上面列出的目标身份、真实读回或对象来源条件后重试；用户可见措辞不是执行许可。'
            ].join('\n'),
            blockedTool: guardedTool,
            tools,
            preconditions,
            blockers,
            warnings: expressionWarnings,
            clarification: exactPropertyClarification
        };
    }

    return {
        status: 'ready',
        ready: true,
        tools,
        preconditions,
        blockers: [],
        // 表达没到位不再拦人，但如实带回：事后能看见「这次没说清楚就动手了」。
        warnings: expressionWarnings
    };
}
