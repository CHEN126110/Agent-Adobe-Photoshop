import type {
    DesignAgentOsStatus,
    VerificationCheck,
    VerificationReport
} from './design-agent-os-contracts';
import type { MainImageDesignStandards } from './main-image-design-standards';
import type { MainImageProductionExecutorDryRunPreview } from './main-image-production-executor-dry-run';
import type { MainImageQaReport } from './main-image-qa-report';

export type MainImageDesignReadinessStatus =
    | 'blocked_missing_strategy_inputs'
    | 'blocked_strategy_inputs_not_ready'
    | 'blocked_design_standards_not_ready'
    | 'blocked_executor_dry_run_not_ready'
    | 'waiting_for_user_checkpoint'
    | 'ready_for_live_executor'
    | 'waiting_for_result_qa'
    | 'quality_claim_ready';

export interface MainImageDesignReadinessReportInput {
    strategyInputContext?: MainImageDesignReadinessStrategyContext | null;
    qaReport?: MainImageQaReport | null;
    userCheckpointApproved?: boolean;
}

export interface MainImageDesignReadinessStrategyContext {
    status: string;
    skeletonOnly?: boolean;
    productionSubmission?: boolean;
    missingInputs: string[];
    blockers: string[];
    warnings: string[];
    designStandards: MainImageDesignStandards;
    productionExecutorDryRunPreview: MainImageProductionExecutorDryRunPreview;
}

export interface MainImageDesignReadinessCheck {
    id: string;
    label: string;
    status: DesignAgentOsStatus;
    summary: string;
}

export interface MainImageDesignReadinessReport {
    version: 'main-image-design-readiness-report/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageDesignReadinessStatus;
    readinessChecks: MainImageDesignReadinessCheck[];
    canEnterLiveExecutor: boolean;
    canClaimOutputQuality: boolean;
    canClaimDesignComplete: false;
    requiresUserCheckpoint: boolean;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    blockers: string[];
    warnings: string[];
    limitations: string[];
    nextActions: string[];
    verificationReport: VerificationReport;
}

const FORBIDDEN_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return text.replace(/\s+/g, ' ').trim();
}

