/**
 * Agentic Runtime Manifest late-binding projection.
 *
 * The model explicitly selects the task profile first. Harness then projects only
 * manifest-owned input and delivery obligations plus source kinds already proven
 * by the current runtime. This projection never chooses an asset, layout, copy, or
 * next design action, and it never grants a Tool permission.
 */

import type {
    RuntimeDesignWorkMode,
    SkillRuntimeInputSourceKind,
    SkillRuntimeManifest
} from './contracts';
import type { RuntimeDesignBriefAvailableInputSource } from './runtime-design-brief-declaration';
import type { RuntimeContextItem } from './runtime-context-compiler';

export interface AgenticRuntimeResolvedInput {
    inputKey: string;
    sourceKinds: SkillRuntimeInputSourceKind[];
}

export interface AgenticRuntimeBindingContext {
    version: 'agentic-runtime-binding-context/v0';
    skillId: string;
    taskType: string;
    workMode?: RuntimeDesignWorkMode;
    methodPlaybookId?: string;
    requiredInputs: string[];
    resolvedInputs: AgenticRuntimeResolvedInput[];
    missingInputs: string[];
    deliveryOutputs: string[];
    productionObligation?: string;
    exitCriteria: string[];
    boundaries: {
        explicitRuntimeBindingOnly: true;
        sourceKindsOnly: true;
        doesNotExecuteSkill: true;
        doesNotGrantToolPermission: true;
        doesNotAuthorDesignDecision: true;
        doesNotSelectAsset: true;
    };
}

export interface BuildAgenticRuntimeBindingContextInput {
    manifest: SkillRuntimeManifest;
    workMode?: RuntimeDesignWorkMode;
    availableInputSources: readonly RuntimeDesignBriefAvailableInputSource[];
    deliveryOutputs: readonly string[];
    productionObligation?: string;
    exitCriteria: readonly string[];
}

function clean(value: unknown): string {
    return String(value || '').trim();
}

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function sourceAppliesToInput(
    source: RuntimeDesignBriefAvailableInputSource,
    inputKey: string,
    allowedSourceKinds: readonly SkillRuntimeInputSourceKind[]
): boolean {
    if (!allowedSourceKinds.includes(source.sourceKind)) return false;
    if (!Array.isArray(source.inputKeys) || source.inputKeys.length === 0) return true;
    return source.inputKeys.some((candidate) => clean(candidate) === inputKey);
}

export function buildAgenticRuntimeBindingContext(
    input: BuildAgenticRuntimeBindingContextInput
): AgenticRuntimeBindingContext {
    const requiredInputs = unique(input.manifest.required_inputs || []);
    const resolvedInputs: AgenticRuntimeResolvedInput[] = [];
    const missingInputs: string[] = [];

    for (const inputKey of requiredInputs) {
        const allowedSourceKinds = input.manifest.input_sources[inputKey] || [];
        const sourceKinds = unique(input.availableInputSources
            .filter((source) => sourceAppliesToInput(source, inputKey, allowedSourceKinds))
            .map((source) => source.sourceKind)) as SkillRuntimeInputSourceKind[];
        if (sourceKinds.length === 0) {
            missingInputs.push(inputKey);
            continue;
        }
        resolvedInputs.push({ inputKey, sourceKinds });
    }

    const methodPlaybookId = unique([
        ...(input.manifest.workflow_entry_skill_ids || []),
        ...(input.manifest.legacy_skill_ids || [])
    ])[0];

    return {
        version: 'agentic-runtime-binding-context/v0',
        skillId: clean(input.manifest.skill_id),
        taskType: clean(input.manifest.task_type),
        ...(input.workMode ? { workMode: input.workMode } : {}),
        ...(methodPlaybookId ? { methodPlaybookId } : {}),
        requiredInputs,
        resolvedInputs,
        missingInputs,
        deliveryOutputs: unique(input.deliveryOutputs),
        ...(clean(input.productionObligation)
            ? { productionObligation: clean(input.productionObligation) }
            : {}),
        exitCriteria: unique(input.exitCriteria),
        boundaries: {
            explicitRuntimeBindingOnly: true,
            sourceKindsOnly: true,
            doesNotExecuteSkill: true,
            doesNotGrantToolPermission: true,
            doesNotAuthorDesignDecision: true,
            doesNotSelectAsset: true
        }
    };
}

function formatResolvedInput(input: AgenticRuntimeResolvedInput): string {
    return `- ${input.inputKey}：已有来源 ${input.sourceKinds.join(' / ')}；仍需由你查看事实并形成判断。`;
}

export function buildAgenticRuntimeBindingPromptSection(
    context: AgenticRuntimeBindingContext | undefined
): string {
    if (!context || context.version !== 'agentic-runtime-binding-context/v0') return '';
    const resolvedLines = context.resolvedInputs.map(formatResolvedInput);
    const missingLines = context.missingInputs.map((inputKey) => (
        `- ${inputKey}：尚无可靠来源；先从当前可用项目或画面事实补齐，不能根据文件名或常识编造。`
    ));
    const deliveryLines = context.deliveryOutputs.map((output) => `- ${output}`);
    const exitLines = context.exitCriteria.map((criterion) => `- ${criterion}`);

    return [
        `你已显式把当前任务绑定为 ${context.taskType}。下面是该专业任务当前有效的输入与交付责任。`,
        context.methodPlaybookId
            ? `需要生产结构或交付细则时，可读取工作法手册 ${context.methodPlaybookId}；手册不替你选择素材、构图、文案或审美方向。`
            : '',
        context.requiredInputs.length > 0
            ? ['必需输入：', ...resolvedLines, ...missingLines].join('\n')
            : '',
        deliveryLines.length > 0
            ? ['最终交付：', ...deliveryLines].join('\n')
            : '',
        context.productionObligation
            ? `生产义务：${context.productionObligation}`
            : '',
        exitLines.length > 0
            ? ['结束前必须满足：', ...exitLines].join('\n')
            : '',
        '这些责任不执行 Skill、不增加工具权限，也不替你决定设计；当前工具可见性和执行安全仍由既有 Runtime 与执行点约束。'
    ].filter(Boolean).join('\n');
}

export function buildAgenticRuntimeBindingContextItem(
    context: AgenticRuntimeBindingContext
): RuntimeContextItem {
    return {
        id: `agentic-runtime-binding:${context.skillId}:${context.taskType}`,
        kind: 'goal_context',
        source: `manifest:${context.skillId}`,
        trust: 'runtime_observation',
        slot: 'runtime_context',
        content: buildAgenticRuntimeBindingPromptSection(context),
        priority: 96,
        freshness: 'current',
        conflictKey: 'agentic-runtime-binding'
    };
}
