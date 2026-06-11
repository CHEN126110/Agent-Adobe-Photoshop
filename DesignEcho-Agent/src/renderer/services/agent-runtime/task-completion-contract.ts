import type {
    AgentExecutionStatus,
    AgentToolCallLogEntry,
    TaskCompletionContext,
    TaskCompletionContract,
    TaskCompletionEvidence,
    TaskCompletionKind,
    TaskCompletionRequirement
} from './types';

const INSPECTION_TOOLS = new Set([
    'getDocumentInfo',
    'getLayerHierarchy',
    'getAllTextLayers',
    'getTextContent',
    'getLayerBounds',
    'getLayerProperties',
    'getCanvasSnapshot',
    'getScreenSnapshots',
    'getScreenSnapshotsWithOverlay',
    'getAcceptanceSnapshot',
    'parseDetailPageTemplate',
    'describeImage',
    'listProjectResources',
    'searchProjectResources'
]);

const TEXT_MUTATION_TOOLS = new Set([
    'createTextLayer',
    'setTextContent',
    'setTextStyle',
    'moveLayer',
    'quickScale'
]);

const LAYER_ORDER_MUTATION_TOOLS = new Set([
    'reorderLayer'
]);

const LAYER_ORDER_VERIFICATION_TOOLS = new Set([
    'getLayerHierarchy',
    'getAcceptanceSnapshot'
]);

const LAYER_MANAGEMENT_MUTATION_TOOLS = new Set([
    'selectLayer',
    'renameLayer',
    'deleteLayer',
    'duplicateLayer',
    'groupLayers',
    'ungroupLayers',
    'setLayerOpacity',
    'setBlendMode'
]);

const LAYER_MANAGEMENT_VERIFICATION_TOOLS = new Set([
    'getLayerHierarchy',
    'getLayerProperties',
    'getAcceptanceSnapshot'
]);

const DOCUMENT_SAVE_TOOLS = new Set([
    'saveDocument',
    'smartSave',
    'quickExport'
]);

const DOCUMENT_CLOSE_TOOLS = new Set([
    'closeDocument'
]);

const DOCUMENT_VERIFICATION_TOOLS = new Set([
    'getDocumentInfo',
    'listDocuments',
    'getAcceptanceSnapshot'
]);

const REFERENCE_MUTATION_TOOLS = new Set([
    'createTextLayer',
    'setTextContent',
    'setTextStyle',
    'createRectangle',
    'createShape',
    'placeImage',
    'replaceLayerContent',
    'moveLayer',
    'quickScale',
    'fillDetailPage',
    'matchDetailPageContent'
]);

const TEXT_VERIFICATION_TOOLS = new Set([
    'getAllTextLayers',
    'getTextContent',
    'getLayerBounds',
    'getLayerProperties',
    'getAcceptanceSnapshot'
]);

const VISUAL_VERIFICATION_TOOLS = new Set([
    'getScreenSnapshotsWithOverlay',
    'getScreenSnapshots',
    'getCanvasSnapshot',
    'auditDetailPagePlacement'
]);

interface ContractInput {
    task: string;
    context?: TaskCompletionContext;
    toolCallLog: AgentToolCallLogEntry[];
}

interface AcceptanceCounts {
    verified: number;
    failed: number;
    needsReview: number;
    noDocumentChangeRisk: number;
}

interface CoverageEvidence {
    expected: number;
    applied: number;
    failed: number;
    skipped: number;
    missingIds?: string[];
}

type VisualEvidence = NonNullable<TaskCompletionEvidence['visual']>;

function toolSucceeded(entry: AgentToolCallLogEntry): boolean {
    return entry.result?.success !== false;
}

function getAcceptance(result: any): any {
    return result?.acceptance || result?.data?.acceptance || null;
}

function collectAcceptanceCounts(toolCallLog: AgentToolCallLogEntry[]): AcceptanceCounts {
    const counts: AcceptanceCounts = {
        verified: 0,
        failed: 0,
        needsReview: 0,
        noDocumentChangeRisk: 0
    };

    for (const item of toolCallLog) {
        const acceptance = getAcceptance(item.result);
        if (!acceptance?.enabled) continue;
        if (acceptance.verified === true) {
            counts.verified += 1;
        }
        if (acceptance.assertionStatus === 'failed') {
            counts.failed += 1;
        }
        if (acceptance.assertionStatus === 'needs_review'
            || acceptance.noDocumentChangeRisk === true
            || (acceptance.verified === false && acceptance.assertionStatus !== 'failed')) {
            counts.needsReview += 1;
        }
        if (acceptance.noDocumentChangeRisk === true) {
            counts.noDocumentChangeRisk += 1;
        }
    }

    return counts;
}

