/**
 * 思维过程展示组件（简洁版）
 */

import React from 'react';
import './ThinkingProcess.css';

// 工具名称中文映射表
export const TOOL_NAME_MAP: Record<string, { name: string; icon: string; description: string }> = {
    // 文档操作
    createDocument: { name: '创建文档', icon: '📄', description: '创建新的 Photoshop 文档' },
    getDocumentInfo: { name: '获取文档信息', icon: '📋', description: '获取当前文档的尺寸、名称等信息' },
    listDocuments: { name: '列出文档', icon: '📂', description: '查看所有打开的文档' },
    switchDocument: { name: '切换文档', icon: '🔄', description: '切换到另一个文档' },
    diagnoseState: { name: '诊断状态', icon: '🔍', description: '检查 Photoshop 当前状态' },
    
    // 图层操作
    selectLayer: { name: '选择图层', icon: '👆', description: '选中指定的图层' },
    getLayerHierarchy: { name: '获取图层结构', icon: '🌲', description: '查看图层层级关系' },
    getAllTextLayers: { name: '获取文本图层', icon: '📝', description: '获取所有文本图层信息' },
    getLayerBounds: { name: '获取图层边界', icon: '📐', description: '获取图层的位置和大小' },
    moveLayer: { name: '移动图层', icon: '↔️', description: '调整图层位置' },
    alignLayers: { name: '对齐图层', icon: '⬛', description: '将多个图层对齐' },
    distributeLayers: { name: '分布图层', icon: '📊', description: '均匀分布多个图层' },
    
    // 文本操作
    getTextContent: { name: '获取文本内容', icon: '📖', description: '读取文本图层的内容' },
    setTextContent: { name: '修改文本', icon: '✏️', description: '修改文本图层的内容' },
    getTextStyle: { name: '获取文本样式', icon: '🎨', description: '获取字体、大小等样式' },
    setTextStyle: { name: '设置文本样式', icon: '🖌️', description: '修改字体、颜色等样式' },
    createTextLayer: { name: '创建文本', icon: '➕', description: '添加新的文本图层' },
    
    // 图层管理
    renameLayer: { name: '重命名图层', icon: '✏️', description: '修改图层名称' },
    groupLayers: { name: '编组图层', icon: '📁', description: '将多个图层组合' },
    ungroupLayers: { name: '解散组', icon: '📂', description: '解散图层组' },
    reorderLayer: { name: '调整层序', icon: '↕️', description: '调整图层上下顺序' },
    createClippingMask: { name: '创建剪切蒙版', icon: '✂️', description: '创建剪切蒙版效果' },
    releaseClippingMask: { name: '释放剪切蒙版', icon: '🔓', description: '释放剪切蒙版' },
    createGroup: { name: '创建组', icon: '📁', description: '创建新的图层组' },
    
    // 视觉分析
    getCanvasSnapshot: { name: '截取画布', icon: '📷', description: '获取当前画布截图' },
    getDocumentSnapshot: { name: '截取文档', icon: '🖼️', description: '获取文档完整截图' },
    getElementMapping: { name: '分析元素', icon: '🗺️', description: '识别画布中的所有元素' },
    analyzeLayout: { name: '分析布局', icon: '📐', description: '分析设计的布局结构' },
    getAnnotatedSnapshot: { name: '获取标注截图', icon: '🏷️', description: '获取带标注的画布截图' },
    
    // 图像处理
    removeBackground: { name: '智能抠图', icon: '✂️', description: '使用 AI 去除背景' },
    placeImage: { name: '置入图片', icon: '🖼️', description: '将图片放入文档' },
    
    // 形状创建
    createRectangle: { name: '创建矩形', icon: '⬛', description: '绘制矩形形状' },
    createEllipse: { name: '创建椭圆', icon: '⚪', description: '绘制椭圆形状' },
    
    // 历史操作
    undo: { name: '撤销', icon: '↩️', description: '撤销上一步操作' },
    redo: { name: '重做', icon: '↪️', description: '重做上一步操作' },
    getHistoryInfo: { name: '获取历史', icon: '📜', description: '查看操作历史记录' },
    
    // 保存导出
    saveDocument: { name: '保存文档', icon: '💾', description: '保存当前文档' },
    quickExport: { name: '快速导出', icon: '📤', description: '快速导出为图片' },
    batchExport: { name: '批量导出', icon: '📦', description: '批量导出多个图层' },
    
    // 资源管理
    listProjectResources: { name: '列出项目资源', icon: '📂', description: '查看项目中的素材文件' },
    searchProjectResources: { name: '搜索项目资源', icon: '🔎', description: '搜索项目中的特定素材' },
    getProjectStructure: { name: '获取项目结构', icon: '🌲', description: '查看项目目录结构' },
    getResourcesByCategory: { name: '按类别获取资源', icon: '📁', description: '按类别筛选素材' },
    
    // SKU 操作
    skuLayout: { name: 'SKU 排版', icon: '🎨', description: '生成 SKU 组合排版' },
    openProjectFile: { name: '打开文件', icon: '📂', description: '打开项目文件' },
};

// 获取工具的友好显示名称
export const getToolDisplayInfo = (toolName: string): { name: string; icon: string; description: string } => {
    return TOOL_NAME_MAP[toolName] || { 
        name: toolName, 
        icon: '🔧', 
        description: '执行操作' 
    };
};

// 思维步骤类型
export interface ThinkingStep {
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

interface ThinkingProcessProps {
    steps: ThinkingStep[];
    isExpanded?: boolean;
    onToggle?: () => void;
    className?: string;
}

/**
 * 简洁版思维过程组件（GPT Pondering 风格）
 * 纯文本列表，无图标装饰
 */
export const ThinkingProcess: React.FC<ThinkingProcessProps> = ({
    steps,
    className = ''
}) => {
    // 过滤出有内容的步骤
    const validSteps = steps.filter(s => s.content && s.content.trim());
    
    // 没有有效步骤时不显示
    if (validSteps.length === 0) {
        // 如果有运行中的步骤但没有内容，显示简单的加载指示
        const isRunning = steps.some(s => s.status === 'running');
        if (isRunning) {
            return (
                <div className={`thinking-simple ${className}`}>
                    <div className="pondering-header">
                        <span className="pondering-dot"></span>
                        <span className="pondering-title">Pondering</span>
                        <span className="pondering-dots">...</span>
                    </div>
                </div>
            );
        }
        return null;
    }

    const getStepText = (step: ThinkingStep): string => {
        // 如果是工具调用，显示简洁的操作描述
        if (step.type === 'tool_call' && step.toolName) {
            const info = getToolDisplayInfo(step.toolName);
            return step.content || info.description;
        }
        return step.content;
    };

    // 统计步骤数
    const totalSteps = validSteps.length;
    const completedSteps = validSteps.filter(s => s.status === 'success').length;

    return (
        <div className={`thinking-simple ${className}`}>
            {/* 标题行 */}
            <div className="pondering-header">
                <span className="pondering-dot"></span>
                <span className="pondering-title">Pondering</span>
                <span className="pondering-count">({totalSteps})</span>
            </div>
            
            {/* 步骤列表 - 纯文本 */}
            <div className="pondering-steps">
                {validSteps.map((step, index) => (
                    <div 
                        key={step.id} 
                        className={`pondering-step ${step.status}`}
                    >
                        <span className="step-number">{String(index + 1).padStart(2, '0')}</span>
                        <span className="step-text">{getStepText(step)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ThinkingProcess;
