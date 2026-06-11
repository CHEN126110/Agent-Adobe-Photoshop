import type {
    DesignAgentOsAction,
    DesignAgentOsScenario,
    EvidenceRef,
    UserIntent
} from './design-agent-os-contracts';
import type { DesignTeammateRole } from './types/design-team.types';

export type AgentTaskClass =
    | 'chat'
    | 'simple-operation'
    | 'document-management'
    | 'layer-management'
    | 'text-editing'
    | 'copywriting'
    | 'project-inventory'
    | 'project-analysis'
    | 'sku-batch'
    | 'main-image'
    | 'detail-page'
    | 'reference-replication'
    | 'open-design'
    | 'unknown';

export type AgentVerificationTier =
    | 'none'
    | 'metadata'
    | 'bounds'
    | 'screenshot'
    | 'manual';

export type AgentLatencyClass = 'instant' | 'short' | 'medium' | 'long' | 'unknown';
export type AgentResourceRisk = 'low' | 'medium' | 'high';
export type AgentVisualSamplingScenario =
    | 'main-image'
    | 'detail-page'
    | 'sku'
    | 'reference-replication'
    | 'general-design'
    | 'unknown';

export interface AgentPerformanceBudget {
    maxModelCalls: number;
    maxToolCalls: number;
    maxIterations: number;
    maxVisionCandidates: number;
    maxVisualAnalyses: number;
    maxFullResolutionImageReads: number;
    softTimeBudgetMs: number;
}

export interface AgentCostProfile {
    modelCallClass: 'none' | 'text-light' | 'text-heavy' | 'vision-light' | 'vision-heavy';
    photoshopToolClass: 'none' | 'read-only' | 'write-light' | 'write-heavy';
    imageProcessingClass: 'none' | 'metadata-only' | 'bounded-vision' | 'pixel-probe' | 'heavy-local';
    expectedLatency: AgentLatencyClass;
    resourceRisk: AgentResourceRisk;
}

export interface AgentRuntimeBudget {
    budgetVersion: 'agent-runtime-budget/v0';
    maxIterations: number;
    source: 'explicit-user-parameter' | 'legacy-autonomous-agent-default';
    limitations: string[];
    evidence: EvidenceRef[];
}

export interface AgentDesignTeamRuntimeBudget {
    budgetVersion: 'agent-design-team-runtime-budget/v0';
    role: DesignTeammateRole;
    maxIterations: number;
    source: 'explicit-user-parameter' | 'teammate-role-default';
    limitations: string[];
    evidence: EvidenceRef[];
}

export interface AgentProviderTokenBudget {
    budgetVersion: 'agent-provider-token-budget/v0';
    maxTokens: number;
    source: 'explicit-user-parameter' | 'legacy-provider-default';
    limitations: string[];
    evidence: EvidenceRef[];
}

export interface AgentContextWindowBudget {
    budgetVersion: 'agent-context-window-budget/v0';
    maxTokens: number;
    keepRecentRounds: number;
    source: 'explicit-user-parameter' | 'legacy-context-manager-default';
    limitations: string[];
    evidence: EvidenceRef[];
}

export interface AgentResourceCacheBudget {
    budgetVersion: 'agent-resource-cache-budget/v0';
    resourceScanCacheTtlMs: number;
    psdPreviewCacheTtlMs: number;
    source: 'agent-performance-policy';
    limitations: string[];
    evidence: EvidenceRef[];
}

export interface AgentAcceptanceCaptureBudget {
    budgetVersion: 'agent-acceptance-capture-budget/v0';
    mode: 'standard' | 'bulk' | 'deep';
    maxLayers: number;
    timeoutMs: number;
    maxChangedLayers: number;
    source: 'agent-performance-policy';
    limitations: string[];
    evidence: EvidenceRef[];
}

export interface AgentVisualSamplingBudget {
    budgetVersion: 'agent-visual-sampling-budget/v0';
    scenario: AgentVisualSamplingScenario;
    maxCandidates: number;
    hardCap: number;
    source: 'agent-performance-policy';
    limitations: string[];
    evidence: EvidenceRef[];
}

