﻿/**
 * 对话面板
 * 参考 Lovart (https://lovart.ai) 和 Manus (https://manus.im) 的设计理念
 * 
 * 重构说明：
 * - 业务逻辑已抽离到 useChatActions Hook
 * - 本文件主要负责 UI 渲染和状态管理
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '../stores/app.store';
import { SuggestionList, TextSuggestion } from './SuggestionList';
import { ReferenceUpload } from './ReferenceUpload';
import { ReferenceReplicator } from './ReferenceReplicator';
import { LayoutFixList, LayoutFix } from './LayoutFixList';
import { ExecutionStatus, ExecutionStep, EXECUTION_TEMPLATES } from './ExecutionStatus';
import { buildProSystemPrompt, buildSimpleProPrompt } from '../../shared/prompts/agent-prompt';
import { ThinkingProcess, ThinkingStep, getToolDisplayInfo } from './ThinkingProcess';
import './ThinkingProcess.css';

// 多模态消息渲染
import { MessageRenderer, convertLegacyMessage } from './message';
import type { MultimodalMessage } from './message';

// 从工具执行服务导入核心功能
import { 
    AVAILABLE_TOOLS,
    executeToolCall,
} from '../services/tool-executor.service';

// 保留 useChatActions Hook 的模型选择功能
import { useChatActions } from '../hooks/useChatActions';

// 导入统一 AI Agent 服务
import { 
    processWithUnifiedAgent, 
    debugInferDecisionFromText,
    getPhotoshopContext,
    getProjectContext,
    type AgentContext,
    type AgentResult,
    type PhotoshopContext
} from '../services/unified-agent.service';

// 导入 BFL 图像生成模型配置
import { BFL_MODELS } from '../../shared/config/models.config';


// 模型配置导入已移至 useChatActions hook

// 日志工具函数 - 同时输出到控制台和日志文件
const agentLog = (level: 'info' | 'warn' | 'error', message: string, data?: any) => {
    const prefix = {
        info: '[Agent] ℹ️',
        warn: '[Agent] ⚠️',
        error: '[Agent] ❌'
    }[level];
    
    // 输出到控制台
    if (data) {
        console.log(`${prefix} ${message}`, data);
    } else {
        console.log(`${prefix} ${message}`);
    }
    
    // 写入到日志文件
    if (window.designEcho?.writeLog) {
        window.designEcho.writeLog(level, message, data);
    }
};

export const ChatPanel: React.FC = () => {
    const { 
        messages, addMessage, updateMessage, isLoading, setLoading, isPluginConnected, removeMessagesFrom,
        setAbortController, stopGeneration,
        modelPreferences,  // 获取用户模型偏好
        agentSettings      // 获取 Agent 设置（包含模型竞速配置）
    } = useAppStore();

    // 使用 Hook 获取业务逻辑（模型优先级、Agent 处理等）
    const { 
        modelPriority,
        isVisionModelAvailable,
        // 智能模型协作
        detectTaskType,
        getModelPriorityForTask,
        getTaskTypeLabel
    } = useChatActions({ isPluginConnected });
    const [input, setInput] = useState('');
    const [showUpload, setShowUpload] = useState(false);  // 参考图上传面板
    const [showAttachMenu, setShowAttachMenu] = useState(false);  // 附件菜单（+按钮）
    const [referenceImage, setReferenceImage] = useState<string | null>(null);
    const [pastedImage, setPastedImage] = useState<{ data: string; type: string } | null>(null);  // 粘贴的图片
    const [isDraggingImage, setIsDraggingImage] = useState(false);  // 拖拽状态
    
    // 图片生成状态
    const [showImageGen, setShowImageGen] = useState(false);  // 显示图片生成下拉菜单
    const [selectedImageModel, setSelectedImageModel] = useState<string>('bfl-flux2-max');  // 选中的图片生成模型
    const [isGeneratingImage, setIsGeneratingImage] = useState(false);  // 是否正在生成图片
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const inputAreaRef = useRef<HTMLDivElement>(null);
    
    // 执行状态
    const [executionSteps, setExecutionSteps] = useState<ExecutionStep[]>([]);
    const [showExecution, setShowExecution] = useState(false);
    
    // 消息编辑状态
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editingContent, setEditingContent] = useState('');
    
    // 参考图复刻面板状态
    const [showReplicator, setShowReplicator] = useState(false);
    
    // 思维链状态
    const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
    const [showThinking, setShowThinking] = useState(false);
    
    // === 性能优化：缓存消息渲染回调 ===
    // 用于 MessageRenderer 的 action 处理（稳定引用）
    const handleMessageAction = useCallback((actionId: string, params?: Record<string, any>) => {
        console.log('[ChatPanel] 执行动作:', actionId, params);

        const normalizedActionId = (() => {
            const aliases: Record<string, string> = {
                copy: 'copyText',
                copy_text: 'copyText',
                'copy-to-clipboard': 'copyText',
                copyContent: 'copyText',
                insert_prompt: 'insertPrompt',
                fillInput: 'insertPrompt',
                reusePrompt: 'insertPrompt',
                open_file: 'openProjectFile',
                openFile: 'openProjectFile',
                openDocument: 'openProjectFile',
                switch_document: 'switchDocument',
                activateDocument: 'switchDocument',
                executeTool: 'runTool',
                retryTool: 'runTool',
                retry_tool: 'runTool'
            };
            return aliases[actionId] || actionId;
        })();

        const emitActionResult = (
            _status: 'success' | 'failed' | 'skipped' | 'partial' | 'fallback',
            content: string,
            _details?: string,
            _toolOverride?: string
        ) => {
            addMessage({
                role: 'assistant',
                content
            });
        };

        void (async () => {
            try {
                switch (normalizedActionId) {
                    case 'copyText': {
                        const text = String(
                            params?.text ??
                            params?.value ??
                            params?.content ??
                            params?.summary ??
                            params?.payload?.text ??
                            ''
                        ).trim();
                        if (!text) {
                            emitActionResult('skipped', '⚠️ 没有可复制的内容', 'text empty', 'ui.copyText');
                            return;
                        }
                        await navigator.clipboard.writeText(text);
                        emitActionResult('success', '✅ 已复制到剪贴板', `length=${text.length}`, 'ui.copyText');
                        return;
                    }
                    case 'insertPrompt': {
                        const prompt = String(
                            params?.prompt ??
                            params?.text ??
                            params?.payload?.prompt ??
                            ''
                        ).trim();
                        if (!prompt) {
                            emitActionResult('skipped', '⚠️ 未提供可插入的提示词', 'prompt empty', 'ui.insertPrompt');
                            return;
                        }
                        setInput(prompt);
                        emitActionResult('success', '✅ 已将提示词填入输入框', `length=${prompt.length}`, 'ui.insertPrompt');
                        return;
                    }
                    case 'openProjectFile': {
                        const query = String(
                            params?.query ??
                            params?.fileName ??
                            params?.name ??
                            params?.path ??
                            params?.payload?.query ??
                            ''
                        ).trim();
                        if (!query) {
                            emitActionResult('skipped', '⚠️ 缺少要打开的文件关键词', 'query empty', 'openProjectFile');
                            return;
                        }
                        const result = await executeToolCall('openProjectFile', {
                            query,
                            type: params?.type || params?.payload?.type || 'all',
                            directory: params?.directory || params?.payload?.directory
                        });
                        if (result?.success) {
                            emitActionResult('success', `✅ 已尝试打开文件：${query}`, 'openProjectFile success', 'openProjectFile');
                        } else {
                            emitActionResult('failed', `❌ 打开文件失败：${result?.error || '未知错误'}`, result?.error || 'openProjectFile failed', 'openProjectFile');
                        }
                        return;
                    }
                    case 'switchDocument': {
                        const documentName = String(
                            params?.documentName ??
                            params?.name ??
                            params?.query ??
                            params?.payload?.documentName ??
                            ''
                        ).trim();
                        if (!documentName) {
                            emitActionResult('skipped', '⚠️ 缺少文档名称', 'documentName empty', 'switchDocument');
                            return;
                        }
                        const result = await executeToolCall('switchDocument', { documentName });
                        if (result?.success) {
                            emitActionResult('success', `✅ 已切换到文档：${documentName}`, 'switchDocument success', 'switchDocument');
                        } else {
                            emitActionResult('failed', `❌ 切换文档失败：${result?.error || '未知错误'}`, result?.error || 'switchDocument failed', 'switchDocument');
                        }
                        return;
                    }
                    case 'runTool': {
                        const toolName = String(
                            params?.toolName ??
                            params?.tool ??
                            params?.retryTool ??
                            params?.name ??
                            params?.payload?.toolName ??
                            ''
                        ).trim();
                        if (!toolName) {
                            emitActionResult('skipped', '⚠️ 未指定要执行的工具', 'toolName empty', 'runTool');
                            return;
                        }
                        const toolParams = (
                            params?.toolParams ??
                            params?.params ??
                            params?.payload?.toolParams ??
                            params?.payload?.params ??
                            {}
                        ) as Record<string, any>;
                        const result = await executeToolCall(toolName, toolParams);
                        if (result?.success) {
                            emitActionResult('success', `✅ 工具 ${toolName} 执行成功`, result?.message || 'runTool success', toolName);
                        } else {
                            const code = result?.code ? `code=${result.code}` : '';
                            const err = result?.error || 'runTool failed';
                            emitActionResult('failed', `❌ 工具 ${toolName} 执行失败：${result?.error || '未知错误'}`, [err, code].filter(Boolean).join(' | '), toolName);
                        }
                        return;
                    }
                    default:
                        emitActionResult('skipped', `⚠️ 未支持的动作：${actionId}`, 'unsupported action', `ui.${normalizedActionId}`);
                        return;
                }
            } catch (error: any) {
                emitActionResult('failed', `❌ 动作执行失败：${error?.message || '未知错误'}`, error?.message || 'action exception', `ui.${normalizedActionId}`);
            }
        })();
    }, [addMessage]);
    
    // 思维链辅助函数
    const addThinkingStep = (step: Omit<ThinkingStep, 'id' | 'timestamp'>) => {
        const newStep: ThinkingStep = {
            ...step,
            id: `step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now()
        };
        setThinkingSteps(prev => [...prev, newStep]);
        return newStep.id;
    };
    
    const updateThinkingStep = (stepId: string, updates: Partial<ThinkingStep>) => {
        setThinkingSteps(prev => prev.map(step => 
            step.id === stepId ? { ...step, ...updates } : step
        ));
    };
    
    const clearThinkingSteps = (hideThinking: boolean = true) => {
        setThinkingSteps([]);
        if (hideThinking) {
        setShowThinking(false);
        }
    };

    /**
     * 开始编辑消息
     * 使用 useCallback 避免子组件不必要的重渲染
     */
    const handleStartEdit = useCallback((messageId: string, content: string) => {
        setEditingMessageId(messageId);
        setEditingContent(content);
    }, []);

    /**
     * 取消编辑
     */
    const handleCancelEdit = useCallback(() => {
        setEditingMessageId(null);
        setEditingContent('');
    }, []);

    /**
     * 确认编辑并重新发送
     */
    const handleConfirmEdit = async () => {
        if (!editingMessageId || !editingContent.trim()) return;
        
        // 删除该消息及其后续消息
        removeMessagesFrom(editingMessageId);
        
        // 重置编辑状态
        const newContent = editingContent;
        setEditingMessageId(null);
        setEditingContent('');
        
        // 将编辑后的内容作为新消息发送
        addMessage({ role: 'user', content: newContent });
        
        // 使用统一 Agent 处理
        setLoading(true);
        try {
            await handleUnifiedAgent(newContent);
        } finally {
            setLoading(false);
        }
    };

    // 执行状态辅助函数
    const startExecution = (templateName: keyof typeof EXECUTION_TEMPLATES) => {
        const template = EXECUTION_TEMPLATES[templateName];
        setExecutionSteps(template.map(s => ({ ...s, status: 'pending' as const })));
        setShowExecution(true);
    };

    const updateStep = (stepId: string, status: ExecutionStep['status'], detail?: string) => {
        setExecutionSteps(prev => prev.map(step => 
            step.id === stepId ? { ...step, status, detail } : step
        ));
    };

    const finishExecution = (delay: number = 1500) => {
        setTimeout(() => setShowExecution(false), delay);
    };

    // 自动滚动到底部
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // 自动调整输入框高度
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
        }
    }, [input]);

    const handleApplySuggestion = async (suggestion: TextSuggestion) => {
        if (!window.designEcho) return;
        
        try {
            // 1. 设置文本内容
            await window.designEcho.sendToPlugin('setTextContent', { 
                content: suggestion.text 
            });

            // 2. 设置文本样式 (如果建议中有)
            const styleParams: Record<string, any> = {};
            
            if (suggestion.design.suggestedFontSize) {
                styleParams.fontSize = typeof suggestion.design.suggestedFontSize === 'number' 
                        ? suggestion.design.suggestedFontSize 
                    : parseFloat(suggestion.design.suggestedFontSize as string);
            }

            // 解析字间距（如 "+2%" 转换为 tracking 值）
            if (suggestion.design.suggestedLetterSpacing) {
                const spacing = suggestion.design.suggestedLetterSpacing;
                const match = spacing.match(/([+-]?\d+(?:\.\d+)?)\s*%?/);
                if (match) {
                    // 将百分比转换为 tracking 值（千分之一 em）
                    // 1% ≈ 10 tracking 单位
                    styleParams.tracking = parseFloat(match[1]) * 10;
                }
            }

            // 设置行高
            if (suggestion.design.suggestedLineHeight) {
                // lineHeight 是倍数，需要乘以字号得到 leading 值
                const fontSize = styleParams.fontSize || 12;
                styleParams.leading = suggestion.design.suggestedLineHeight * fontSize;
            }

            if (Object.keys(styleParams).length > 0) {
                await window.designEcho.sendToPlugin('setTextStyle', styleParams);
            }

            addMessage({
                role: 'assistant',
                content: `✅ 已应用方案：${suggestion.text}`
            });

        } catch (error) {
            addMessage({
                role: 'assistant',
                content: `❌ 应用失败：${error instanceof Error ? error.message : '未知错误'}`
            });
        }
    };

    /**
     * 应用单个排版修复
     */
    const handleApplyLayoutFix = async (fix: LayoutFix): Promise<void> => {
        if (!window.designEcho) return;

        try {
            console.log('[ChatPanel] 应用修复:', fix);
            
            switch (fix.action) {
                case 'move':
                    // 映射 left/top 到 x/y (moveLayer 工具使用 x, y 参数)
                    const moveParams = {
                        layerId: fix.layerId,
                        x: fix.changes.left ?? fix.changes.x ?? 0,
                        y: fix.changes.top ?? fix.changes.y ?? 0,
                        relative: false  // 使用绝对位置
                    };
                    console.log('[ChatPanel] moveLayer 参数:', moveParams);
                    const moveResult = await window.designEcho.sendToPlugin('moveLayer', moveParams);
                    console.log('[ChatPanel] moveLayer 结果:', moveResult);
                    if (!moveResult.success) {
                        throw new Error(moveResult.error || '移动图层失败');
                    }
                    break;
                
                case 'restyle':
                    const restyleResult = await window.designEcho.sendToPlugin('setTextStyle', {
                        layerId: fix.layerId,
                        ...fix.changes
                    });
                    console.log('[ChatPanel] setTextStyle 结果:', restyleResult);
                    if (!restyleResult.success) {
                        throw new Error(restyleResult.error || '设置样式失败');
                    }
                    break;
                
                case 'align':
                    const alignResult = await window.designEcho.sendToPlugin('alignLayers', {
                        layerIds: [fix.layerId],
                        alignType: fix.changes.alignType || 'center'
                    });
                    console.log('[ChatPanel] alignLayers 结果:', alignResult);
                    if (!alignResult.success) {
                        throw new Error(alignResult.error || '对齐失败');
                    }
                    break;
                
                default:
                    console.warn('Unknown fix action:', fix.action);
            }
        } catch (error) {
            console.error('[ChatPanel] 应用修复失败:', error);
            throw new Error(`应用修复失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    };

    /**
     * 应用智能文案版本
     */
    const handleApplySmartCopyVersion = async (version: string) => {
        try {
            // 从 localStorage 获取保存的智能文案数据
            const savedData = localStorage.getItem('designecho_smart_copy_data');
            if (!savedData) {
                addMessage({
                    role: 'assistant',
                    content: '⚠️ 未找到智能文案方案数据，请先点击"智能文案"按钮生成方案。'
                });
                return;
            }
            
            const smartCopyData = JSON.parse(savedData);
            const copyVersions = smartCopyData.copyVersions;
            
            if (!copyVersions) {
                addMessage({
                    role: 'assistant',
                    content: '⚠️ 文案版本数据无效，请重新生成。'
                });
                return;
            }
            
            const selectedVersion = version === 'A' ? copyVersions.version_a : copyVersions.version_b;
            
            if (!selectedVersion || !selectedVersion.copies) {
                addMessage({
                    role: 'assistant',
                    content: `⚠️ 未找到版本 ${version} 的文案数据。`
                });
                return;
            }
            
            setLoading(true);
            addMessage({
                role: 'assistant',
                content: `🔄 正在应用 ${selectedVersion.style_name || `版本${version}`}...`
            });
            
            // 批量替换文案
            let successCount = 0;
            let failCount = 0;
            const results: string[] = [];
            
            for (const copy of selectedVersion.copies) {
                try {
                    // 根据图层名查找并选择图层
                    const selectResult = await window.designEcho.sendToPlugin('selectLayer', {
                        layerName: copy.layer_name
                    });
                    
                    if (selectResult.success) {
                        // 替换文案内容
                        const setResult = await window.designEcho.sendToPlugin('setTextContent', {
                            content: copy.new_copy
                        });
                        
                        if (setResult.success) {
                            successCount++;
                            results.push(`✅ [${copy.layer_name}] "${copy.original}" → "${copy.new_copy}"`);
                        } else {
                            failCount++;
                            results.push(`❌ [${copy.layer_name}] 设置失败: ${setResult.error}`);
                        }
                    } else {
                        failCount++;
                        results.push(`⚠️ [${copy.layer_name}] 未找到图层`);
                    }
                } catch (e: any) {
                    failCount++;
                    results.push(`❌ [${copy.layer_name}] 错误: ${e.message}`);
                }
            }
            
            // 清除保存的数据
            localStorage.removeItem('designecho_smart_copy_data');
            
            // 显示结果
            useAppStore.getState().removeLastMessage();
            
            let resultContent = `## ✅ 文案替换完成\n\n`;
            resultContent += `**使用方案**：${selectedVersion.style_name || `版本${version}`}\n`;
            resultContent += `**成功**：${successCount} 个 | **失败**：${failCount} 个\n\n`;
            resultContent += `### 替换详情\n\n`;
            resultContent += results.join('\n');
            
            if (failCount > 0) {
                resultContent += `\n\n💡 **提示**：部分图层可能名称不匹配，您可以手动调整。`;
            }
            
            addMessage({
                role: 'assistant',
                content: resultContent
            });
            
        } catch (error: any) {
            addMessage({
                role: 'assistant',
                content: `❌ 应用文案失败：${error.message}`
            });
        } finally {
            setLoading(false);
        }
    };

    /**
     * 批量应用排版修复
     */
    const handleApplyAllLayoutFixes = async (fixes: LayoutFix[]): Promise<void> => {
        for (const fix of fixes) {
            await handleApplyLayoutFix(fix);
        }
        
        addMessage({
            role: 'assistant',
            content: `✅ 已应用 ${fixes.length} 项排版修复`
        });
    };

    const handleOptimize = async () => {
        if (!isPluginConnected) {
            addMessage({ role: 'assistant', content: '⚠️ 请先连接 Photoshop 插件' });
            return;
        }

        setLoading(true);
        startExecution('textOptimize');

        try {
            // 步骤 1: 获取选中文本
            updateStep('get-text', 'running');
            const result = await window.designEcho.sendToPlugin('getTextContent', {});
            if (!result.success) {
                updateStep('get-text', 'error', result.error);
                throw new Error(result.error || '获取文本失败');
            }
            const currentText = result.content;
            updateStep('get-text', 'completed', `"${currentText.substring(0, 20)}..."`);

            // 步骤 2: 获取样式
            updateStep('get-style', 'running');
            const styleResult = await window.designEcho.sendToPlugin('getTextStyle', {});
            updateStep('get-style', 'completed', styleResult.success ? '已获取' : '跳过');

            // 步骤 3: 调用 AI 优化
            updateStep('ai-optimize', 'running');
            const aiResponse = await window.designEcho.executeTask('text-optimize', {
                text: currentText
            });
            updateStep('ai-optimize', 'completed');

            // 步骤 4: 生成方案
            updateStep('generate', 'running');

            // 3. 解析结果
            let suggestions: TextSuggestion[] = [];
            if (aiResponse.suggestions) {
                suggestions = aiResponse.suggestions;
            } else {
                // 尝试从文本解析 JSON
                // 实际生产中应该由 TaskOrchestrator 保证返回 JSON
                console.warn('AI response format warning:', aiResponse);
                if (typeof aiResponse === 'string') {
                    // 简单的尝试解析
                    try {
                        const jsonMatch = aiResponse.match(/```json\n?([\s\S]*?)\n?```/);
                        if (jsonMatch) {
                             const parsed = JSON.parse(jsonMatch[1]);
                             if (parsed.suggestions) suggestions = parsed.suggestions;
                        }
                    } catch (e) {
                        console.error('Failed to parse response manually', e);
                    }
                }
            }

            // 4. 展示结果
            if (suggestions.length > 0) {
                updateStep('generate', 'completed', `${suggestions.length} 个方案`);
                finishExecution();
                addMessage({
                    role: 'assistant',
                    content: '✨ 优化建议如下：',
                    suggestions: suggestions
                });
            } else {
                updateStep('generate', 'error', '无建议');
                finishExecution();
                addMessage({
                    role: 'assistant',
                    content: '🤔 AI 未能生成有效建议，请重试。'
                });
            }

        } catch (error) {
            console.error('Optimize error:', error);
            finishExecution(500);
            addMessage({
                role: 'assistant',
                content: `❌ 优化失败：${error instanceof Error ? error.message : '未知错误'}`
            });
        } finally {
            setLoading(false);
        }
    };

    /**
     * 处理粘贴事件 - 支持 Ctrl+V 粘贴图片
     */
    const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            
            // 检查是否为图片类型
            if (item.type.startsWith('image/')) {
                e.preventDefault();  // 阻止默认粘贴行为
                
                const file = item.getAsFile();
                if (!file) continue;
                
                // 读取图片为 base64
                const reader = new FileReader();
                reader.onload = (event) => {
                    const result = event.target?.result as string;
                    if (result) {
                        // 提取 base64 数据（去掉 data:image/xxx;base64, 前缀）
                        const base64Data = result.split(',')[1];
                        const imageType = item.type;
                        
                        setPastedImage({
                            data: base64Data,
                            type: imageType
                        });
                        
                        console.log(`[ChatPanel] 📷 已粘贴图片: ${imageType}, 大小: ${(base64Data.length / 1024).toFixed(1)}KB`);
                    }
                };
                reader.readAsDataURL(file);
                break;  // 只处理第一张图片
            }
        }
    };

    /**
     * 处理拖拽进入事件
     */
    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        // 检查是否拖拽的是文件
        if (e.dataTransfer?.types.includes('Files')) {
            setIsDraggingImage(true);
        }
    };

    /**
     * 处理拖拽悬停事件
     */
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    /**
     * 处理拖拽离开事件
     */
    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        // 检查是否真的离开了输入区域（而不是进入子元素）
        const rect = inputAreaRef.current?.getBoundingClientRect();
        if (rect) {
            const { clientX, clientY } = e;
            if (
                clientX < rect.left ||
                clientX > rect.right ||
                clientY < rect.top ||
                clientY > rect.bottom
            ) {
                setIsDraggingImage(false);
            }
        }
    };

    /**
     * 处理拖拽放置事件 - 支持拖拽图片到输入框
     */
    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingImage(false);
        
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        
        // 查找第一个图片文件
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            
            if (file.type.startsWith('image/')) {
                // 读取图片为 base64
                const reader = new FileReader();
                reader.onload = (event) => {
                    const dataUrl = event.target?.result as string;
                    if (!dataUrl) return;
                    
                    // 提取 base64 数据（去掉 data:image/xxx;base64, 前缀）
                    const base64Match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
                    if (base64Match) {
                        const [, mimeType, base64Data] = base64Match;
                        setPastedImage({
                            data: base64Data,
                            type: mimeType
                        });
                        console.log(`[ChatPanel] 📷 拖拽图片成功: ${file.name}, ${file.type}, ${Math.round(base64Data.length / 1024)}KB`);
                        
                        // 聚焦到输入框
                        textareaRef.current?.focus();
                    }
                };
                reader.readAsDataURL(file);
                break;  // 只处理第一张图片
            }
        }
    };

    /**
     * 处理图片生成
     * @param promptOverride 可选的提示词覆盖（从 handleSend 调用时使用）
     */
    const handleImageGeneration = async (promptOverride?: string) => {
        const prompt = promptOverride || input.trim();
        if (!prompt) {
            addMessage({ role: 'assistant', content: '⚠️ 请输入图片描述' });
            return;
        }

        const selectedModel = BFL_MODELS.find(m => m.id === selectedImageModel);
        if (!selectedModel) {
            addMessage({ role: 'assistant', content: '⚠️ 请选择图片生成模型' });
            return;
        }

        // 检查 BFL API Key 是否已配置
        const hasApiKey = await window.designEcho.bfl.hasApiKey();
        if (!hasApiKey) {
            addMessage({ 
                role: 'assistant', 
                content: `⚠️ **未配置 BFL API 密钥**\n\n请先在 **设置 → API 密钥 → Black Forest Labs** 中配置 API Key。\n\n获取 API Key: [bfl.ai](https://bfl.ai)`
            });
            return;
        }

        setIsGeneratingImage(true);
        if (!promptOverride) {
            setInput('');  // 只有直接调用时才清空
        }

        // addMessage 返回新消息的 ID
        const msgId = addMessage({ 
            role: 'assistant', 
            content: `🎨 正在使用 ${selectedModel.name} 生成图片...\n\n**提示词**: ${prompt}`
        });

        try {
            // 检查是否需要参考图片（image-to-image 类型）
            const needsImage = selectedModel.type === 'image-to-image' || selectedModel.type === 'inpainting';
            
            if (needsImage && !pastedImage) {
                updateMessage(msgId, {
                    content: `⚠️ ${selectedModel.name} 需要参考图片，请先粘贴或拖拽一张图片`
                });
                setIsGeneratingImage(false);
                return;
            }

            let result: any;
            
            if (selectedModel.type === 'text-to-image' || !pastedImage) {
                // 文生图 - 参数顺序: model, prompt, options
                result = await window.designEcho.bfl.text2image(
                    selectedModel.apiModelId,
                    prompt,
                    { width: 1024, height: 1024 }
                );
            } else if (selectedModel.type === 'image-to-image') {
                // 图生图 - 参数顺序: model, prompt, inputImage, options
                result = await window.designEcho.bfl.image2image(
                    selectedModel.apiModelId,
                    prompt,
                    pastedImage.data,
                    {}
                );
            } else if (selectedModel.type === 'inpainting') {
                // 局部重绘 - 参数顺序: prompt, inputImage, maskImage, options
                result = await window.designEcho.bfl.inpaint(
                    prompt,
                    pastedImage.data,
                    pastedImage.data,  // TODO: 实际使用时需要单独的 mask
                    {}
                );
            }

            // BFLService 返回: { id, url, width, height, raw }
            if (result.success && result.data?.url) {
                // 下载图片
                const downloadResult = await window.designEcho.bfl.downloadImage(result.data.url);
                
                if (downloadResult.success && downloadResult.data) {
                    updateMessage(msgId, {
                        content: `✅ 图片生成成功！\n\n**模型**: ${selectedModel.name}\n**提示词**: ${prompt}`,
                        image: {
                            data: downloadResult.data,
                            type: 'image/png'
                        }
                    });
                    
                    // 清除参考图片
                    setPastedImage(null);
                } else {
                    updateMessage(msgId, {
                        content: `⚠️ 图片生成成功但下载失败\n\n**图片链接**: ${result.data.url}\n\n*链接24小时内有效*`
                    });
                }
            } else {
                updateMessage(msgId, {
                    content: `❌ 图片生成失败: ${result.error || '未知错误'}`
                });
            }
        } catch (error: any) {
            console.error('[ChatPanel] 图片生成错误:', error);
            updateMessage(msgId, {
                content: `❌ 图片生成出错: ${error.message || '未知错误'}`
            });
        } finally {
            setIsGeneratingImage(false);
        }
    };

    const handleVisualAnalysis = async () => {
        if (!isPluginConnected) {
            addMessage({ role: 'assistant', content: '⚠️ 请先连接 Photoshop 插件' });
            return;
        }

        if (!referenceImage) {
             addMessage({ role: 'assistant', content: '⚠️ 请先上传参考图' });
             return;
        }

        setLoading(true);
        addMessage({ role: 'assistant', content: '🔍 正在获取当前画布截图...' });

        try {
            // 1. 获取当前画布截图
            const snapshotResult = await window.designEcho.sendToPlugin('getDocumentSnapshot', {
                maxWidth: 800,
                maxHeight: 600,
                format: 'jpeg'
            });

            if (!snapshotResult.success) {
                throw new Error(snapshotResult.error || '获取画布截图失败');
            }

            addMessage({ role: 'assistant', content: '🤖 正在进行视觉对比分析...' });

            // 2. 调用 AI 视觉对比
            const aiResponse = await window.designEcho.executeTask('visual-compare', {
                image: {
                    data: referenceImage, // Base64
                    mediaType: 'image/jpeg' 
                },
                documentImage: {
                    data: snapshotResult.imageData,
                    mediaType: 'image/jpeg'
                }
            });

            // 3. 解析并展示结果
            let content = '✨ 分析完成！\n\n';
            
            if (aiResponse.differences) {
                content += '**1. 视觉差异：**\n';
                aiResponse.differences.forEach((diff: any) => {
                    content += `- [${diff.dimension}] ${diff.description}\n`;
                });
            }

            if (aiResponse.suggestions) {
                content += '\n**2. 改进建议：**\n';
                aiResponse.suggestions.forEach((sugg: any) => {
                    content += `- **${sugg.target}**: ${sugg.action} (${sugg.reason})\n`;
                });
            }

            if (aiResponse.summary) {
                content += `\n**总结**：${aiResponse.summary}`;
            }

            // 如果没有结构化数据，显示原始文本
            if (!aiResponse.differences && !aiResponse.suggestions) {
                content += typeof aiResponse === 'string' ? aiResponse : JSON.stringify(aiResponse, null, 2);
            }

            addMessage({
                role: 'assistant',
                content: content
            });

        } catch (error) {
             addMessage({
                role: 'assistant',
                content: `❌ 分析失败：${error instanceof Error ? error.message : '未知错误'}`
            });
        } finally {
            setLoading(false);
        }
    };

    const handleImageUpload = (file: File, base64: string) => {
        setReferenceImage(base64);
        addMessage({
            role: 'user',
            content: `[已上传参考图: ${file.name}]`
        });
        setShowUpload(false);
    };

    const captureScreenshotForChat = async (source: 'agent' | 'desktop') => {
        try {
            const captureResult = source === 'agent'
                ? await window.designEcho.captureAgentWindowScreenshot?.()
                : await window.designEcho.captureDesktopScreenshot?.();

            if (!captureResult?.success || !captureResult.imageBase64) {
                addMessage({
                    role: 'assistant',
                    content: `❌ 截图失败：${captureResult?.error || '接口不可用'}`
                });
                return;
            }

            setPastedImage({
                data: captureResult.imageBase64,
                type: captureResult.mimeType || 'image/png'
            });
            setShowAttachMenu(false);
            textareaRef.current?.focus();
        } catch (error: any) {
            addMessage({
                role: 'assistant',
                content: `❌ 截图失败：${error?.message || '未知错误'}`
            });
        }
    };
    
    /**
     * 统一的消息发送处理
     * 
     * 设计原则：
     * 1. 所有对话都交给 AI Agent 处理，保证上下文理解
     * 2. AI 可以调用工具执行操作
     * 3. 只有明确的斜杠命令才特殊处理
     */
    const handleSend = async () => {
        if ((!input.trim() && !referenceImage && !pastedImage) || isLoading) return;

        const userInput = input.trim();
        const imageToSend = pastedImage;  // 保存当前粘贴的图片
        setInput('');
        setPastedImage(null);  // 清除粘贴的图片
        
        if (userInput || imageToSend) {
            // 如果有图片，在消息中包含图片标记
            const messageContent = imageToSend 
                ? `${userInput || '请分析这张图片'}\n\n[📷 已附带图片]`
                : userInput;
            
            addMessage({
                role: 'user',
                content: messageContent,
                image: imageToSend ? { data: imageToSend.data, type: imageToSend.type } : undefined
            });
        }

        // 只有斜杠命令特殊处理
        if (userInput.startsWith('/')) {
            handleCommand(userInput);
            return;
        }

        // ======== 图片生成模式：直接调用 FLUX API ========
        if (showImageGen && userInput) {
            await handleImageGeneration(userInput);
            return;
        }

        // 检查是否是选择智能文案版本的指令
        const smartCopyMatch = userInput.match(/^(用|选|应用|采用)\s*(A|B|版本A|版本B|方案A|方案B)$/i);
        if (smartCopyMatch) {
            await handleApplySmartCopyVersion(smartCopyMatch[2].toUpperCase().replace(/版本|方案/, ''));
            return;
        }

        // ======== 快捷命令模式：对于常见操作直接执行，不调用 AI ========
        const quickResult = await tryQuickCommand(userInput);
        if (quickResult.handled) {
            // 快捷命令已处理
            addMessage({ role: 'assistant', content: quickResult.message || '' });
            return;
        }

        // 所有其他对话都交给 AI Agent 处理
        setLoading(true);
        try {
            await handleUnifiedAgent(userInput, imageToSend || undefined);
        } catch (error) {
            console.error('Agent error:', error);
            addMessage({
                role: 'assistant',
                content: `❌ 处理失败：${error instanceof Error ? error.message : '未知错误'}`
            });
        } finally {
            setLoading(false);
        }
    };

    /**
     * 快捷命令处理器
     * 对于常见的简单操作，直接执行而不调用 AI 模型
     * 大幅提升响应速度！
     */
    /**
     * 快捷命令处理
     * 
     * 设计原则：
     * - 只处理【单词级】的简单命令（撤销、保存、重做）
     * - 其他所有请求都交给 AI 处理，让 AI 理解用户意图
     * - 避免机械式的关键词匹配
     */
    const tryQuickCommand = async (input: string): Promise<{ handled: boolean; message?: string }> => {
        const trimmed = input.trim().toLowerCase();
        
        // ===== 只处理单词级的简单命令 =====
        
        // 撤销
        if (trimmed === '撤销' || trimmed === 'undo') {
            try {
                const result = await executeToolCall('undo', {});
                return { handled: true, message: result?.success ? '✅ 已撤销' : `❌ ${result?.error || '撤销失败'}` };
            } catch (e: any) {
                return { handled: true, message: `❌ ${e.message}` };
            }
        }
        
        // 重做
        if (trimmed === '重做' || trimmed === 'redo') {
            try {
                const result = await executeToolCall('redo', {});
                return { handled: true, message: result?.success ? '✅ 已重做' : `❌ ${result?.error || '重做失败'}` };
            } catch (e: any) {
                return { handled: true, message: `❌ ${e.message}` };
            }
        }
        
        // 保存（仅单词）
        if (trimmed === '保存' || trimmed === 'save') {
            try {
                const result = await executeToolCall('smartSave', {});
                return { handled: true, message: result?.message || (result?.success ? '✅ 已保存' : `❌ ${result?.error || '保存失败'}`) };
            } catch (e: any) {
                return { handled: true, message: `❌ ${e.message}` };
            }
        }
        
        // 其他所有请求都交给 AI 处理
        // AI 会理解用户意图，而不是机械式匹配关键词
        return { handled: false };
    };

    /**
     * 统一的 AI Agent 处理器
     * 
     * 新架构：
     * 1. AI 理解用户意图（不是关键词匹配）
     * 2. AI 选择工具/技能（根据理解做决策）
     * 3. 执行决策并返回结果
     * 4. 支持多轮对话
     */
    const handleUnifiedAgent = async (userInput: string, attachedImage?: { data: string; type: string }) => {
        // ========== 🤖 AI 驱动流程（专业思维链展示） ==========
        
        // 创建 AbortController 用于取消任务
        const controller = new AbortController();
        setAbortController(controller);
        const signal = controller.signal;
        
        const thinkingStartTime = Date.now();
        const hasAttachedImage = !!attachedImage;
        
        // 💡 收集思维步骤（用于专业 UI 展示）
        const collectedSteps: ThinkingStep[] = [];
        const stepStartTimes: Record<string, number> = {};
        
        // 添加思维步骤的辅助函数
        const addStep = (step: Omit<ThinkingStep, 'id' | 'timestamp'>): string => {
            const id = `step-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
            const newStep: ThinkingStep = {
                ...step,
                id,
                timestamp: Date.now()
            };
            collectedSteps.push(newStep);
            stepStartTimes[id] = Date.now();
            
            // 同步到 UI 状态
            setThinkingSteps([...collectedSteps]);
            return id;
        };
        
        // 清理 AI 响应中可能残留的 JSON 结构
        const cleanResponseContent = (content: string): string => {
            if (!content) return content;
            
            // 检查是否包含 JSON 结构
            const jsonMatch = content.match(/^\s*```json\s*([\s\S]*?)\s*```\s*$/);
            if (jsonMatch) {
                try {
                    const json = JSON.parse(jsonMatch[1]);
                    if (json.directResponse) return json.directResponse;
                    if (json.reasoning) return json.reasoning;
                } catch {}
            }
            
            // 检查是否是纯 JSON 对象
            const trimmed = content.trim();
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                try {
                    const json = JSON.parse(trimmed);
                    if (json.directResponse) return json.directResponse;
                    if (json.reasoning) return json.reasoning;
                } catch {}
            }
            
            return content;
        };
        
        // 打字机效果显示消息（不再依赖 removeLastMessage）
        const typewriterMessage = async (
            fullContent: string, 
            options?: { image?: any; thinkingSteps?: ThinkingStep[] }
        ) => {
            // 清理可能的 JSON 残留
            const cleanedContent = cleanResponseContent(fullContent);
            
            // 短消息或无内容直接显示
            if (!cleanedContent || cleanedContent.length < 50) {
                addMessage({
                    role: 'assistant',
                    content: cleanedContent,
                    image: options?.image,
                    thinkingSteps: options?.thinkingSteps,
                    isThinking: false
                });
                return;
            }
        
            // 逐步显示内容
            let displayedLength = 0;
            const chunkSize = 3; // 每次显示3个字符
            const delay = 15; // 每次间隔15ms
            
            // 添加初始空消息
            addMessage({
                role: 'assistant',
                content: '',
                image: options?.image,
                thinkingSteps: options?.thinkingSteps,
                isThinking: false
            });
            
            // 逐步更新内容（使用清理后的内容）
            while (displayedLength < cleanedContent.length) {
                displayedLength = Math.min(displayedLength + chunkSize, cleanedContent.length);
                const partialContent = cleanedContent.substring(0, displayedLength);
                
                // 更新消息内容
                useAppStore.getState().updateLastMessage(partialContent);
                
                // 滚动到底部
                if (messagesEndRef.current) {
                    messagesEndRef.current.scrollIntoView({ behavior: 'auto' });
                }
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        };
        
        // 更新思维步骤
        const updateStep = (stepId: string, updates: Partial<ThinkingStep>) => {
            const idx = collectedSteps.findIndex(s => s.id === stepId);
            console.log('[ChatPanel] updateStep 调用:', { stepId, idx, updates: updates.content?.substring(0, 30), stepCount: collectedSteps.length });
            if (idx !== -1) {
                // 如果状态变为完成，计算耗时
                if (updates.status === 'success' || updates.status === 'error') {
                    const startTime = stepStartTimes[stepId];
                    if (startTime) {
                        updates.duration = Date.now() - startTime;
                    }
                }
                collectedSteps[idx] = { ...collectedSteps[idx], ...updates };
                const newSteps = [...collectedSteps];
                console.log('[ChatPanel] 更新后的步骤:', newSteps.map(s => ({ type: s.type, content: s.content?.substring(0, 20), status: s.status })));
                setThinkingSteps(newSteps);
            }
        };
        
        // 显示思维链 UI
        clearThinkingSteps(false);  // 清空但不隐藏
        setShowThinking(true);
        
        // 创建思考步骤占位（不显示初始文字，等待真正的思考内容）
        const thinkingStepId = addStep({
            type: 'thinking',
            content: '',  // 空内容，等待实际思考过程填充
            status: 'running'
        });
        
        try {
            // 获取 Photoshop 上下文
            let photoshopContext: PhotoshopContext | undefined;
            if (isPluginConnected) {
                photoshopContext = await getPhotoshopContext();
            } else {
                photoshopContext = { hasDocument: false };
            }
            
            // 获取项目上下文
            const projectContext = await getProjectContext();
            
            // 构建 Agent 上下文
            const agentContext: AgentContext = {
                userInput,
                conversationHistory: messages.map(m => ({
                    role: m.role,
                    content: typeof m.content === 'string' ? m.content : ''
                })),
                isPluginConnected,
                photoshopContext,
                projectContext: projectContext ? {
                    projectPath: projectContext.projectPath,
                    hasSkuFiles: projectContext.hasSkuFiles,
                    hasTemplates: projectContext.hasTemplates
                } : undefined,
                hasAttachedImage,  // 传递图片状态
                attachedImageData: attachedImage?.data  // 传递图片数据
            };
            
            // 调用模型的封装函数（支持图片 + 模型竞速优化）
            const callModel = async (msgs: Array<{ role: string; content: string | any[] }>, options?: any) => {
                // 如果有附带图片，优先使用视觉模型
                let modelsToTry = modelPriority;
                const modelErrors: string[] = [];
                
                if (hasAttachedImage) {
                    // 获取视觉任务的模型优先级
                    const visualModels = getModelPriorityForTask('visual');
                    // 视觉模型优先，然后是默认模型
                    modelsToTry = [...new Set([...visualModels, ...modelPriority])];
                    console.log('[ChatPanel] 📷 有附带图片，使用视觉模型:', modelsToTry.slice(0, 3).join(', '));
                    console.log('[ChatPanel] 📷 附带图片信息:', {
                        hasData: !!attachedImage?.data,
                        dataLength: attachedImage?.data?.length,
                        type: attachedImage?.type,
                        msgCount: msgs.length
                    });
                    
                    // 转换消息格式为多模态格式（符合 model-service.ts 的 MessageContent 格式）
                    msgs = msgs.map((msg, idx) => {
                        // 只为最后一条用户消息添加图片
                        if (msg.role === 'user' && idx === msgs.length - 1 && attachedImage) {
                            console.log('[ChatPanel] 📷 为消息添加图片:', { idx, totalMsgs: msgs.length, textPreview: typeof msg.content === 'string' ? msg.content.substring(0, 50) : 'array' });
                            return {
                                role: 'user',
                                content: [
                                    { type: 'text', text: typeof msg.content === 'string' ? msg.content : (msg.content[0]?.text || '') },
                                    { 
                                        type: 'image', 
                                        image: {
                                            data: attachedImage.data,
                                            mediaType: attachedImage.type
                                        }
                                    }
                                ]
                            };
                        }
                        return msg;
                    });
                }
                
                // 按顺序尝试模型列表
                for (const modelId of modelsToTry) {
                    if (signal.aborted) {
                        throw new Error('任务已取消');
                    }
                    
                    try {
                        const response = await window.designEcho.chat(modelId, msgs, options);
                        if (response?.text) {
                            console.log(`[ChatPanel] ✓ 模型 ${modelId} 调用成功`);
                            return response;
                        }
                        modelErrors.push(`${modelId}: empty response`);
                    } catch (error) {
                        console.warn(`[ChatPanel] 模型 ${modelId} 调用失败:`, error);
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        modelErrors.push(`${modelId}: ${errorMessage}`);
                        // 继续尝试下一个模型
                    }
                }
                
                console.warn('[ChatPanel] ⚠️ 所有模型调用失败');
                const mergedError = Array.from(new Set(modelErrors)).slice(0, 3).join(' | ');
                throw new Error(mergedError || '所有模型调用失败');
            };
            
            // 追踪是否已收到思维内容
            let hasReceivedThinking = false;
            
            // 检查是否已取消
            if (signal.aborted) {
                throw new Error('任务已取消');
            }
            
            // 执行统一 Agent 处理（使用专业思维链回调）
            const result = await processWithUnifiedAgent(agentContext, {
                callModel,
                signal,  // 传递取消信号
                callbacks: {
                    onProgress: (message, percent) => {
                        agentLog('info', `[AI Agent] ${message} (${percent}%)`);
                        // 进度更新只记录日志，不再添加步骤（避免与 onMessage/onThinking 重复）
                    },
                    onMessage: (message) => {
                        // AI 的推理/决策内容（reasoning 字段）
                        // 只有在没有收到真正的 thinking 时才使用这个
                        if (!hasReceivedThinking && message && message.trim()) {
                            agentLog('info', `[AI Agent] 💡 推理: ${message.substring(0, 100)}...`);
                        
                            // 更新思维步骤内容
                            console.log('[ChatPanel] 💡 更新思维步骤 (from reasoning):', { thinkingStepId, message: message.substring(0, 50) });
                        updateStep(thinkingStepId, { 
                            type: 'thinking',
                            content: message,
                            status: 'running'  // 保持 running 状态，让动画继续显示
                        });
                        }
                    },
                    onToolStart: (toolName) => {
                        agentLog('info', `[AI Agent] 执行工具: ${toolName}`);
                        
                        // 标记思维完成（工具开始执行说明思维阶段结束）
                        if (!hasReceivedThinking) {
                            const currentStep = collectedSteps.find(s => s.id === thinkingStepId);
                            if (currentStep && currentStep.status === 'running') {
                                updateStep(thinkingStepId, { status: 'success' });
                            }
                        }
                        
                        // 添加工具调用步骤
                        const toolInfo = getToolDisplayInfo(toolName);
                        addStep({
                            type: 'tool_call',
                            content: toolInfo.description,
                            toolName: toolName,
                            status: 'running'
                        });
                    },
                    onToolComplete: (toolName, toolResult) => {
                        agentLog('info', `[AI Agent] 工具完成: ${toolName}`, toolResult);
                        
                        // 找到对应的工具步骤并更新（保留原始 content，只更新状态）
                        const toolStep = collectedSteps.find(s => s.toolName === toolName && s.status === 'running');
                        if (toolStep) {
                            updateStep(toolStep.id, {
                                status: toolResult?.success !== false ? 'success' : 'error',
                                // 保留原始工具描述，不用 "完成" 覆盖
                                toolResult: toolResult
                            });
                        }
                    },
                    onThinking: (thinking) => {
                        // 模型的真实思维过程（优先级最高）
                        if (thinking && thinking.trim()) {
                            hasReceivedThinking = true;
                            agentLog('info', `[AI Agent] 💡 思维过程: ${thinking.substring(0, 200)}...`);
                        
                            // 更新初始思考步骤
                            console.log('[ChatPanel] 💡 更新思维步骤 (from thinking):', { thinkingStepId, thinking: thinking.substring(0, 50) });
                        updateStep(thinkingStepId, { 
                            type: 'thinking',
                            content: thinking,
                                status: 'running'  // 保持 running，直到工具开始执行
                        });
                        }
                    }
                }
            });
            
            // 计算处理时长
            const processingTime = Date.now() - thinkingStartTime;
            const hasToolExecution = result.toolResults && result.toolResults.length > 0;
            
            // 完成所有剩余的运行中步骤
            collectedSteps.forEach(step => {
                if (step.status === 'running') {
                    updateStep(step.id, { status: 'success' });
                }
            });
            
            // 隐藏实时思维链（将显示在消息中）
            setShowThinking(false);
            
            // 检查是否是用户取消（优先处理）
            if ((result as any).cancelled) {
                console.log('[AI Agent] 用户主动停止');
                
                // 标记运行中的步骤为已停止（不是错误）
                collectedSteps.forEach(step => {
                    if (step.status === 'running') {
                        updateStep(step.id, { status: 'success', content: '已停止' });
                    }
                });
                
                addMessage({
                    role: 'assistant',
                    content: '⏹️ 已停止'
                });
            } else if (result.success) {
                let responseContent = result.message;
                let generatedImage: { data: string; type: string } | undefined;
                
                // 如果有工具结果，格式化显示
                if (hasToolExecution) {
                    // 检查是否有图片生成结果
                    const imageGenResult = result.toolResults!.find(tr => 
                        tr.toolName === 'generateImage' && tr.result?.imageData
                    );
                    if (imageGenResult?.result?.imageData) {
                        generatedImage = {
                            data: imageGenResult.result.imageData,
                            type: 'image/png'
                        };
                        responseContent = imageGenResult.result.message || result.message;
                    }
                }
                
                // 添加消息（包含思维步骤供 ThinkingProcess 组件展示）
                // 只在执行了工具时保存思维步骤（简单问答不需要）
                const hasThinkingContent = collectedSteps.some(
                    step => step.type === 'thinking' && typeof step.content === 'string' && step.content.trim().length > 0
                );
                const stepsToSave = (collectedSteps.length > 0 && (hasToolExecution || hasThinkingContent))
                    ? [...collectedSteps]
                    : undefined;
                
                // 使用打字机效果显示最终回复
                await typewriterMessage(responseContent, {
                    image: generatedImage,
                    thinkingSteps: stepsToSave
                });
                
                console.log(`[AI Agent] ✅ 完成，耗时 ${(processingTime/1000).toFixed(1)}s，思维步骤: ${collectedSteps.length}`);
                } else {
                addMessage({ 
                    role: 'assistant', 
                    content: `⚠️ ${result.message || '处理失败'}${result.error ? `\n\n错误: ${result.error}` : ''}`,
                    thinkingSteps: collectedSteps.length > 0 ? [...collectedSteps] : undefined
                });
            }
            
            // 清理思维步骤状态
            clearThinkingSteps();
            
        } catch (error: any) {
            console.error('[AI Agent] 处理失败:', error);
            // 注意：不再调用 removeLastMessage，因为现在没有添加 loading 消息
            
            // 检查是否是用户取消
            if (error.message === '任务已取消' || signal.aborted) {
                console.log('[AI Agent] 任务已被用户取消');
                
                // 标记所有运行中的步骤为取消
                collectedSteps.forEach(step => {
                    if (step.status === 'running') {
                        updateStep(step.id, { status: 'error', content: '已取消' });
                    }
                });
                
                setShowThinking(false);
                clearThinkingSteps();
            
            addMessage({
                role: 'assistant',
                    content: '⏹️ 任务已停止'
                });
                return;
            }
            
            // 标记所有运行中的步骤为错误
            collectedSteps.forEach(step => {
                if (step.status === 'running') {
                    updateStep(step.id, { status: 'error' });
                }
            });
            
            // 隐藏实时思维链
            setShowThinking(false);
            clearThinkingSteps();
            
            // 构建智能错误消息
            const prefs = useAppStore.getState().modelPreferences;
            const isCloud = prefs?.mode === 'cloud';
            const errText = error.message || '';
            
            let errorMsg = '抱歉，处理时出错了。';
            if (errText.includes('API key') || errText.includes('401') || errText.includes('403')) {
                errorMsg = '⚠️ API 密钥错误，请检查设置。';
            } else if (errText.includes('Google') || errText.includes('gemini')) {
                errorMsg = '⚠️ Google AI 连接失败，请检查 API 密钥。';
            } else if (isCloud && errText.includes('fetch')) {
                errorMsg = '⚠️ 无法连接到云端 AI 服务，请检查网络和 API 密钥。';
            } else if (errText.includes('Ollama') || errText.includes('localhost:11434')) {
                errorMsg = '⚠️ 无法连接到 Ollama，请确保服务已启动。';
            } else if (errText.includes('fetch') && !isCloud) {
                errorMsg = '⚠️ 无法连接到 AI 模型。请确保 Ollama 正在运行，或切换到云端模式。';
            }
            
            addMessage({ 
                role: 'assistant', 
                content: errorMsg
            });
        } finally {
            // 清理 AbortController
            setAbortController(null);
        }
    };

    /**
     * 构建简化版系统提示 - 用于本地小模型
     * 使用新的专业级提示词
     */
    const _buildSimpleSystemPrompt = (): string => {
        const toolsList = AVAILABLE_TOOLS.map(t => `- ${t.name}: ${t.description}`).join('\n');
        return buildSimpleProPrompt(toolsList, isPluginConnected);
    };

    /**
     * 构建 Agent 系统提示 - 包含专业设计知识
     * 使用新的专业级提示词（参考 Lovart/Manus）
     */
    const buildAgentSystemPrompt = (useSimple: boolean = false): string => {
        const toolsList = AVAILABLE_TOOLS.map(t => `- ${t.name}: ${t.description}`).join('\n');
        
        // 根据参数选择使用简化版还是完整版
        if (useSimple) {
            return buildSimpleProPrompt(toolsList, isPluginConnected);
        }
        
        return buildProSystemPrompt(toolsList, isPluginConnected);
    };


    /**
     * 检测用户意图
     */
    type IntentType = 'optimize' | 'analyze' | 'help' | 'chat' | 'switch-document' | 'select-layer' | 'list-documents';
    
    const _detectIntent = (text: string): { type: IntentType; params?: any } => {
        const lower = text.toLowerCase();
        
        // 切换文档相关
        const switchDocPatterns = [
            /切换.*?(?:到|去)\s*(.+?)(?:的)?(?:文档|文件|画布)$/,
            /切换.*?(?:到|去)\s*(.+?)$/,  // 更宽松的匹配：切换到xxx
            /打开(?:那个|另一个)?(.+?)(?:的)?(?:文档|文件)/,
            /换到(.+?)(?:的)?(?:文档|文件)?$/,
            /去(.+?)(?:的)?(?:文档|文件)/,
            /switch\s+to\s+(.+)/i,
        ];
        for (const pattern of switchDocPatterns) {
            const match = text.match(pattern);
            if (match) {
                // 清理捕获的名称：去除末尾的"的"、空格、"文档"等
                let docName = match[1].trim()
                    .replace(/的$/, '')
                    .replace(/文档$/, '')
                    .replace(/文件$/, '')
                    .trim();
                if (docName && docName.length >= 1) {
                    return { type: 'switch-document', params: { documentName: docName } };
                }
            }
        }
        
        // 选择图层相关
        const selectLayerPatterns = [
            /选[中择]?(?:那个)?(.+?)(?:的)?(?:图层|layer)/i,
            /切换到(.+?)(?:的)?图层/,
            /去(.+?)(?:的)?图层/,
            /select\s+(.+?)\s*layer/i,
            /选[中择]?名.*?(?:为|叫|是)(.+?)(?:的)?(?:图层)?/,
        ];
        for (const pattern of selectLayerPatterns) {
            const match = text.match(pattern);
            if (match) {
                // 清理捕获的名称：去除末尾的"的"、空格等
                let layerName = match[1].trim().replace(/的$/, '').trim();
                if (layerName) {
                    return { type: 'select-layer', params: { layerName: layerName } };
                }
            }
        }
        
        // 列出文档相关
        if (/(?:列出|显示|查看|有哪些|所有).*?(?:文档|文件|画布)/.test(lower) ||
            /(?:打开.*?几个|多少个).*?(?:文档|文件)/.test(lower) ||
            /list.*?document/i.test(text)) {
            return { type: 'list-documents' };
        }
        
        // 优化相关
        if (lower.includes('优化') || lower.includes('文案') || lower.includes('改写') || 
            lower.includes('rewrite') || lower.includes('optimize')) {
            return { type: 'optimize' };
        }
        
        // 分析相关
        if (lower.includes('分析') || lower.includes('排版') || lower.includes('布局') ||
            lower.includes('analyze') || lower.includes('layout')) {
            return { type: 'analyze' };
        }
        
        // 帮助
        if (lower.includes('帮助') || lower.includes('help') || lower.includes('怎么用') ||
            lower.includes('功能') || lower.includes('能做什么')) {
            return { type: 'help' };
        }
        
        // 默认对话
        return { type: 'chat' };
    };

    /**
     * 获取 Photoshop 上下文信息
     */
    const _getPhotoshopContext = async (): Promise<string> => {
        if (!isPluginConnected) {
            return '【Photoshop 状态】未连接';
        }

        const contextParts: string[] = [];

        try {
            // 获取所有打开的文档
            const docList = await window.designEcho.sendToPlugin('listDocuments', { includeDetails: false });
            if (docList && docList.success && docList.count > 0) {
                const docs = docList.documents.map((d: any) => 
                    d.isActive ? `${d.name} (当前)` : d.name
                ).join('、');
                contextParts.push(`【打开的文档】${docList.count} 个: ${docs}`);
            }
        } catch (e) {
            // 忽略文档列表获取失败
        }

        try {
            // 获取当前文档信息
            const docInfo = await window.designEcho.sendToPlugin('getDocumentInfo', {});
            if (docInfo && docInfo.success && docInfo.document) {
                contextParts.push(`【当前文档】${docInfo.document.name} (${docInfo.document.width}×${docInfo.document.height}px)`);
                if (docInfo.document.layerCount) {
                    contextParts.push(`【图层数量】${docInfo.document.layerCount} 个图层`);
                }
            }
        } catch (e) {
            contextParts.push('【当前文档】无法获取文档信息');
        }

        try {
            // 获取诊断状态 - 包含选中图层的详细信息
            const diagnosis = await window.designEcho.sendToPlugin('diagnoseState', { verbose: false });
            if (diagnosis && diagnosis.success) {
                if (diagnosis.selectedLayers && diagnosis.selectedLayers.length > 0) {
                    const layerInfo = diagnosis.selectedLayers.map((l: any) => 
                        `${l.name} (ID: ${l.id}, 类型: ${l.type})`
                    ).join('、');
                    contextParts.push(`【选中图层】${layerInfo}`);
                } else {
                    contextParts.push('【选中图层】无（请在 PS 中选择图层）');
                }
            }
        } catch (e) {
            // 忽略诊断失败
        }

        try {
            // 获取选中图层的文本内容（如果是文本图层）
            const textContent = await window.designEcho.sendToPlugin('getTextContent', {});
            if (textContent && textContent.success) {
                contextParts.push(`【选中文本内容】"${textContent.content}"`);
            }
        } catch (e) {
            // 忽略，可能不是文本图层
        }

        try {
            // 获取文本样式
            const textStyle = await window.designEcho.sendToPlugin('getTextStyle', {});
            if (textStyle && textStyle.success) {
                const styleInfo: string[] = [];
                if (textStyle.fontName) styleInfo.push(`字体: ${textStyle.fontName}`);
                if (textStyle.fontSize) styleInfo.push(`字号: ${textStyle.fontSize}pt`);
                if (textStyle.fontWeight) styleInfo.push(`字重: ${textStyle.fontWeight}`);
                if (textStyle.color) styleInfo.push(`颜色: ${textStyle.color}`);
                if (styleInfo.length > 0) {
                    contextParts.push(`【文本样式】${styleInfo.join('，')}`);
                }
            }
        } catch (e) {
            // 忽略样式获取失败
        }

        return contextParts.length > 0 ? contextParts.join('\n') : '【Photoshop 状态】已连接，但无法获取详细信息';
    };

    /**
     * 判断是否需要获取 Photoshop 上下文（预留）
     */
    const _needsPhotoshopContext = (input: string): boolean => {
        const patterns = [
            /选.*?(图层|文字|文本|内容|什么|哪)/,
            /当前.*?(图层|文档|画布|选择|选中|状态)/,
            /哪个.*?(图层|文字)/,
            /(图层|文档|画布).*?(信息|状态|详情|是什么)/,
            /现在.*?(选|是)/,
            /(看|查|检查|获取).*?(图层|文档|选中)/,
            /photoshop/i,
            /ps.*?(状态|信息)/i,
        ];
        
        for (const pattern of patterns) {
            if (pattern.test(input)) {
                return true;
            }
        }
        return false;
    };

    /**
     * 列出所有打开的文档（预留）
     */
    const _handleListDocuments = async () => {
        if (!isPluginConnected) {
            addMessage({
                role: 'assistant',
                content: '⚠️ 请先连接 Photoshop 插件。'
            });
            return;
        }

        try {
            const result = await window.designEcho.sendToPlugin('listDocuments', { includeDetails: true });
            
            if (result.success) {
                if (result.count === 0) {
                    addMessage({
                        role: 'assistant',
                        content: '📂 当前没有打开的文档。\n\n请在 Photoshop 中打开一个或多个文档后再试。'
                    });
                } else {
                    const docList = result.documents.map((d: any) => {
                        const activeTag = d.isActive ? ' ✓ (当前)' : '';
                        const details = d.width ? ` - ${d.width}×${d.height}px, ${d.layerCount || 0} 个图层` : '';
                        return `- **${d.name}**${activeTag}${details}`;
                    }).join('\n');
                    
                    addMessage({
                        role: 'assistant',
                        content: `📂 **打开的文档** (共 ${result.count} 个)\n\n${docList}\n\n💡 提示：说"切换到 xxx 文档"可以快速切换`
                    });
                }
            } else {
                addMessage({
                    role: 'assistant',
                    content: `❌ 获取文档列表失败：${result.error}`
                });
            }
        } catch (e: any) {
            addMessage({
                role: 'assistant',
                content: `❌ 获取文档列表时出错：${e.message}`
            });
        }
    };

    // 旧的 handleNaturalChat 函数已废弃，由 handleUnifiedAgent 替代

    // [已移除] handleQuickTaskExecute 函数 - 快捷任务模板功能
    // [已移除] 硬编码快速操作按钮相关函数
    // 用户应通过自然语言与 Agent 交互实现：优化文案、分析排版、智能文案等功能
    // [已移除] 原快速操作函数 handleQuickAction, handleSmartCopywriting, formatQuickActionResult
    // 这些功能现在应该通过与 Agent 自然语言交互来实现
    /**
     * 工具测试 - 验证 UXP 插件连接
     */
    // [已移除] handleQuickAction, handleSmartCopywriting, formatQuickActionResult
    // 这些功能现在通过 Agent 自然语言交互实现

    /**
     * 工具测试 - 验证 UXP 插件连接
     */
    const handleToolTest = async () => {
        if (!isPluginConnected) {
            addMessage({
                role: 'assistant',
                content: '⚠️ 请先连接 Photoshop 插件后再进行工具测试。'
            });
            return;
        }

        setLoading(true);
        addMessage({
            role: 'assistant',
            content: '🧪 开始工具验证测试...'
        });

        const results: string[] = [];
        const testTool = async (name: string, method: string, params: any = {}): Promise<boolean> => {
            try {
                const result = await window.designEcho.sendToPlugin(method, params);
                if (result.success !== false) {
                    results.push(`✅ ${name}: 成功`);
                    return true;
                } else {
                    results.push(`❌ ${name}: ${result.error || '失败'}`);
                    return false;
                }
            } catch (error: any) {
                results.push(`❌ ${name}: ${error.message}`);
                return false;
            }
        };

        try {
            // 1. 测试文档信息获取
            await testTool('获取文档信息', 'getDocumentInfo');

            // 2. 测试获取所有文本图层
            await testTool('获取文本图层', 'getAllTextLayers');

            // 3. 测试获取选中图层文本
            await testTool('获取选中文本', 'getTextContent');

            // 4. 测试获取文本样式
            await testTool('获取文本样式', 'getTextStyle');

            // 5. 测试获取历史记录
            await testTool('获取历史记录', 'getHistoryInfo');

            // 6. 测试画布截图
            await testTool('画布截图', 'getDocumentSnapshot', { maxWidth: 200, maxHeight: 200 });

            // 统计结果
            const passed = results.filter(r => r.startsWith('✅')).length;
            const failed = results.filter(r => r.startsWith('❌')).length;

            let summary = `\n\n📊 **测试结果：** ${passed}/${results.length} 通过\n\n`;
            summary += results.join('\n');

            if (failed > 0) {
                summary += '\n\n💡 **提示：** 某些测试失败可能是因为没有选中图层或没有打开文档。请确保：\n1. 在 Photoshop 中打开了一个文档\n2. 选中了一个文本图层（用于文本相关测试）';
            } else {
                summary += '\n\n🎉 所有工具测试通过！';
            }

            addMessage({
                role: 'assistant',
                content: summary
            });

        } catch (error: any) {
            addMessage({
                role: 'assistant',
                content: `❌ 测试过程中发生错误：${error.message}`
            });
        } finally {
            setLoading(false);
        }
    };

    const handleDesktopDebug = async (rawCommand: string) => {
        if (!isPluginConnected) {
            addMessage({
                role: 'assistant',
                content: '⚠️ 桌面端联调需要先连接 Photoshop 插件。'
            });
            return;
        }

        setLoading(true);
        addMessage({
            role: 'assistant',
            content: '🧪 开始桌面端联调（主图/详情页）...'
        });

        try {
            const toolsResp = await window.designEcho.invoke('mcp:tools:list');
            const tools = toolsResp?.tools || toolsResp?.result?.tools || [];
            const toolNames = new Set((tools || []).map((t: any) => t?.name).filter(Boolean));
            const requiredTools = ['getSubjectBounds', 'smartLayout', 'quickExport', 'parseDetailPageTemplate', 'autoFitDetailPageContent', 'exportSlices'];
            const missingTools = requiredTools.filter((name) => !toolNames.has(name));

            const scenarios = rawCommand.toLowerCase().includes('quick')
                ? [
                    '请基于当前模板生成一版主图，突出价格和卖点',
                    '请优化当前详情页文案并自动适配换行'
                ]
                : [
                    '请基于当前模板生成一版主图，突出价格和卖点',
                    '请优化当前详情页文案并自动适配换行',
                    '把这组商品图应用到详情页模板并导出切片',
                    '再来一轮主图优化，输出800尺寸版本'
                ];

            const routeLines: string[] = [];
            for (const inputText of scenarios) {
                const decision = debugInferDecisionFromText(inputText);
                const target = decision.type === 'skill_execution'
                    ? `${decision.skillId}`
                    : decision.type === 'tool_call'
                        ? `tool_call(${(decision.toolCalls || []).map((t) => t.toolName).join(',')})`
                        : decision.type;
                routeLines.push(`- ${inputText}\n  → ${target}`);
            }

            const probeCalls = [
                { name: 'diagnoseState', args: { verbose: false } },
                { name: 'getSubjectBounds', args: {} },
                { name: 'parseDetailPageTemplate', args: { strict: false } }
            ];
            const probeLines: string[] = [];
            for (const probe of probeCalls) {
                try {
                    const result = await window.designEcho.invoke('mcp:tools:call', {
                        name: probe.name,
                        arguments: probe.args
                    });
                    const failed = !!(result?.error || result?.isError === true || result?.success === false);
                    probeLines.push(`${failed ? '❌' : '✅'} ${probe.name}`);
                } catch (error: any) {
                    probeLines.push(`❌ ${probe.name}: ${error?.message || '调用异常'}`);
                }
            }

            let report = `📌 **桌面端联调报告（主图/详情页）**\n\n`;
            report += `- MCP 工具总数：${tools.length}\n`;
            report += `- 关键工具完整性：${missingTools.length === 0 ? '✅ 完整' : `❌ 缺失 ${missingTools.join(', ')}`}\n\n`;
            report += `**分流结果**\n${routeLines.join('\n')}\n\n`;
            report += `**链路探针**\n${probeLines.join('\n')}\n\n`;
            report += `💡 说明：此命令在桌面端会话内执行，不会占用/挤掉 UXP 的唯一 WebSocket 连接。`;

            addMessage({
                role: 'assistant',
                content: report
            });
        } catch (error: any) {
            addMessage({
                role: 'assistant',
                content: `❌ 桌面端联调失败：${error?.message || '未知错误'}`
            });
        } finally {
            setLoading(false);
        }
    };

    const handleCommand = (command: string) => {
        const cmd = command.toLowerCase().trim();

        if (cmd.startsWith('/desktop-debug')) {
            void handleDesktopDebug(command);
            return;
        }

        switch (cmd) {
            case '/optimize':
                handleOptimize();
                break;
            
            case '/help':
                addMessage({
                    role: 'assistant',
                    content: `🔧 **可用命令：**

- \`/optimize\` - 优化当前选中的文案
- \`/analyze\` - 分析当前文档的排版
- \`/status\` - 查看连接状态
- \`/test\` - 测试 UXP 工具连接
- \`/clear\` - 清空对话历史
- \`/help\` - 显示此帮助信息

**调试命令：**
- \`/debug\` - 开启调试模式（显示详细工具日志）
- \`/debug off\` - 关闭调试模式
- \`/debug report\` - 查看最近会话的调试报告
- \`/desktop-debug\` - 在桌面端执行主图/详情页联调
- \`/desktop-debug quick\` - 执行双场景快速联调

**快捷操作：**
使用底部工具栏可以快速执行常用操作。`
                });
                break;
            
            case '/test':
                handleToolTest();
                break;

            case '/status':
                addMessage({
                    role: 'assistant',
                    content: `📊 **当前状态：**

- Photoshop 连接：${isPluginConnected ? '✅ 已连接' : '❌ 未连接'}
- Agent 版本：v1.0.0

${!isPluginConnected ? '\n⚠️ 请在 Photoshop 中加载 DesignEcho 插件以建立连接。' : ''}`
                });
                break;

            case '/clear':
                useAppStore.getState().clearMessages();
                addMessage({
                    role: 'assistant',
                    content: '🧹 对话历史已清空。'
                });
                break;

            case '/debug':
            case '/debug on':
                {
                    const { toolLogger } = require('../services/tool-logger');
                    toolLogger.setDebugMode(true);
                    addMessage({
                        role: 'assistant',
                        content: `🔍 **调试模式已开启**

接下来的工具调用将显示详细日志：
- 工具名称和参数
- 执行耗时
- 成功/失败状态
- 错误详情

使用 \`/debug off\` 关闭调试模式。
使用 \`/debug report\` 查看上次会话的调试报告。`
                    });
                }
                break;

            case '/debug off':
                {
                    const { toolLogger } = require('../services/tool-logger');
                    toolLogger.setDebugMode(false);
                    addMessage({
                        role: 'assistant',
                        content: '🔕 调试模式已关闭。'
                    });
                }
                break;

            case '/debug report':
                {
                    const { toolLogger } = require('../services/tool-logger');
                    const report = toolLogger.generateDebugReport();
                    addMessage({
                        role: 'assistant',
                        content: report
                    });
                }
                break;

            default:
                addMessage({
                    role: 'assistant',
                    content: `❓ 未知命令：\`${command}\`\n\n输入 \`/help\` 查看可用命令。`
                });
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="chat-panel">
            {/* 消息列表 */}
            <div className="messages-container">
                {messages.length === 0 ? (
                    <div className="welcome-message">
                        <div className="welcome-icon">🎨</div>
                        <h2>DesignEcho</h2>
                        <p>专业电商设计智能体 · 一句话完成设计任务</p>
                        
                        {/* [已移除] 快捷任务面板 - 使用自然语言交互代替 */}
                        
                    </div>
                ) : (
                    messages.map((msg) => {
                        if (editingMessageId === msg.id) {
                            return (
                                <div key={msg.id} className={`message-wrapper message ${msg.role}`}>
                                    <div className="message-avatar">👤</div>
                                    <div className="message-content">
                                        <div className="message-edit-container">
                                            <textarea
                                                className="message-edit-input"
                                                value={editingContent}
                                                onChange={(e) => setEditingContent(e.target.value)}
                                                rows={3}
                                                autoFocus
                                                spellCheck={false}
                                            />
                                            <div className="message-edit-actions">
                                                <button 
                                                    className="edit-cancel-btn"
                                                    onClick={handleCancelEdit}
                                                >
                                                    取消
                                                </button>
                                                <button 
                                                    className="edit-confirm-btn"
                                                    onClick={handleConfirmEdit}
                                                    disabled={!editingContent.trim()}
                                                >
                                                    保存并重新发送
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        const multimodalMsg = convertLegacyMessage(msg);
                        return (
                            <div key={msg.id} className="message-wrapper">
                                <MessageRenderer 
                                    message={multimodalMsg}
                                    isStreaming={msg.isThinking}
                                    onAction={handleMessageAction}
                                    showEditButton={msg.role === 'user' && !isLoading}
                                    onEdit={() => handleStartEdit(msg.id, msg.content)}
                                />
                                
                                {/* 保留旧版特殊组件：建议列表、布局修复列表 */}
                                {msg.suggestions && (
                                    <div className="message-extra-content">
                                        <SuggestionList 
                                            suggestions={msg.suggestions} 
                                            onApply={handleApplySuggestion}
                                        />
                                    </div>
                                )}
                                
                                {msg.layoutResult && (
                                    <div className="message-extra-content">
                                        <LayoutFixList
                                            result={msg.layoutResult}
                                            onApplyFix={handleApplyLayoutFix}
                                            onApplyAll={handleApplyAllLayoutFixes}
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
                
                {/* 实时思维链显示（加载过程中） */}
                {isLoading && showThinking && (
                    <div className="message assistant">
                        <div className="message-avatar">🤖</div>
                        <div className="message-content">
                                <ThinkingProcess 
                                    steps={thinkingSteps}
                                    isExpanded={true}
                                    className="live-thinking"
                                />
                        </div>
                    </div>
                )}
                
                {/* 执行状态指示器（非思维链模式）*/}
                {isLoading && showExecution && executionSteps.length > 0 && !showThinking && (
                    <div className="message assistant">
                        <div className="message-avatar">🤖</div>
                        <div className="message-content">
                                <ExecutionStatus
                                    steps={executionSteps}
                                    isVisible={showExecution}
                                />
                        </div>
                    </div>
                )}
                
                <div ref={messagesEndRef} />
            </div>

            {/* 输入区域 */}
            <div className="input-container">
                {showUpload && (
                    <div className="upload-panel">
                        <div className="upload-header">
                            <span>上传参考图</span>
                            <button className="close-upload" onClick={() => setShowUpload(false)}>×</button>
                        </div>
                        <ReferenceUpload onUpload={handleImageUpload} isLoading={isLoading} />
                    </div>
                )}
                
                {showReplicator && (
                    <div className="replicator-panel">
                        <ReferenceReplicator 
                            isPluginConnected={isPluginConnected} 
                            onClose={() => setShowReplicator(false)}
                        />
                    </div>
                )}
                
                <div className="input-wrapper">
                    {/* 附件按钮 - 点击展开菜单 */}
                    <div className="attach-menu-container">
                    <button 
                            className={`attach-button ${showAttachMenu || showImageGen ? 'active' : ''}`}
                            onClick={() => setShowAttachMenu(!showAttachMenu)}
                            title="添加附件"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="12" y1="5" x2="12" y2="19"></line>
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                    </button>
                    
                        {/* 附件菜单 */}
                        {showAttachMenu && (
                            <div className="attach-menu">
                                <button
                                    className="attach-menu-item"
                                    onClick={() => captureScreenshotForChat('agent')}
                                >
                                    <span className="menu-icon">🪟</span>
                                    <span>截图 Agent 窗口</span>
                                </button>
                                <button
                                    className="attach-menu-item"
                                    onClick={() => captureScreenshotForChat('desktop')}
                                >
                                    <span className="menu-icon">🖥️</span>
                                    <span>截图桌面(含PS)</span>
                                </button>
                    <button 
                                    className="attach-menu-item"
                                    onClick={() => {
                                        // 触发文件上传
                                        const fileInput = document.createElement('input');
                                        fileInput.type = 'file';
                                        fileInput.accept = 'image/*';
                                        fileInput.onchange = async (e) => {
                                            const file = (e.target as HTMLInputElement).files?.[0];
                                            if (file) {
                                                const reader = new FileReader();
                                                reader.onload = () => {
                                                    const base64 = (reader.result as string).split(',')[1];
                                                    setPastedImage({ data: base64, type: file.type });
                                                    setShowAttachMenu(false);
                                                };
                                                reader.readAsDataURL(file);
                                            }
                                        };
                                        fileInput.click();
                                    }}
                                >
                                    <span className="menu-icon">📷</span>
                                    <span>上传图片</span>
                    </button>
                                <button 
                                    className={`attach-menu-item ${showImageGen ? 'selected' : ''}`}
                                    onClick={() => {
                                        setShowImageGen(!showImageGen);
                                        setShowAttachMenu(false);
                                    }}
                                >
                                    <span className="menu-icon">🎨</span>
                                    <span>AI 生成图片</span>
                                    {showImageGen && <span className="check-icon">✓</span>}
                                </button>
                            </div>
                        )}
                    </div>
                    
                    <div 
                        ref={inputAreaRef}
                        className={`input-area ${isDraggingImage ? 'dragging' : ''} ${showImageGen ? 'gen-mode' : ''}`}
                        onDragEnter={handleDragEnter}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                    >
                        {/* 拖拽指示器 */}
                        {isDraggingImage && (
                            <div className="drag-overlay">
                                <div className="drag-content">
                                    <span className="drag-icon">📷</span>
                                    <span className="drag-text">放开以添加图片</span>
                                </div>
                            </div>
                        )}
                        
                        {/* 图片预览 - 简化样式 */}
                        {(pastedImage || referenceImage) && (
                            <div className="image-preview-compact">
                                <img 
                                    src={pastedImage 
                                        ? `data:${pastedImage.type};base64,${pastedImage.data}` 
                                        : `data:image/jpeg;base64,${referenceImage}`
                                    } 
                                    alt="Preview" 
                                />
                                    <button 
                                    className="remove-image-btn"
                                    onClick={() => {
                                        setPastedImage(null);
                                        setReferenceImage(null);
                                    }}
                                        title="移除图片"
                                >×</button>
                            </div>
                        )}
                        
                        <textarea
                            ref={textareaRef}
                            className="chat-input"
                            placeholder={showImageGen ? "描述你想要生成的图片..." : "输入消息..."}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                            rows={1}
                            spellCheck={false}
                            autoComplete="off"
                            autoCorrect="off"
                        />
                        
                        {/* 生成模式标签 */}
                        {showImageGen && (
                            <div className="gen-mode-tag">
                                <span>🎨 FLUX</span>
                                <button onClick={() => setShowImageGen(false)}>×</button>
                            </div>
                        )}
                    </div>

                    {isLoading ? (
                        <button 
                            className="send-button stop-button"
                            onClick={() => {
                                console.log('[ChatPanel] 用户点击停止按钮');
                                stopGeneration();
                                // 不在这里添加消息，让 handleUnifiedAgent 的 catch 块统一处理
                            }}
                            title="停止生成"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <rect x="6" y="6" width="12" height="12" rx="2" />
                            </svg>
                        </button>
                    ) : (
                        <button 
                            className="send-button"
                            onClick={handleSend}
                            disabled={!input.trim() && !pastedImage}
                            title={pastedImage ? "发送图片和消息" : "发送消息"}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="22" y1="2" x2="11" y2="13"></line>
                                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            <style>{`
                .chat-panel {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }

                .messages-container {
                    flex: 1;
                    overflow-y: auto;
                    padding: 24px;
                }

                /* 多模态消息包装器 */
                .message-wrapper {
                    position: relative;
                    margin-bottom: 16px;
                }

                .message-wrapper:last-child {
                    margin-bottom: 0;
                }

                .message-extra-content {
                    margin-left: 48px;
                    margin-top: 8px;
                }

                
                /* 编辑模式下的消息容器 */
                .message-wrapper.message {
                    display: flex;
                    gap: 12px;
                    padding: 16px 24px;
                }
                
                .message-wrapper.message.user {
                    flex-direction: row-reverse;
                }
                
                .message-wrapper.message .message-content {
                    flex: 1;
                    max-width: calc(100% - 60px);
                }
                
                .message-wrapper.message .message-avatar {
                    width: 36px;
                    height: 36px;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 18px;
                    flex-shrink: 0;
                    background: var(--de-avatar-bg, rgba(255, 255, 255, 0.05));
                }

                /* 欢迎信息 */
                .welcome-message {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    text-align: center;
                    animation: fadeIn 0.5s ease-out;
                }

                .welcome-icon {
                    font-size: 64px;
                    margin-bottom: 16px;
                }

                .welcome-message h2 {
                    font-family: 'Space Grotesk', sans-serif;
                    font-size: 28px;
                    font-weight: 600;
                    margin-bottom: 8px;
                    background: linear-gradient(135deg, #fff 0%, #0066ff 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }

                .welcome-message p {
                    color: var(--de-text-secondary);
                    margin-bottom: 32px;
                }

                .welcome-tips {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .tip-card {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px 20px;
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 8px;
                    font-size: 14px;
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .tip-card:hover {
                    background: var(--de-bg-light);
                    border-color: var(--de-primary);
                }

                .tip-icon {
                    font-size: 20px;
                }

                /* 消息 */
                .message {
                    display: flex;
                    gap: 12px;
                    margin-bottom: 20px;
                    animation: slideUp 0.3s ease-out;
                }

                .message.user {
                    flex-direction: row-reverse;
                }

                .message-avatar {
                    width: 36px;
                    height: 36px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--de-bg-light);
                    border-radius: 50%;
                    font-size: 18px;
                    flex-shrink: 0;
                }

                .message.user .message-avatar {
                    background: var(--de-primary);
                }

                .message-content {
                    max-width: 70%;
                    display: flex;
                    flex-direction: column;
                }

                .message.user .message-content {
                    align-items: flex-end;
                }

                .message-text {
                    padding: 12px 16px;
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 12px;
                    font-size: 14px;
                    line-height: 1.6;
                    white-space: pre-wrap;
                }

                .message.user .message-text {
                    background: var(--de-user-bubble-bg, var(--de-primary));
                    border-color: var(--de-user-bubble-bg, var(--de-primary));
                    color: var(--de-user-bubble-text, white);
                }

                .message-text strong {
                    color: var(--de-primary);
                    font-weight: 600;
                }

                .message.user .message-text strong {
                    color: #fff;
                }

                .message-text code {
                    background: rgba(0, 102, 255, 0.2);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 13px;
                }

                .message-text p {
                    margin: 0 0 8px 0;
                }

                .message-text p:last-child {
                    margin-bottom: 0;
                }

                /* 执行结果卡片 */
                .result-card {
                    border-radius: 12px;
                    overflow: hidden;
                    background: var(--de-bg);
                }

                .result-card.success {
                    border: 1px solid rgba(16, 185, 129, 0.4);
                    background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%);
                }

                .result-card.warning {
                    border: 1px solid rgba(245, 158, 11, 0.4);
                    background: linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(245, 158, 11, 0.02) 100%);
                }

                .result-header {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 14px 16px;
                    border-bottom: 1px solid var(--de-border);
                }

                .result-icon {
                    width: 24px;
                    height: 24px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 50%;
                    font-size: 14px;
                    font-weight: bold;
                }

                .result-card.success .result-icon {
                    background: rgba(16, 185, 129, 0.2);
                    color: #10b981;
                }

                .result-card.warning .result-icon {
                    background: rgba(245, 158, 11, 0.2);
                    color: #f59e0b;
                }

                .result-title {
                    font-size: 15px;
                    font-weight: 600;
                    color: var(--de-text);
                }

                .result-details {
                    padding: 12px 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .detail-row {
                    display: flex;
                    align-items: baseline;
                    gap: 8px;
                    font-size: 13px;
                }

                .detail-label {
                    color: var(--de-text-secondary);
                    flex-shrink: 0;
                }

                .detail-value {
                    color: var(--de-text);
                    font-weight: 500;
                }

                .result-list {
                    padding: 12px 16px;
                    border-top: 1px solid rgba(255, 255, 255, 0.05);
                    background: rgba(0, 0, 0, 0.15);
                }

                .list-header {
                    font-size: 12px;
                    color: var(--de-text-secondary);
                    margin-bottom: 10px;
                    font-weight: 500;
                }

                .list-items {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }

                .list-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 10px;
                    background: rgba(255, 255, 255, 0.03);
                    border-radius: 6px;
                    font-size: 12px;
                }

                .file-icon {
                    font-size: 14px;
                    opacity: 0.7;
                }

                .file-name {
                    color: var(--de-text);
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 11px;
                }

                .list-more {
                    font-size: 11px;
                    color: var(--de-text-secondary);
                    padding: 6px 10px;
                    text-align: center;
                }

                .message-footer {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-top: 8px;
                }

                .message-time {
                    font-size: 11px;
                    color: var(--de-text-secondary);
                }

                /* 消息编辑按钮 */
                .message-edit-btn {
                    opacity: 0;
                    background: none;
                    border: none;
                    cursor: pointer;
                    font-size: 12px;
                    padding: 2px 6px;
                    border-radius: 4px;
                    transition: all 0.2s ease;
                }

                .message:hover .message-edit-btn {
                    opacity: 0.6;
                }

                .message-edit-btn:hover {
                    opacity: 1 !important;
                    background: rgba(99, 102, 241, 0.2);
                }

                /* 消息编辑容器 */
                .message-edit-container {
                    width: 100%;
                }

                .message-edit-input {
                    width: 100%;
                    min-height: 60px;
                    padding: 12px;
                    background: rgba(0, 0, 0, 0.3);
                    border: 1px solid var(--de-primary);
                    border-radius: 8px;
                    color: var(--de-text);
                    font-size: 14px;
                    font-family: inherit;
                    resize: vertical;
                    outline: none;
                }

                .message-edit-input:focus {
                    border-color: var(--de-primary);
                    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
                }

                .message-edit-actions {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                    margin-top: 8px;
                }

                .edit-cancel-btn {
                    padding: 6px 12px;
                    background: var(--de-hover-bg, rgba(0, 0, 0, 0.05));
                    border: 1px solid var(--de-border);
                    border-radius: 6px;
                    color: var(--de-text-secondary);
                    font-size: 13px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .edit-cancel-btn:hover {
                    background: var(--de-bg-light);
                    color: var(--de-text);
                }

                .edit-confirm-btn {
                    padding: 6px 16px;
                    background: var(--de-primary);
                    border: none;
                    border-radius: 6px;
                    color: white;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .edit-confirm-btn:hover:not(:disabled) {
                    background: var(--de-primary-dark);
                    transform: translateY(-1px);
                }

                .edit-confirm-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                /* 上传面板 */
                .upload-panel {
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 12px;
                    padding: 12px;
                    margin-bottom: 12px;
                    animation: slideUp 0.2s ease-out;
                }

                .upload-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--de-text);
                }

                .close-upload {
                    background: none;
                    border: none;
                    color: var(--de-text-secondary);
                    font-size: 18px;
                    cursor: pointer;
                    padding: 4px;
                }

                .close-upload:hover {
                    color: var(--de-text);
                }

                /* 复刻面板 */
                .replicator-panel {
                    margin-bottom: 12px;
                    animation: slideUp 0.2s ease-out;
                }

                /* [已移除] 快速操作按钮样式 */

                .qa-icon {
                    font-size: 14px;
                }

                .qa-label {
                    font-weight: 500;
                }

                /* 输入区域 */
                .input-container {
                    padding: 16px 24px 24px;
                    background: linear-gradient(180deg, transparent 0%, var(--de-bg) 20%);
                }

                .input-wrapper {
                    display: flex;
                    gap: 8px;
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 24px;
                    padding: 8px 12px;
                    align-items: flex-end;
                }
                
                .input-area {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    min-width: 0;
                }
                
                .input-area.gen-mode {
                    /* 生成模式时的微妙提示 */
                }

                /* 附件按钮 - 简洁的 + 号 */
                .attach-menu-container {
                    position: relative;
                    align-self: center;  /* 垂直居中对齐 */
                }

                .attach-button {
                    background: none;
                    border: none;
                    cursor: pointer;
                    padding: 6px;
                    border-radius: 50%;
                    transition: all 0.15s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 32px;
                    height: 32px;
                    color: var(--de-text-secondary);
                }

                .attach-button:hover {
                    background: var(--de-hover-bg, rgba(0, 0, 0, 0.05));
                    color: var(--de-text);
                }

                .attach-button.active {
                    color: var(--de-primary);
                    background: rgba(var(--de-primary-rgb), 0.1);
                    transform: rotate(45deg);
                }

                /* 附件菜单 */
                .attach-menu {
                    position: absolute;
                    bottom: 100%;
                    left: 0;
                    margin-bottom: 8px;
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 12px;
                    padding: 6px;
                    min-width: 160px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                    z-index: 100;
                }

                .attach-menu-item {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    width: 100%;
                    padding: 10px 12px;
                    border: none;
                    background: none;
                    color: var(--de-text);
                    font-size: 13px;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: background 0.15s;
                }

                .attach-menu-item:hover {
                    background: rgba(255, 255, 255, 0.05);
                }

                .attach-menu-item.selected {
                    background: rgba(var(--de-primary-rgb), 0.1);
                    color: var(--de-primary);
                }

                .attach-menu-item .menu-icon {
                    font-size: 16px;
                }

                .attach-menu-item .check-icon {
                    margin-left: auto;
                    color: var(--de-primary);
                }

                /* 简洁的图片预览 */
                .image-preview-compact {
                    position: relative;
                    display: inline-block;
                    width: 48px;
                    height: 48px;
                    border-radius: 8px;
                    overflow: hidden;
                    flex-shrink: 0;
                }

                .image-preview-compact img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }

                .remove-image-btn {
                    position: absolute;
                    top: -4px;
                    right: -4px;
                    width: 18px;
                    height: 18px;
                    border-radius: 50%;
                    background: var(--de-bg);
                    border: 1px solid var(--de-border);
                    color: var(--de-text-secondary);
                    font-size: 12px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    line-height: 1;
                }

                .remove-image-btn:hover {
                    background: var(--de-danger);
                    color: white;
                    border-color: var(--de-danger);
                }

                /* 生成模式标签 */
                .gen-mode-tag {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 4px 8px;
                    background: rgba(var(--de-primary-rgb), 0.1);
                    border-radius: 12px;
                    font-size: 11px;
                    color: var(--de-primary);
                    align-self: flex-start;
                }

                .gen-mode-tag button {
                    background: none;
                    border: none;
                    color: var(--de-primary);
                    cursor: pointer;
                    padding: 0;
                    font-size: 14px;
                    line-height: 1;
                    opacity: 0.7;
                }

                .gen-mode-tag button:hover {
                    opacity: 1;
                }

                .gen-spinner {
                    width: 16px;
                    height: 16px;
                    border: 2px solid var(--de-border);
                    border-top-color: var(--de-primary);
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }

                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                    cursor: pointer;
                    outline: none;
                    max-width: 180px;
                }

                .model-quick-select:focus {
                    border-color: var(--de-primary);
                }

                .mode-close {
                    background: none;
                    border: none;
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    font-size: 16px;
                    padding: 2px 6px;
                    line-height: 1;
                    border-radius: 4px;
                    transition: all 0.15s;
                }

                .mode-close:hover {
                    background: rgba(var(--de-danger-rgb, 239, 68, 68), 0.1);
                    color: var(--de-danger, #ef4444);
                }

                .chat-input {
                    width: 100%;
                    background: transparent;
                    border: none;
                    color: var(--de-text);
                    font-size: 14px;
                    line-height: 1.5;
                    resize: none;
                    outline: none;
                    min-height: 24px;
                    max-height: 120px;
                    padding: 8px 0;
                }

                .chat-input::placeholder {
                    color: var(--de-text-secondary);
                }

                .send-button {
                    width: 40px;
                    height: 40px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--de-primary);
                    border: none;
                    border-radius: 8px;
                    color: white;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    flex-shrink: 0;
                }

                .send-button:hover:not(:disabled) {
                    background: #0055dd;
                    transform: scale(1.05);
                }

                .send-button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .send-button.stop-button {
                    background: #ef4444;
                    animation: pulse-stop 1.5s ease-in-out infinite;
                }

                .send-button.stop-button:hover {
                    background: #dc2626;
                    transform: scale(1.05);
                }

                @keyframes pulse-stop {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
                    50% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
                }
                
                /* 参考图预览 */
                .reference-preview {
                    display: flex;
                    gap: 12px;
                    background: var(--de-bg-light);
                    padding: 8px;
                    border-radius: 8px;
                    margin-bottom: 8px;
                }
                
                .reference-preview img {
                    width: 60px;
                    height: 60px;
                    object-fit: cover;
                    border-radius: 4px;
                    border: 1px solid var(--de-border);
                }
                
                .reference-info {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 12px;
                    color: var(--de-text-secondary);
                }
                
                .analyze-btn {
                    padding: 4px 12px;
                    background: var(--de-primary);
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                }
                
                .analyze-btn:disabled {
                    opacity: 0.5;
                    cursor: wait;
                }

                /* 粘贴图片预览 */
                .pasted-image-preview {
                    display: flex;
                    gap: 12px;
                    background: linear-gradient(135deg, var(--de-bg-light), rgba(var(--de-primary-rgb), 0.1));
                    padding: 10px;
                    border-radius: 10px;
                    margin-bottom: 8px;
                    border: 1px solid rgba(var(--de-primary-rgb), 0.2);
                    animation: fadeIn 0.2s ease-out;
                }

                .pasted-image-preview img {
                    width: 80px;
                    height: 80px;
                    object-fit: cover;
                    border-radius: 6px;
                    border: 2px solid var(--de-primary);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }

                .pasted-image-info {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    font-size: 13px;
                    color: var(--de-text-primary);
                    font-weight: 500;
                }

                .remove-pasted-btn {
                    width: 24px;
                    height: 24px;
                    border-radius: 50%;
                    background: var(--de-bg);
                    border: 1px solid var(--de-border);
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    font-size: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.15s ease;
                }

                .remove-pasted-btn:hover {
                    background: var(--de-danger);
                    border-color: var(--de-danger);
                    color: white;
                }

                /* 拖拽状态 */
                .input-area {
                    position: relative;
                    transition: all 0.2s ease;
                }

                .input-area.dragging {
                    border-color: var(--de-primary);
                    background: rgba(var(--de-primary-rgb), 0.05);
                }

                .drag-overlay {
                    position: absolute;
                    inset: 0;
                    background: rgba(var(--de-primary-rgb), 0.1);
                    backdrop-filter: blur(2px);
                    border: 2px dashed var(--de-primary);
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10;
                    animation: dragPulse 1s ease infinite;
                }

                @keyframes dragPulse {
                    0%, 100% { 
                        border-color: var(--de-primary);
                        background: rgba(var(--de-primary-rgb), 0.1);
                    }
                    50% { 
                        border-color: rgba(var(--de-primary-rgb), 0.6);
                        background: rgba(var(--de-primary-rgb), 0.15);
                    }
                }

                .drag-content {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    color: var(--de-primary);
                    font-weight: 500;
                }

                .drag-icon {
                    font-size: 32px;
                    animation: bounce 0.5s ease infinite alternate;
                }

                @keyframes bounce {
                    from { transform: translateY(0); }
                    to { transform: translateY(-5px); }
                }

                .drag-text {
                    font-size: 14px;
                    opacity: 0.9;
                }

                /* 消息中的图片显示 */
                .message-image {
                    margin-bottom: 12px;
                    border-radius: 8px;
                    overflow: hidden;
                    max-width: 300px;
                    border: 1px solid var(--de-border);
                }

                .message-image img {
                    width: 100%;
                    height: auto;
                    display: block;
                }

                .message.user .message-image {
                    margin-left: auto;
                }
                
                .remove-btn {
                    margin-left: auto;
                    background: none;
                    border: none;
                    font-size: 16px;
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    padding: 4px;
                }
                
                .remove-btn:hover {
                    color: var(--de-text);
                }
            `}</style>
        </div>
    );
};
