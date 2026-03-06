/**
 * 消息解析器
 * 
 * 将传统消息格式转换为多模态内容块格式
 * 
 * 性能优化：
 * - 稳定 ID 生成（基于内容哈希）
 * - 转换结果缓存
 * - 避免不必要的字符串操作
 */

import type { ActionItem, ContentBlock, MultimodalMessage, TextBlock, CodeBlock, ImageBlock, ToolResultBlock, CardBlock, ThinkingBlock as ThinkingBlockType, ParseOptions } from './types';
import { getToolDisplayInfo } from '../ThinkingProcess';

// ==================== 类型定义 ====================

// 旧版思维步骤类型
interface LegacyThinkingStep {
    id: string;
    type: 'thinking' | 'tool_call' | 'tool_result' | 'decision' | 'reading' | 'exploring' | 'analyzing';
    content: string;
    toolName?: string;
    toolParams?: any;
    toolResult?: any;
    imageData?: string;
    status: 'pending' | 'running' | 'success' | 'error';
    timestamp: number;
    duration?: number;
    filePath?: string;
    lineRange?: string;
}

// 旧版消息类型
interface LegacyMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    suggestions?: any[];
    layoutResult?: any;
    copyResult?: any;
    isThinking?: boolean;
    thinkingSteps?: LegacyThinkingStep[];
    image?: { data: string; type: string };
}
// ==================== 缓存机制 ====================

/**
 * 消息转换缓存
 * 
 * 使用 WeakMap 存储转换结果：
 * - 键：原始消息对象引用
 * - 值：缓存条目（包含转换结果和验证用的内容哈希）
 * 
 * WeakMap 优势：当原始消息被 GC 时，缓存自动清理
 */
interface CacheEntry {
    result: MultimodalMessage;
    contentHash: string;
    thinkingStepsLength: number;
    hasImage: boolean;
}

const conversionCache = new WeakMap<LegacyMessage, CacheEntry>();

/**
 * 简单字符串哈希（djb2 算法）
 * 用于检测内容变化，非加密用途
 */
function hashString(str: string): string {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    return hash.toString(36);
}

/**
 * 生成稳定 ID
 * 
 * 基于消息 ID、类型和索引生成确定性 ID
 * 相同输入总是产生相同输出，避免 React key 变化
 */
function createStableId(messageId: string, blockType: string, index: number): string {
    return `${messageId}-${blockType}-${index}`;
}

function withActionPayload(
    params: Record<string, any>,
    payload: Record<string, any> = params
): Record<string, any> {
    return {
        ...params,
        payload
    };
}

// ==================== 解析函数 ====================

/**
 * 代码块正则（预编译，避免重复创建）
 */
const CODE_BLOCK_REGEX = /```(\w+)?\n([\s\S]*?)```/g;

/**
 * 提取代码块
 */
function extractCodeBlocks(
    content: string, 
    messageId: string,
    startIndex: number
): { blocks: CodeBlock[]; remainingContent: string } {
    const blocks: CodeBlock[] = [];
    let remainingContent = content;
    let blockIndex = startIndex;
    
    // 重置正则状态
    CODE_BLOCK_REGEX.lastIndex = 0;
    
    let match;
    while ((match = CODE_BLOCK_REGEX.exec(content)) !== null) {
        const language = match[1] || 'text';
        const code = match[2].trim();
        
        blocks.push({
            id: createStableId(messageId, 'code', blockIndex++),
            type: 'code',
            language,
            code,
            lineNumbers: true,
            copyable: true
        });
        
        // 用占位符替换代码块
        remainingContent = remainingContent.replace(match[0], `\n[CODE_BLOCK_${blocks.length - 1}]\n`);
    }
    
    return { blocks, remainingContent };
}

/**
 * 检测特殊消息类型
 * 
 * 使用字符码检测，避免多次 startsWith 调用
 */