export interface AgentPerformancePolicy {
    policyVersion: 'agent-performance-policy/v0';
    taskClass: AgentTaskClass;
    scenario: DesignAgentOsScenario;
    action: DesignAgentOsAction;
    budget: AgentPerformanceBudget;
    verificationTier: AgentVerificationTier;
    costProfile: AgentCostProfile;
    controls: {
        allowProviderStreaming: boolean;
        allowVisionModel: boolean;
        allowBulkProjectScan: boolean;
        allowFullResolutionImageRead: boolean;
        preferMetadataOnly: boolean;
        preferToolBatching: boolean;
        requireContextSnapshotBeforeExecution: boolean;
    };
    warnings: string[];
    limitations: string[];
    evidence: EvidenceRef[];
}

export interface BuildAutonomousAgentRuntimeBudgetInput {
    requestedMaxIterations?: unknown;
}

export interface BuildDesignTeamRuntimeBudgetInput {
    role: DesignTeammateRole;
    requestedMaxIterations?: unknown;
}

export interface BuildAgentProviderTokenBudgetInput {
    requestedMaxTokens?: unknown;
    legacyDefaultMaxTokens?: unknown;
}

export interface BuildAgentContextWindowBudgetInput {
    requestedMaxTokens?: unknown;
    requestedKeepRecentRounds?: unknown;
}

export interface BuildAgentResourceCacheBudgetInput {
    requestedResourceScanCacheTtlMs?: unknown;
    requestedPsdPreviewCacheTtlMs?: unknown;
}

export interface BuildAgentAcceptanceCaptureBudgetInput {
    deep?: boolean;
    bulk?: boolean;
    maxChangedLayers?: unknown;
}

export interface BuildAgentVisualSamplingBudgetInput {
    scenario?: unknown;
    requestedMaxCandidates?: unknown;
}

export interface BuildAgentPerformancePolicyInput {
    userText?: string;
    scenario?: DesignAgentOsScenario;
    action?: DesignAgentOsAction;
    skillId?: string;
    mode?: string;
    skillParams?: Record<string, unknown>;
    hasAttachedImage?: boolean;
    requiresPhotoshop?: boolean;
    projectImageCount?: number;
    visualSamplingCandidateCount?: number;
}

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizeSkillParam(input: BuildAgentPerformancePolicyInput, key: string): string {
    return normalizeText(input.skillParams?.[key]);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function resolveRuntimeIterationLimit(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function defaultDesignTeamIterationLimit(role: DesignTeammateRole): number {
    switch (role) {
        case 'executor':
            return 12;
        case 'scene-analyst':
        case 'design-strategist':
        case 'critic':
            return 8;
        default:
            return 8;
    }
}

function resolveProviderMaxTokens(value: unknown, fallback: unknown = 4096): number {
    const fallbackNumeric = Number(fallback);
    const defaultValue = Number.isFinite(fallbackNumeric) && fallbackNumeric > 0
        ? fallbackNumeric
        : 4096;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric === 0) return defaultValue;
    return numeric;
}

function resolvePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.max(min, Math.min(max, Math.round(numeric)));
}

function resolveAcceptanceChangedLayerLimit(value: unknown): number {
    return Math.max(1, Number(value ?? 50));
}

function normalizeVisualSamplingScenario(value: unknown): AgentVisualSamplingScenario {
    const scenario = normalizeText(value);
    switch (scenario) {
        case 'main-image':
        case 'detail-page':
        case 'sku':
        case 'reference-replication':
        case 'general-design':
        case 'unknown':
            return scenario;
        default:
            return 'general-design';
    }
}

function defaultVisualCandidateCountForScenario(scenario: AgentVisualSamplingScenario): number {
    switch (scenario) {
        case 'main-image':
            return 4;
        case 'detail-page':
            return 6;
        case 'sku':
            return 4;
        case 'reference-replication':
            return 2;
        case 'general-design':
            return 4;
        default:
            return 3;
    }
}

function resolveVisualSamplingMaxCandidates(input: {
    scenario: AgentVisualSamplingScenario;
    requestedMaxCandidates?: unknown;
}): number {
    const fallback = defaultVisualCandidateCountForScenario(input.scenario);
    const numeric = Number(input.requestedMaxCandidates);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(0, Math.min(8, Math.round(numeric)));
}

