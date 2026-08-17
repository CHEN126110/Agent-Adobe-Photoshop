import type {
    AgentToolCallLogEntry,
    TaskCompletionContext
} from '../agent-runtime/types';
import { buildTaskCompletionContract } from '../agent-runtime/task-completion-contract';

export interface AgentTaskPolicyDirective {
    directive: string;
    shortReason: string;
}

export function buildDesignTaskContractRemediationDirective(input: {
    task: string;
    context?: TaskCompletionContext;
    toolCallLog: AgentToolCallLogEntry[];
}): AgentTaskPolicyDirective | null {
    const contract = buildTaskCompletionContract({
        task: input.task,
        context: input.context,
        toolCallLog: input.toolCallLog
    });
    if (!contract || contract.status === 'completed') {
        return null;
    }
    if (contract.kind === 'layer_management') {
        const semanticOrganization =
            input.context?.intentMode === 'organize'
            || /(?:整理|归组|组合).{0,8}(?:图层|编组)|(?:图层|编组).{0,8}(?:整理|组合)|organize layers?/i
                .test(input.task);
        return {
            directive: semanticOrganization
                ? [
                    '图层整理还没有真正落到文档中：当前只有查看和建议，继续完成实际整理。',
                    '立即调用 layer-management，action=organize，preserveUnassigned=true。',
                    '如果工具返回 awaiting_semantic_plan，直接使用它给出的完整层级、分屏观察和版本 ID 生成 groups，并在下一步再次调用同一工具执行；不要把计划展示给用户确认。',
                    '隐藏层、空组、锁定层和低置信图层保持原状，放入 intentionallyUnassignedLayerIds；先完成其余高置信、可撤回的安全归组，不要擅自删除或重命名。',
                    '创建图层组后查看最终层级和画面，确认内容没有被意外改变，再向用户说明结果。'
                ].join('\n')
                : [
                    '用户要求的图层修改还没有发生，不能只给说明或建议。',
                    '根据用户原始动作调用 layer-management，并使用明确的 layerId、目标名称或目标组参数执行。',
                    '执行后查看图层层级或属性，再回复用户。'
                ].join('\n'),
            shortReason: semanticOrganization
                ? '只分析了图层，尚未执行整理'
                : '图层操作尚未执行'
        };
    }
    if (contract.kind !== 'creative_design') {
        return null;
    }

    const pendingRequirements = contract.required.filter(
        (item) => item.status === 'failed' || item.status === 'needs_review'
    );
    const pendingIds = new Set(pendingRequirements.map((item) => item.id));
    const failedIds = new Set(
        pendingRequirements.filter((item) => item.status === 'failed').map((item) => item.id)
    );
    const needsReviewIds = new Set(
        pendingRequirements.filter((item) => item.status === 'needs_review').map((item) => item.id)
    );
    const missingExecution = pendingIds.has('creative-execution');
    const missingDocument = pendingIds.has('creative-document');
    const wrongOrUnknownTarget = pendingIds.has('creative-target');
    const missingReadback = pendingIds.has('creative-readback');
    const missingCopy = failedIds.has('creative-copy');
    const unverifiedCopy = needsReviewIds.has('creative-copy');
    const violatesNoCopyConstraint = failedIds.has('creative-copy-constraint');
    const unverifiedNoCopyConstraint = needsReviewIds.has('creative-copy-constraint');
    const missingDelivery = pendingIds.has('creative-delivery');
    const missingReview = pendingIds.has('creative-review');
    const layoutNeedsRepair = pendingIds.has('creative-layout-quality');
    if (!missingExecution
        && !missingDocument
        && !wrongOrUnknownTarget
        && !missingReadback
        && !missingCopy
        && !unverifiedCopy
        && !violatesNoCopyConstraint
        && !unverifiedNoCopyConstraint
        && !missingDelivery
        && !missingReview
        && !layoutNeedsRepair) {
        return null;
    }

    const steps: string[] = [];
    const latestLayoutResult = [...input.toolCallLog]
        .reverse()
        .find((entry) => entry.name === 'renderLayout' && entry.result?.success !== false)
        ?.result;
    const layoutFindings = Array.isArray(latestLayoutResult?.qualityFindings)
        ? latestLayoutResult.qualityFindings
        : [];

    if (layoutNeedsRepair) {
        const repairActions = layoutFindings
            .map((finding: any) => finding?.recommendedAction)
            .filter((action: any) => action
                && typeof action.toolName === 'string'
                && action.params
                && typeof action.params === 'object');
        if (repairActions.length > 0) {
            for (const action of repairActions.slice(0, 3)) {
                steps.push(
                    `调用 ${action.toolName}，参数 ${JSON.stringify(action.params)}。`
                    + `${String(action.reason || '').trim() ? ` 原因：${String(action.reason).trim()}` : ''}`
                );
            }
        } else {
            const findingSummary = layoutFindings
                .slice(0, 3)
                .map((finding: any) => {
                    const message = String(finding?.message || finding?.code || '').trim();
                    const strategies = Array.isArray(finding?.recommendedStrategies)
                        ? finding.recommendedStrategies.map((item: unknown) => String(item).trim()).filter(Boolean)
                        : [];
                    return `${message}${strategies.length ? ` 可选策略：${strategies.join(' / ')}` : ''}`;
                })
                .filter(Boolean)
                .join('；');
            steps.push(
                `先按 renderLayout 的结构化质量发现重新规划并修复当前草稿${findingSummary ? `：${findingSummary}` : ''}。`
                + '构图或落位方式改变时，重新调用 renderLayout 形成新的版式结果。'
                + '只处理已确认的图层与失败项，不重新搜索整个项目或重放已经成功的写入。'
            );
        }
    }

    if (missingExecution) {
        steps.push(
            '回到用户原始目标，在正确文档上完成交付真正需要的设计动作。'
            + '只做该任务需要的最小改动；不要为了满足内部检查自动补主体图、标题、卖点、背景或其他可选内容。'
        );
    }
    if (missingDocument) {
        steps.push(
            '用户已经明确要求新建文档：调用 createDocument 创建对应画布，并沿用返回的 documentId 完成后续编辑和查看。'
            + '只有存在这条显式 requirement 时才允许把新建画布当作补救动作。'
        );
    }
    if (wrongOrUnknownTarget) {
        steps.push(
            '先用 getDocumentInfo 确认用户指定或当前文档的 documentId，后续修改始终绑定这个目标。'
            + '如果本轮误建了新文档，不要擅自关闭、删除或覆盖它；回到正确目标继续，并如实保留该冲突。'
        );
    }
    if (missingCopy) {
        steps.push(
            '只写入 TaskPlan 或用户原始请求明确要求的文字类型与内容，并复核实际文本。'
            + '不要套用“主标题 + 1-2 条卖点”等固定公式，也不要补用户没有要求的额外文案。'
        );
    }
    if (unverifiedCopy || unverifiedNoCopyConstraint) {
        steps.push(
            '先在最后一次写入对应的同一 documentId 上调用 getAllTextLayers，读取最终非空文本内容。'
            + '在读回前不要重复写文案、清空文字或删除文本图层；未知状态只能补观察，不能猜测最终有字或无字。'
        );
    }
    if (violatesNoCopyConstraint) {
        steps.push(
            '用户明确要求无字/不要文案：恢复本轮误加的文本，使结果重新满足该约束。'
            + '只处理本轮新增或明确指向的文本，并用 getAllTextLayers 读回确认没有非空文本；'
            + '若恢复需要未经批准的删除或覆盖，停止该不可逆动作并如实报告，不能反向再加文字。'
        );
    }
    if (missingDelivery) {
        steps.push(
            '按用户明确列出的文件类型、格式与位置完成保存或导出，并使用操作返回的实际路径说明交付位置。'
            + '不要把仅存在于 Photoshop 的打开文档或口头说明冒充已交付文件。'
        );
    }
    if (missingReadback) {
        steps.push(
            '最后一次修改后，在同一个 documentId 和目标位置查看文档或图层；另一个文档的结果不能用来判断这次修改。'
        );
    }
    if (missingReview || layoutNeedsRepair || missingExecution || missingCopy || violatesNoCopyConstraint) {
        const observation = latestLayoutResult?.suggestedObservation;
        if (observation?.toolName && observation?.params) {
            steps.push(
                `补完后调用 ${observation.toolName}，参数 ${JSON.stringify(observation.params)}，`
                + '只看本次修改对应的高分辨率区域；全页缩略图只用于导航。读取真实画面后再判断是否还需修订。'
            );
        } else {
            steps.push('补完后用 getAnnotatedSnapshot 或 getCanvasSnapshot 截图复核排版与可读性，再给出最终回复。');
        }
    }

    const missingLabel = [
        missingExecution ? '真实设计写入' : '',
        missingDocument ? '明确要求的新文档' : '',
        wrongOrUnknownTarget ? '正确目标文档' : '',
        missingReadback ? '同目标写后读回' : '',
        layoutNeedsRepair ? '布局/图片落位修订' : '',
        missingCopy ? '用户明确要求的文字' : '',
        unverifiedCopy ? '最终文字读回' : '',
        violatesNoCopyConstraint ? '无字约束恢复' : '',
        unverifiedNoCopyConstraint ? '无字约束读回' : '',
        missingReview ? '写后画面复核' : '',
        missingDelivery ? '导出交付文件' : ''
    ]
        .filter(Boolean)
        .join('、');
    return {
        directive: [
            `当前版本还没完成，接下来需要补上：${missingLabel}。`,
            '请在用户指定的目标文档上继续完成下面的内容，不要只用文字描述：',
            ...steps.map((step, index) => `${index + 1}. ${step}`),
            '用户要求的内容确实做完、改在正确目标并看过当前结果后，才能向用户说完成；审美还拿不准时就说当前版本可以先看，不要编造结论，也不要擅自补内容。'
        ].join('\n'),
        shortReason: [
            missingExecution ? '缺真实写入' : '',
            missingDocument ? '缺明确要求的新文档' : '',
            wrongOrUnknownTarget ? '目标不正确或不可证' : '',
            missingReadback ? '缺同目标读回' : '',
            layoutNeedsRepair ? '落位需修订' : '',
            missingCopy ? '缺用户要求的文字' : '',
            unverifiedCopy ? '缺最终文字读回' : '',
            violatesNoCopyConstraint ? '违反无字约束' : '',
            unverifiedNoCopyConstraint ? '缺无字约束读回' : '',
            missingReview ? '缺画面复核' : '',
            missingDelivery ? '缺导出' : ''
        ]
            .filter(Boolean)
            .join('+')
    };
}