function detectMessageType(content: string): 'success' | 'warning' | 'error' | 'info' | 'normal' {
    const trimmed = content.trimStart();
    if (trimmed.length === 0) return 'normal';
    
    const firstChar = trimmed.charCodeAt(0);
    
    // ✅ (U+2705) 或 ✓ (U+2713)
    if (firstChar === 0x2705 || firstChar === 0x2713) return 'success';
    
    // ⚠ (U+26A0) - 注意：⚠️ 是两个字符
    if (firstChar === 0x26A0) return 'warning';
    
    // ❌ (U+274C) 或 ✗ (U+2717)
    if (firstChar === 0x274C || firstChar === 0x2717) return 'error';
    
    // ℹ (U+2139)
    if (firstChar === 0x2139) return 'info';
    
    // 中文关键词检测
    if (trimmed.startsWith('警告')) return 'warning';
    if (trimmed.startsWith('错误')) return 'error';
    if (trimmed.startsWith('提示')) return 'info';
    
    return 'normal';
}

/**
 * 提取标题和内容
 */
function extractTitleAndContent(content: string): { title: string; body: string } {
    // 移除开头的 emoji（使用更精确的模式）
    const cleaned = content.replace(/^[\u2705\u2713\u274C\u2717\u26A0\u2139\uFE0F\s]+/, '').trim();
    
    // 检查是否有 **标题** 格式
    const boldMatch = cleaned.match(/^\*\*([^*]+)\*\*\s*([\s\S]*)/);
    if (boldMatch) {
        return { title: boldMatch[1], body: boldMatch[2].trim() };
    }
    
    // 检查是否有冒号分隔
    const colonIndex = cleaned.search(/[：:]/);
    if (colonIndex > 0 && colonIndex < 20) {
        return { 
            title: cleaned.slice(0, colonIndex), 
            body: cleaned.slice(colonIndex + 1).trim() 
        };
    }
    
    return { title: '', body: cleaned };
}

/**
 * 格式化工具结果为人性化摘要
 * 避免向用户暴露原始 JSON 数据
 */
function formatToolResultSummary(toolName: string, result: any): string | undefined {
    if (!result) return undefined;
    
    // 如果是字符串，尝试解析
    let data = result;
    if (typeof result === 'string') {
        try {
            data = JSON.parse(result);
        } catch {
            // 非 JSON 字符串，截取显示
            return result.length > 50 ? result.slice(0, 50) + '...' : result;
        }
    }
    
    // 处理常见工具结果模式
    if (typeof data !== 'object' || data === null) {
        return String(data);
    }
    
    // 检查是否成功
    const success = data.success !== false;
    
    // 错误消息优先显示
    if (data.error) {
        return `错误: ${data.error}`;
    }
    if (data.message && !success) {
        return data.message;
    }
    
    // 根据工具类型生成友好摘要
    switch (toolName) {
        case 'getLayerHierarchy':
            if (data.totalLayers !== undefined) {
                return `文档 "${data.documentName || '当前文档'}"，共 ${data.totalLayers} 个图层`;
            }
            break;
            
        case 'getDocumentInfo':
            if (data.name) {
                return `${data.name} (${data.width}×${data.height})`;
            }
            break;
            
        case 'searchProjectResources':
        case 'listProjectResources':
            if (data.totalFiles !== undefined) {
                return `找到 ${data.totalFiles} 个文件`;
            }
            if (data.results?.length !== undefined) {
                return `找到 ${data.results.length} 个匹配项`;
            }
            if (Array.isArray(data)) {
                return `找到 ${data.length} 个文件`;
            }
            break;
            
        case 'analyzeLayout':
        case 'layout-analyze':
            if (data.layout?.type) {
                return `布局类型: ${data.layout.type}`;
            }
            break;
            
        case 'removeBackground':
        case 'applyMattingResult':
            return success ? '抠图完成' : '抠图失败';
            
        case 'placeImage':
            if (data.layerName) {
                return `已置入图层 "${data.layerName}"`;
            }
            return success ? '图片已置入' : '置入失败';
            
        case 'setTextContent':
        case 'setTextStyle':
            return success ? '文本已更新' : '更新失败';
            
        case 'moveLayer':
        case 'transformLayer':
            return success ? '变换已应用' : '变换失败';
            
        case 'createGroup':
        case 'groupLayers':
            if (data.groupName) {
                return `已创建组 "${data.groupName}"`;
            }
            return success ? '已创建组' : '创建失败';
            
        case 'saveDocument':
        case 'quickExport':
            if (data.path) {
                const fileName = data.path.split(/[/\\]/).pop();
                return `已保存: ${fileName}`;
            }
            return success ? '保存成功' : '保存失败';
            
        case 'getSmartObjectInfo':
            if (data.data?.isSmartObject) {
                const linked = data.data.linked ? '链接' : '嵌入';
                return `${linked}型智能对象`;
            }
            break;
            
        case 'convertToSmartObject':
            return success ? '已转换为智能对象' : '转换失败';
            
        case 'editSmartObjectContents':
            return success ? '智能对象已打开编辑' : '打开失败';
    }
    
    // 通用消息字段
    if (data.message && typeof data.message === 'string') {
        return data.message.length > 60 ? data.message.slice(0, 60) + '...' : data.message;
    }
    
    // 通用成功/失败
    if (success) {
        // 尝试提取有意义的字段
        if (data.name) return data.name;
        if (data.layerName) return `图层: ${data.layerName}`;
        if (data.count !== undefined) return `${data.count} 项`;
        if (data.totalLayers !== undefined) return `${data.totalLayers} 个图层`;
        return '执行成功';
    }
    
    return '执行完成';
}

