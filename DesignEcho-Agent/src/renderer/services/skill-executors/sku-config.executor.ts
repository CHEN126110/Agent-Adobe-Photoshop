import type { SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';

/** SKU Skill 的内部配置/占位符策略，不单独注册为 Skill。 */
export async function executeSkuConfigurationStrategy({
    params,
    callbacks,
    signal
}: SkillExecuteParams): Promise<AgentResult> {
        const action = String(params?.configAction || params?.action || '').trim();

        if (!action) {
            return {
                success: false,
                message: 'SKU 配置操作缺少 action。可用生产动作：exportColors / createPlaceholders。纯查看占位符请直接使用只读工具。',
                error: 'Missing SKU configuration action',
                data: {
                    availableActions: ['exportColors', 'createPlaceholders'],
                    requiredStage: 'config'
                }
            };
        }

        if (action === 'exportColors') {
            callbacks?.onToolStart?.('exportColorConfig');
            const result = await executeToolCall('exportColorConfig', {}, { signal });
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
            // 前置文档检查：createSkuPlaceholders 需要打开的文档才能操作
            callbacks?.onToolStart?.('getDocumentInfo');
            const docInfo = await executeToolCall('getDocumentInfo', {}, { signal });
            callbacks?.onToolComplete?.('getDocumentInfo', docInfo);
            if (docInfo?.success === false) {
                return {
                    success: false,
                    message: '当前没有打开的 Photoshop 文档，无法创建 SKU 占位符。请先打开或创建一个文档。',
                    toolResults: [{ toolName: 'getDocumentInfo', result: docInfo }],
                    error: docInfo?.error || '没有打开的文档'
                };
            }

            const placeholderCount = Number(params?.placeholderCount);
            if (!Number.isInteger(placeholderCount) || placeholderCount <= 0) {
                return {
                    success: false,
                    message: '创建 SKU 占位符需要明确的正整数 placeholderCount；本策略不会猜测默认数量。',
                    error: 'Missing explicit SKU placeholder count',
                    toolResults: [{ toolName: 'getDocumentInfo', result: docInfo }]
                };
            }

            const payload = {
                count: placeholderCount,
                layout: params?.placeholderLayout || params?.layout || 'horizontal'
            };
            callbacks?.onToolStart?.('createSkuPlaceholders');
            const result = await executeToolCall('createSkuPlaceholders', payload, { signal });
            callbacks?.onToolComplete?.('createSkuPlaceholders', result);
            return {
                success: result?.success !== false,
                message: result?.message || (result?.success !== false ? 'SKU 占位符创建完成。' : '创建 SKU 占位符失败。'),
                toolResults: [
                    { toolName: 'getDocumentInfo', result: docInfo },
                    { toolName: 'createSkuPlaceholders', result }
                ],
                error: result?.success === false ? (result?.error || 'createSkuPlaceholders failed') : undefined,
                data: result?.data
            };
        }

        // 只保留旧调用兼容；新模型不会从 Skill schema 看到这个只读动作。
        if (action === 'getPlaceholders') {
            callbacks?.onToolStart?.('getSkuPlaceholders');
            const result = await executeToolCall('getSkuPlaceholders', {}, { signal });
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
            message: `不支持的 SKU 配置动作：${action}`,
            error: 'Unsupported SKU configuration action'
        };
}
