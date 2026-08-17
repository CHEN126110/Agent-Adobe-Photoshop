/**
 * SKU 模板候选选择（纯逻辑、单一评分 owner）。
 *
 * 主进程负责建立候选 inventory，Renderer 负责在当前 SKU run 中复用该 snapshot；
 * 两端必须使用本模块的同一评分，避免以“减少扫描”为名悄悄改变模板选择结果。
 */

export const CURRENT_GENERATED_SKU_CARD_TEMPLATE_REVISION = 4;

export interface SkuTemplateSelectionCandidate {
    id: string;
    name: string;
    filePath: string;
    description?: string;
    metadata?: {
        comboSize?: number;
    };
    source: string;
    sourcePriority: number;
}

export interface PickSkuTemplateCandidateOptions {
    comboSize: number;
    keyword?: string;
    noteMode: boolean;
    sources?: readonly string[];
}

export type SkuTemplateCandidateValidationVerdict = {
    schema: 'sku-template-candidate-validation/v0';
    status: 'validated' | 'rejected';
    reasonCode:
        | 'validated_current_revision'
        | 'not_generated_candidate'
        | 'candidate_read_failed'
        | 'candidate_path_mismatch'
        | 'candidate_inspection_unreliable'
        | 'candidate_revision_identity_mismatch'
        | 'candidate_layout_not_ready'
        | 'candidate_content_not_ready';
    reason: string;
    candidateId: string;
    candidatePath: string;
    observedDocumentId?: number;
    observedHistoryStateId?: number;
    boundaries: {
        writesPhotoshop: false;
        grantsPermission: false;
    };
};

export type SkuTemplateCandidatePriorityDecision<T extends SkuTemplateSelectionCandidate> = {
    schema: 'sku-template-candidate-priority-decision/v0';
    status: 'validated_generated_candidate' | 'fallback_candidate' | 'blocked_no_validated_candidate';
    candidate: T | null;
    diagnostics: string[];
    boundaries: {
        writesPhotoshop: false;
        grantsPermission: false;
    };
};

const TEMPLATE_FILE_PATTERN = /\.(psd|psb|tif|tiff)$/i;
const NOTE_TEMPLATE_KEYWORD = '自选备注';

function normalizeFullWidthDigits(value: string): string {
    return value.replace(/[０-９]/g, (character) => (
        String(character.charCodeAt(0) - '０'.charCodeAt(0))
    ));
}

function normalizeNameWithoutExt(value: string): string {
    return normalizeFullWidthDigits(String(value || ''))
        .replace(/\.[^.]+$/, '')
        .trim()
        .toLowerCase();
}