function inferTaskClass(input: BuildAgentPerformancePolicyInput): AgentTaskClass {
    const text = normalizeText(input.userText);
    const skillId = normalizeText(input.skillId);
    const scenario = input.scenario || 'unknown';
    const action = input.action || 'unknown';
    const mode = normalizeText(input.mode);
    const analysisMode = normalizeSkillParam(input, 'analysisMode') || mode;
    const focus = normalizeSkillParam(input, 'focus');
    const sampleSize = Number(input.skillParams?.sampleSize);

    if (action === 'chat' || (!input.requiresPhotoshop && scenario === 'unknown')) {
        return 'chat';
    }
    if (skillId === 'project-image-analysis') {
        if (analysisMode === 'inventory' || focus === 'inventory' || sampleSize === 0) {
            return 'project-inventory';
        }
        return 'project-analysis';
    }
    if (action === 'save' || action === 'export' || skillId === 'document-management') {
        return 'document-management';
    }
    if (skillId === 'layer-management' || /图层.*(顺序|置顶|置底|上移|下移|颜色|隐藏|数量)|从浅到深|从深到浅/.test(text)) {
        return 'layer-management';
    }
    if (skillId === 'text-font-replace' || /字体|字号|文字图层|改文案|替换文案/.test(text)) {
        return 'text-editing';
    }
    if (scenario === 'sku' || skillId === 'sku-batch') {
        return 'sku-batch';
    }
    if (scenario === 'main-image' || skillId === 'main-image') {
        return 'main-image';
    }
    if (scenario === 'detail-page' || skillId === 'detail-page') {
        return 'detail-page';
    }
    if (scenario === 'reference-replication' || skillId === 'layout-replication') {
        return 'reference-replication';
    }
    if (scenario === 'copywriting' || skillId === 'copywriting') {
        return 'copywriting';
    }
    if (input.requiresPhotoshop) {
        return 'open-design';
    }
    return 'unknown';
}

function budgetForTaskClass(taskClass: AgentTaskClass): AgentPerformanceBudget {
    switch (taskClass) {
        case 'chat':
            return {
                maxModelCalls: 1,
                maxToolCalls: 0,
                maxIterations: 2,
                maxVisionCandidates: 0,
                maxVisualAnalyses: 0,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 30_000
            };
        case 'document-management':
        case 'layer-management':
        case 'text-editing':
        case 'simple-operation':
            return {
                maxModelCalls: 1,
                maxToolCalls: 10,
                maxIterations: 8,
                maxVisionCandidates: 0,
                maxVisualAnalyses: 0,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 45_000
            };
        case 'copywriting':
            return {
                maxModelCalls: 2,
                maxToolCalls: 8,
                maxIterations: 8,
                maxVisionCandidates: 1,
                maxVisualAnalyses: 1,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 60_000
            };
        case 'project-inventory':
            return {
                maxModelCalls: 0,
                maxToolCalls: 2,
                maxIterations: 4,
                maxVisionCandidates: 0,
                maxVisualAnalyses: 0,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 15_000
            };
        case 'project-analysis':
            return {
                maxModelCalls: 1,
                maxToolCalls: 8,
                maxIterations: 8,
                maxVisionCandidates: 4,
                maxVisualAnalyses: 4,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 90_000
            };
        case 'sku-batch':
            return {
                maxModelCalls: 2,
                maxToolCalls: 90,
                maxIterations: 50,
                maxVisionCandidates: 3,
                maxVisualAnalyses: 0,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 240_000
            };
        case 'main-image':
            return {
                maxModelCalls: 3,
                maxToolCalls: 60,
                maxIterations: 35,
                maxVisionCandidates: 4,
                maxVisualAnalyses: 1,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 180_000
            };
        case 'detail-page':
            return {
                maxModelCalls: 4,
                maxToolCalls: 140,
                maxIterations: 70,
                maxVisionCandidates: 6,
                maxVisualAnalyses: 2,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 420_000
            };
        case 'reference-replication':
            return {
                maxModelCalls: 4,
                maxToolCalls: 100,
                maxIterations: 55,
                maxVisionCandidates: 4,
                maxVisualAnalyses: 1,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 240_000
            };
        case 'open-design':
            return {
                maxModelCalls: 4,
                maxToolCalls: 120,
                maxIterations: 60,
                maxVisionCandidates: 6,
                maxVisualAnalyses: 2,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 360_000
            };
        default:
            return {
                maxModelCalls: 1,
                maxToolCalls: 12,
                maxIterations: 10,
                maxVisionCandidates: 0,
                maxVisualAnalyses: 0,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 60_000
            };
    }
}

