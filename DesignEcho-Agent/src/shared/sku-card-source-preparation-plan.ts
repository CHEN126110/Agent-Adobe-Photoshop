import type {
    SkuCardAssetCandidate,
    SkuCardAssetCandidateReport
} from './sku-card-asset-candidates';

export type SkuCardSourcePreparationPlanVersion = 'sku-card-source-preparation-plan/v0';
export type SkuCardSourcePreparationPlanStatus =
    | 'ready_for_design_decision'
    | 'blocked_missing_project_path'
    | 'blocked_candidates_not_ready';

export interface SkuCardSourcePreparationSource {
    assetId: string;
    path: string;
    relativePath: string;
    colorName: string;
    displayName: string;
    score: number;
    recommendedUse: SkuCardAssetCandidate['recommendedUse'];
}

export interface SkuCardSourcePreparationPlan {
    version: SkuCardSourcePreparationPlanVersion;
    status: SkuCardSourcePreparationPlanStatus;
    canRunPhotoshopWrites: boolean;
    outputDocumentPath: string;
    minimumSourceCount: number;
    selectedSources: SkuCardSourcePreparationSource[];
    requiresAgentDesignSpec: boolean;
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

export interface BuildSkuCardSourcePreparationPlanInput {
    projectPath?: string | null;
    skuCardAssetCandidateReport?: SkuCardAssetCandidateReport | null;
    maxSources?: number;
    minimumSourceCount?: number;
    outputRelativePath?: string;
}

const DEFAULT_OUTPUT_RELATIVE_PATH = 'PSD/SKU-card-source.psb';

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function normalizePath(value: unknown): string {
    return cleanString(value).replace(/\\/g, '/').replace(/\/+$/, '');
}

function joinProjectPath(projectPath: string, relativePath: string): string {
    const project = normalizePath(projectPath);
    const relative = normalizePath(relativePath).replace(/^\/+/, '');
    return `${project}/${relative}`.replace(/\//g, '\\');
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.round(numeric);
}

function defaultDisplayColorName(index: number): string {
    return `颜色${index + 1}`;
}

function candidateDisplayName(candidate: SkuCardAssetCandidate, index = 0): string {
    return cleanString(candidate.skuColorName) || defaultDisplayColorName(index);
}

function selectEligibleSkuCardCandidates(
    report?: SkuCardAssetCandidateReport | null,
    maxSources = 8
): SkuCardSourcePreparationSource[] {
    const candidates = Array.isArray(report?.candidates) ? report.candidates : [];
    const limit = Math.max(1, Math.min(12, normalizePositiveInteger(maxSources, 8)));

    return candidates
        .filter((candidate) => (
            (candidate.recommendedUse === 'primary_sku_card' || candidate.recommendedUse === 'secondary_sku_card')
            && candidate.needsVisualConfirmation === false
            && Boolean(cleanString(candidate.path))
        ))
        // 这里仅建立候选集，不按启发式分数排列“赢家”。稳定路径序只提供身份，
        // 最终使用哪些素材以及顺序由 Agent 在 colorCardDesignSpec.sourceAssetIds 声明。
        .sort((left, right) => normalizePath(left.relativePath).localeCompare(
            normalizePath(right.relativePath),
            'zh-Hans-CN'
        ))
        .slice(0, limit)
        .map((candidate, index) => ({
            assetId: candidate.assetId,
            path: candidate.path,
            relativePath: candidate.relativePath,
            colorName: String(index + 1),
            displayName: candidateDisplayName(candidate, index),
            score: candidate.score,
            recommendedUse: candidate.recommendedUse
        }));
}

export function buildSkuCardSourcePreparationPlan(
    input: BuildSkuCardSourcePreparationPlanInput
): SkuCardSourcePreparationPlan {
    const projectPath = normalizePath(input.projectPath);
    const outputRelativePath = cleanString(input.outputRelativePath) || DEFAULT_OUTPUT_RELATIVE_PATH;
    const outputDocumentPath = projectPath ? joinProjectPath(projectPath, outputRelativePath) : '';
    const minimumSourceCount = normalizePositiveInteger(input.minimumSourceCount, 1);
    const selectedSources = selectEligibleSkuCardCandidates(
        input.skuCardAssetCandidateReport,
        input.maxSources
    );

    if (!projectPath) {
        return {
            version: 'sku-card-source-preparation-plan/v0',
            status: 'blocked_missing_project_path',
            canRunPhotoshopWrites: false,
            outputDocumentPath,
            minimumSourceCount,
            selectedSources: [],
            requiresAgentDesignSpec: false,
            blockers: ['缺少当前项目路径，不能确定 SKU 源文档保存位置。'],
            warnings: [],
            limitations: [
                '该计划只生成受控执行步骤，不直接读写项目文件。',
                '没有项目路径时禁止准备 Photoshop 写入请求。'
            ]
        };
    }

    if (selectedSources.length === 0) {
        return {
            version: 'sku-card-source-preparation-plan/v0',
            status: 'blocked_candidates_not_ready',
            canRunPhotoshopWrites: false,
            outputDocumentPath,
            minimumSourceCount,
            selectedSources: [],
            requiresAgentDesignSpec: false,
            blockers: ['SKU 卡片候选还没有完成视觉确认，不能把路径候选直接整理成 SKU 源文档。'],
            warnings: input.skuCardAssetCandidateReport?.warnings || [],
            limitations: [
                '只有视觉确认过的完整单只/平铺素材可以进入 SKU 源文档准备。',
                '局部特写、模特穿着图、多只合照只可作为参考，不能直接作为颜色组源图。'
            ]
        };
    }

    if (selectedSources.length < minimumSourceCount) {
        return {
            version: 'sku-card-source-preparation-plan/v0',
            status: 'blocked_candidates_not_ready',
            canRunPhotoshopWrites: false,
            outputDocumentPath,
            minimumSourceCount,
            selectedSources,
            requiresAgentDesignSpec: false,
            blockers: [`SKU 配置需要至少 ${minimumSourceCount} 个颜色槽，当前只有 ${selectedSources.length} 个已确认 SKU 色卡素材。`],
            warnings: [
                ...(input.skuCardAssetCandidateReport?.warnings || []),
                '需要继续确认更多可直接作为 SKU 色卡的单款素材，不能先生成注定与配置不匹配的源文档。'
            ],
            limitations: [
                '只有视觉确认过的完整单只/平铺素材可以进入 SKU 源文档准备。',
                '多色合集图可作为色卡参考，但不能自动冒充单个颜色槽。'
            ]
        };
    }

    return {
        version: 'sku-card-source-preparation-plan/v0',
        status: 'ready_for_design_decision',
        canRunPhotoshopWrites: false,
        outputDocumentPath,
        minimumSourceCount,
        selectedSources,
        requiresAgentDesignSpec: true,
        blockers: [],
        warnings: [
            '候选中的数字槽位仅用于稳定引用，不表示最终选定或生产顺序。',
            '本计划只确认可比较候选和保存位置；Agent 尚未声明 sourceAssetIds 与视觉方案。'
        ],
        limitations: [
            '该计划不复制参考项目模板或配置，不读取考试答案。',
            '该计划只确认候选与目标路径，不包含任何 Photoshop 写入请求或视觉默认值。',
            '最终仍需要 sku-batch 用模板导出后进行读回和视觉复核。'
        ]
    };
}