/**
 * 将旧版思维步骤转换为思考块
 */
function convertThinkingSteps(steps: LegacyThinkingStep[], messageId: string): ThinkingBlockType {
    const thinkingSteps = steps.map(step => {
        let icon = '🔧';
        let label = step.content || '';
        
        if (step.toolName) {
            const info = getToolDisplayInfo(step.toolName);
            icon = info.icon;
            label = info.name;
            if (step.content && step.content !== info.description) {
                label = step.content;
            }
        } else if (step.type === 'thinking' || step.type === 'decision') {
            icon = '💭';
        } else if (step.type === 'reading') {
            icon = '📖';
            if (step.filePath) {
                label = `读取 ${step.filePath}${step.lineRange ? ` ${step.lineRange}` : ''}`;
            }
        } else if (step.type === 'exploring') {
            icon = '🔍';
        } else if (step.type === 'analyzing') {
            icon = '📊';
        }
        
        return {
            id: step.id,
            label,
            icon,
            status: step.status,
            detail: step.toolResult ? formatToolResultSummary(step.toolName || '', step.toolResult) : undefined,
            duration: step.duration
        };
    });
    
    const totalDuration = steps.reduce((sum, s) => sum + (s.duration || 0), 0);
    
    return {
        id: createStableId(messageId, 'thinking', 0),
        type: 'thinking',
        steps: thinkingSteps,
        isExpanded: false,
        totalDuration
    };
}

/**
 * 将工具调用结果转换为结果块
 */
function convertToolResult(step: LegacyThinkingStep, messageId: string, index: number): ToolResultBlock | null {
    if (step.type !== 'tool_result' || !step.toolName) return null;
    
    const info = getToolDisplayInfo(step.toolName);
    
    return {
        id: createStableId(messageId, 'tool_result', index),
        type: 'tool_result',
        toolName: step.toolName,
        displayName: info.name,
        icon: info.icon,
        success: step.status === 'success',
        result: step.toolResult,
        error: step.status === 'error' ? (step.content || '执行失败') : undefined,
        duration: step.duration,
        details: step.toolResult ? parseToolResultDetails(step.toolResult) : undefined,
        actions: buildToolResultActions(step, messageId, index)
    };
}

function buildToolResultActions(step: LegacyThinkingStep, messageId: string, index: number): ActionItem[] | undefined {
    const actions: ActionItem[] = [];
    const summary = formatToolResultSummary(step.toolName || '', step.toolResult);

    if (summary) {
        actions.push({
            id: createStableId(messageId, 'tool-result-copy', index + 101),
            label: '复制摘要',
            icon: '📋',
            variant: 'secondary',
            action: 'copyText',
            params: withActionPayload({ text: summary })
        });
    }

    if (step.status === 'error' && step.toolName) {
        actions.push({
            id: createStableId(messageId, 'tool-result-retry', index + 102),
            label: '重试工具',
            icon: '🔁',
            variant: 'primary',
            action: 'runTool',
            params: withActionPayload(
                { toolName: step.toolName, toolParams: step.toolParams || {} },
                { toolName: step.toolName, toolParams: step.toolParams || {} }
            )
        });
    }

    return actions.length > 0 ? actions : undefined;
}

