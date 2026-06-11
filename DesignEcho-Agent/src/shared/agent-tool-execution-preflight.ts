import { shouldCollectAcceptanceEvidence } from './acceptance/tool-acceptance';

export type AgentToolExecutionKind =
    | 'read_only_evidence'
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

export interface AgentToolExecutionPreflight {
    status: 'ready' | 'blocked' | 'not_applicable';
    ready: boolean;
    issue?: string;
    message?: string;
    blockedTool?: AgentToolExecutionPreflightTool;
    tools: AgentToolExecutionPreflightTool[];
    evidence: {
        hasPriorDocumentEvidence: boolean;
        priorEvidenceTools: string[];
        hasPublicPlan: boolean;
        hasVerificationTarget: boolean;
    };
    blockers: string[];
    warnings: string[];
}

export interface AgentToolExecutionPreflightLogEntry {
    name: string;
    result?: any;
}

export interface AgentToolExecutionPreflightInput {
    assistantContent?: string;
    toolCalls: Array<{ name: string; arguments?: any }>;
    completedToolCalls?: AgentToolExecutionPreflightLogEntry[];
}

const READ_ONLY_EVIDENCE_TOOLS = new Set([
    'getDocumentInfo',
    'getDocumentSnapshot',
    'getAcceptanceSnapshot',
    'getCanvasSnapshot',
    'getLayerHierarchy',
    'getAllTextLayers',
    'getLayerBounds',
    'getLayerProperties',
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

const PRIOR_DOCUMENT_EVIDENCE_TOOLS = new Set([
    'getDocumentInfo',
    'getDocumentSnapshot',
    'getAcceptanceSnapshot',
    'getCanvasSnapshot',
    'getLayerHierarchy',
    'getAllTextLayers',
    'getLayerBounds',
    'getLayerProperties',
    'getTextContent',
    'getTextStyle',
    'getElementMapping',
    'analyzeLayout',
    'parseDetailPageTemplate',
    'getScreenSnapshots',
    'getScreenSnapshotsWithOverlay',
    'auditDetailPagePlacement',
    'diagnoseState'
]);

const CONTEXT_READ_TOOLS = new Set([
    'listDocuments',
    'listProjectResources',
    'searchProjectResources',
    'analyzeProjectForDetailPage',
    'matchDetailPageContent',
    'resolveFontName'
]);

const STATEFUL_CONTEXT_TOOLS = new Set([
    'switchDocument',
    'openProjectFile',
    'selectLayer',
    'focusLayer',
    'delegateToAgent'
]);

const SAVE_EXPORT_TOOLS = new Set([
    'saveDocument',
    'smartSave',
    'quickExport',
    'exportGroup',
    'exportDetailPageSlices'
]);

const EXTERNAL_GENERATION_TOOLS = new Set([
    'generateImage'
]);

const EXTRA_PHOTOSHOP_WRITE_TOOLS = new Set([
    'fixLayerIssues'
]);

const WRITE_TOOLS_ALLOWED_WITHOUT_PRIOR_DOCUMENT_EVIDENCE = new Set([
    'createDocument'
]);

const PLAN_KEYWORDS = /(计划|准备|我会|需要|先|然后|接着|下一步|读取|确认|检查|创建|修改|放置|执行|保存|导出|plan|next|first|then)/i;
const VERIFICATION_KEYWORDS = /(验证|验收|复核|检查|确认|回读|截图|快照|结果|状态|图层|文档|画面|保存后|导出后|verify|check|inspect|snapshot|readback|result)/i;

function toolSucceeded(entry: AgentToolExecutionPreflightLogEntry): boolean {
    return entry.result?.success !== false;
}

function normalizeToolName(name: unknown): string {
    return String(name || '').trim();
}

function normalizeAssistantContent(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function isPriorDocumentEvidenceTool(name: string): boolean {
    return PRIOR_DOCUMENT_EVIDENCE_TOOLS.has(name);
}

export function classifyAgentToolExecution(toolName: string, params: any = {}): AgentToolExecutionKind {
    const name = normalizeToolName(toolName);
    if (!name) return 'unknown';
    if (READ_ONLY_EVIDENCE_TOOLS.has(name) || CONTEXT_READ_TOOLS.has(name)) return 'read_only_evidence';
    if (SAVE_EXPORT_TOOLS.has(name)) return 'save_export';
    if (EXTERNAL_GENERATION_TOOLS.has(name)) return 'external_generation';
    if (EXTRA_PHOTOSHOP_WRITE_TOOLS.has(name)) return 'photoshop_write';
    if (shouldCollectAcceptanceEvidence(name, params)) return 'photoshop_write';
    if (STATEFUL_CONTEXT_TOOLS.has(name)) return 'stateful_context';
    return 'unknown';
}

export function isAgentToolExecutionGuarded(toolName: string, params: any = {}): boolean {
    const kind = classifyAgentToolExecution(toolName, params);
    return kind === 'photoshop_write' || kind === 'save_export';
}

export function buildAgentToolExecutionPreflight(
    input: AgentToolExecutionPreflightInput
): AgentToolExecutionPreflight {
    const assistantContent = normalizeAssistantContent(input.assistantContent);
    const completedToolCalls = Array.isArray(input.completedToolCalls) ? input.completedToolCalls : [];
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

    const priorEvidenceTools = completedToolCalls
        .filter((entry) => isPriorDocumentEvidenceTool(normalizeToolName(entry.name)) && toolSucceeded(entry))
        .map((entry) => normalizeToolName(entry.name));
    const hasPriorDocumentEvidence = priorEvidenceTools.length > 0;
    const hasPublicPlan = assistantContent.length >= 12 && PLAN_KEYWORDS.test(assistantContent);
    const hasVerificationTarget = VERIFICATION_KEYWORDS.test(assistantContent);

    const evidence = {
        hasPriorDocumentEvidence,
        priorEvidenceTools: Array.from(new Set(priorEvidenceTools)),
        hasPublicPlan,
        hasVerificationTarget
    };

    if (tools.length === 0) {
        return {
            status: 'not_applicable',
            ready: true,
            tools,
            evidence,
            blockers: [],
            warnings: []
        };
    }

    const guardedTool = tools.find((tool) => tool.guarded);
    if (!guardedTool) {
        const warnings = tools
            .filter((tool) => tool.kind === 'external_generation' || tool.kind === 'stateful_context' || tool.kind === 'unknown')
            .map((tool) => `${tool.name} 不是普通只读证据工具，后续写入前仍需读取 Photoshop 文档证据。`);
        return {
            status: 'ready',
            ready: true,
            tools,
            evidence,
            blockers: [],
            warnings
        };
    }

    const blockers: string[] = [];
    if (!hasPublicPlan) {
        blockers.push('缺少给用户可见的执行计划，不能直接发起 Photoshop 写入或保存导出。');
    }
    if (!hasVerificationTarget) {
        blockers.push('缺少明确的执行后复核目标，不能直接发起 Photoshop 写入或保存导出。');
    }
    if (!hasPriorDocumentEvidence && !WRITE_TOOLS_ALLOWED_WITHOUT_PRIOR_DOCUMENT_EVIDENCE.has(guardedTool.name)) {
        blockers.push('缺少 Photoshop 文档或画面读取证据，不能确认目标文档、图层或画面状态。');
    }

    if (blockers.length > 0) {
        return {
            status: 'blocked',
            ready: false,
            issue: 'agent_tool_execution_preflight_blocked',
            message: [
                `已阻止工具执行：${guardedTool.name}。`,
                ...blockers,
                '请先公开说明计划，读取必要的文档/图层/画面证据，并说明执行后如何复核。'
            ].join('\n'),
            blockedTool: guardedTool,
            tools,
            evidence,
            blockers,
            warnings: []
        };
    }

    return {
        status: 'ready',
        ready: true,
        tools,
        evidence,
        blockers: [],
        warnings: []
    };
}