function inferTaskKind(input: ContractInput): TaskCompletionKind | null {
    const task = String(input.task || '');
    const skillId = input.context?.skillId || '';
    const intentMode = input.context?.intentMode || '';
    const text = `${task} ${skillId} ${intentMode}`.toLowerCase();
    const toolNames = input.toolCallLog.map((item) => item.name);
    const hasTextMutation = toolNames.some((name) => TEXT_MUTATION_TOOLS.has(name));

    if (/图层.{0,12}(顺序|层级|排序|置顶|置底|上移|下移)|(?:顺序|层级|排序|置顶|置底|上移|下移).{0,12}图层|从浅到深|从深到浅|移到.*(?:上方|下方|顶层|底层)/.test(text)
        || toolNames.some((name) => LAYER_ORDER_MUTATION_TOOLS.has(name))) {
        return 'layer_order_edit';
    }

    if (skillId === 'document-management' && intentMode === 'close'
        || /关闭文档|关掉文档|close document|close file/.test(text)
        || toolNames.some((name) => DOCUMENT_CLOSE_TOOLS.has(name))) {
        return 'document_close';
    }

    if (skillId === 'document-management' && intentMode === 'save'
        || /保存文档|保存当前文档|导出当前文档|保存为|导出为|save document|export document|save psd|export png/.test(text)
        || toolNames.some((name) => DOCUMENT_SAVE_TOOLS.has(name))) {
        return 'document_save';
    }

    if (skillId === 'layout-replication'
        || /参考图|复刻|仿照|照着|还原|复现|同款|参考.*设计|按.*图/.test(text)) {
        return 'reference_replication';
    }

    if (/字体|字号|字重|字距|行距|思源|黑体|宋体|微软雅黑|居中|对齐|换行|标点|文字排版|文本排版/.test(text)) {
        return 'text_typography_edit';
    }

    if (/(文字|文本|文案|标题|副标题|内容).{0,16}(改成|替换|修改|删除|添加|创建|输入|写入)|(?:改成|替换|修改|删除|添加|创建|输入|写入).{0,16}(文字|文本|文案|标题|副标题|内容)|删除.*字|添加.*字|创建.*字/.test(text)
        || hasTextMutation) {
        return 'text_content_edit';
    }

    if (skillId === 'layer-management'
        || /图层.{0,12}(选中|选择|重命名|删除|复制|拷贝|编组|解除编组|透明度|混合模式)|(?:选中|选择|重命名|删除|复制|拷贝|编组|解除编组).{0,12}图层/.test(text)
        || toolNames.some((name) => LAYER_MANAGEMENT_MUTATION_TOOLS.has(name))) {
        return 'layer_management';
    }

    return null;
}

function firstSuccessfulIndex(toolCallLog: AgentToolCallLogEntry[], names: Set<string>): number {
    return toolCallLog.findIndex((item) => names.has(item.name) && toolSucceeded(item));
}

function hasSuccessfulBefore(toolCallLog: AgentToolCallLogEntry[], names: Set<string>, beforeIndex: number): boolean {
    return toolCallLog.some((item, index) => index < beforeIndex && names.has(item.name) && toolSucceeded(item));
}

function hasSuccessfulAfter(toolCallLog: AgentToolCallLogEntry[], names: Set<string>, afterIndex: number): boolean {
    return toolCallLog.some((item, index) => index > afterIndex && names.has(item.name) && toolSucceeded(item));
}

function countSuccessful(toolCallLog: AgentToolCallLogEntry[], names: Set<string>): number {
    return toolCallLog.filter((item) => names.has(item.name) && toolSucceeded(item)).length;
}

function countFailed(toolCallLog: AgentToolCallLogEntry[], names: Set<string>): number {
    return toolCallLog.filter((item) => names.has(item.name) && !toolSucceeded(item)).length;
}