/**
 * 解析工具结果详情
 */
function parseToolResultDetails(result: any): Array<{ label: string; value: string | number; type?: 'text' | 'code' | 'link' }> | undefined {
    if (!result || typeof result !== 'object') return undefined;
    
    const details: Array<{ label: string; value: string | number; type?: 'text' | 'code' | 'link' }> = [];
    
    // 常见字段映射
    const fieldMap: Record<string, string> = {
        'name': '名称',
        'id': 'ID',
        'path': '路径',
        'type': '类型',
        'count': '数量',
        'size': '大小',
        'width': '宽度',
        'height': '高度',
        'success': '成功',
        'error': '错误',
        'message': '消息'
    };
    
    for (const [key, value] of Object.entries(result)) {
        if (value === null || value === undefined) continue;
        if (typeof value === 'object') continue;
        
        const label = fieldMap[key] || key;
        const displayValue = typeof value === 'boolean' 
            ? (value ? '是' : '否')
            : String(value);
        
        details.push({
            label,
            value: displayValue,
            type: key === 'path' ? 'code' : 'text'
        });
        
        // 限制详情数量
        if (details.length >= 6) break;
    }
    
    return details.length > 0 ? details : undefined;
}

/**
 * 解析消息内容为内容块
 */
function parseMessageContentInternal(
    content: string, 
    messageId: string,
    startBlockIndex: number
): ContentBlock[] {
    const blocks: ContentBlock[] = [];
    let blockIndex = startBlockIndex;
    
    // 1. 提取代码块
    const { blocks: codeBlocks, remainingContent } = extractCodeBlocks(content, messageId, blockIndex);
    blockIndex += codeBlocks.length;
    
    // 2. 检测消息类型
    const messageType = detectMessageType(remainingContent);
    
    // 3. 如果是特殊类型消息，转换为卡片
    if (messageType !== 'normal') {
        const { title, body } = extractTitleAndContent(remainingContent);
        
        // 如果有代码块，需要将它们插入回正确位置
        if (codeBlocks.length > 0 && body.includes('[CODE_BLOCK_')) {
            const parts = body.split(/\[CODE_BLOCK_(\d+)\]/);
            for (let i = 0; i < parts.length; i++) {
                if (i % 2 === 0) {
                    if (parts[i].trim()) {
                        blocks.push({
                            id: createStableId(messageId, 'card', blockIndex++),
                            type: 'card',
                            variant: messageType,
                            title: i === 0 ? title : undefined,
                            content: parts[i].trim()
                        } as CardBlock);
                    }
                } else {
                    const codeIndex = parseInt(parts[i], 10);
                    if (codeBlocks[codeIndex]) {
                        blocks.push(codeBlocks[codeIndex]);
                    }
                }
            }
        } else {
            blocks.push({
                id: createStableId(messageId, 'card', blockIndex++),
                type: 'card',
                variant: messageType,
                title,
                content: body.replace(/\[CODE_BLOCK_\d+\]/g, '').trim()
            } as CardBlock);
            
            blocks.push(...codeBlocks);
        }
    } else {
        // 4. 普通消息
        if (codeBlocks.length > 0 && remainingContent.includes('[CODE_BLOCK_')) {
            const parts = remainingContent.split(/\[CODE_BLOCK_(\d+)\]/);
            for (let i = 0; i < parts.length; i++) {
                if (i % 2 === 0) {
                    if (parts[i].trim()) {
                        blocks.push({
                            id: createStableId(messageId, 'text', blockIndex++),
                            type: 'text',
                            content: parts[i].trim(),
                            format: 'markdown'
                        } as TextBlock);
                    }
                } else {
                    const codeIndex = parseInt(parts[i], 10);
                    if (codeBlocks[codeIndex]) {
                        blocks.push(codeBlocks[codeIndex]);
                    }
                }
            }
        } else {
            blocks.push({
                id: createStableId(messageId, 'text', blockIndex++),
                type: 'text',
                content: remainingContent,
                format: 'markdown'
            } as TextBlock);
        }
    }
    
    return blocks;
}


/**
 * 解析消息内容为内容块
 */