function verificationTierForTaskClass(taskClass: AgentTaskClass): AgentVerificationTier {
    switch (taskClass) {
        case 'chat':
            return 'none';
        case 'document-management':
            return 'metadata';
        case 'layer-management':
        case 'text-editing':
        case 'simple-operation':
            return 'bounds';
        case 'sku-batch':
            return 'metadata';
        case 'project-inventory':
            return 'metadata';
        case 'project-analysis':
            return 'manual';
        case 'copywriting':
            return 'manual';
        case 'main-image':
        case 'reference-replication':
            return 'screenshot';
        case 'detail-page':
        case 'open-design':
            return 'manual';
        default:
            return 'metadata';
    }
}

function costProfileForTaskClass(taskClass: AgentTaskClass): AgentCostProfile {
    switch (taskClass) {
        case 'chat':
            return {
                modelCallClass: 'text-light',
                photoshopToolClass: 'none',
                imageProcessingClass: 'none',
                expectedLatency: 'short',
                resourceRisk: 'low'
            };
        case 'document-management':
        case 'layer-management':
        case 'text-editing':
        case 'simple-operation':
            return {
                modelCallClass: 'text-light',
                photoshopToolClass: 'write-light',
                imageProcessingClass: 'metadata-only',
                expectedLatency: 'short',
                resourceRisk: 'low'
            };
        case 'sku-batch':
            return {
                modelCallClass: 'text-light',
                photoshopToolClass: 'write-heavy',
                imageProcessingClass: 'metadata-only',
                expectedLatency: 'long',
                resourceRisk: 'medium'
            };
        case 'project-inventory':
            return {
                modelCallClass: 'none',
                photoshopToolClass: 'read-only',
                imageProcessingClass: 'metadata-only',
                expectedLatency: 'instant',
                resourceRisk: 'low'
            };
        case 'project-analysis':
            return {
                modelCallClass: 'vision-light',
                photoshopToolClass: 'read-only',
                imageProcessingClass: 'bounded-vision',
                expectedLatency: 'medium',
                resourceRisk: 'medium'
            };
        case 'main-image':
        case 'reference-replication':
            return {
                modelCallClass: 'vision-light',
                photoshopToolClass: 'write-heavy',
                imageProcessingClass: 'bounded-vision',
                expectedLatency: 'medium',
                resourceRisk: 'medium'
            };
        case 'detail-page':
        case 'open-design':
            return {
                modelCallClass: 'vision-light',
                photoshopToolClass: 'write-heavy',
                imageProcessingClass: 'bounded-vision',
                expectedLatency: 'long',
                resourceRisk: 'high'
            };
        case 'copywriting':
            return {
                modelCallClass: 'text-heavy',
                photoshopToolClass: 'read-only',
                imageProcessingClass: 'bounded-vision',
                expectedLatency: 'medium',
                resourceRisk: 'medium'
            };
        default:
            return {
                modelCallClass: 'text-light',
                photoshopToolClass: 'read-only',
                imageProcessingClass: 'metadata-only',
                expectedLatency: 'unknown',
                resourceRisk: 'medium'
            };
    }
}

function isBusinessDesignTask(taskClass: AgentTaskClass): boolean {
    return taskClass === 'main-image'
        || taskClass === 'detail-page'
        || taskClass === 'sku-batch'
        || taskClass === 'reference-replication'
        || taskClass === 'open-design';
}

function shouldAllowVisionModel(taskClass: AgentTaskClass, hasAttachedImage: boolean): boolean {
    if (taskClass === 'project-inventory') return false;
    if (taskClass === 'project-analysis') return true;
    if (taskClass === 'sku-batch') return false;
    if (taskClass === 'copywriting') return hasAttachedImage;
    return taskClass === 'main-image'
        || taskClass === 'detail-page'
        || taskClass === 'reference-replication'
        || taskClass === 'open-design';
}

function applyProjectScaleWarnings(input: {
    budget: AgentPerformanceBudget;
    projectImageCount: number;
    visualSamplingCandidateCount: number;
}): string[] {
    const warnings: string[] = [];
    if (input.projectImageCount > 80) {
        warnings.push(`项目图片数量 ${input.projectImageCount} 较多，必须使用 ProjectAssetIndex 和 VisualSamplingPlan，不能全量视觉分析。`);
    }
    if (input.budget.maxVisionCandidates > 0 && input.visualSamplingCandidateCount > input.budget.maxVisionCandidates) {
        warnings.push(`视觉候选 ${input.visualSamplingCandidateCount} 超过预算 ${input.budget.maxVisionCandidates}，执行前必须截断候选。`);
    }
    return warnings;
}