function normalizeCoverage(value: any): CoverageEvidence | null {
    if (!value || typeof value !== 'object') return null;
    const expected = Number(value.expected);
    const applied = Number(value.applied ?? value.successCount ?? value.matched);
    const failed = Number(value.failed ?? value.failCount ?? 0);
    const skipped = Number(value.skipped ?? 0);
    if (!Number.isFinite(expected) || !Number.isFinite(applied)) return null;
    return {
        expected,
        applied,
        failed: Number.isFinite(failed) ? failed : 0,
        skipped: Number.isFinite(skipped) ? skipped : 0,
        missingIds: Array.isArray(value.missingIds) ? value.missingIds.map(String) : undefined
    };
}

function findCoverageEvidence(toolCallLog: AgentToolCallLogEntry[]): CoverageEvidence | undefined {
    for (const item of toolCallLog) {
        const result = item.result || {};
        const candidates = [
            result?.completionContract?.evidence?.coverage,
            result?.data?.completionContract?.evidence?.coverage,
            result?.data?.coverage,
            result?.coverage
        ];
        for (const candidate of candidates) {
            const coverage = normalizeCoverage(candidate);
            if (coverage) return coverage;
        }
    }
    return undefined;
}

function getVisualEvidence(toolCallLog: AgentToolCallLogEntry[], firstMutationIndex: number): VisualEvidence {
    const afterMutation = toolCallLog.filter((item, index) => index > firstMutationIndex && toolSucceeded(item));
    const overlayCount = afterMutation.filter((item) => item.name === 'getScreenSnapshotsWithOverlay').length;
    const screenshotCount = afterMutation.filter((item) => item.name === 'getScreenSnapshots' || item.name === 'getCanvasSnapshot').length;
    const modelReviewCount = afterMutation.filter((item) => item.name === 'auditDetailPagePlacement').length;
    const boundsCount = afterMutation.filter((item) => item.name === 'getLayerBounds' || item.name === 'getLayerProperties').length;

    if (modelReviewCount > 0) {
        return { mode: 'model_review', snapshotCount: screenshotCount, overlayCount };
    }
    if (overlayCount > 0) {
        return { mode: 'overlay', snapshotCount: screenshotCount, overlayCount };
    }
    if (screenshotCount > 0) {
        return { mode: 'screenshot', snapshotCount: screenshotCount, overlayCount };
    }
    if (boundsCount > 0) {
        return { mode: 'bounds_only', snapshotCount: 0, overlayCount: 0 };
    }
    return { mode: 'none', snapshotCount: 0, overlayCount: 0 };
}

function resolveStatus(requirements: TaskCompletionRequirement[], blockers: string[], warnings: string[]): AgentExecutionStatus {
    if (blockers.length > 0 || requirements.some((item) => item.status === 'failed')) {
        return 'failed';
    }
    if (warnings.length > 0 || requirements.some((item) => item.status === 'needs_review')) {
        return 'needs_review';
    }
    return 'completed';
}

function buildSummary(kind: TaskCompletionKind, status: AgentExecutionStatus, requirements: TaskCompletionRequirement[]): string {
    const kindText: Record<TaskCompletionKind, string> = {
        reference_replication: '参考图复刻',
        text_content_edit: '文字内容编辑',
        text_typography_edit: '文字排版/字体编辑',
        layer_order_edit: '图层顺序编辑',
        layer_management: '图层管理',
        document_save: '文档保存/导出',
        document_close: '文档关闭'
    };
    const statusText: Record<AgentExecutionStatus, string> = {
        completed: '已完成',
        needs_review: '需复核',
        failed: '未完成',
        cancelled: '已取消'
    };
    const passed = requirements.filter((item) => item.status === 'passed').length;
    return `${kindText[kind]}完成契约：${statusText[status]}，${passed}/${requirements.length} 项通过。`;
}

