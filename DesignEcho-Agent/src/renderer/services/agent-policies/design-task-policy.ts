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
    if (contract.kind !== 'layer_management'
        && contract.kind !== 'creative_design'
        && contract.kind !== 'skill_evaluation_profile') {
        return null;
    }

    const pendingRequirements = contract.required.filter(
        (item) => item.status === 'failed' || item.status === 'needs_review'
    );
    if (pendingRequirements.length === 0) return null;
    if (contract.kind === 'skill_evaluation_profile'
        && pendingRequirements.some((item) => !item.id.startsWith('production-'))) {
        // 同实例收尾只补可验证的生产、读回和交付事实。Profile 的审美 finding、
        // publication review 或其它方法检查仍由质量 owner / Agent Reflexion 处理。
        return null;
    }

    const pendingFacts = pendingRequirements.slice(0, 12).map((item) => {
        const status = item.status === 'failed' ? '确定未满足' : '尚未验证';
        const reason = String(item.reason || '').trim();
        return `- ${item.label}（${status}）${reason ? `：${reason}` : ''}`;
    });
    const shortReason = pendingRequirements
        .slice(0, 5)
        .map((item) => item.label)
        .join('+');

    return {
        directive: [
            '当前版本还没有通过完成契约，以下是验收事实：',
            ...pendingFacts,
            '这些事实只定义“什么还没有被证明完成”，不指定下一工具、参数或动作顺序。',
            '请根据用户原始目标、当前文档事实和完整已授权能力面，自主选择最小且可验证的推进动作。',
            '用户指定的目标、内容与禁止项继续有效；不要为了通过检查补做用户没有要求的内容。',
            '任何未知写入状态都要先取得同一目标的新事实；只有真实执行结果可以证明保存、导出或交付已经完成。'
        ].join('\n'),
        shortReason
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
