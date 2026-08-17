/**
 * 跨设计品类的局部编辑 Runtime Policy。
 *
 * 这里定义的是 workMode=edit_existing 的首轮最小能力种子、成本与能力硬上限，
 * 不是 Tool 权限。各 artifact Manifest 仍分别拥有输入、交付物和评价 Profile；
 * Capability Session / Tool preflight / 目标守卫继续决定一次具体调用能否执行。
 *
 * 当前只开放拥有精确 acceptance assertion 的文字内容替换。其余局部写入即使 Host
 * 能执行，也不能仅凭 success 或通用 diff 证明“目标已达成且范围外未变化”；在补齐
 * expected/actual/affectedLayerIds 行为验收前，不得进入这个自动完成通道。
 */

import type { ExactPropertyExecutionScope } from '../agent-tool-execution-preflight';
import type { SkillRuntimePerformanceProfile } from './contracts';

export type ScopedEditExecutionScopeDecision =
    | { status: 'ready' }
    | {
        status: 'missing' | 'mismatch';
        code: 'runtime_exact_text_scope_required' | 'runtime_exact_text_scope_mismatch';
        reason: string;
      };

/**
 * workMode 的低成本执行身份只能消费 Engine 已签发的精确属性范围；Manifest 本身
 * 不能凭“edit_existing”创造目标或写权限。当前自动完成通道只支持画面文字替换。
 */
export function evaluateScopedEditExecutionScope(input: {
    executionScopeKind?: 'exact_text_replacement';
    exactPropertyScope?: ExactPropertyExecutionScope;
}): ScopedEditExecutionScopeDecision {
    if (input.executionScopeKind !== 'exact_text_replacement') return { status: 'ready' };
    const scope = input.exactPropertyScope;
    if (!scope) {
        return {
            status: 'missing',
            code: 'runtime_exact_text_scope_required',
            reason: '这次低成本局部修改尚未解析出唯一文字目标。请明确旧文字与新文字；系统会先核对全文档唯一命中和当前历史版本，再执行一次比较后写入。'
        };
    }
    if (scope.replacement.hint !== 'text_content'
        || scope.allowedWriteTools.length !== 1
        || scope.allowedWriteTools[0] !== 'setTextContent') {
        return {
            status: 'mismatch',
            code: 'runtime_exact_text_scope_mismatch',
            reason: '当前低成本模式只处理画面中的可见文字替换，不处理图层名称或其它设计属性。'
        };
    }
    return { status: 'ready' };
}

export const SCOPED_EDIT_INITIAL_CAPABILITY_IDS: readonly string[] = Object.freeze([
    'photoshop.read.getDocumentInfo',
    'photoshop.read.getAcceptanceSnapshot',
    'photoshop.write.setTextContent'
]);

export const SCOPED_EDIT_CAPABILITY_CEILING: readonly string[] = Object.freeze([
    'photoshop.read.getDocumentInfo',
    'photoshop.read.getLayerHierarchy',
    'photoshop.read.getAcceptanceSnapshot',
    'photoshop.read.getCanvasSnapshot',
    'photoshop.read.getLayerBounds',
    'photoshop.write.setTextContent'
]);

export function buildScopedEditPerformanceProfile(): SkillRuntimePerformanceProfile {
    return {
        version: 'skill-runtime-performance-profile/v0',
        budget: {
            max_model_calls: 6,
            max_tool_calls: 12,
            max_iterations: 8,
            max_vision_candidates: 1,
            max_initial_vision_candidates: 0,
            max_visual_analyses: 1,
            max_full_resolution_image_reads: 0,
            soft_time_budget_ms: 120_000
        },
        verification_tier: 'bounds',
        cost_profile: {
            model_call_class: 'text-light',
            photoshop_tool_class: 'write-light',
            image_processing_class: 'bounded-vision',
            expected_latency: 'short',
            resource_risk: 'low'
        },
        vision_policy: 'bounded'
    };
}