function buildOperationContract(
    kind: 'layer_management' | 'document_save' | 'document_close',
    input: ContractInput,
    acceptance: AcceptanceCounts,
    mutationTools: Set<string>,
    verificationTools: Set<string>,
    labels: { context: string; mutation: string; verification: string }
): TaskCompletionContract {
    const firstMutation = firstSuccessfulIndex(input.toolCallLog, mutationTools);
    const actionCount = countSuccessful(input.toolCallLog, mutationTools);
    const failedActions = countFailed(input.toolCallLog, mutationTools);
    const inspectedBeforeMutation = firstMutation >= 0 && hasSuccessfulBefore(input.toolCallLog, INSPECTION_TOOLS, firstMutation);
    const verifiedAfterMutation = firstMutation >= 0 && (
        hasSuccessfulAfter(input.toolCallLog, verificationTools, firstMutation)
        || acceptance.verified > 0
    );

    const requirements: TaskCompletionRequirement[] = [
        {
            id: 'operation-context-read',
            label: labels.context,
            status: inspectedBeforeMutation || kind === 'document_close' ? 'passed' : 'needs_review',
            reason: inspectedBeforeMutation || kind === 'document_close' ? undefined : '缺少操作前上下文读取证据。'
        },
        {
            id: 'operation-mutated',
            label: labels.mutation,
            status: actionCount > 0 ? 'passed' : 'failed',
            actual: { actionCount, failedActions },
            reason: actionCount > 0 ? undefined : '没有检测到成功的目标工具调用。'
        },
        {
            id: 'operation-verified',
            label: labels.verification,
            status: verifiedAfterMutation ? 'passed' : 'needs_review',
            reason: verifiedAfterMutation ? undefined : '缺少操作后的状态复核或工具验收证据。'
        }
    ];

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (failedActions > 0) {
        blockers.push(`存在 ${failedActions} 个目标工具失败。`);
    }
    if (acceptance.failed > 0) {
        blockers.push(`存在 ${acceptance.failed} 个工具验收失败。`);
    }
    if (!inspectedBeforeMutation && kind !== 'document_close') {
        warnings.push('缺少修改前上下文读取，无法确认目标是否正确。');
    }
    if (!verifiedAfterMutation) {
        warnings.push('缺少修改后复核，不能只凭模型口头结论判定完成。');
    }
    if (acceptance.needsReview > 0 || acceptance.noDocumentChangeRisk > 0) {
        warnings.push(`工具验收仍有 ${acceptance.needsReview} 项需要复核，${acceptance.noDocumentChangeRisk} 项存在无变化风险。`);
    }

    const status = resolveStatus(requirements, blockers, warnings);
    return {
        kind,
        status,
        required: requirements,
        evidence: {
            toolAcceptance: acceptance
        },
        blockers,
        warnings,
        summary: buildSummary(kind, status, requirements)
    };
}

function buildLayerOrderContract(input: ContractInput, acceptance: AcceptanceCounts): TaskCompletionContract {
    const firstMutation = firstSuccessfulIndex(input.toolCallLog, LAYER_ORDER_MUTATION_TOOLS);
    const actionCount = countSuccessful(input.toolCallLog, LAYER_ORDER_MUTATION_TOOLS);
    const failedActions = countFailed(input.toolCallLog, LAYER_ORDER_MUTATION_TOOLS);
    const inspectedBeforeMutation = firstMutation >= 0 && hasSuccessfulBefore(input.toolCallLog, INSPECTION_TOOLS, firstMutation);
    const verifiedAfterMutation = firstMutation >= 0 && (
        hasSuccessfulAfter(input.toolCallLog, LAYER_ORDER_VERIFICATION_TOOLS, firstMutation)
        || acceptance.verified > 0
    );

    const requirements: TaskCompletionRequirement[] = [
        {
            id: 'layer-context-read',
            label: '读取图层层级上下文',
            status: inspectedBeforeMutation ? 'passed' : 'needs_review',
            reason: inspectedBeforeMutation ? undefined : '缺少排序前的图层层级读取证据。'
        },
        {
            id: 'layer-order-mutated',
            label: '执行图层顺序调整',
            status: actionCount > 0 ? 'passed' : 'failed',
            actual: { actionCount, failedActions },
            reason: actionCount > 0 ? undefined : '没有检测到成功的 reorderLayer 调用。'
        },
        {
            id: 'layer-order-verified',
            label: '复核图层顺序',
            status: verifiedAfterMutation ? 'passed' : 'needs_review',
            reason: verifiedAfterMutation ? undefined : '缺少排序后的图层层级或验收快照。'
        }
    ];

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (failedActions > 0) {
        blockers.push(`存在 ${failedActions} 个图层顺序调整工具失败。`);
    }
    if (acceptance.failed > 0) {
        blockers.push(`存在 ${acceptance.failed} 个工具验收失败。`);
    }
    if (!inspectedBeforeMutation) {
        warnings.push('图层顺序任务缺少修改前层级读取，无法确认目标集合是否正确。');
    }
    if (!verifiedAfterMutation) {
        warnings.push('图层顺序任务缺少修改后复核，不能只凭模型口头结论判定完成。');
    }
    if (acceptance.needsReview > 0 || acceptance.noDocumentChangeRisk > 0) {
        warnings.push(`工具验收仍有 ${acceptance.needsReview} 项需要复核，${acceptance.noDocumentChangeRisk} 项存在无变化风险。`);
    }

    const status = resolveStatus(requirements, blockers, warnings);
    return {
        kind: 'layer_order_edit',
        status,
        required: requirements,
        evidence: {
            toolAcceptance: acceptance
        },
        blockers,
        warnings,
        summary: buildSummary('layer_order_edit', status, requirements)
    };
}