export function buildObservedDesignDraftSummary(toolCallLog: AgentToolCallLogEntry[]): string {
    const successfulCreate = [...toolCallLog].reverse().find((entry) =>
        entry.name === 'createDocument' && entry.result?.success !== false);
    const successfulLayout = [...toolCallLog].reverse().find((entry) =>
        (entry.name === 'renderLayout'
            || entry.name === 'placeImage'
            || entry.name === 'createTextLayer'
            || entry.name === 'createRectangle'
            || entry.name === 'createShape')
        && entry.result?.success !== false);
    const successfulObservation = [...toolCallLog].reverse().find((entry) =>
        (entry.name === 'getCanvasSnapshot'
            || entry.name === 'getAnnotatedSnapshot'
            || entry.name === 'getScreenSnapshots'
            || entry.name === 'getScreenSnapshotsWithOverlay'
            || entry.name === 'getAcceptanceSnapshot')
        && entry.result?.success !== false);

    if (!successfulCreate || !successfulLayout || !successfulObservation) {
        return '';
    }

    const documentName = resolveCreatedDocumentName(successfulCreate) || '当前设计文档';
    const documentRole = resolveDocumentRoleLabel(documentName);
    const createdCount = resolveCreatedElementCount(successfulLayout.result);
    const createdSummary = createdCount > 0
        ? `本轮已在画面中写入 ${createdCount} 个可编辑元素。`
        : '本轮已在画面中写入可编辑设计元素。';
    const observationLabel = successfulObservation.name === 'getAcceptanceSnapshot'
        ? '最新画面'
        : '画面快照';

    return [
        `${documentRole}「${documentName}」已经生成当前阶段草稿。`,
        createdSummary,
        `我已经读取过${observationLabel}，这个结果可以进入画面复核；它还不是最终质量结论，后续应继续根据实际画面调整。`
    ].join('\n');
}