function cleanStrings(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function makeCheck(
    id: string,
    label: string,
    status: DesignAgentOsStatus,
    summary: string
): MainImageDesignReadinessCheck {
    return {
        id,
        label,
        status,
        summary: cleanString(summary)
    };
}

function buildDesignStandardsCheckSummary(
    strategy: MainImageDesignReadinessStrategyContext | null | undefined,
    designStandards: MainImageDesignStandards | undefined
): string {
    if (strategy?.skeletonOnly === true) {
        return '空骨架任务不包含素材、构图、文案或审美判断，不需要设计规范取得写入资格。';
    }
    if (strategy?.productionSubmission === true) {
        return '逐槽生产提交只消费 Agent 已声明的素材与几何；旧的全局设计策略不再取得第二次写入裁决权。';
    }
    if (!designStandards) return '没有主图设计规范。';
    return `status=${designStandards.status}; rules=${designStandards.rules.length}; recipes=${designStandards.recipeCandidates.length}`;
}

function buildChecks(input: MainImageDesignReadinessReportInput): MainImageDesignReadinessCheck[] {
    const strategy = input.strategyInputContext;
    const designStandards = strategy?.designStandards;
    const dryRun = strategy?.productionExecutorDryRunPreview;
    const qaReport = input.qaReport || null;

    return [
        makeCheck(
            'strategy-inputs',
            '主图策略输入',
            strategy
                ? strategy.status === 'ready_for_strategy_contract' ? 'passed' : 'needs_review'
                : 'not_run',
            strategy
                ? `status=${strategy.status}; missing=${strategy.missingInputs.join('/') || 'none'}`
                : '没有主图策略输入。'
        ),
        makeCheck(
            'design-standards',
            '设计规范与知识来源',
            strategy?.skeletonOnly === true || strategy?.productionSubmission === true
                ? 'not_run'
                : designStandards
                ? designStandards.status === 'ready_for_design_strategy' ? 'passed' : 'needs_review'
                : 'not_run',
            buildDesignStandardsCheckSummary(strategy, designStandards)
        ),
        makeCheck(
            'executor-dry-run',
            '执行器 dry-run',
            dryRun
                ? dryRun.status === 'completed_dry_run' ? 'passed' : 'needs_review'
                : 'not_run',
            dryRun
                ? `status=${dryRun.status}; operations=${dryRun.operationCount}; actualResult=null`
                : '没有 production executor dry-run preview。'
        ),
        makeCheck(
            'user-checkpoint',
            'Runtime 执行授权',
            input.userCheckpointApproved === true ? 'passed' : 'needs_review',
            input.userCheckpointApproved === true
                ? '当前任务已取得 Harness 签发的受保护原子执行通道。'
                : '当前任务没有受保护的 Photoshop 原子执行通道，不能进入真实 executor。'
        ),
        makeCheck(
            'result-qa',
            '结果图 QA',
            qaReport
                ? qaReport.qualityClaim.allowed === true ? 'passed' : 'needs_review'
                : 'not_run',
            qaReport
                ? `stage=${qaReport.stage}; qualityClaim=${qaReport.qualityClaim.allowed}`
                : '尚无真实结果图、读回、截图、pixel probe 或人工验收。'
        )
    ];
}

function inferStatus(input: MainImageDesignReadinessReportInput): MainImageDesignReadinessStatus {
    const strategy = input.strategyInputContext;
    if (!strategy) return 'blocked_missing_strategy_inputs';
    if (strategy.status !== 'ready_for_strategy_contract') return 'blocked_strategy_inputs_not_ready';
    if (strategy.skeletonOnly !== true
        && strategy.productionSubmission !== true
        && strategy.designStandards.status !== 'ready_for_design_strategy') {
        return 'blocked_design_standards_not_ready';
    }
    if (strategy.productionExecutorDryRunPreview.status !== 'completed_dry_run') {
        return 'blocked_executor_dry_run_not_ready';
    }
    if (input.qaReport?.qualityClaim.allowed === true) return 'quality_claim_ready';
    if (input.qaReport) return 'waiting_for_result_qa';
    if (input.userCheckpointApproved !== true) return 'waiting_for_user_checkpoint';
    return 'ready_for_live_executor';
}

function statusToVerificationStatus(status: MainImageDesignReadinessStatus): DesignAgentOsStatus {
    if (status === 'quality_claim_ready' || status === 'ready_for_live_executor') return 'passed';
    if (status.startsWith('blocked_')) return 'failed';
    return 'needs_review';
}

function collectBlockers(
    input: MainImageDesignReadinessReportInput,
    status: MainImageDesignReadinessStatus
): string[] {
    const strategy = input.strategyInputContext;
    const blockers = [
        ...(strategy?.blockers || []),
        ...(strategy?.skeletonOnly === true || strategy?.productionSubmission === true
            ? []
            : strategy?.designStandards.blockers || []),
        ...(strategy?.productionExecutorDryRunPreview.blockers || []),
        ...(input.qaReport?.blockers || [])
    ];

    if (status === 'blocked_missing_strategy_inputs') blockers.push('main_image_strategy_inputs_required');
    if (status === 'blocked_strategy_inputs_not_ready') blockers.push('main_image_strategy_inputs_not_ready');
    if (status === 'blocked_design_standards_not_ready') blockers.push('main_image_design_standards_not_ready');
    if (status === 'blocked_executor_dry_run_not_ready') blockers.push('main_image_executor_dry_run_not_ready');
    if (status === 'waiting_for_user_checkpoint') blockers.push('guarded_runtime_execution_required_before_live_executor');
    if (status === 'waiting_for_result_qa') blockers.push('main_image_result_qa_not_ready');

    return cleanStrings(blockers);
}

function collectWarnings(input: MainImageDesignReadinessReportInput): string[] {
    const strategy = input.strategyInputContext;
    return cleanStrings([
        ...(strategy?.warnings || []),
        ...(strategy?.designStandards.warnings || []),
        ...(strategy?.productionExecutorDryRunPreview.warnings || []),
        ...(input.qaReport?.warnings || [])
    ]);
}

function buildNextActions(status: MainImageDesignReadinessStatus): string[] {
    if (status === 'blocked_missing_strategy_inputs') {
        return ['先生成主图策略输入，不能直接进入 executor。'];
    }
    if (status === 'blocked_strategy_inputs_not_ready') {
        return ['补齐素材、主体 bounds、尺寸计划、文案角色、导出和性能预算输入。'];
    }
    if (status === 'blocked_design_standards_not_ready') {
        return ['补齐与所选素材绑定的可用视觉上下文，让主图设计规范能指导点击图/转化图策略。'];
    }
    if (status === 'blocked_executor_dry_run_not_ready') {
        return ['先完成 production executor dispatch plan 与 dry-run operation preview。'];
    }
    if (status === 'waiting_for_user_checkpoint') {
        return ['等待 Harness 为当前任务签发受保护的 Photoshop 原子执行通道。'];
    }
    if (status === 'ready_for_live_executor') {
        return ['可以通过当前受保护执行通道进入真实 Photoshop executor，并必须执行读回 QA。'];
    }
    if (status === 'waiting_for_result_qa') {
        return ['补齐结果图、Photoshop 读回、截图 / pixel probe 和人工验收。'];
    }
    return ['质量检查已允许声明，但仍不能把它扩大成完整设计项目完成。'];
}

export function buildMainImageDesignReadinessReport(
    input: MainImageDesignReadinessReportInput
): MainImageDesignReadinessReport {
    const status = inferStatus(input);
    const verificationStatus = statusToVerificationStatus(status);
    const readinessChecks = buildChecks(input);
    const blockers = collectBlockers(input, status);
    const warnings = collectWarnings(input);
    const canEnterLiveExecutor = status === 'ready_for_live_executor';
    const canClaimOutputQuality = status === 'quality_claim_ready';
    const requiresUserCheckpoint = input.userCheckpointApproved !== true && status !== 'quality_claim_ready';
    const limitations = [
        'mainImageDesignReadinessReport 只汇总已有主图状态，不执行 Photoshop、不调用 provider、不搜索网页。',
        'ready_for_live_executor 只表示当前任务具备受保护执行通道，不代表已经执行或输出合格。',
        'quality_claim_ready 只来自 QA report 的检查结果，不等于完整电商项目设计完成。',
        '所有 Photoshop actualBounds、截图、导出和人工验收都必须来自后续真实读回，不能由 dry-run 伪造。'
    ];
    const verificationReport: VerificationReport = {
        reportId: 'main-image-design-readiness-report',
        scenario: 'main-image',
        status: verificationStatus,
        scope: 'task',
        summary: canClaimOutputQuality
            ? '主图 QA 检查结果允许质量声明，但不代表完整设计项目完成。'
            : `主图设计 readiness=${status}，仍不能声明主图设计质量完成。`,
        checks: readinessChecks.map((check): VerificationCheck => ({
            id: check.id,
            label: check.label,
            status: check.status,
            summary: check.summary
        })),
        blockers,
        warnings,
        limitations
    };

    return {
        version: 'main-image-design-readiness-report/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status,
        readinessChecks,
        canEnterLiveExecutor,
        canClaimOutputQuality,
        canClaimDesignComplete: false,
        requiresUserCheckpoint,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers,
        warnings,
        limitations,
        nextActions: buildNextActions(status),
        verificationReport
    };
}
