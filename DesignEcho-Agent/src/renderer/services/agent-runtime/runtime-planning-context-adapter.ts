import type { RuntimeActionPlanDeclaration } from '../../../shared/agent-runtime-v5/runtime-action-plan-declaration';
import {
    createRuntimeActionPlanExecutionJournal,
    type RuntimeActionPlanExecutionJournal
} from '../../../shared/agent-runtime-v5/runtime-action-plan-observation';
import type { RuntimeDesignBriefDeclaration } from '../../../shared/agent-runtime-v5/runtime-design-brief-declaration';
import {
    buildRuntimePlanningContextSeedDigest,
    validateRuntimePlanningContextSeed,
    type RuntimePlanningContextSeed,
    type RuntimePlanningContextSeedDigest
} from '../../../shared/agent-runtime-v5/runtime-planning-context-seed';
import type { RuntimeReferenceBriefDeclaration } from '../../../shared/agent-runtime-v5/runtime-reference-context';
import type { RuntimeSession } from '../../../shared/agent-runtime-v5/runtime-session';
import type { RuntimeStagePlan } from '../../../shared/agent-runtime-v5/runtime-stage-plan';
import type { RuntimeDesignStrategyDeclaration } from '../../../shared/agent-runtime-v5/runtime-design-strategy-declaration';

export interface RestoredRuntimePlanningContextState {
    runtimePlanningContextSeedDigest: RuntimePlanningContextSeedDigest;
    runtimeDesignBriefDeclaration?: RuntimeDesignBriefDeclaration;
    runtimeReferenceBriefDeclaration?: RuntimeReferenceBriefDeclaration;
    runtimeDesignStrategyDeclaration?: RuntimeDesignStrategyDeclaration;
    runtimeActionPlanDeclaration?: RuntimeActionPlanDeclaration;
    runtimeActionPlanExecutionJournal?: RuntimeActionPlanExecutionJournal;
}

export function resolveRuntimePlanningContextSeedState(input: {
    seed?: RuntimePlanningContextSeed;
    session?: RuntimeSession;
    plan?: RuntimeStagePlan;
}): RestoredRuntimePlanningContextState | undefined {
    if (!input.seed) return undefined;
    if (!input.session || !input.plan) {
        throw new Error('runtime_planning_context_seed_without_session');
    }
    const validation = validateRuntimePlanningContextSeed({
        seed: input.seed,
        session: input.session,
        plan: input.plan
    });
    if (!validation.ok) throw new Error(validation.issues.join(','));
    return {
        runtimePlanningContextSeedDigest: buildRuntimePlanningContextSeedDigest(input.seed),
        runtimeDesignBriefDeclaration: input.seed.declarations.brief,
        runtimeReferenceBriefDeclaration: input.seed.declarations.referenceBrief,
        runtimeDesignStrategyDeclaration: input.seed.declarations.strategy,
        runtimeActionPlanDeclaration: input.seed.declarations.actionPlan,
        runtimeActionPlanExecutionJournal: input.seed.declarations.actionPlan
            ? createRuntimeActionPlanExecutionJournal()
            : undefined
    };
}

export function buildRuntimePlanningContextPrompt(input: {
    digest?: RuntimePlanningContextSeedDigest;
    brief?: RuntimeDesignBriefDeclaration;
    referenceBrief?: RuntimeReferenceBriefDeclaration;
    strategy?: RuntimeDesignStrategyDeclaration;
    actionPlan?: RuntimeActionPlanDeclaration;
}): string {
    if (!input.digest) return '';
    const lines = [
        '这是当前版本的调整续接。保留仍然有效的目标和设计方向，只重新处理复盘指出的问题；除非新画面已经推翻原判断，不要从头规划。'
    ];
    if (input.brief) {
        lines.push(`原目标：${input.brief.payload.taskGoal}`);
        lines.push(`要交付：${input.brief.payload.deliverables.slice(0, 8).join('；')}`);
        if (input.brief.payload.constraints.length > 0) {
            lines.push(`继续遵守：${input.brief.payload.constraints.slice(0, 10).join('；')}`);
        }
    }
    if (input.referenceBrief) {
        const direction = input.referenceBrief.insights.slice(0, 6)
            .map((insight) => insight.application || insight.observation)
            .filter(Boolean)
            .join('；');
        lines.push(`参考方向保持为：${direction || '沿用当前项目与画面判断'}。`);
    }
    if (input.strategy) {
        lines.push(`设计目标：${input.strategy.payload.objective.primaryGoal}`);
        lines.push(`主要信息：${input.strategy.payload.messageArchitecture.primaryMessage}`);
        lines.push(`视觉方向：${[
            ...input.strategy.payload.visualDirection.moodKeywords,
            ...input.strategy.payload.visualDirection.compositionIntent
        ].slice(0, 12).join('；')}`);
        const selectedDirection = input.strategy.payload.directionExploration?.find((candidate) => (
            candidate.variantId === input.strategy!.payload.selectedDirectionId
        ));
        if (selectedDirection) {
            lines.push(`已选方向：${selectedDirection.label}（${selectedDirection.intent}）`);
            if (input.strategy.payload.selectionRationale) {
                lines.push(`选择依据：${input.strategy.payload.selectionRationale}`);
            }
        }
    }
    if (input.actionPlan) lines.push(`当前制作目标：${input.actionPlan.payload.planGoal}`);
    return lines.join('\n');
}