function normalizePathForIdentity(value: string): string {
    return String(value || '')
        .trim()
        .replace(/\//g, '\\')
        .replace(/\\+$/, '')
        .toLowerCase();
}

function normalizePositiveInteger(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return undefined;
    return numeric;
}

export function inferSkuTemplateComboSize(
    candidate: Pick<SkuTemplateSelectionCandidate, 'name' | 'filePath' | 'metadata'>
): number | undefined {
    const metadataSize = normalizePositiveInteger(candidate.metadata?.comboSize);
    if (metadataSize !== undefined) return metadataSize;
    const text = normalizeNameWithoutExt(`${candidate.name} ${candidate.filePath}`);
    const patterns = [
        /(?:^|[^\d])(\d{1,2})\s*(?:双装自选备注|双自选备注|双装|双模板|双)(?!\d)/i,
        /(?:^|[^\d])(\d{1,2})\s*(?:组|套)(?!\d)/i
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        const size = normalizePositiveInteger(match?.[1]);
        if (size !== undefined && size <= 99) return size;
    }
    return undefined;
}

export function isSkuCardStyleTemplateText(value: string): boolean {
    const text = normalizeNameWithoutExt(value);
    return /卡片|色卡|card|designecho/.test(text);
}

export function isSkuCardStyleTemplateCandidate(
    candidate: Pick<SkuTemplateSelectionCandidate, 'name' | 'filePath' | 'description'>
): boolean {
    return isSkuCardStyleTemplateText([
        candidate.name,
        candidate.filePath,
        candidate.description || ''
    ].join(' '));
}

/**
 * 只识别 SKU owner 另存的新版本候选命名；该信号只负责发现待验文件，
 * 不参与普通模板评分，也不代表候选已经可以用于生产。
 */
export function isDesignEchoSkuTemplateCandidateDiscovery(
    candidate: Pick<SkuTemplateSelectionCandidate, 'name' | 'filePath'>
): boolean {
    const name = normalizeNameWithoutExt(
        candidate.name || candidate.filePath.split(/[/\\]/).pop() || ''
    );
    return /(?:^|[-_\s])designecho候选(?:[-_\s]?(?:v)?\d+)?$/i.test(name);
}

function readPositiveInteger(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return undefined;
    return numeric;
}

export function validateDesignEchoSkuTemplateCandidate(input: {
    candidate: SkuTemplateSelectionCandidate;
    openedDocument?: { id?: unknown; path?: unknown } | null;
    expectedItemCount: number;
    runtimeInspection?: Record<string, any> | null;
    preflight?: {
        expectedItemCount?: number;
        skuPlaceholderInspectionStatus?: string;
        hasReliableSkuPlaceholders?: boolean;
        layoutPlan?: { status?: string };
    } | null;
    contentConsistencyStatus?: string;
    hasContentRepairProposal?: boolean;
    contentRepairError?: string;
    readError?: string;
}): SkuTemplateCandidateValidationVerdict {
    const candidateId = String(input.candidate.id || '').trim();
    const candidatePath = String(input.candidate.filePath || '').trim();
    const reject = (
        reasonCode: Exclude<SkuTemplateCandidateValidationVerdict['reasonCode'], 'validated_current_revision'>,
        reason: string
    ): SkuTemplateCandidateValidationVerdict => ({
        schema: 'sku-template-candidate-validation/v0',
        status: 'rejected',
        reasonCode,
        reason,
        candidateId,
        candidatePath,
        boundaries: {
            writesPhotoshop: false,
            grantsPermission: false
        }
    });
    if (!isDesignEchoSkuTemplateCandidateDiscovery(input.candidate)) {
        return reject('not_generated_candidate', '该文件不是 SKU owner 另存的 DesignEcho 候选。');
    }
    if (String(input.readError || '').trim()) {
        return reject('candidate_read_failed', `候选读取失败：${String(input.readError).trim()}`);
    }
    const openedPath = normalizePathForIdentity(String(input.openedDocument?.path || ''));
    if (!openedPath || openedPath !== normalizePathForIdentity(candidatePath)) {
        return reject('candidate_path_mismatch', '候选没有按项目目录中的精确文件路径打开。');
    }
    const documentId = readPositiveInteger(input.openedDocument?.id);
    const observedDocumentId = readPositiveInteger(input.runtimeInspection?.historyStateRef?.documentId);
    const observedHistoryStateId = readPositiveInteger(input.runtimeInspection?.historyStateRef?.historyStateId);
    if (
        input.preflight?.skuPlaceholderInspectionStatus !== 'inspected'
        || input.runtimeInspection?.schema !== 'sku-template-layout-inspection/v3'
        || input.runtimeInspection?.hasReliableInspection === false
    ) {
        return reject('candidate_inspection_unreliable', '候选没有取得可靠的 v3 模板结构检查结果。');
    }
    if (
        documentId === undefined
        || observedDocumentId === undefined
        || observedHistoryStateId === undefined
        || documentId !== observedDocumentId
    ) {
        return reject('candidate_revision_identity_mismatch', '候选文档与模板检查的 documentId/historyStateId 不一致。');
    }
    if (
        input.preflight.hasReliableSkuPlaceholders !== true
        || input.preflight.layoutPlan?.status !== 'ready'
        || Number(input.preflight.expectedItemCount) !== Number(input.expectedItemCount)
    ) {
        return reject('candidate_layout_not_ready', '候选的占位结构或规格布局尚未通过当前修订预检。');
    }
    const contentStatus = String(input.contentConsistencyStatus || '').trim();
    if (
        String(input.contentRepairError || '').trim()
        || input.hasContentRepairProposal === true
        || (contentStatus && contentStatus !== 'consistent' && contentStatus !== 'warning')
    ) {
        return reject('candidate_content_not_ready', '候选的可见规格文字尚未通过当前修订内容预检。');
    }
    return {
        schema: 'sku-template-candidate-validation/v0',
        status: 'validated',
        reasonCode: 'validated_current_revision',
        reason: '候选已通过精确路径、当前 Photoshop 修订、占位结构与内容预检。',
        candidateId,
        candidatePath,
        observedDocumentId,
        observedHistoryStateId,
        boundaries: {
            writesPhotoshop: false,
            grantsPermission: false
        }
    };
}

export function pickSkuTemplateCandidateWithValidatedGeneratedPriority<
    T extends SkuTemplateSelectionCandidate
>(input: {
    generatedCandidates: ReadonlyArray<{
        candidate: T;
        validation: SkuTemplateCandidateValidationVerdict;
    }>;
    fallbackCandidate?: T | null;
}): SkuTemplateCandidatePriorityDecision<T> {
    const validated = input.generatedCandidates.find(item => item.validation.status === 'validated');
    const diagnostics = input.generatedCandidates
        .filter(item => item.validation.status === 'rejected')
        .map(item => `${item.candidate.filePath}: ${item.validation.reason}`);
    if (validated) {
        return {
            schema: 'sku-template-candidate-priority-decision/v0',
            status: 'validated_generated_candidate',
            candidate: validated.candidate,
            diagnostics,
            boundaries: {
                writesPhotoshop: false,
                grantsPermission: false
            }
        };
    }
    if (input.fallbackCandidate) {
        return {
            schema: 'sku-template-candidate-priority-decision/v0',
            status: 'fallback_candidate',
            candidate: input.fallbackCandidate,
            diagnostics,
            boundaries: {
                writesPhotoshop: false,
                grantsPermission: false
            }
        };
    }
    return {
        schema: 'sku-template-candidate-priority-decision/v0',
        status: 'blocked_no_validated_candidate',
        candidate: null,
        diagnostics,
        boundaries: {
            writesPhotoshop: false,
            grantsPermission: false
        }
    };
}

export function scoreGeneratedSkuCardTemplateRevision(value: string): number {
    const text = normalizeNameWithoutExt(value);
    const versions = Array.from(text.matchAll(/卡片模板v(\d+)/gi))
        .map((match) => Number(match[1]))
        .filter((version) => Number.isInteger(version) && version > 0);
    return versions.length > 0 ? Math.max(...versions) : 0;
}

export function getGeneratedSkuCardTemplateRevision(
    candidate: Pick<SkuTemplateSelectionCandidate, 'name' | 'filePath' | 'description'>
): number {
    return scoreGeneratedSkuCardTemplateRevision([
        candidate.name,
        candidate.filePath,
        candidate.description || ''
    ].join(' '));
}

export function isOutdatedGeneratedSkuCardTemplateCandidate(
    candidate: Pick<SkuTemplateSelectionCandidate, 'name' | 'filePath' | 'description'>
): boolean {
    const revision = getGeneratedSkuCardTemplateRevision(candidate);
    return revision > 0 && revision < CURRENT_GENERATED_SKU_CARD_TEMPLATE_REVISION;
}

/**
 * 同规格下优先真实用户模板；`卡片模板vN` 是生成器兜底产物，不得凭“版本号更高”
 * 覆盖用户的 2双装/3双装 PSD、PSB 或 TIF。生产模板必须能从结构化 metadata
 * 或文件身份证明规格；规格未知的普通 PSD 只可作为设计参考，不能冒充任意 N 双模板。
 */
export function pickBestSkuTemplateCandidate<T extends SkuTemplateSelectionCandidate>(
    candidates: readonly T[],
    options: PickSkuTemplateCandidateOptions
): T | null {
    const comboSize = normalizePositiveInteger(options.comboSize);
    if (comboSize === undefined) return null;
    const keyword = String(options.keyword || '').trim().toLowerCase();
    const sizeKeyword = `${comboSize}双`;
    const sourceSet = options.sources && options.sources.length > 0
        ? new Set(options.sources)
        : undefined;

    const scored = candidates
        .map((candidate, ordinal) => {
            if (sourceSet && !sourceSet.has(candidate.source)) {
                return { candidate, ordinal, score: -Infinity };
            }
            const fileName = normalizeNameWithoutExt(
                candidate.name || candidate.filePath.split(/[/\\]/).pop() || ''
            );
            const isNote = fileName.includes(NOTE_TEMPLATE_KEYWORD);
            if (options.noteMode && !isNote) return { candidate, ordinal, score: -Infinity };
            if (!options.noteMode && isNote) return { candidate, ordinal, score: -Infinity };

            let score = 0;
            const inferredSize = inferSkuTemplateComboSize(candidate);
            if (inferredSize === undefined) {
                return { candidate, ordinal, score: -Infinity };
            }
            if (inferredSize !== comboSize) {
                return { candidate, ordinal, score: -Infinity };
            }
            if (inferredSize === comboSize) score += 100;
            if (fileName.includes(sizeKeyword)) score += 60;
            if (keyword && (
                fileName.includes(keyword)
                || String(candidate.description || '').toLowerCase().includes(keyword)
            )) {
                score += 25;
            }
            const generatedRevision = getGeneratedSkuCardTemplateRevision(candidate);
            if (generatedRevision > 0) score -= 80;
            else if (isSkuCardStyleTemplateCandidate(candidate)) score += 40;
            if (fileName.includes('模板')) score += 8;
            if (TEMPLATE_FILE_PATTERN.test(candidate.filePath)) score += 5;
            if (/\.psd$/i.test(candidate.filePath)) score += 3;

            return { candidate, ordinal, score };
        })
        .filter((row) => Number.isFinite(row.score))
        .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            const leftPriority = Number.isFinite(left.candidate.sourcePriority)
                ? left.candidate.sourcePriority
                : Number.MAX_SAFE_INTEGER;
            const rightPriority = Number.isFinite(right.candidate.sourcePriority)
                ? right.candidate.sourcePriority
                : Number.MAX_SAFE_INTEGER;
            if (leftPriority !== rightPriority) return leftPriority - rightPriority;
            return left.ordinal - right.ordinal;
        });

    return scored.length > 0 ? scored[0].candidate : null;
}

export function collectSkuTemplateSizes<T extends SkuTemplateSelectionCandidate>(
    candidates: readonly T[],
    sources?: readonly string[]
): number[] {
    const sourceSet = sources && sources.length > 0 ? new Set(sources) : undefined;
    const sizes = new Set<number>();
    for (const candidate of candidates) {
        if (sourceSet && !sourceSet.has(candidate.source)) continue;
        const fileName = normalizeNameWithoutExt(candidate.name || '');
        if (fileName.includes(NOTE_TEMPLATE_KEYWORD)) continue;
        const size = inferSkuTemplateComboSize(candidate);
        if (size !== undefined) sizes.add(size);
    }
    return Array.from(sizes).sort((left, right) => left - right);
}
