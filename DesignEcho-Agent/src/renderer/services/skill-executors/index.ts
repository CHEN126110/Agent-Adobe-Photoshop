/**
 * Skill executor registry.
 * Keeps each skill implementation isolated while exposing one execution entrypoint.
 */

import type { SkillExecutor, SkillExecutorRegistry, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { getSkillById } from '../../../shared/skills/skill-declarations';
import { startTiming, endTiming } from '../performance-tracker';

import { matteProductExecutor } from './matte-product.executor';
import { smartLayoutExecutor } from './smart-layout.executor';
import { skuBatchExecutor } from './sku-batch.executor';
import { skuConfigExecutor } from './sku-config.executor';
import { layoutReplicationExecutor } from './layout-replication.executor';
import { ecommerceSocksDesignExecutor } from './ecommerce-socks-design.executor';
import { mainImageExecutor } from './main-image.executor';
import { visualAnalysisExecutor } from './visual-analysis.executor';
import { projectImageAnalysisExecutor } from './project-image-analysis.executor';
import { layerManagementExecutor } from './layer-management.executor';
import { designReferenceSearchExecutor } from './design-reference-search.executor';
import { findEditElementExecutor } from './find-edit-element.executor';
import { agentPanelBridgeExecutor } from './agent-panel-bridge.executor';
import { documentManagementExecutor } from './document-management.executor';
import { templateSaveExecutor } from './template-save.executor';
import { autonomousAgentExecutor } from './autonomous-agent.executor';
import { detailPageExecutor } from './detail-page.executor';
import { detailPageTemplateAuthoringExecutor } from './detail-page-template-authoring.executor';
import { textFontReplaceExecutor } from './text-font-replace.executor';
import { mainImageTemplateAuthoringExecutor } from './main-image-template-authoring.executor';
import {
    attachBusinessSkillImagePlacementVerificationIntakeToResult,
    attachBusinessSkillExecutionPlanIntakeToResult,
    attachBusinessSkillProjectAssetUnderstandingIntakeToResult,
    attachBusinessSkillExecutionIntakeToResult,
    attachBusinessSkillVisualEvidencePreExecutionToResult,
    attachBusinessSkillExecutionPreflightGateToResult,
    attachBusinessSkillVisualEvidenceControlDecisionToResult,
    attachBusinessVisualEvidenceGateToResult,
    buildBusinessSkillImagePlacementVerificationIntakeForSkill,
    buildBusinessSkillExecutionPlanIntakeForSkill,
    buildBusinessSkillProjectAssetUnderstandingIntakeForSkill,
    buildBusinessSkillExecutionIntakeForSkill,
    buildBusinessSkillVisualEvidencePreExecutionGateForSkill,
    buildBusinessSkillExecutionPreflightGateForSkill,
    buildBusinessVisualEvidenceGateForSkill,
    prepareBusinessSkillProjectContextForScenario,
    runBusinessSkillVisualEvidenceRefreshBeforeExecution,
    runBusinessSkillVisualEvidenceRefreshAfterExecution
} from './business-skill-visual-evidence-gate';

const executorRegistry: SkillExecutorRegistry = new Map();

function registerBuiltinExecutors(): void {
    executorRegistry.set(matteProductExecutor.skillId, matteProductExecutor);

    executorRegistry.set(smartLayoutExecutor.skillId, smartLayoutExecutor);
    executorRegistry.set(layoutReplicationExecutor.skillId, layoutReplicationExecutor);
    executorRegistry.set(ecommerceSocksDesignExecutor.skillId, ecommerceSocksDesignExecutor);

    executorRegistry.set(mainImageExecutor.skillId, mainImageExecutor);
    executorRegistry.set(mainImageTemplateAuthoringExecutor.skillId, mainImageTemplateAuthoringExecutor);
    executorRegistry.set(detailPageExecutor.skillId, detailPageExecutor);
    executorRegistry.set(detailPageTemplateAuthoringExecutor.skillId, detailPageTemplateAuthoringExecutor);
    executorRegistry.set(skuConfigExecutor.skillId, skuConfigExecutor);
    executorRegistry.set(skuBatchExecutor.skillId, skuBatchExecutor);

    executorRegistry.set(visualAnalysisExecutor.skillId, visualAnalysisExecutor);
    executorRegistry.set(projectImageAnalysisExecutor.skillId, projectImageAnalysisExecutor);
    executorRegistry.set(layerManagementExecutor.skillId, layerManagementExecutor);
    executorRegistry.set(findEditElementExecutor.skillId, findEditElementExecutor);
    executorRegistry.set(agentPanelBridgeExecutor.skillId, agentPanelBridgeExecutor);
    executorRegistry.set(documentManagementExecutor.skillId, documentManagementExecutor);
    executorRegistry.set(templateSaveExecutor.skillId, templateSaveExecutor);
    executorRegistry.set(textFontReplaceExecutor.skillId, textFontReplaceExecutor);

    executorRegistry.set(designReferenceSearchExecutor.skillId, designReferenceSearchExecutor);
    executorRegistry.set(autonomousAgentExecutor.skillId, autonomousAgentExecutor);
}

registerBuiltinExecutors();

function getSafeSkillLabel(skillId: string): string {
    const skill = getSkillById(skillId);
    if (!skill) {
        return '该能力';
    }
    return skill.visibility === 'user-facing' ? skill.name : '当前请求';
}

function compactSkillResultText(value: unknown): string {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
}

function summarizeSkillResult(result: AgentResult): string {
    const error = compactSkillResultText(result.error);
    if (error) return `失败原因: ${error}`;

    const message = compactSkillResultText(result.message);
    if (message) return message;

    return result.success ? '能力执行成功。' : '能力执行未完成。';
}

export function getSkillExecutor(skillId: string): SkillExecutor | undefined {
    return executorRegistry.get(skillId);
}

export function registerSkillExecutor(executor: SkillExecutor): void {
    executorRegistry.set(executor.skillId, executor);
}

function withUnifiedSkillRunner(executeParams: SkillExecuteParams): SkillExecuteParams {
    return {
        ...executeParams,
        runSkill: (childSkillId, childExecuteParams) => executeSkillWithExecutor(childSkillId, childExecuteParams)
    };
}

export async function executeSkillWithExecutor(
    skillId: string,
    executeParams: SkillExecuteParams
): Promise<AgentResult> {
    startTiming(`技能:${skillId}`, { params: Object.keys(executeParams.params) });
    const skillStepId = `skill-${skillId}-${Date.now()}`;

    const skill = getSkillById(skillId);
    if (!skill) {
        executeParams.callbacks?.onStep?.({
            kind: 'tool_completed',
            title: `能力不可用：${skillId}`,
            detail: '技能注册表中没有找到该能力。',
            status: 'error',
            toolName: skillId,
            toolCallId: skillStepId,
            issue: 'skill_not_found'
        });
        endTiming(`技能:${skillId}`, { error: 'not found' });
        return {
            success: false,
            message: '当前没有可用的处理能力来完成这个请求。',
            error: 'Skill not found'
        };
    }

    const userVisibleSkill = skill.visibility === 'user-facing';
    executeParams.callbacks?.onProgress?.(
        userVisibleSkill ? `执行能力：${skill.name}` : '正在处理请求',
        0
    );
    executeParams.callbacks?.onMessage?.(
        userVisibleSkill ? `正在执行「${skill.name}」。` : '正在处理请求。'
    );

    const executor = getSkillExecutor(skillId);
    const skillLabel = getSafeSkillLabel(skillId);

    executeParams.callbacks?.onStep?.({
        kind: 'tool_started',
        title: `开始能力：${skillLabel}`,
        detail: `能力 ID: ${skillId}`,
        status: 'running',
        toolName: skillId,
        toolCallId: skillStepId,
        percent: 32
    });

    if (!executor) {
        executeParams.callbacks?.onStep?.({
            kind: 'tool_completed',
            title: `能力不可用：${skillLabel}`,
            detail: '该能力缺少可执行处理器。',
            status: 'error',
            toolName: skillId,
            toolCallId: skillStepId,
            issue: 'skill_executor_not_found'
        });
        endTiming(`技能:${skillId}`, { error: 'no executor' });
        return {
            success: false,
            message: `${getSafeSkillLabel(skillId)}的执行器当前不可用。`,
            error: 'Skill executor not implemented'
        };
    }

    try {
        const scenarioPreparedExecuteParams = await prepareBusinessSkillProjectContextForScenario(skillId, executeParams);
        const businessVisualEvidenceGate = buildBusinessVisualEvidenceGateForSkill(skillId, scenarioPreparedExecuteParams);
        const businessSkillProjectAssetUnderstandingIntake =
            buildBusinessSkillProjectAssetUnderstandingIntakeForSkill(skillId, scenarioPreparedExecuteParams);
        const businessSkillVisualEvidencePreExecutionGate =
            buildBusinessSkillVisualEvidencePreExecutionGateForSkill(skillId, scenarioPreparedExecuteParams);
        const businessSkillInitialExecutionIntake = buildBusinessSkillExecutionIntakeForSkill(skillId, {
            stage: 'before_executor',
            preExecutionGate: businessSkillVisualEvidencePreExecutionGate
        });
        const preExecutionVisualEvidence = await runBusinessSkillVisualEvidenceRefreshBeforeExecution(
            businessSkillVisualEvidencePreExecutionGate,
            scenarioPreparedExecuteParams
        );

        if (preExecutionVisualEvidence.blockedResult) {
            const blockedIntake = buildBusinessSkillExecutionIntakeForSkill(skillId, {
                stage: 'blocked_before_executor',
                preExecutionGate: businessSkillVisualEvidencePreExecutionGate,
                preExecutionRun: preExecutionVisualEvidence.runSummary as any
            }) || businessSkillInitialExecutionIntake;
            const blockedResultWithPlacementIntake = attachBusinessSkillImagePlacementVerificationIntakeToResult(
                attachBusinessSkillProjectAssetUnderstandingIntakeToResult(
                    preExecutionVisualEvidence.blockedResult,
                    businessSkillProjectAssetUnderstandingIntake
                ),
                buildBusinessSkillImagePlacementVerificationIntakeForSkill(
                    skillId,
                    preExecutionVisualEvidence.blockedResult
                )
            );
            const blockedResultWithExecutionPlanIntake = attachBusinessSkillExecutionPlanIntakeToResult(
                blockedResultWithPlacementIntake,
                buildBusinessSkillExecutionPlanIntakeForSkill(skillId, blockedResultWithPlacementIntake)
            );
            const blockedResult = attachBusinessSkillExecutionIntakeToResult(
                blockedResultWithExecutionPlanIntake,
                blockedIntake
            );
            executeParams.callbacks?.onStep?.({
                kind: 'tool_completed',
                title: `能力未完成：${skillLabel}`,
                detail: summarizeSkillResult(blockedResult),
                status: 'error',
                toolName: skillId,
                toolCallId: skillStepId,
                percent: 95,
                issue: blockedResult.error || 'business_visual_evidence_required_before_execution'
            });
            endTiming(`技能:${skillId}`, { error: 'business visual evidence required before execution' });
            return blockedResult;
        }

        const executeParamsForBusiness = withUnifiedSkillRunner(preExecutionVisualEvidence.executeParams);
        const executorResult = await executor.execute(executeParamsForBusiness);
        const businessSkillExecutionPreflightGate = buildBusinessSkillExecutionPreflightGateForSkill(
            skillId,
            executeParamsForBusiness,
            executorResult
        );
        const resultWithEvidence = attachBusinessSkillExecutionPreflightGateToResult(
            attachBusinessSkillVisualEvidencePreExecutionToResult(
                attachBusinessSkillProjectAssetUnderstandingIntakeToResult(
                    attachBusinessVisualEvidenceGateToResult(executorResult, businessVisualEvidenceGate),
                    businessSkillProjectAssetUnderstandingIntake
                ),
                businessSkillVisualEvidencePreExecutionGate,
                preExecutionVisualEvidence.runSummary
            ),
            businessSkillExecutionPreflightGate,
            executeParamsForBusiness
        );
        const resultWithRefreshEvidence = await runBusinessSkillVisualEvidenceRefreshAfterExecution(
            resultWithEvidence,
            businessSkillExecutionPreflightGate,
            executeParamsForBusiness
        );
        const resultWithControlDecision = attachBusinessSkillVisualEvidenceControlDecisionToResult(resultWithRefreshEvidence);
        const resultWithPlacementIntake = attachBusinessSkillImagePlacementVerificationIntakeToResult(
            resultWithControlDecision,
            buildBusinessSkillImagePlacementVerificationIntakeForSkill(skillId, resultWithControlDecision)
        );
        const resultWithExecutionPlanIntake = attachBusinessSkillExecutionPlanIntakeToResult(
            resultWithPlacementIntake,
            buildBusinessSkillExecutionPlanIntakeForSkill(skillId, resultWithPlacementIntake)
        );
        const resultData = (resultWithExecutionPlanIntake.data || {}) as any;
        const finalExecutionIntake = buildBusinessSkillExecutionIntakeForSkill(skillId, {
            stage: 'after_executor',
            preExecutionGate: resultData.businessSkillVisualEvidencePreExecutionGate,
            preExecutionRun: resultData.businessSkillVisualEvidencePreExecutionRun,
            executionPreflightGate: resultData.businessSkillExecutionPreflightGate,
            plannerEvidence: resultData.businessSkillPreflightPlannerEvidence,
            refreshPlan: resultData.businessSkillVisualEvidenceRefreshPlan,
            refreshRun: resultData.businessSkillVisualEvidenceRefreshRun,
            controlDecision: resultData.businessSkillVisualEvidenceControlDecision
        });
        const result = attachBusinessSkillExecutionIntakeToResult(
            resultWithExecutionPlanIntake,
            finalExecutionIntake || businessSkillInitialExecutionIntake
        );
        executeParams.callbacks?.onStep?.({
            kind: 'tool_completed',
            title: `${result.success ? '能力完成' : '能力未完成'}：${skillLabel}`,
            detail: summarizeSkillResult(result),
            status: result.success ? 'success' : 'error',
            toolName: skillId,
            toolCallId: skillStepId,
            percent: 95,
            issue: result.success ? undefined : compactSkillResultText(result.error) || 'skill_failed'
        });
        endTiming(`技能:${skillId}`, { success: result.success });
        return result;
    } catch (e: any) {
        executeParams.callbacks?.onStep?.({
            kind: 'tool_completed',
            title: `能力异常：${skillLabel}`,
            detail: compactSkillResultText(e.message) || '能力执行过程发生异常。',
            status: 'error',
            toolName: skillId,
            toolCallId: skillStepId,
            percent: 95,
            issue: compactSkillResultText(e.message) || 'skill_exception'
        });
        endTiming(`技能:${skillId}`, { error: e.message });
        return {
            success: false,
            message: `执行能力失败：${e.message}`,
            error: e.message
        };
    }
}

export type { SkillExecutor, SkillExecuteParams } from './types';