function resolveCreatedDocumentName(entry: AgentToolCallLogEntry): string {
    const directName = String(
        entry.arguments?.documentName
        || entry.arguments?.name
        || entry.result?.documentName
        || entry.result?.name
        || ''
    ).trim();
    if (directName) return directName;

    const message = String(entry.result?.message || entry.result?.summary || '').trim();
    const quoted = message.match(/["“「]([^"”」]+)["”」]/);
    return String(quoted?.[1] || '').trim();
}

function resolveCreatedElementCount(result: any): number {
    const candidates = [
        result?.created,
        result?.createdLayers,
        result?.layers,
        result?.createdCount,
        result?.layerCount
    ];
    for (const value of candidates) {
        if (Array.isArray(value)) return value.length;
        const count = Number(value);
        if (Number.isFinite(count) && count > 0) return Math.round(count);
    }
    return 0;
}

function resolveDocumentRoleLabel(documentName: string): string {
    const name = String(documentName || '').trim();
    if (/详情页|商品详情|detail\s*page|detail-page|product\s*detail/i.test(name)) return '详情页文档';
    if (/(^|[^a-z0-9])sku([^a-z0-9]|$)|色卡|组合图|规格图|套装|自选/i.test(name)) return 'SKU 文档';
    if (/主图|点击图|转化图|main\s*image|main-image|hero\s*image/i.test(name)) return '主图文档';
    return '设计文档';
}
