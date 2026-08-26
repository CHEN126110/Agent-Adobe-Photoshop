/**
 * SKU 前置缺件修复策略。
 *
 * 该策略只消费结构化阶段与显式覆盖项，不读取用户文本。项目库存是否真的
 * 缺少 PSD/PSB 仍由执行器的真实资源搜索决定；允许修复不等于允许跳过搜索。
 */

import type { SkuSkillStage } from './sku-intent-params';

export type SkuPrerequisiteRepairStage = SkuSkillStage | 'inspect';

export interface SkuPrerequisiteRepairOverrides {
    /** 显式 false 会关闭缺源后的自主准备；true 也不能突破非 full/inspect 阶段上限。 */
    sourcePreparation?: boolean;
    /** 显式 false 会关闭缺模板后的自主准备；true 也不能突破非 full/inspect 阶段上限。 */
    templatePreparation?: boolean;
    /** 结构化只读信号；一旦为 true，所有前置修复都保持 fail-closed。 */
    inspectOnly?: boolean;
}

export type SkuMissingSourceStatus =
    | 'blocked_sku_card_source_preparation_not_ready'
    | 'blocked_missing_sku_source_file';

export type SkuMissingTemplateDisposition = 'prepare' | 'block';

export interface SkuPrerequisiteRepairPolicy {
    stage: SkuPrerequisiteRepairStage;
    /** 无论是否允许修复，执行器都必须先搜索并复用项目中的现有 PSD/PSB。 */
    searchExistingSourceFirst: true;
    /** 找不到现有源文档后，是否可以建立候选与 Agent 设计 handoff；不直接授权视觉写入。 */
    allowSourcePreparationWhenMissing: boolean;
    /** 找不到所需模板后，是否可以进入既有模板自主设计/准备路径。 */
    allowTemplatePreparationWhenMissing: boolean;
    missingSourceDisposition: 'prepare' | 'block';
    missingSourceStatus: SkuMissingSourceStatus;
    missingTemplateDisposition: SkuMissingTemplateDisposition;
    reason: string;
}

/**
 * 解析 SKU 前置缺件修复权限。
 *
 * - 只有结构化 stage=full 默认可建立缺源候选与续跑；首次视觉写入仍需 Agent design spec；
 * - inspect 永远不能被覆盖项升级为写入；
 * - preferExisting=true 表示调用方要求只复用既有源，源缺失时保持 fail-closed；
 * - 显式 false 是收窄权限，永远优先于 full 的默认修复能力。
 */
export function resolveSkuPrerequisiteRepairPolicy(
    stage: SkuPrerequisiteRepairStage | undefined,
    preferExisting: boolean,
    overrides: SkuPrerequisiteRepairOverrides = {}
): SkuPrerequisiteRepairPolicy {
    const resolvedStage = stage || 'full';
    const inspectOnly = resolvedStage === 'inspect' || overrides.inspectOnly === true;
    const fullProduction = resolvedStage === 'full' && !inspectOnly;
    const allowSourcePreparationWhenMissing = fullProduction
        && !preferExisting
        && overrides.sourcePreparation !== false;
    const allowTemplatePreparationWhenMissing = fullProduction
        && overrides.templatePreparation !== false;

    if (inspectOnly) {
        return {
            stage: resolvedStage,
            searchExistingSourceFirst: true,
            allowSourcePreparationWhenMissing: false,
            allowTemplatePreparationWhenMissing: false,
            missingSourceDisposition: 'block',
            missingSourceStatus: 'blocked_missing_sku_source_file',
            missingTemplateDisposition: 'block',
            reason: 'inspect 模式只允许读取真实库存，不允许创建 SKU 源文档或模板。'
        };
    }

    if (!fullProduction) {
        return {
            stage: resolvedStage,
            searchExistingSourceFirst: true,
            allowSourcePreparationWhenMissing: false,
            allowTemplatePreparationWhenMissing: false,
            missingSourceDisposition: 'block',
            missingSourceStatus: 'blocked_missing_sku_source_file',
            missingTemplateDisposition: 'block',
            reason: `stage=${resolvedStage} 不是完整生产阶段，不能隐式扩大为前置缺件修复。`
        };
    }

    return {
        stage: resolvedStage,
        searchExistingSourceFirst: true,
        allowSourcePreparationWhenMissing,
        allowTemplatePreparationWhenMissing,
        missingSourceDisposition: allowSourcePreparationWhenMissing ? 'prepare' : 'block',
        missingSourceStatus: allowSourcePreparationWhenMissing
            ? 'blocked_sku_card_source_preparation_not_ready'
            : 'blocked_missing_sku_source_file',
        missingTemplateDisposition: allowTemplatePreparationWhenMissing ? 'prepare' : 'block',
        reason: allowSourcePreparationWhenMissing || allowTemplatePreparationWhenMissing
            ? '完整 SKU 生产先复用真实项目库存；确认缺件后只建立候选与设计续跑，视觉写入仍需 Agent 明确声明。'
            : '完整 SKU 生产的前置修复已被显式限制，缺件时保持 fail-closed。'
    };
}