function buildTextContract(
    kind: 'text_content_edit' | 'text_typography_edit',
    input: ContractInput,
    acceptance: AcceptanceCounts
): TaskCompletionContract {
    const firstMutation = firstSuccessfulIndex(input.toolCallLog, TEXT_MUTATION_TOOLS);
    const actionCount = countSuccessful(input.toolCallLog, TEXT_MUTATION_TOOLS);
    const failedActions = countFailed(input.toolCallLog, TEXT_MUTATION_TOOLS);
    const inspectedBeforeMutation = firstMutation >= 0 && hasSuccessfulBefore(input.toolCallLog, INSPECTION_TOOLS, firstMutation);
    const verifiedAfterMutation = firstMutation >= 0 && (
        hasSuccessfulAfter(input.toolCallLog, TEXT_VERIFICATION_TOOLS, firstMutation)
        || acceptance.verified > 0
    );

    const requirements: TaskCompletionRequirement[] = [
        {
            id: 'context-read',
            label: '读取文本/图层上下文',
            status: inspectedBeforeMutation ? 'passed' : 'needs_review',
            reason: inspectedBeforeMutation ? undefined : '缺少修改前的文本或图层读取证据。'
        },
        {
            id: 'text-mutated',
            label: '执行文字修改',
            status: actionCount > 0 ? 'passed' : 'failed',
            actual: { actionCount, failedActions },
            reason: actionCount > 0 ? undefined : '没有检测到成功的文字修改工具调用。'
        },
        {
            id: 'text-verified',
            label: '复核文字字段或图层状态',
            status: verifiedAfterMutation ? 'passed' : 'needs_review',
            reason: verifiedAfterMutation ? undefined : '缺少修改后的文本字段、图层边界或验收快照。'
        }
    ];

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (failedActions > 0) {
        blockers.push(`存在 ${failedActions} 个文字修改工具失败。`);
    }
    if (acceptance.failed > 0) {
        blockers.push(`存在 ${acceptance.failed} 个工具验收失败。`);
    }
    if (!inspectedBeforeMutation) {
        warnings.push('文字任务缺少修改前上下文读取，无法确认目标集合是否正确。');
    }
    if (!verifiedAfterMutation) {
        warnings.push('文字任务缺少修改后复核，不能只凭模型口头结论判定完成。');
    }
    if (acceptance.needsReview > 0 || acceptance.noDocumentChangeRisk > 0) {
        warnings.push(`工具验收仍有 ${acceptance.needsReview} 项需要复核，${acceptance.noDocumentChangeRisk} 项存在无变化风险。`);
    }

    const status = resolveStatus(requirements, blockers, warnings);
    return {
        kind,
        status,
        required: requirements,
        evidence: {
            toolAcceptance: acceptance
        },
        blockers,
        warnings,
        summary: buildSummary(kind, status, requirements)
    };
}