export function buildAgentPerformancePolicy(input: BuildAgentPerformancePolicyInput): AgentPerformancePolicy {
    const scenario = input.scenario || 'unknown';
    const action = input.action || 'unknown';
    const taskClass = inferTaskClass(input);
    const rawBudget = budgetForTaskClass(taskClass);
    const visualSamplingCandidateCount = clampInt(input.visualSamplingCandidateCount, 0, 0, 999);
    const projectImageCount = clampInt(input.projectImageCount, 0, 0, 999_999);
    const requestedSampleSize = Number(input.skillParams?.sampleSize);
    const requestedVisionCandidates = Number.isFinite(requestedSampleSize) && requestedSampleSize >= 0
        ? requestedSampleSize
        : visualSamplingCandidateCount;
    const maxVisionCandidates = rawBudget.maxVisionCandidates > 0 && requestedVisionCandidates > 0
        ? Math.min(rawBudget.maxVisionCandidates, requestedVisionCandidates)
        : rawBudget.maxVisionCandidates;
    const budget: AgentPerformanceBudget = {
        ...rawBudget,
        maxVisionCandidates
    };
    const hasAttachedImage = input.hasAttachedImage === true;
    const allowVisionModel = shouldAllowVisionModel(taskClass, hasAttachedImage || maxVisionCandidates > 0);
    const warnings = applyProjectScaleWarnings({
        budget,
        projectImageCount,
        visualSamplingCandidateCount
    });

    return {
        policyVersion: 'agent-performance-policy/v0',
        taskClass,
        scenario,
        action,
        budget,
        verificationTier: verificationTierForTaskClass(taskClass),
        costProfile: costProfileForTaskClass(taskClass),
        controls: {
            allowProviderStreaming: taskClass === 'chat' || taskClass === 'copywriting',
            allowVisionModel,
            allowBulkProjectScan: false,
            allowFullResolutionImageRead: false,
            preferMetadataOnly: !allowVisionModel,
            preferToolBatching: taskClass !== 'chat',
            requireContextSnapshotBeforeExecution: isBusinessDesignTask(taskClass)
        },
        warnings,
        limitations: [
            '性能策略是执行前预算和资源边界，不代表任务已经执行。',
            '默认禁止全项目视觉分析和全分辨率图片读取。',
            '需要视觉模型时必须通过有界候选和缓存策略进入，不能绕过 ProjectAssetIndex。',
            '验收等级只定义最低证据要求，不等于设计质量通过。'
        ],
        evidence: [{
            source: 'agent-performance-policy',
            summary: `taskClass=${taskClass}; maxModelCalls=${budget.maxModelCalls}; maxToolCalls=${budget.maxToolCalls}; maxVisionCandidates=${budget.maxVisionCandidates}`,
            status: 'needs_review'
        }]
    };
}

export function buildAutonomousAgentRuntimeBudget(input: BuildAutonomousAgentRuntimeBudgetInput = {}): AgentRuntimeBudget {
    const hasExplicitBudget = input.requestedMaxIterations !== undefined
        && input.requestedMaxIterations !== null
        && input.requestedMaxIterations !== '';
    const fallbackMaxIterations = 25;
    const maxIterations = hasExplicitBudget
        ? resolveRuntimeIterationLimit(input.requestedMaxIterations, fallbackMaxIterations)
        : fallbackMaxIterations;
    const source = hasExplicitBudget
        ? 'explicit-user-parameter'
        : 'legacy-autonomous-agent-default';

    return {
        budgetVersion: 'agent-runtime-budget/v0',
        maxIterations,
        source,
        limitations: [
            '该预算迁移保留 autonomous-agent 既有默认 25 轮行为，不代表硬预算策略已经完成。',
            '后续需要按 taskClass 将运行时预算收敛到 AgentPerformancePolicy，而不是所有任务共用 legacy 默认。'
        ],
        evidence: [{
            source: 'agent-performance-policy/runtime-budget',
            summary: `autonomous-agent maxIterations=${maxIterations}; source=${source}`,
            status: 'needs_review'
        }]
    };
}