export function parseMessageContent(content: string, options: ParseOptions = {}): ContentBlock[] {
    // 使用时间戳作为临时 ID（用于非缓存场景）
    return parseMessageContentInternal(content, `temp-${Date.now()}`, 0);
}

/**
 * 将旧版消息转换为多模态消息
 * 
 * 性能优化：
 * - 使用 WeakMap 缓存转换结果
 * - 通过内容哈希检测变化
 * - 缓存命中时直接返回，避免重复计算
 */
export function convertLegacyMessage(message: LegacyMessage): MultimodalMessage {
    // 检查缓存
    const cached = conversionCache.get(message);
    const contentHash = hashString(message.content || '');
    const thinkingStepsLength = message.thinkingSteps?.length ?? 0;
    const hasImage = !!message.image;
    
    // 缓存命中且内容未变化
    if (cached && 
        cached.contentHash === contentHash &&
        cached.thinkingStepsLength === thinkingStepsLength &&
        cached.hasImage === hasImage) {
        return cached.result;
    }
    
    // 执行转换
    const blocks: ContentBlock[] = [];
    let blockIndex = 0;
    
    // 1. 如果有图片，添加图片块
    if (message.image) {
        blocks.push({
            id: createStableId(message.id, 'image', blockIndex++),
            type: 'image',
            src: `data:${message.image.type};base64,${message.image.data}`,
            alt: '附件图片',
            zoomable: true
        } as ImageBlock);
    }
    
    // 2. 如果有思维步骤，添加思考块
    if (message.thinkingSteps && message.thinkingSteps.length > 0) {
        const thinkingBlock = convertThinkingSteps(message.thinkingSteps, message.id);
        blocks.push(thinkingBlock);
        blockIndex++;
        
        // 添加工具执行结果
        const resultSteps = message.thinkingSteps.filter(s => s.type === 'tool_result');
        for (const step of resultSteps) {
            const resultBlock = convertToolResult(step, message.id, blockIndex++);
            if (resultBlock) {
                blocks.push(resultBlock);
            }
        }
    }


    if (message.content) {
        const contentBlocks = parseMessageContentInternal(message.content, message.id, blockIndex);
        blocks.push(...contentBlocks);
    }
    
    const result: MultimodalMessage = {
        id: message.id,
        role: message.role,
        timestamp: message.timestamp,
        blocks,
        isStreaming: message.isThinking
    };
    
    // 存入缓存
    conversionCache.set(message, {
        result,
        contentHash,
        thinkingStepsLength,
        hasImage
    });
    
    return result;
}

/**
 * 快速创建文本消息
 */
export function createTextMessage(
    content: string,
    role: 'user' | 'assistant' = 'assistant'
): MultimodalMessage {
    const id = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    return {
        id,
        role,
        timestamp: Date.now(),
        blocks: [{
            id: createStableId(id, 'text', 0),
            type: 'text',
            content,
            format: 'markdown'
        } as TextBlock]
    };
}

/**
 * 快速创建成功消息
 */
export function createSuccessMessage(title: string, message: string, details?: string[]): MultimodalMessage {
    const id = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const blocks: ContentBlock[] = [{
        id: createStableId(id, 'card', 0),
        type: 'card',
        variant: 'success',
        title,
        content: message
    } as CardBlock];
    
    return {
        id,
        role: 'assistant',
        timestamp: Date.now(),
        blocks
    };
}

/**
 * 快速创建错误消息
 */
export function createErrorMessage(title: string, message: string, suggestion?: string): MultimodalMessage {
    const id = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    return {
        id,
        role: 'assistant',
        timestamp: Date.now(),
        blocks: [{
            id: createStableId(id, 'error', 0),
            type: 'error',
            title,
            message,
            suggestion
        }]
    };
}

/**
 * 快速创建图片消息
 */
export function createImageMessage(
    imageSrc: string,
    caption?: string,
    role: 'user' | 'assistant' = 'assistant'
): MultimodalMessage {
    const id = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    return {
        id,
        role,
        timestamp: Date.now(),
        blocks: [{
            id: createStableId(id, 'image', 0),
            type: 'image',
            src: imageSrc,
            caption,
            zoomable: true
        } as ImageBlock]
    };
}