function buildReferenceContract(input: ContractInput, acceptance: AcceptanceCounts): TaskCompletionContract {
    const firstMutation = firstSuccessfulIndex(input.toolCallLog, REFERENCE_MUTATION_TOOLS);
    const actionCount = countSuccessful(input.toolCallLog, REFERENCE_MUTATION_TOOLS);
    const failedActions = countFailed(input.toolCallLog, REFERENCE_MUTATION_TOOLS);
    const hasReferenceInput = (input.context?.imageCount || 0) > 0
        || input.toolCallLog.some((item) => (item.name === 'describeImage' || item.name === 'getCanvasSnapshot') && toolSucceeded(item));
    const visual = firstMutation >= 0 ? getVisualEvidence(input.toolCallLog, firstMutation) : { mode: 'none' as const, snapshotCount: 0, overlayCount: 0 };
    const coverage = findCoverageEvidence(input.toolCallLog);
    const visualVerified = visual.mode === 'screenshot' || visual.mode === 'overlay' || visual.mode === 'model_review';
    const coveragePassed = Boolean(coverage && coverage.expected > 0 && coverage.applied >= coverage.expected && coverage.failed === 0);

    const requirements: TaskCompletionRequirement[] = [
        {
            id: 'reference-understood',
            label: '读取或理解参考图',
            status: hasReferenceInput ? 'passed' : 'needs_review',
            reason: hasReferenceInput ? undefined : '缺少参考图附件或图像读取证据。'
        },
        {
            id: 'editable-layout-created',
            label: '创建可编辑设计元素',
            status: actionCount > 0 ? 'passed' : 'failed',
            actual: { actionCount, failedActions },
            reason: actionCount > 0 ? undefined : '没有检测到成功的文字、形状或图片创建/放置工具调用。'
        },
        {
            id: 'visual-verified',
            label: '复核生成结果画面',
            status: visualVerified ? 'passed' : 'needs_review',
            actual: visual,
            reason: visualVerified ? undefined : '缺少生成后的截图、overlay 或视觉复核证据。'
        },
        {
            id: 'reference-coverage',
            label: '参考元素覆盖率',
            status: coveragePassed ? 'passed' : 'needs_review',
            expected: coverage ? { expected: coverage.expected } : undefined,
            actual: coverage || undefined,
            reason: coveragePassed ? undefined : '缺少参考元素 expected/applied 覆盖率，不能确认复刻是否覆盖关键元素。'
        }
    ];

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (failedActions > 0) {
        blockers.push(`存在 ${failedActions} 个参考图复刻相关工具失败。`);
    }
    if (acceptance.failed > 0) {
        blockers.push(`存在 ${acceptance.failed} 个工具验收失败。`);
    }
    if (!hasReferenceInput) {
        warnings.push('参考图复刻缺少参考输入证据。');
    }
    if (!visualVerified) {
        warnings.push('参考图复刻缺少生成后画面复核。');
    }
    if (!coveragePassed) {
        warnings.push('参考图复刻缺少关键元素覆盖率证据。');
    }
    if (acceptance.needsReview > 0 || acceptance.noDocumentChangeRisk > 0) {
        warnings.push(`工具验收仍有 ${acceptance.needsReview} 项需要复核，${acceptance.noDocumentChangeRisk} 项存在无变化风险。`);
    }

    const status = resolveStatus(requirements, blockers, warnings);
    return {
        kind: 'reference_replication',
        status,
        required: requirements,
        evidence: {
            toolAcceptance: acceptance,
            visual,
            coverage
        },
        blockers,
        warnings,
        summary: buildSummary('reference_replication', status, requirements)
    };
}

export function buildTaskCompletionContract(input: ContractInput): TaskCompletionContract | undefined {
    const kind = inferTaskKind(input);
    if (!kind) return undefined;

    const acceptance = collectAcceptanceCounts(input.toolCallLog);
    if (kind === 'reference_replication') {
        return buildReferenceContract(input, acceptance);
    }
    if (kind === 'layer_order_edit') {
        return buildLayerOrderContract(input, acceptance);
    }
    if (kind === 'layer_management') {
        return buildOperationContract(kind, input, acceptance, LAYER_MANAGEMENT_MUTATION_TOOLS, LAYER_MANAGEMENT_VERIFICATION_TOOLS, {
            context: '读取图层上下文',
            mutation: '执行图层管理操作',
            verification: '复核图层状态'
        });
    }
    if (kind === 'document_save') {
        return buildOperationContract(kind, input, acceptance, DOCUMENT_SAVE_TOOLS, DOCUMENT_VERIFICATION_TOOLS, {
            context: '读取文档状态',
            mutation: '执行文档保存或导出',
            verification: '复核文档保存结果'
        });
    }
    if (kind === 'document_close') {
        return buildOperationContract(kind, input, acceptance, DOCUMENT_CLOSE_TOOLS, DOCUMENT_VERIFICATION_TOOLS, {
            context: '确认待关闭文档',
            mutation: '执行文档关闭',
            verification: '复核文档关闭结果'
        });
    }
    return buildTextContract(kind, input, acceptance);
}