export function buildDesignTeamRuntimeBudget(input: BuildDesignTeamRuntimeBudgetInput): AgentDesignTeamRuntimeBudget {
    const fallbackMaxIterations = defaultDesignTeamIterationLimit(input.role);
    const hasExplicitBudget = input.requestedMaxIterations !== undefined
        && input.requestedMaxIterations !== null
        && input.requestedMaxIterations !== '';
    const maxIterations = hasExplicitBudget
        ? resolveRuntimeIterationLimit(input.requestedMaxIterations, fallbackMaxIterations)
        : fallbackMaxIterations;
    const source = hasExplicitBudget
        ? 'explicit-user-parameter'
        : 'teammate-role-default';

    return {
        budgetVersion: 'agent-design-team-runtime-budget/v0',
        role: input.role,
        maxIterations,
        source,
        limitations: [
            '该预算迁移保留 design-team teammate 既有默认迭代数，不代表多 Agent 工作流已完整成熟。',
            '显式请求的 maxIterations 仍可覆盖默认值；无效或小于等于 0 的值会回退到角色默认值。'
        ],
        evidence: [{
            source: 'agent-performance-policy/design-team-runtime-budget',
            summary: `role=${input.role}; maxIterations=${maxIterations}; source=${source}`,
            status: 'needs_review'
        }]
    };
}

export function buildAgentProviderTokenBudget(input: BuildAgentProviderTokenBudgetInput = {}): AgentProviderTokenBudget {
    const hasExplicitBudget = input.requestedMaxTokens !== undefined
        && input.requestedMaxTokens !== null
        && input.requestedMaxTokens !== '';
    const maxTokens = resolveProviderMaxTokens(input.requestedMaxTokens, input.legacyDefaultMaxTokens);
    const legacyDefaultMaxTokens = resolveProviderMaxTokens(undefined, input.legacyDefaultMaxTokens);
    const source = hasExplicitBudget && maxTokens !== legacyDefaultMaxTokens
        ? 'explicit-user-parameter'
        : 'legacy-provider-default';

    return {
        budgetVersion: 'agent-provider-token-budget/v0',
        maxTokens,
        source,
        limitations: [
            `该预算迁移保留 provider/model 既有默认 maxTokens=${legacyDefaultMaxTokens}，不代表所有模型调用已完成动态预算。`,
            '本 helper 只集中默认输出 token 上限，不改变温度、工具调用、流式协议或 provider timeout。'
        ],
        evidence: [{
            source: 'agent-performance-policy/provider-token-budget',
            summary: `maxTokens=${maxTokens}; source=${source}`,
            status: 'needs_review'
        }]
    };
}

export function buildAgentContextWindowBudget(
    input: BuildAgentContextWindowBudgetInput = {}
): AgentContextWindowBudget {
    const defaultMaxTokens = 100_000;
    const defaultKeepRecentRounds = 6;
    const hasExplicitBudget = input.requestedMaxTokens !== undefined
        || input.requestedKeepRecentRounds !== undefined;
    const maxTokens = resolvePositiveInt(input.requestedMaxTokens, defaultMaxTokens, 1_000, 1_000_000);
    const keepRecentRounds = resolvePositiveInt(input.requestedKeepRecentRounds, defaultKeepRecentRounds, 1, 50);

    return {
        budgetVersion: 'agent-context-window-budget/v0',
        maxTokens,
        keepRecentRounds,
        source: hasExplicitBudget ? 'explicit-user-parameter' : 'legacy-context-manager-default',
        limitations: [
            '该预算迁移保留 ContextManager 既有 maxTokens=100000 与 keepRecentRounds=6 默认值，不代表上下文压缩策略已经成熟。',
            '当前 token 估算仍是字符级粗略估算，不能等同 provider 真实 token 计费。'
        ],
        evidence: [{
            source: 'agent-performance-policy/context-window-budget',
            summary: `maxTokens=${maxTokens}; keepRecentRounds=${keepRecentRounds}`,
            status: 'needs_review'
        }]
    };
}

