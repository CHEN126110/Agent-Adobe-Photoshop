import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';
import { skuBatchExecutor } from './sku-batch.executor';

function parseComboSizesFromText(input: string): number[] {
    const text = String(input || '');
    const matched = text.match(/\d+/g) || [];
    const sizes = matched
        .map(v => Number(v))
        .filter(v => Number.isFinite(v) && v >= 2 && v <= 12);
    return Array.from(new Set(sizes)).sort((a, b) => a - b);
}

function parseCountPerSizeFromText(input: string): number | undefined {
    const text = String(input || '');
    const m = text.match(/每个规格(?:需要|要)?\s*(\d+)\s*个/);
    if (!m) return undefined;
    const value = Number(m[1]);
    if (!Number.isFinite(value) || value <= 0) return undefined;
    return value;
}

export const skuConfigExecutor: SkillExecutor = {
    skillId: 'sku-config',

    async execute({ params, callbacks, signal, context }: SkillExecuteParams): Promise<AgentResult> {
        const action = String(params?.action || '').trim();

        if (!action) {
            const userInput = String(context?.userInput || '');
            const shouldDelegateToBatch = /(双装|自选备注|组合|批量|生成|制作|sku)/i.test(userInput);
            if (shouldDelegateToBatch) {
                const comboSizes = parseComboSizesFromText(userInput);
                const countPerSize = parseCountPerSizeFromText(userInput);
                return skuBatchExecutor.execute({
                    params: {
                        comboSizes: comboSizes.length > 0 ? comboSizes : undefined,
                        countPerSize: countPerSize || params?.countPerSize
                    },
                    callbacks,
                    signal,
                    context
                });
            }

            return {
                success: false,
                message: 'SKU 配置操作缺少 action。可用值：exportColors / createPlaceholders / getPlaceholders。',
                error: 'Missing sku-config action'
            };
        }

        if (action === 'exportColors') {
            callbacks?.onToolStart?.('exportColorConfig');
            const result = await executeToolCall('exportColorConfig', {});
            callbacks?.onToolComplete?.('exportColorConfig', result);
            return {
                success: result?.success !== false,
                message: result?.message || (result?.success !== false ? '颜色配置已导出。' : '导出颜色配置失败。'),
                toolResults: [{ toolName: 'exportColorConfig', result }],
                error: result?.success === false ? (result?.error || 'exportColorConfig failed') : undefined,
                data: result?.data
            };
        }

        if (action === 'createPlaceholders') {
            const payload = {
                placeholderCount: Number(params?.placeholderCount || 5),
                layout: params?.layout || 'horizontal'
            };
            callbacks?.onToolStart?.('createSkuPlaceholders');
            const result = await executeToolCall('createSkuPlaceholders', payload);
            callbacks?.onToolComplete?.('createSkuPlaceholders', result);
            return {
                success: result?.success !== false,
                message: result?.message || (result?.success !== false ? 'SKU 占位符创建完成。' : '创建 SKU 占位符失败。'),
                toolResults: [{ toolName: 'createSkuPlaceholders', result }],
                error: result?.success === false ? (result?.error || 'createSkuPlaceholders failed') : undefined,
                data: result?.data
            };
        }

        if (action === 'getPlaceholders') {
            callbacks?.onToolStart?.('getSkuPlaceholders');
            const result = await executeToolCall('getSkuPlaceholders', {});
            callbacks?.onToolComplete?.('getSkuPlaceholders', result);
            return {
                success: result?.success !== false,
                message: result?.message || (result?.success !== false ? '已获取 SKU 占位符信息。' : '获取 SKU 占位符失败。'),
                toolResults: [{ toolName: 'getSkuPlaceholders', result }],
                error: result?.success === false ? (result?.error || 'getSkuPlaceholders failed') : undefined,
                data: result?.data
            };
        }

        return {
            success: false,
            message: `不支持的 sku-config action: ${action}`,
            error: 'Unsupported sku-config action'
        };
    }
};