export function buildAgentResourceCacheBudget(
    input: BuildAgentResourceCacheBudgetInput = {}
): AgentResourceCacheBudget {
    const resourceScanCacheTtlMs = resolvePositiveInt(
        input.requestedResourceScanCacheTtlMs,
        30_000,
        1_000,
        10 * 60 * 1_000
    );
    const psdPreviewCacheTtlMs = resolvePositiveInt(
        input.requestedPsdPreviewCacheTtlMs,
        300_000,
        1_000,
        60 * 60 * 1_000
    );

    return {
        budgetVersion: 'agent-resource-cache-budget/v0',
        resourceScanCacheTtlMs,
        psdPreviewCacheTtlMs,
        source: 'agent-performance-policy',
        limitations: [
            '该预算迁移保留 ResourceManager 既有目录扫描 30 秒缓存和 PSD 预览 5 分钟缓存，不改变资源读取行为。',
            '缓存预算只是性能边界，不代表图片内容理解、最佳素材选择或视觉分析已经完成。'
        ],
        evidence: [{
            source: 'agent-performance-policy/resource-cache-budget',
            summary: `resourceScanCacheTtlMs=${resourceScanCacheTtlMs}; psdPreviewCacheTtlMs=${psdPreviewCacheTtlMs}`,
            status: 'needs_review'
        }]
    };
}

export function buildAgentAcceptanceCaptureBudget(
    input: BuildAgentAcceptanceCaptureBudgetInput = {}
): AgentAcceptanceCaptureBudget {
    let mode: AgentAcceptanceCaptureBudget['mode'] = 'standard';
    let maxLayers = 350;
    let timeoutMs = 12_000;

    if (input.deep === true) {
        mode = 'deep';
        maxLayers = 1_000;
        timeoutMs = 30_000;
    } else if (input.bulk === true) {
        mode = 'bulk';
        maxLayers = 700;
        timeoutMs = 22_000;
    }

    return {
        budgetVersion: 'agent-acceptance-capture-budget/v0',
        mode,
        maxLayers,
        timeoutMs,
        maxChangedLayers: resolveAcceptanceChangedLayerLimit(input.maxChangedLayers),
        source: 'agent-performance-policy',
        limitations: [
            '该预算迁移保留 tool acceptance 既有 maxLayers、timeoutMs 和 changed layer 默认值，不代表截图级 QA 已完成。',
            '后续需要按 taskClass 和文档规模把验收预算推进到硬限制和 UI 资源提示。'
        ],
        evidence: [{
            source: 'agent-performance-policy/acceptance-capture-budget',
            summary: `mode=${mode}; maxLayers=${maxLayers}; timeoutMs=${timeoutMs}`,
            status: 'needs_review'
        }]
    };
}

export function buildAgentVisualSamplingBudget(
    input: BuildAgentVisualSamplingBudgetInput = {}
): AgentVisualSamplingBudget {
    const scenario = normalizeVisualSamplingScenario(input.scenario);
    const maxCandidates = resolveVisualSamplingMaxCandidates({
        scenario,
        requestedMaxCandidates: input.requestedMaxCandidates
    });

    return {
        budgetVersion: 'agent-visual-sampling-budget/v0',
        scenario,
        maxCandidates,
        hardCap: 8,
        source: 'agent-performance-policy',
        limitations: [
            '该预算迁移保留 ProjectVisualSamplingPlan 既有默认候选数量和 8 张硬上限，不代表已经调用视觉模型。',
            '候选数量只控制进入视觉预检的图片范围，不能声明最佳图片、产品款式或设计质量。'
        ],
        evidence: [{
            source: 'agent-performance-policy/visual-sampling-budget',
            summary: `scenario=${scenario}; maxCandidates=${maxCandidates}; hardCap=8`,
            status: 'needs_review'
        }]
    };
}

export function buildAgentPerformancePolicyFromIntent(input: {
    intent: UserIntent;
    skillId?: string;
    hasAttachedImage?: boolean;
    projectImageCount?: number;
    visualSamplingCandidateCount?: number;
}): AgentPerformancePolicy {
    return buildAgentPerformancePolicy({
        userText: input.intent.normalizedText || input.intent.rawText,
        scenario: input.intent.targetScenario,
        action: input.intent.action,
        skillId: input.skillId,
        hasAttachedImage: input.hasAttachedImage,
        requiresPhotoshop: input.intent.requiresPhotoshop,
        projectImageCount: input.projectImageCount,
        visualSamplingCandidateCount: input.visualSamplingCandidateCount
    });
}
