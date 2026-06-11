/**
 * 设置弹窗 - 重构版
 * 
 * 清晰划分模型类型：
 * 1. AI 对话模型 - 用于文案、排版、视觉分析
 *    - 本地：Ollama LLM
 *    - 云端：OpenRouter / 直连 API
 * 2. 图像处理模型 - 用于抠图等图像处理
 *    - 本地 ONNX：BiRefNet + YOLO-World
 */

import React, { useState, useEffect } from 'react';
import { useAppStore, TaskCategory } from '../stores/app.store';
import { getUserFacingSkills } from '../../shared/skills/skill-declarations';
import { getSkillExecutor } from '../services/skill-executors';
import {
    buildDesignKnowledgeSettingsSummary,
    normalizeDesignKnowledgeSettings
} from '../../shared/design-knowledge-settings';
import { buildDesignKnowledgeRuntimeCapabilitySummary } from '../../shared/design-knowledge-runtime-capability';
import {
    getMemoryService,
    type PreferenceMemoryItem
} from '../services/memory.service';

// 从统一配置导入模型定义
import { 
    LOCAL_MODELS as LOCAL_MODELS_CONFIG, 
    GOOGLE_MODELS as GOOGLE_MODELS_CONFIG,
    XIAOMI_MODELS as XIAOMI_MODELS_CONFIG,
    OPENROUTER_MODELS as OPENROUTER_MODELS_CONFIG,
    OLLAMA_CLOUD_MODELS as OLLAMA_CLOUD_CONFIG,
    GPTSAPI_MODELS as GPTSAPI_MODELS_CONFIG,
    DEEPSEEK_MODELS as DEEPSEEK_MODELS_CONFIG,
    matchOllamaModel,
    DEFAULT_MODEL_PREFERENCES,
    getModelById
} from '../../shared/config/models.config';

// ========== 类型定义 ==========

// 设置 Tab 类型
type SettingsTab = 'general' | 'ai-models' | 'image-models' | 'api-keys' | 'integrations' | 'knowledge' | 'preferences';

// 简洁单色图标组件（与导航栏风格一致）
const TaskIcon: React.FC<{ type: string }> = ({ type }) => {
    const icons: Record<string, JSX.Element> = {
        brain: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
        ),
        edit: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
        ),
        eye: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
            </svg>
        )
    };
    return <span className="task-svg-icon">{icons[type] || null}</span>;
};

// 任务分类配置（简洁单色图标）
const TASK_CATEGORIES = [
    { id: 'layoutAnalysis' as TaskCategory, name: '逻辑理解', desc: '排版分析、代码生成', iconType: 'brain' },
    { id: 'textOptimize' as TaskCategory, name: '文案撰写', desc: '文案生成、营销文案', iconType: 'edit' },
    { id: 'visualAnalyze' as TaskCategory, name: '视觉分析', desc: '图像理解、设计分析', iconType: 'eye' },
];

// ========== 本地模型（Ollama）==========
const OLLAMA_MODELS = LOCAL_MODELS_CONFIG.map(m => ({
    id: m.id,
    name: m.name,
    desc: m.description || '',
    size: m.size || '',
    recommended: m.recommended || false,
    vision: m.supportsVision,
    apiModelId: m.apiModelId
}));

// ========== 云端模型 ==========

// Google AI Studio（官方直连）
const GOOGLE_MODELS = GOOGLE_MODELS_CONFIG.map(m => ({
    id: m.id,
    name: m.name,
    provider: 'google',
    channel: 'Google AI Studio' as const,
    desc: m.description || '',
    recommended: m.recommended || false,
    vision: m.supportsVision,
    requiredKey: 'google' as const
}));

const XIAOMI_MODELS = XIAOMI_MODELS_CONFIG.map(m => ({
    id: m.id,
    name: m.name,
    provider: 'xiaomi',
    channel: 'Xiaomi MiMo' as const,
    desc: m.description || '',
    recommended: m.recommended || false,
    vision: m.supportsVision,
    requiredKey: 'xiaomi' as const
}));

// OpenRouter（中转渠道）
const OPENROUTER_MODELS = OPENROUTER_MODELS_CONFIG.map(m => ({
    id: m.id,
    name: m.name,
    provider: m.apiModelId.split('/')[0] || 'openrouter',
    channel: 'OpenRouter' as const,
    desc: m.description || '',
    recommended: m.recommended || false,
    vision: m.supportsVision,
    requiredKey: 'openrouter' as const
}));

// Ollama Cloud（云服务）
const OLLAMA_CLOUD_MODELS = OLLAMA_CLOUD_CONFIG.map(m => ({
    id: m.id,
    name: m.name,
    provider: 'ollama-cloud',
    channel: 'Ollama Cloud' as const,
    desc: m.description || '',
    recommended: m.recommended || false,
    vision: m.supportsVision,
    apiModelId: m.apiModelId,
    requiredKey: 'ollamaApiKey' as const
}));

const GPTSAPI_MODELS = GPTSAPI_MODELS_CONFIG.map(m => ({
    id: m.id,
    name: m.name,
    provider: 'gptsapi',
    channel: 'GPTs API' as const,
    desc: m.description || '',
    recommended: m.recommended || false,
    vision: m.supportsVision,
    requiredKey: 'gptsapi' as const
}));

const DEEPSEEK_MODELS = DEEPSEEK_MODELS_CONFIG.map(m => ({
    id: m.id,
    name: m.name,
    provider: 'deepseek',
    channel: 'DeepSeek' as const,
    desc: m.description || '',
    recommended: m.recommended || false,
    vision: m.supportsVision,
    requiredKey: 'deepseek' as const
}));

const CLOUD_MODELS = [...GPTSAPI_MODELS, ...DEEPSEEK_MODELS, ...GOOGLE_MODELS, ...XIAOMI_MODELS, ...OPENROUTER_MODELS, ...OLLAMA_CLOUD_MODELS];

interface SettingsModalProps {
    onClose: () => void;
}

const SKILL_CATEGORY_LABELS: Record<string, string> = {
    image: '图像',
    layout: '排版',
    text: '文本',
    document: '文档',
    batch: '批量',
    analysis: '分析',
    export: '导出',
    replication: '复刻',
    ecommerce: '电商'
};

const BUILTIN_MCP_SERVERS = [
    {
        id: 'builtin-photoshop-host',
        name: 'Photoshop MCP Host',
        transport: 'http',
        endpoint: 'http://127.0.0.1:8768/mcp',
        description: 'Agent 内置 MCP Host，用于暴露 Photoshop UXP 插件工具。'
    },
    {
        id: 'builtin-design-crawler',
        name: 'Design Crawler MCP',
        transport: 'internal',
        endpoint: 'Electron IPC',
        description: 'Agent 内置设计参考爬虫能力，当前由桌面端内部服务提供。'
    }
] as const;

const PREFERENCE_STATUS_LABELS: Record<PreferenceMemoryItem['status'], string> = {
    active: '启用',
    disabled: '已禁用',
    needs_review: '待确认',
    archived: '已归档'
};

const PREFERENCE_SOURCE_LABELS: Record<PreferenceMemoryItem['sourceType'], string> = {
    explicit: '显式偏好',
    inferred: '推断偏好',
    temporary: '临时偏好',
    deprecated: '旧版偏好'
};

const PREFERENCE_CATEGORY_LABELS: Record<PreferenceMemoryItem['category'], string> = {
    font: '字体',
    color: '颜色',
    style: '风格',
    workflow: '工作流',
    interaction: '交互',
    copywriting: '文案',
    layout: '排版',
    unknown: '其他'
};

type PreferenceScopeType = NonNullable<PreferenceMemoryItem['scope']>['type'];

interface PreferenceDraft {
    category: PreferenceMemoryItem['category'];
    value: string;
    label: string;
    evidenceSummary: string;
    scopeType: PreferenceScopeType;
    scopeId: string;
}

const PREFERENCE_SCOPE_LABELS: Record<PreferenceScopeType, string> = {
    user: '用户级',
    project: '项目级',
    brand: '品牌级',
    session: '会话级'
};

const PREFERENCE_DRAFT_DEFAULT: PreferenceDraft = {
    category: 'style',
    value: '',
    label: '',
    evidenceSummary: '',
    scopeType: 'user',
    scopeId: ''
};

function preferenceItemToDraft(item: PreferenceMemoryItem): PreferenceDraft {
    return {
        category: item.category,
        value: item.value,
        label: item.label,
        evidenceSummary: item.evidenceSummary,
        scopeType: item.scope?.type || 'user',
        scopeId: item.scope?.id || ''
    };
}

function preferenceDraftScope(draft: PreferenceDraft): PreferenceMemoryItem['scope'] {
    const id = draft.scopeId.trim();
    return id ? { type: draft.scopeType, id } : { type: draft.scopeType };
}

// ========== 智能分割模型配置 ==========
interface SegmentationModel {
    id: string;
    name: string;
    description: string;
    size: string;
    downloadUrl: string;
    mirrorUrl?: string;  // 中国镜像
    fileName: string;
    folder: string;
    required: boolean;
    feature: string;  // 功能说明
}

// 推荐的模型配置（最佳实践：文本定位 + 精确分割）
const SEGMENTATION_MODELS: SegmentationModel[] = [
    {
        id: 'birefnet',
        name: 'BiRefNet',
        description: '高精度边缘分割',
        feature: '精确分割 + 边缘细化',
        size: '~176MB',
        downloadUrl: 'https://huggingface.co/onnx-community/BiRefNet/resolve/main/onnx/model.onnx',
        mirrorUrl: 'https://hf-mirror.com/onnx-community/BiRefNet/resolve/main/onnx/model.onnx',
        fileName: 'birefnet.onnx',
        folder: 'birefnet',
        required: true
    },
    {
        id: 'yolo-world',
        name: 'YOLO-World',
        description: '开放词汇目标检测',
        feature: '文本定位 + 目标检测',
        size: '~48MB',
        downloadUrl: 'https://huggingface.co/x1yiis/yolo-world-onnx/resolve/main/yolov8s-worldv2.onnx',
        mirrorUrl: 'https://hf-mirror.com/x1yiis/yolo-world-onnx/resolve/main/yolov8s-worldv2.onnx',
        fileName: 'yolov8s-worldv2.onnx',
        folder: 'yolo-world',
        required: false
    },
    {
        id: 'sam-encoder',
        name: 'MobileSAM Encoder',
        description: '交互式分割编码器',
        feature: '选区分割 - 图像特征提取',
        size: '~36MB',
        downloadUrl: 'https://huggingface.co/vietanhdev/mobile-sam-onnx/resolve/main/mobile_sam_image_encoder.onnx',
        mirrorUrl: 'https://hf-mirror.com/vietanhdev/mobile-sam-onnx/resolve/main/mobile_sam_image_encoder.onnx',
        fileName: 'mobile_sam_encoder.onnx',
        folder: 'sam',
        required: false
    },
    {
        id: 'sam-decoder',
        name: 'MobileSAM Decoder',
        description: '交互式分割解码器',
        feature: '选区分割 - Box Prompt 分割',
        size: '~16MB',
        downloadUrl: 'https://huggingface.co/vietanhdev/mobile-sam-onnx/resolve/main/mobile_sam_mask_decoder.onnx',
        mirrorUrl: 'https://hf-mirror.com/vietanhdev/mobile-sam-onnx/resolve/main/mobile_sam_mask_decoder.onnx',
        fileName: 'mobile_sam_decoder.onnx',
        folder: 'sam',
        required: false
    }
];

// 模型管理组件
const SegmentationModelManager: React.FC = () => {
    const [modelStatus, setModelStatus] = useState<Record<string, 'installed' | 'missing' | 'downloading'>>({});
    const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});

    // 检查模型状态
    const checkModelStatus = async () => {
        const api = window.designEcho as any;
        if (!api?.checkSegmentModelExists) return;
        
        const status: Record<string, 'installed' | 'missing'> = {};
        for (const model of SEGMENTATION_MODELS) {
            try {
                const exists = await api.checkSegmentModelExists(model.folder, model.fileName);
                status[model.id] = exists ? 'installed' : 'missing';
            } catch {
                status[model.id] = 'missing';
            }
        }
        setModelStatus(status);
    };

    useEffect(() => {
        checkModelStatus();
    }, []);

    // 下载模型
    const handleDownload = async (model: SegmentationModel) => {
        const api = window.designEcho as any;
        if (!api?.downloadSegmentModel) {
            // 降级：打开浏览器下载
            if (api?.openExternal) {
                api.openExternal(model.downloadUrl);
            } else {
                window.open(model.downloadUrl, '_blank');
            }
            return;
        }

        setModelStatus(prev => ({ ...prev, [model.id]: 'downloading' }));
        setDownloadProgress(prev => ({ ...prev, [model.id]: 0 }));

        try {
            await api.downloadSegmentModel({
                url: model.downloadUrl,
                folder: model.folder,
                fileName: model.fileName,
                onProgress: (progress: number) => {
                    setDownloadProgress(prev => ({ ...prev, [model.id]: progress }));
                }
            });
            setModelStatus(prev => ({ ...prev, [model.id]: 'installed' }));
        } catch (e: any) {
            console.error('下载失败:', e);
            setModelStatus(prev => ({ ...prev, [model.id]: 'missing' }));
            alert(`下载失败: ${e.message}\n\n请手动下载模型文件。`);
        }
    };

    // 打开模型目录
    const openModelsFolder = () => {
        const api = window.designEcho as any;
        if (api?.openModelsFolder) {
            api.openModelsFolder();
        }
    };

    const getStatusBadge = (modelId: string) => {
        const status = modelStatus[modelId];
        if (status === 'installed') {
            return <span style={{ color: '#10b981', fontSize: '12px' }}>✅ 已安装</span>;
        }
        if (status === 'downloading') {
            const progress = downloadProgress[modelId] || 0;
            return <span style={{ color: '#3b82f6', fontSize: '12px' }}>⏳ 下载中 {progress}%</span>;
        }
        return <span style={{ color: '#ef4444', fontSize: '12px' }}>❌ 未安装</span>;
    };

    return (
        <div className="model-manager">
            {/* 功能说明 */}
            <div style={{ 
                marginBottom: '16px', 
                padding: '12px 16px', 
                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(16, 185, 129, 0.1))',
                borderRadius: '8px',
                border: '1px solid rgba(59, 130, 246, 0.2)'
            }}>
                <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--de-text)' }}>
                    ✨ 智能分割流程
                </div>
                <div style={{ fontSize: '12px', color: 'var(--de-text-secondary)', lineHeight: 1.6 }}>
                    <span style={{ color: '#3b82f6' }}>文本定位</span> (YOLO-World) → 
                    <span style={{ color: '#10b981' }}> 目标检测</span> → 
                    <span style={{ color: '#8b5cf6' }}> 精确分割</span> (BiRefNet) → 
                    <span style={{ color: '#f59e0b' }}> 边缘细化</span>
                </div>
            </div>

            {/* 顶部操作栏 */}
            <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: 'var(--de-text-secondary)' }}>
                    总计约 224MB（BiRefNet 必需，YOLO-World 可选）
                </span>
                <button
                    onClick={openModelsFolder}
                    style={{
                        padding: '4px 12px',
                        fontSize: '11px',
                        background: 'var(--de-bg-tertiary)',
                        border: '1px solid var(--de-border)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        color: 'var(--de-text)'
                    }}
                >
                    📂 打开模型目录
                </button>
            </div>

            {/* 模型列表 */}
            {SEGMENTATION_MODELS.map(model => (
                <div
                    key={model.id}
                    style={{
                        padding: '16px',
                        background: 'var(--de-bg-secondary)',
                        borderRadius: '8px',
                        marginBottom: '12px',
                        border: `1px solid ${model.required ? 'rgba(59, 130, 246, 0.3)' : 'var(--de-border)'}`
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <div>
                            <span style={{ fontWeight: 600, fontSize: '14px' }}>{model.name}</span>
                            {model.required ? (
                                <span style={{ 
                                    marginLeft: '8px', 
                                    fontSize: '10px', 
                                    padding: '2px 6px', 
                                    background: '#3b82f6', 
                                    color: 'white', 
                                    borderRadius: '4px' 
                                }}>
                                    必需
                                </span>
                            ) : (
                                <span style={{ 
                                    marginLeft: '8px', 
                                    fontSize: '10px', 
                                    padding: '2px 6px', 
                                    background: '#6b7280', 
                                    color: 'white', 
                                    borderRadius: '4px' 
                                }}>
                                    推荐
                                </span>
                            )}
                        </div>
                        {getStatusBadge(model.id)}
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--de-text-secondary)', margin: '0 0 4px 0' }}>
                        {model.description} · {model.size}
                    </p>
                    <p style={{ fontSize: '11px', color: '#10b981', margin: '0 0 12px 0' }}>
                        功能: {model.feature}
                    </p>
                    {modelStatus[model.id] !== 'installed' && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                onClick={() => handleDownload(model)}
                                disabled={modelStatus[model.id] === 'downloading'}
                                style={{
                                    padding: '8px 16px',
                                    fontSize: '12px',
                                    background: modelStatus[model.id] === 'downloading' ? 'var(--de-bg-tertiary)' : '#3b82f6',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: modelStatus[model.id] === 'downloading' ? 'not-allowed' : 'pointer',
                                    fontWeight: 500
                                }}
                            >
                                {modelStatus[model.id] === 'downloading' ? '下载中...' : '⬇️ 下载'}
                            </button>
                            {model.mirrorUrl && (
                                <button
                                    onClick={() => window.open(model.mirrorUrl, '_blank')}
                                    style={{
                                        padding: '8px 12px',
                                        fontSize: '11px',
                                        background: 'transparent',
                                        color: 'var(--de-text-secondary)',
                                        border: '1px solid var(--de-border)',
                                        borderRadius: '6px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    🇨🇳 镜像
                                </button>
                            )}
                        </div>
                    )}
                </div>
            ))}

            <details style={{ marginTop: '16px', fontSize: '12px', color: '#888' }}>
                <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>📖 手动安装说明</summary>
                <ol style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.8 }}>
                    <li>点击"打开模型目录"按钮</li>
                    <li>从 Hugging Face 或镜像站下载模型文件</li>
                    <li>将文件放入对应文件夹：
                        <ul style={{ marginTop: '4px', paddingLeft: '16px' }}>
                            <li><code>birefnet/birefnet.onnx</code> (必需)</li>
                            <li><code>yolo-world/yolov8s-worldv2.onnx</code> (推荐)</li>
                        </ul>
                    </li>
                    <li>重启 Agent 应用</li>
                </ol>
            </details>
        </div>
    );
};

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
    const { 
        apiKeys, setApiKeys, 
        modelPreferences, setModelPreferences,
        morphingSettings, setMorphingSettings,
        agentSettings, setAgentSettings,
        integrationSettings, setIntegrationSettings,
        designKnowledgeSettings, setDesignKnowledgeSettings,
        theme, setTheme
    } = useAppStore();
    
    // 在系统浏览器中打开链接
    const openExternalLink = (url: string) => {
        const designEcho = (window as any).designEcho;
        if (designEcho?.openExternal) {
            designEcho.openExternal(url);
        } else {
            // 降级：在新窗口打开
            window.open(url, '_blank');
        }
    };
    
    // ========== 状态 ==========
    const [activeTab, setActiveTab] = useState<SettingsTab>('ai-models');
    const [localKeys, setLocalKeys] = useState({
        openrouter: apiKeys.openrouter || '',
        anthropic: apiKeys.anthropic || '',
        google: apiKeys.google || '',
        xiaomi: apiKeys.xiaomi || '',
        openai: apiKeys.openai || '',
        gptsapi: apiKeys.gptsapi || '',
        ollamaUrl: apiKeys.ollamaUrl || 'http://localhost:11434',
        deepseek: apiKeys.deepseek || '',
        ollamaApiKey: apiKeys.ollamaApiKey || '',  // Ollama 云服务 API Key
        bfl: apiKeys.bfl || '',  // Black Forest Labs (FLUX) API Key
        volcengineJimengAccessKeyId: apiKeys.volcengineJimengAccessKeyId || '',
        volcengineJimengSecretAccessKey: apiKeys.volcengineJimengSecretAccessKey || '',
        volcengineSeedreamApiKey: apiKeys.volcengineSeedreamApiKey || '',
        volcengineTosRegion: apiKeys.volcengineTosRegion || 'cn-beijing',
        volcengineTosEndpoint: apiKeys.volcengineTosEndpoint || 'tos-s3-cn-beijing.volces.com',
        volcengineTosBucket: apiKeys.volcengineTosBucket || '',
        volcengineTosPublicBaseUrl: apiKeys.volcengineTosPublicBaseUrl || '',
        volcengineTosKeyPrefix: apiKeys.volcengineTosKeyPrefix || 'designecho/jimeng-i2i',
    });
    // 修复已删除的模型配置
    const fixDeletedModels = (prefs: typeof modelPreferences) => {
        const validLocalIds = OLLAMA_MODELS.map(m => m.id);
        const fixedPrefs = { ...prefs, preferredLocalModels: { ...prefs.preferredLocalModels } };
        let needsFix = false;
        
        // 检查本地模型偏好中是否有无效的模型
        Object.entries(prefs.preferredLocalModels).forEach(([key, modelId]) => {
            // 检查 local- 前缀（新格式）和 ollama- 前缀（旧格式）
            const isLocalModel = modelId.startsWith('local-') || modelId.startsWith('ollama-');
            
            if (isLocalModel && !validLocalIds.includes(modelId)) {
                console.warn(`[Settings] 模型 ${modelId} 不存在于有效列表中，替换为默认值`);
                
                // 使用统一配置中的默认值（新格式 local-xxx）
                const defaultValue = DEFAULT_MODEL_PREFERENCES.preferredLocalModels[key as keyof typeof DEFAULT_MODEL_PREFERENCES.preferredLocalModels];
                (fixedPrefs.preferredLocalModels as any)[key] = defaultValue || validLocalIds[0];
                needsFix = true;
            }
        });
        
        return { prefs: fixedPrefs, needsFix };
    };
    
    const { prefs: fixedModelPrefs, needsFix } = fixDeletedModels(modelPreferences);
    const [localPrefs, setLocalPrefs] = useState(fixedModelPrefs);
    const [localIntegration, setLocalIntegration] = useState(integrationSettings);
    const [localDesignKnowledge, setLocalDesignKnowledge] = useState(
        normalizeDesignKnowledgeSettings(designKnowledgeSettings)
    );
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [preferenceItems, setPreferenceItems] = useState<PreferenceMemoryItem[]>(() => getMemoryService().listPreferenceItems());
    const [preferenceMessage, setPreferenceMessage] = useState('');
    const [preferenceEditorOpen, setPreferenceEditorOpen] = useState(false);
    const [editingPreferenceId, setEditingPreferenceId] = useState<string | null>(null);
    const [preferenceDraft, setPreferenceDraft] = useState<PreferenceDraft>(PREFERENCE_DRAFT_DEFAULT);
    const [preferenceImportText, setPreferenceImportText] = useState('');
    const [preferenceExportText, setPreferenceExportText] = useState('');

    useEffect(() => {
        setLocalIntegration(integrationSettings);
    }, [integrationSettings]);

    useEffect(() => {
        setLocalDesignKnowledge(normalizeDesignKnowledgeSettings(designKnowledgeSettings));
    }, [designKnowledgeSettings]);

    const visibleSkills = getUserFacingSkills();
    const enabledSkillCount = visibleSkills.filter(
        (skill) => localIntegration.skills?.[skill.id]?.enabled !== false
    ).length;
    const enabledMcpCount = localIntegration.mcpServers.filter((server) => server.enabled).length;
    const activePreferenceCount = preferenceItems.filter((item) => item.status === 'active').length;
    const reviewPreferenceCount = preferenceItems.filter((item) => item.status === 'needs_review').length;
    const disabledPreferenceCount = preferenceItems.filter((item) => item.status === 'disabled').length;
    const archivedPreferenceCount = preferenceItems.filter((item) => item.status === 'archived').length;
    const designKnowledgeSummary = buildDesignKnowledgeSettingsSummary(localDesignKnowledge);
    const designKnowledgeSelectedModel = getModelById(
        localPrefs.orchestrator?.primaryModel || localPrefs.preferredCloudModels.layoutAnalysis
    );
    const designKnowledgeRuntimeCapability = buildDesignKnowledgeRuntimeCapabilitySummary({
        settings: localDesignKnowledge,
        model: designKnowledgeSelectedModel
    });
    const skillGroups = Object.entries(
        visibleSkills.reduce<Record<string, typeof visibleSkills>>((groups, skill) => {
            const category = skill.category || 'other';
            if (!groups[category]) groups[category] = [];
            groups[category].push(skill);
            return groups;
        }, {})
    );
    
    // 如果需要修复，自动保存
    useEffect(() => {
        if (needsFix) {
            setModelPreferences(fixedModelPrefs);
            window.designEcho?.setModelPreferences?.(fixedModelPrefs);
            console.log('[Settings] 已自动修复模型配置');
        }
    }, []);
    
    // Ollama 状态
    const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'online' | 'offline'>('checking');
    const [installedModels, setInstalledModels] = useState<string[]>([]);
    
    
    // API 测试状态 - OpenRouter
    const [apiTestStatus, setApiTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [apiTestMessage, setApiTestMessage] = useState('');
    
    // API 测试状态 - Google AI Studio
    const [googleApiTestStatus, setGoogleApiTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [googleApiTestMessage, setGoogleApiTestMessage] = useState('');
    
    // API 测试状态 - Ollama Cloud
    const [ollamaCloudTestStatus, setOllamaCloudTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [ollamaCloudTestMessage, setOllamaCloudTestMessage] = useState('');

    // API 测试状态 - DeepSeek 官方
    const [deepSeekTestStatus, setDeepSeekTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [deepSeekTestMessage, setDeepSeekTestMessage] = useState('');
    
    // API 测试状态 - BFL (Black Forest Labs)
    const [bflTestStatus, setBflTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [bflTestMessage, setBflTestMessage] = useState('');

    // API 测试状态 - 火山即梦
    const [jimengTestStatus, setJimengTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [jimengTestMessage, setJimengTestMessage] = useState('');

    // API 测试状态 - Seedream
    const [seedreamTestStatus, setSeedreamTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [seedreamTestMessage, setSeedreamTestMessage] = useState('');

    // 设计知识 SearXNG 健康检查状态
    const [designKnowledgeTestStatus, setDesignKnowledgeTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [designKnowledgeTestMessage, setDesignKnowledgeTestMessage] = useState('');
    
    // 本地模型测试状态
    const [modelTestStatus, setModelTestStatus] = useState<'idle' | 'testing'>('idle');
    const [modelTestResults, setModelTestResults] = useState<Record<string, { status: 'success' | 'error' | 'pending'; message: string }>>({});
    
    // Ollama 模型下载状态
    const [ollamaDownloading, setOllamaDownloading] = useState<Record<string, boolean>>({});
    const [ollamaDownloadMessages, setOllamaDownloadMessages] = useState<Record<string, string>>({});
    
    // 抠图使用本地 ONNX 模型（BiRefNet + YOLO-World）

    // ========== Effects ==========
    
    // 检查 Ollama 状态
    useEffect(() => {
        const checkOllama = async () => {
            try {
                const response = await fetch(`${localKeys.ollamaUrl}/api/tags`);
                if (response.ok) {
                    const data = await response.json();
                    setInstalledModels(data.models?.map((m: any) => m.name) || []);
                    setOllamaStatus('online');
                } else {
                    setOllamaStatus('offline');
                }
            } catch {
                setOllamaStatus('offline');
            }
        };
        checkOllama();
    }, [localKeys.ollamaUrl]);


    // ESC 键关闭
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    // ========== 处理函数 ==========
    
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    };

    const createMcpServerDraft = (transport: 'stdio' | 'http') => ({
        id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: transport === 'stdio' ? 'New MCP Server' : 'New MCP Endpoint',
        transport,
        enabled: true,
        command: transport === 'stdio' ? 'node' : '',
        args: [],
        url: transport === 'http' ? 'http://127.0.0.1:3000/mcp' : '',
        notes: ''
    });

    const handleToggleSkill = (skillId: string, enabled: boolean) => {
        setLocalIntegration((prev) => ({
            ...prev,
            skills: {
                ...prev.skills,
                [skillId]: { enabled }
            }
        }));
    };

    const handleAddMcpServer = (transport: 'stdio' | 'http') => {
        setLocalIntegration((prev) => ({
            ...prev,
            mcpServers: [...prev.mcpServers, createMcpServerDraft(transport)]
        }));
    };

    const handleUpdateMcpServer = (
        id: string,
        patch: Partial<(typeof localIntegration.mcpServers)[number]>
    ) => {
        setLocalIntegration((prev) => ({
            ...prev,
            mcpServers: prev.mcpServers.map((server) =>
                server.id === id ? { ...server, ...patch } : server
            )
        }));
    };

    const handleRemoveMcpServer = (id: string) => {
        setLocalIntegration((prev) => ({
            ...prev,
            mcpServers: prev.mcpServers.filter((server) => server.id !== id)
        }));
    };

    const handleUpdateDesignKnowledgeSearxng = (
        patch: Partial<typeof localDesignKnowledge.searxng>
    ) => {
        setLocalDesignKnowledge((prev) => normalizeDesignKnowledgeSettings({
            ...prev,
            searxng: {
                ...prev.searxng,
                ...patch
            }
        }));
    };

    const handleUpdateDesignKnowledgeXiaomiWebSearch = (
        patch: Partial<typeof localDesignKnowledge.xiaomiWebSearch>
    ) => {
        setLocalDesignKnowledge((prev) => normalizeDesignKnowledgeSettings({
            ...prev,
            xiaomiWebSearch: {
                ...prev.xiaomiWebSearch,
                ...patch
            }
        }));
    };

    const refreshPreferenceItems = () => {
        setPreferenceItems(getMemoryService().listPreferenceItems());
    };

    const handleCreatePreference = () => {
        setEditingPreferenceId(null);
        setPreferenceDraft(PREFERENCE_DRAFT_DEFAULT);
        setPreferenceEditorOpen(true);
        setPreferenceMessage('');
    };

    const handleEditPreference = (item: PreferenceMemoryItem) => {
        setEditingPreferenceId(item.id);
        setPreferenceDraft(preferenceItemToDraft(item));
        setPreferenceEditorOpen(true);
        setPreferenceMessage('');
    };

    const handleCancelPreferenceEdit = () => {
        setEditingPreferenceId(null);
        setPreferenceDraft(PREFERENCE_DRAFT_DEFAULT);
        setPreferenceEditorOpen(false);
    };

    const handleSavePreferenceDraft = () => {
        const value = preferenceDraft.value.trim();
        if (!value) {
            setPreferenceMessage('偏好值不能为空。');
            return;
        }
        if (preferenceDraft.scopeType !== 'user' && !preferenceDraft.scopeId.trim()) {
            setPreferenceMessage('项目级、品牌级或会话级偏好需要填写作用域 ID。');
            return;
        }

        try {
            const payload = {
                category: preferenceDraft.category,
                value,
                label: preferenceDraft.label.trim() || undefined,
                evidenceSummary: preferenceDraft.evidenceSummary.trim() || undefined,
                scope: preferenceDraftScope(preferenceDraft)
            };
            const updated = editingPreferenceId
                ? getMemoryService().updatePreferenceItem(editingPreferenceId, {
                    ...payload,
                    sourceType: 'explicit',
                    status: 'active'
                })
                : getMemoryService().upsertExplicitPreference(payload);
            refreshPreferenceItems();
            setPreferenceEditorOpen(false);
            setEditingPreferenceId(null);
            setPreferenceDraft(PREFERENCE_DRAFT_DEFAULT);
            setPreferenceMessage(`已保存偏好：${updated.label}`);
        } catch (error: any) {
            setPreferenceMessage(error?.message || '保存偏好失败。');
        }
    };

    const handleExportPreferences = async () => {
        const snapshot = getMemoryService().exportPreferences();
        const text = JSON.stringify(snapshot, null, 2);
        setPreferenceExportText(text);
        try {
            await navigator.clipboard?.writeText(text);
            setPreferenceMessage('已导出偏好 JSON，并尝试复制到剪贴板。');
        } catch {
            setPreferenceMessage('已导出偏好 JSON，可从文本框复制。');
        }
    };

    const handleImportPreferences = () => {
        if (!preferenceImportText.trim()) {
            setPreferenceMessage('请先粘贴需要导入的偏好 JSON。');
            return;
        }
        try {
            const result = getMemoryService().importPreferences(preferenceImportText, { mode: 'merge' });
            refreshPreferenceItems();
            setPreferenceMessage(`已导入 ${result.importedCount} 条偏好，更新 ${result.replacedExistingCount} 条，跳过 ${result.skippedCount} 条。`);
        } catch (error: any) {
            setPreferenceMessage(error?.message || '导入偏好失败。');
        }
    };

    const handleTogglePreference = (item: PreferenceMemoryItem) => {
        const nextEnabled = item.status !== 'active';
        const updated = getMemoryService().setPreferenceEnabled(item.id, nextEnabled);
        refreshPreferenceItems();
        setPreferenceMessage(nextEnabled ? `已启用偏好：${updated.label}` : `已禁用偏好：${updated.label}`);
    };

    const handleArchivePreference = (item: PreferenceMemoryItem) => {
        const updated = getMemoryService().archivePreference(item.id);
        refreshPreferenceItems();
        setPreferenceMessage(`已归档偏好：${updated.label}`);
    };

    const handleClearInferredPreferences = () => {
        const result = getMemoryService().clearInferredPreferences();
        refreshPreferenceItems();
        setPreferenceMessage(`已归档 ${result.archivedCount} 条待确认推断偏好。`);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            setApiKeys(localKeys);
            setModelPreferences(localPrefs);
            setIntegrationSettings(localIntegration);
            setDesignKnowledgeSettings(localDesignKnowledge);
            await window.designEcho?.setApiKeys(localKeys);
            await window.designEcho?.setModelPreferences?.(localPrefs);
            // 保存形态统一设置到主进程
            if (morphingSettings) {
                await window.designEcho?.setMorphingSettings?.(morphingSettings);
            }
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (error) {
            console.error('Failed to save settings:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleTestDesignKnowledge = async () => {
        const settings = normalizeDesignKnowledgeSettings(localDesignKnowledge);

        if (!settings.searxng.enabled) {
            setDesignKnowledgeTestStatus('error');
            setDesignKnowledgeTestMessage('请先启用 SearXNG 设计知识搜索。');
            return;
        }

        if (!settings.searxng.endpoint) {
            setDesignKnowledgeTestStatus('error');
            setDesignKnowledgeTestMessage('请先填写 SearXNG endpoint，例如 http://127.0.0.1:8080。');
            return;
        }

        setDesignKnowledgeTestStatus('testing');
        setDesignKnowledgeTestMessage('正在检查 SearXNG endpoint...');

        try {
            if (!window.designEcho?.probeDesignKnowledgeSearxng) {
                throw new Error('当前版本不支持设计知识健康检查。');
            }

            const result = await window.designEcho.probeDesignKnowledgeSearxng(settings);
            if (result.success && result.status === 'ok') {
                setDesignKnowledgeTestStatus('success');
                setDesignKnowledgeTestMessage(`SearXNG 已响应。HTTP ${result.httpStatus || 200}`);
            } else {
                const warnings = Array.isArray(result.warnings) ? result.warnings.join(' ') : '';
                setDesignKnowledgeTestStatus('error');
                setDesignKnowledgeTestMessage(result.error || warnings || `SearXNG 状态：${result.status || 'unavailable'}`);
            }
        } catch (error: any) {
            setDesignKnowledgeTestStatus('error');
            setDesignKnowledgeTestMessage(error?.message || 'SearXNG 健康检查失败。');
        }

        setTimeout(() => setDesignKnowledgeTestStatus('idle'), 7000);
    };

    const handleTestApi = async () => {
        const apiKey = localKeys.openrouter?.trim();
        if (!apiKey) {
            setApiTestStatus('error');
            setApiTestMessage('请先输入 API Key');
            return;
        }
        
        setApiTestStatus('testing');
        setApiTestMessage('正在测试...');
        
        try {
            const response = await fetch('https://openrouter.ai/api/v1/models', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                setApiTestStatus('success');
                setApiTestMessage(`✅ 连接成功！可用 ${data?.data?.length || 0} 个模型`);
            } else if (response.status === 401) {
                setApiTestStatus('error');
                setApiTestMessage('❌ API Key 无效');
            } else {
                setApiTestStatus('error');
                setApiTestMessage(`❌ 测试失败 (${response.status})`);
            }
        } catch {
            setApiTestStatus('error');
            setApiTestMessage('❌ 网络连接失败');
        }
        
        setTimeout(() => setApiTestStatus('idle'), 5000);
    };

    const handleTestDeepSeek = async () => {
        const apiKey = localKeys.deepseek?.trim();

        if (!apiKey) {
            setDeepSeekTestStatus('error');
            setDeepSeekTestMessage('请先输入 DeepSeek 官方 API Key');
            return;
        }

        setDeepSeekTestStatus('testing');
        setDeepSeekTestMessage('正在调用 DeepSeek 官方文本聊天接口...');

        try {
            if (!window.designEcho?.testDeepSeek) {
                throw new Error('当前版本不支持 DeepSeek 测试');
            }

            const result = await window.designEcho.testDeepSeek(apiKey);
            if (result.success) {
                const usageText = result.usage
                    ? ` 输入 ${result.usage.inputTokens} / 输出 ${result.usage.outputTokens} tokens`
                    : '';
                setDeepSeekTestStatus('success');
                setDeepSeekTestMessage(result.message || `连接成功。${usageText}`);
            } else {
                setDeepSeekTestStatus('error');
                setDeepSeekTestMessage(result.error || 'DeepSeek 测试失败');
            }
        } catch (err: any) {
            setDeepSeekTestStatus('error');
            setDeepSeekTestMessage(err?.message || 'DeepSeek 测试失败');
        }

        setTimeout(() => setDeepSeekTestStatus('idle'), 5000);
    };

    const handleTestGoogleApi = async () => {
        const apiKey = localKeys.google?.trim();
        if (!apiKey) {
            setGoogleApiTestStatus('error');
            setGoogleApiTestMessage('请先输入 API Key');
            return;
        }
        
        setGoogleApiTestStatus('testing');
        setGoogleApiTestMessage('正在测试...');
        
        try {
            // 使用 Google AI Studio API 列出模型
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
                { method: 'GET' }
            );
            
            if (response.ok) {
                const data = await response.json();
                const modelCount = data?.models?.length || 0;
                setGoogleApiTestStatus('success');
                setGoogleApiTestMessage(`✅ 连接成功！可用 ${modelCount} 个模型`);
            } else if (response.status === 400 || response.status === 403) {
                setGoogleApiTestStatus('error');
                setGoogleApiTestMessage('❌ API Key 无效或无权限');
            } else {
                const errorData = await response.json().catch(() => ({}));
                setGoogleApiTestStatus('error');
                setGoogleApiTestMessage(`❌ 测试失败: ${errorData?.error?.message || response.status}`);
            }
        } catch {
            setGoogleApiTestStatus('error');
            setGoogleApiTestMessage('❌ 网络连接失败');
        }
        
        setTimeout(() => setGoogleApiTestStatus('idle'), 5000);
    };

    // 测试 Ollama Cloud API
    // 注意：Ollama 官方没有云端托管服务，这里测试的是第三方托管或自建服务
    const handleTestOllamaCloudApi = async () => {
        const apiKey = localKeys.ollamaApiKey?.trim();
        if (!apiKey) {
            setOllamaCloudTestStatus('error');
            setOllamaCloudTestMessage('请先输入 API Key');
            return;
        }
        
        setOllamaCloudTestStatus('testing');
        setOllamaCloudTestMessage('正在验证...');
        
        try {
            // 通过主进程调用 API 进行测试（避免 CORS 问题）
            const designEcho = (window as any).designEcho;
            if (designEcho?.testOllamaCloudApi) {
                const result = await designEcho.testOllamaCloudApi(apiKey);
                if (result.success) {
                    setOllamaCloudTestStatus('success');
                    setOllamaCloudTestMessage(result.message || '✅ API Key 有效');
                } else {
                    setOllamaCloudTestStatus('error');
                    setOllamaCloudTestMessage(result.error || '❌ 验证失败');
                }
            } else {
                // 备用方案：本地验证格式
                // Ollama Cloud API Key 通常是 UUID 格式或类似格式
                if (apiKey.length >= 20) {
                    setOllamaCloudTestStatus('success');
                    setOllamaCloudTestMessage('✅ API Key 格式有效（将在使用时验证）');
                } else {
                    setOllamaCloudTestStatus('error');
                    setOllamaCloudTestMessage('❌ API Key 格式不正确（长度不足）');
                }
            }
        } catch (err: any) {
            setOllamaCloudTestStatus('error');
            setOllamaCloudTestMessage(`❌ ${err.message || '验证失败'}`);
        }
        
        setTimeout(() => setOllamaCloudTestStatus('idle'), 5000);
    };

    // 测试 BFL (Black Forest Labs) API
    const handleTestBflApi = async () => {
        const apiKey = localKeys.bfl?.trim();
        if (!apiKey) {
            setBflTestStatus('error');
            setBflTestMessage('请先输入 API Key');
            return;
        }
        
        setBflTestStatus('testing');
        setBflTestMessage('正在验证...');

        try {
            const designEcho = (window as any).designEcho;
            if (designEcho?.bfl?.testApiKey) {
                setApiKeys({ bfl: apiKey });
                await window.designEcho?.setApiKeys({ bfl: apiKey });
                // 使用新的 BFL Service API
                const result = await designEcho.bfl.testApiKey(apiKey);
                if (result.success) {
                    setBflTestStatus('success');
                    setBflTestMessage(result.message || '✅ API Key 有效');
                } else {
                    setBflTestStatus('error');
                    setBflTestMessage(result.error || '❌ 验证失败');
                }
            } else {
                // 备用方案：检查格式
                if (apiKey.length >= 30) {
                    setBflTestStatus('success');
                    setBflTestMessage('✅ API Key 格式有效（将在使用时验证）');
                } else {
                    setBflTestStatus('error');
                    setBflTestMessage('❌ API Key 格式不正确');
                }
            }
        } catch (err: any) {
            setBflTestStatus('error');
            setBflTestMessage(`❌ ${err.message || '验证失败'}`);
        }
        
        setTimeout(() => setBflTestStatus('idle'), 5000);
    };

    const handleTestJimengApi = async () => {
        const accessKeyId = localKeys.volcengineJimengAccessKeyId?.trim();
        const secretAccessKey = localKeys.volcengineJimengSecretAccessKey?.trim();
        if (!accessKeyId || !secretAccessKey) {
            setJimengTestStatus('error');
            setJimengTestMessage('请先输入 Access Key ID 和 Secret Access Key');
            return;
        }

        setJimengTestStatus('testing');
        setJimengTestMessage('正在验证鉴权和提交链...');

        try {
            const designEcho = window.designEcho as any;
            if (!designEcho?.testVolcengineJimengCredentials) {
                throw new Error('当前版本不支持即梦 API 测试');
            }
            const result = await designEcho.testVolcengineJimengCredentials(accessKeyId, secretAccessKey);
            if (result.success) {
                setJimengTestStatus('success');
                setJimengTestMessage(result.message || '✅ 鉴权和提交链已通过');
            } else {
                setJimengTestStatus('error');
                setJimengTestMessage(result.error || '❌ 验证失败');
            }
        } catch (err: any) {
            setJimengTestStatus('error');
            setJimengTestMessage(`❌ ${err?.message || '验证失败'}`);
        }

        setTimeout(() => setJimengTestStatus('idle'), 5000);
    };

    const handleTestSeedreamApi = async () => {
        const apiKey = localKeys.volcengineSeedreamApiKey?.trim();
        if (!apiKey) {
            setSeedreamTestStatus('error');
            setSeedreamTestMessage('请先输入 Seedream API Key');
            return;
        }

        setSeedreamTestStatus('testing');
        setSeedreamTestMessage('正在验证...');

        try {
            const designEcho = window.designEcho as any;
            if (!designEcho?.testVolcengineSeedreamApiKey) {
                throw new Error('当前版本不支持 Seedream API 测试');
            }
            const result = await designEcho.testVolcengineSeedreamApiKey(apiKey);
            if (result.success) {
                setSeedreamTestStatus('success');
                setSeedreamTestMessage(result.message || '✅ API Key 可用');
            } else {
                setSeedreamTestStatus('error');
                setSeedreamTestMessage(result.error || '❌ 验证失败');
            }
        } catch (err: any) {
            setSeedreamTestStatus('error');
            setSeedreamTestMessage(`❌ ${err?.message || '验证失败'}`);
        }

        setTimeout(() => setSeedreamTestStatus('idle'), 5000);
    };

    const isModelInstalled = (modelId: string) => {
        // 使用统一配置中的模糊匹配函数
        return installedModels.some(installed => matchOllamaModel(modelId, installed));
    };

    // 测试选中的本地模型
    const testSelectedModels = async () => {
        setModelTestStatus('testing');
        const results: Record<string, { status: 'success' | 'error' | 'pending'; message: string }> = {};
        
        // 获取当前选中的所有本地模型（支持 local- 和 ollama- 两种格式）
        const modelsToTest = new Set<string>();
        Object.values(localPrefs.preferredLocalModels).forEach(modelId => {
            if (modelId.startsWith('local-') || modelId.startsWith('ollama-')) {
                modelsToTest.add(modelId);
            }
        });
        
        // 初始化所有模型为 pending 状态
        modelsToTest.forEach(modelId => {
            results[modelId] = { status: 'pending', message: '等待测试...' };
        });
        setModelTestResults({ ...results });
        
        // 逐个测试模型
        for (const modelId of modelsToTest) {
            // 从配置中获取 Ollama 模型名称（apiModelId）
            const modelConfig = OLLAMA_MODELS.find(m => m.id === modelId);
            const modelName = modelConfig?.apiModelId || modelId.replace('ollama-', '').replace('local-', '');
            results[modelId] = { status: 'pending', message: '正在测试...' };
            setModelTestResults({ ...results });
            
            try {
                // 先检查模型是否存在
                const showResponse = await fetch('http://localhost:11434/api/show', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: modelName })
                });
                
                if (!showResponse.ok) {
                    if (showResponse.status === 404) {
                        results[modelId] = { status: 'error', message: '❌ 模型未下载' };
                    } else {
                        const errorText = await showResponse.text().catch(() => '');
                        results[modelId] = { 
                            status: 'error', 
                            message: `❌ 模型检查失败: ${errorText.substring(0, 50) || showResponse.status}` 
                        };
                    }
                    setModelTestResults({ ...results });
                    continue;
                }
                
                // 调用 Ollama API 测试模型
                const response = await fetch('http://localhost:11434/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: modelName,
                        prompt: '你好',
                        stream: false,
                        options: { num_predict: 10 }  // 只生成少量 token 用于测试
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.response) {
                        results[modelId] = { 
                            status: 'success', 
                            message: `✅ 可用 - ${data.response.substring(0, 30)}...`
                        };
                    } else {
                        results[modelId] = { status: 'error', message: '⚠️ 响应异常' };
                    }
                } else if (response.status === 404) {
                    results[modelId] = { status: 'error', message: '❌ 模型未下载' };
                } else {
                    // 获取详细错误信息
                    const errorData = await response.json().catch(() => ({}));
                    const errorMsg = errorData.error || `HTTP ${response.status}`;
                    
                    // 处理常见错误
                    if (errorMsg.includes('out of memory') || errorMsg.includes('OOM')) {
                        results[modelId] = { status: 'error', message: '❌ 显存不足，请关闭其他模型后重试' };
                    } else if (errorMsg.includes('loading')) {
                        results[modelId] = { status: 'pending', message: '⏳ 模型加载中，请稍后重试' };
                    } else {
                        results[modelId] = { status: 'error', message: `❌ ${errorMsg.substring(0, 50)}` };
                    }
                }
            } catch (error: any) {
                if (error.message?.includes('Failed to fetch')) {
                    results[modelId] = { status: 'error', message: '❌ Ollama 未运行' };
                } else {
                    results[modelId] = { status: 'error', message: `❌ ${error.message}` };
                }
            }
            
            setModelTestResults({ ...results });
        }
        
        setModelTestStatus('idle');
    };

    // 监听 Ollama 下载进度
    useEffect(() => {
        const designEcho = (window as any).designEcho;
        if (!designEcho?.onOllamaPullProgress) return;
        
        const cleanup = designEcho.onOllamaPullProgress((data: { modelName: string; progress: number; status: string }) => {
            const modelId = `ollama-${data.modelName}`;
            const progressText = data.progress > 0 
                ? `⏳ ${data.status} ${data.progress}%` 
                : `⏳ ${data.status}`;
            setOllamaDownloadMessages(prev => ({ ...prev, [modelId]: progressText }));
        });
        
        return cleanup;
    }, []);
    
    // 下载 Ollama 模型（后台下载，有进度）
    const handleDownloadOllamaModel = async (modelId: string) => {
        // 从 modelId 获取实际的 Ollama 模型名称
        const modelConfig = OLLAMA_MODELS.find(m => m.id === modelId);
        if (!modelConfig) {
            setOllamaDownloadMessages(prev => ({ ...prev, [modelId]: '❌ 未找到模型配置' }));
            return;
        }
        
        // 使用配置中的 apiModelId（正确的 Ollama 模型名称）
        const modelName = modelConfig.apiModelId || modelId.replace('ollama-', '');
        
        setOllamaDownloading(prev => ({ ...prev, [modelId]: true }));
        setOllamaDownloadMessages(prev => ({ ...prev, [modelId]: '⏳ 连接 Ollama...' }));
        
        try {
            const designEcho = (window as any).designEcho;
            if (!designEcho?.pullOllamaModel) {
                throw new Error('下载功能不可用');
            }
            
            const result = await designEcho.pullOllamaModel(modelName);
            
            if (result.success) {
                setOllamaDownloadMessages(prev => ({ ...prev, [modelId]: '✅ 下载完成！' }));
                // 更新测试结果
                setModelTestResults(prev => ({
                    ...prev,
                    [modelId]: { status: 'success', message: '✅ 已安装' }
                }));
                // 刷新已安装模型列表
                if (designEcho?.listOllamaModels) {
                    const listResult = await designEcho.listOllamaModels();
                    if (listResult.success && listResult.models) {
                        const modelNames = listResult.models.map((m: any) => m.name || m.model);
                        setInstalledModels(modelNames);
                    }
                }
            } else {
                setOllamaDownloadMessages(prev => ({ 
                    ...prev, 
                    [modelId]: `❌ ${result.error || '下载失败'}` 
                }));
            }
        } catch (error: any) {
            setOllamaDownloadMessages(prev => ({ 
                ...prev, 
                [modelId]: `❌ ${error.message || '下载失败'}` 
            }));
        } finally {
            setOllamaDownloading(prev => ({ ...prev, [modelId]: false }));
        }
    };
    
    // 在终端中下载 Ollama 模型（可以看到详细进度）
    const handleDownloadOllamaModelInTerminal = async (modelId: string) => {
        // 从配置中获取正确的 Ollama 模型名称
        const modelConfig = OLLAMA_MODELS.find(m => m.id === modelId);
        const modelName = modelConfig?.apiModelId || modelId.replace('ollama-', '');
        
        try {
            const designEcho = (window as any).designEcho;
            if (!designEcho?.pullOllamaModelInTerminal) {
                throw new Error('终端下载功能不可用');
            }
            
            const result = await designEcho.pullOllamaModelInTerminal(modelName);
            
            if (result.success) {
                setOllamaDownloadMessages(prev => ({ 
                    ...prev, 
                    [modelId]: '📺 已在终端中开始下载，请查看终端窗口' 
                }));
            } else {
                setOllamaDownloadMessages(prev => ({ 
                    ...prev, 
                    [modelId]: `❌ ${result.error || '启动失败'}` 
                }));
            }
        } catch (error: any) {
            setOllamaDownloadMessages(prev => ({ 
                ...prev, 
                [modelId]: `❌ ${error.message || '启动失败'}` 
            }));
        }
    };

    // ========== 渲染 ==========
    
    return (
        <div className="modal-backdrop" onClick={handleBackdropClick}>
            <div className="settings-modal">
                {/* 头部 */}
                <div className="modal-header">
                    <h2>⚙️ 设置</h2>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                {/* Tab 导航 */}
                <div className="tabs-nav">
                    <button 
                        className={`tab-btn ${activeTab === 'ai-models' ? 'active' : ''}`}
                        onClick={() => setActiveTab('ai-models')}
                    >
                        <span className="tab-icon">🤖</span>
                        <span className="tab-label">AI 模型</span>
                    </button>
                    <button 
                        className={`tab-btn ${activeTab === 'image-models' ? 'active' : ''}`}
                        onClick={() => setActiveTab('image-models')}
                    >
                        <span className="tab-icon">🖼️</span>
                        <span className="tab-label">图像处理</span>
                    </button>
                    <button 
                        className={`tab-btn ${activeTab === 'api-keys' ? 'active' : ''}`}
                        onClick={() => setActiveTab('api-keys')}
                    >
                        <span className="tab-icon">🔑</span>
                        <span className="tab-label">API 密钥</span>
                    </button>
                    <button 
                        className={`tab-btn ${activeTab === 'integrations' ? 'active' : ''}`}
                        onClick={() => setActiveTab('integrations')}
                    >
                        <span className="tab-icon">🧩</span>
                        <span className="tab-label">MCP / Skills</span>
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'knowledge' ? 'active' : ''}`}
                        onClick={() => setActiveTab('knowledge')}
                    >
                        <span className="tab-icon">📚</span>
                        <span className="tab-label">设计知识</span>
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'preferences' ? 'active' : ''}`}
                        onClick={() => setActiveTab('preferences')}
                    >
                        <span className="tab-icon">🧭</span>
                        <span className="tab-label">用户偏好</span>
                    </button>
                    <button 
                        className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`}
                        onClick={() => setActiveTab('general')}
                    >
                        <span className="tab-icon">⚙️</span>
                        <span className="tab-label">常规</span>
                    </button>
                </div>

                {/* Tab 内容 */}
                <div className="modal-content">
                    {/* ==================== 设计知识 Tab ==================== */}
                    {activeTab === 'knowledge' && (
                        <div className="tab-content">
                            <div className="config-section">
                                <div className="section-header">
                                    <h3 className="section-title">设计知识搜索</h3>
                                    <span className={`badge ${designKnowledgeSummary.status === 'ready' ? 'success' : 'warning'}`}>
                                        {designKnowledgeSummary.status === 'ready' ? '已就绪' : '未就绪'}
                                    </span>
                                </div>
                                <p className="section-desc">
                                    这里只配置外部设计知识来源。搜索结果只能作为 Agent 的设计参考和来源说明，不会直接生成 Photoshop 操作。
                                </p>

                                <div className="integration-card" style={{ marginBottom: '16px' }}>
                                    <div className="integration-card-header">
                                        <div>
                                            <div className="integration-card-title">当前模型能力</div>
                                            <div className="integration-card-subtitle">
                                                只读摘要；用于判断当前模型是否支持工具流、公开推理显示和 provider-native 知识搜索。
                                            </div>
                                        </div>
                                        <span className={`badge ${designKnowledgeRuntimeCapability.status === 'ready' ? 'success' : 'warning'}`}>
                                            {designKnowledgeRuntimeCapability.status}
                                        </span>
                                    </div>
                                    <div className="integration-summary-grid" style={{ marginTop: '12px' }}>
                                        <div className="summary-stat-card">
                                            <span className="summary-stat-value">{designKnowledgeRuntimeCapability.selectedModel?.name || '未识别'}</span>
                                            <span className="summary-stat-label">当前规划模型</span>
                                        </div>
                                        <div className="summary-stat-card">
                                            <span className="summary-stat-value">{designKnowledgeRuntimeCapability.providerObservation.toolStream.mode}</span>
                                            <span className="summary-stat-label">工具流模式</span>
                                        </div>
                                        <div className="summary-stat-card">
                                            <span className="summary-stat-value">{designKnowledgeRuntimeCapability.providerObservation.providerThinkingDelta.status}</span>
                                            <span className="summary-stat-label">Provider 思考流</span>
                                        </div>
                                        <div className="summary-stat-card">
                                            <span className="summary-stat-value">{designKnowledgeRuntimeCapability.providerNativeWebSearch.status}</span>
                                            <span className="summary-stat-label">小米 Web Search</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="integration-card" style={{ marginBottom: '16px' }}>
                                    <div className="integration-card-header">
                                        <div>
                                            <div className="integration-card-title">小米官方 Web Search</div>
                                            <div className="integration-card-subtitle">
                                                Provider-native 工具，仅在小米官方 provider 和支持模型上允许进入请求计划；当前不会自动搜索。
                                            </div>
                                        </div>
                                        <label className="toggle-row">
                                            <input
                                                type="checkbox"
                                                checked={localDesignKnowledge.xiaomiWebSearch.enabled}
                                                onChange={(e) => handleUpdateDesignKnowledgeXiaomiWebSearch({ enabled: e.target.checked })}
                                                style={{ width: '16px', height: '16px', accentColor: 'var(--de-primary)' }}
                                            />
                                            <span>启用</span>
                                        </label>
                                    </div>
                                    <div className="mcp-grid">
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label>关键词数量</label>
                                            <input
                                                className="input"
                                                type="number"
                                                min={1}
                                                max={5}
                                                value={localDesignKnowledge.xiaomiWebSearch.maxKeyword}
                                                onChange={(e) => handleUpdateDesignKnowledgeXiaomiWebSearch({ maxKeyword: Number(e.target.value) })}
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label>结果数量</label>
                                            <input
                                                className="input"
                                                type="number"
                                                min={1}
                                                max={10}
                                                value={localDesignKnowledge.xiaomiWebSearch.limit}
                                                onChange={(e) => handleUpdateDesignKnowledgeXiaomiWebSearch({ limit: Number(e.target.value) })}
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label>用户位置</label>
                                            <input
                                                className="input"
                                                value={localDesignKnowledge.xiaomiWebSearch.userLocation}
                                                onChange={(e) => handleUpdateDesignKnowledgeXiaomiWebSearch({ userLocation: e.target.value })}
                                                placeholder="例如 China"
                                            />
                                        </div>
                                        <label className="toggle-row" style={{ alignSelf: 'end', minHeight: '42px' }}>
                                            <input
                                                type="checkbox"
                                                checked={localDesignKnowledge.xiaomiWebSearch.forceSearch}
                                                onChange={(e) => handleUpdateDesignKnowledgeXiaomiWebSearch({ forceSearch: e.target.checked })}
                                                style={{ width: '16px', height: '16px', accentColor: 'var(--de-primary)' }}
                                            />
                                            <span>强制搜索</span>
                                        </label>
                                        <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                                            <label>providerNativeWebSearch</label>
                                            <code className="integration-code">{designKnowledgeRuntimeCapability.providerNativeWebSearch.status}</code>
                                        </div>
                                    </div>
                                </div>

                                <div className="integration-card">
                                    <div className="integration-card-header">
                                        <div>
                                            <div className="integration-card-title">SearXNG 本地 Web RAG</div>
                                            <div className="integration-card-subtitle">
                                                可选 endpoint；DesignEcho 不启动、不停止、不管理 Docker / Harbor / SearXNG。
                                            </div>
                                        </div>
                                        <label className="toggle-row">
                                            <input
                                                type="checkbox"
                                                checked={localDesignKnowledge.searxng.enabled}
                                                onChange={(e) => handleUpdateDesignKnowledgeSearxng({ enabled: e.target.checked })}
                                                style={{ width: '16px', height: '16px', accentColor: 'var(--de-primary)' }}
                                            />
                                            <span>启用</span>
                                        </label>
                                    </div>

                                    <div className="mcp-grid">
                                        <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                                            <label>SearXNG endpoint</label>
                                            <input
                                                className="input"
                                                value={localDesignKnowledge.searxng.endpoint}
                                                onChange={(e) => handleUpdateDesignKnowledgeSearxng({ endpoint: e.target.value })}
                                                placeholder="例如 http://127.0.0.1:8080"
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label>语言</label>
                                            <input
                                                className="input"
                                                value={localDesignKnowledge.searxng.language}
                                                onChange={(e) => handleUpdateDesignKnowledgeSearxng({ language: e.target.value })}
                                                placeholder="zh-CN"
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label>安全搜索</label>
                                            <select
                                                className="select"
                                                value={localDesignKnowledge.searxng.safeSearch}
                                                onChange={(e) => handleUpdateDesignKnowledgeSearxng({ safeSearch: Number(e.target.value) as 0 | 1 | 2 })}
                                            >
                                                <option value={0}>关闭</option>
                                                <option value={1}>中等</option>
                                                <option value={2}>严格</option>
                                            </select>
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label>超时 ms</label>
                                            <input
                                                className="input"
                                                type="number"
                                                min={1000}
                                                max={30000}
                                                value={localDesignKnowledge.searxng.timeoutMs}
                                                onChange={(e) => handleUpdateDesignKnowledgeSearxng({ timeoutMs: Number(e.target.value) })}
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label>状态</label>
                                            <code className="integration-code">{designKnowledgeSummary.status}</code>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
                                        <button
                                            className="btn btn-secondary"
                                            type="button"
                                            onClick={handleTestDesignKnowledge}
                                            disabled={designKnowledgeTestStatus === 'testing'}
                                        >
                                            {designKnowledgeTestStatus === 'testing' ? '测试中...' : '测试连接'}
                                        </button>
                                        {designKnowledgeTestMessage && (
                                            <span className={`test-message ${designKnowledgeTestStatus}`}>
                                                {designKnowledgeTestMessage}
                                            </span>
                                        )}
                                    </div>

                                    {designKnowledgeSummary.warnings.length > 0 && (
                                        <div className="integration-empty-state" style={{ marginTop: '16px' }}>
                                            {designKnowledgeSummary.warnings.map((warning) => (
                                                <div key={warning}>{warning}</div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ==================== 用户偏好 Tab ==================== */}
                    {activeTab === 'preferences' && (
                        <div className="tab-content">
                            <div className="config-section">
                                <div className="section-header">
                                    <h3 className="section-title">用户偏好记忆</h3>
                                    <span className="badge" style={{ background: activePreferenceCount > 0 ? '#059669' : '#6b7280' }}>
                                        {activePreferenceCount} 条启用
                                    </span>
                                </div>
                                <p className="section-desc">
                                    这里管理 Agent 可参考的本地偏好。待确认和已禁用的偏好不会进入设计知识，也不会直接触发 Photoshop 操作。
                                </p>

                                <div className="integration-summary-grid" style={{ marginBottom: '16px' }}>
                                    <div className="summary-stat-card">
                                        <span className="summary-stat-value">{activePreferenceCount}</span>
                                        <span className="summary-stat-label">启用偏好</span>
                                    </div>
                                    <div className="summary-stat-card">
                                        <span className="summary-stat-value">{reviewPreferenceCount}</span>
                                        <span className="summary-stat-label">待确认推断</span>
                                    </div>
                                    <div className="summary-stat-card">
                                        <span className="summary-stat-value">{disabledPreferenceCount}</span>
                                        <span className="summary-stat-label">已禁用</span>
                                    </div>
                                    <div className="summary-stat-card">
                                        <span className="summary-stat-value">{archivedPreferenceCount}</span>
                                        <span className="summary-stat-label">已归档</span>
                                    </div>
                                </div>

                                <div className="integration-card" style={{ marginBottom: '16px' }}>
                                    <div className="integration-card-header">
                                        <div>
                                            <div className="integration-card-title">偏好维护</div>
                                            <div className="integration-card-subtitle">
                                                显式偏好会进入本地设计知识；推断偏好需要人工确认后才能启用。
                                            </div>
                                        </div>
                                        <div className="preference-actions">
                                            <button
                                                className="btn btn-primary"
                                                type="button"
                                                onClick={handleCreatePreference}
                                            >
                                                新增偏好
                                            </button>
                                            <button
                                                className="btn btn-secondary"
                                                type="button"
                                                onClick={handleExportPreferences}
                                            >
                                                导出偏好
                                            </button>
                                            <button
                                                className="btn btn-secondary"
                                                type="button"
                                                onClick={handleClearInferredPreferences}
                                                disabled={reviewPreferenceCount === 0}
                                            >
                                                清理待确认
                                            </button>
                                        </div>
                                    </div>
                                    {preferenceMessage && (
                                        <div className="test-message success" style={{ marginTop: '12px' }}>
                                            {preferenceMessage}
                                        </div>
                                    )}
                                </div>

                                {preferenceEditorOpen && (
                                    <div className="integration-card preference-editor-card" style={{ marginBottom: '16px' }}>
                                        <div className="integration-card-header">
                                            <div>
                                                <div className="integration-card-title">
                                                    {editingPreferenceId ? '编辑偏好' : '新增偏好'}
                                                </div>
                                                <div className="integration-card-subtitle">
                                                    用于记录明确偏好；不会绕过当前任务、商品事实或平台规范。
                                                </div>
                                            </div>
                                        </div>
                                        <div className="preference-editor-grid">
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label>分类</label>
                                                <select
                                                    className="select"
                                                    value={preferenceDraft.category}
                                                    onChange={(event) => setPreferenceDraft((prev) => ({
                                                        ...prev,
                                                        category: event.target.value as PreferenceMemoryItem['category']
                                                    }))}
                                                >
                                                    {Object.entries(PREFERENCE_CATEGORY_LABELS).map(([value, label]) => (
                                                        <option key={value} value={value}>{label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label>作用域</label>
                                                <select
                                                    className="select"
                                                    value={preferenceDraft.scopeType}
                                                    onChange={(event) => setPreferenceDraft((prev) => ({
                                                        ...prev,
                                                        scopeType: event.target.value as PreferenceScopeType,
                                                        scopeId: event.target.value === 'user' ? '' : prev.scopeId
                                                    }))}
                                                >
                                                    {Object.entries(PREFERENCE_SCOPE_LABELS).map(([value, label]) => (
                                                        <option key={value} value={value}>{label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label>作用域 ID</label>
                                                <input
                                                    className="input"
                                                    value={preferenceDraft.scopeId}
                                                    disabled={preferenceDraft.scopeType === 'user'}
                                                    placeholder={preferenceDraft.scopeType === 'project' ? '例如 C-1160' : '非用户级偏好需要填写'}
                                                    onChange={(event) => setPreferenceDraft((prev) => ({
                                                        ...prev,
                                                        scopeId: event.target.value
                                                    }))}
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label>偏好值</label>
                                                <input
                                                    className="input"
                                                    value={preferenceDraft.value}
                                                    placeholder="例如 高级灰、低广告感文案、阿里巴巴普惠体"
                                                    onChange={(event) => setPreferenceDraft((prev) => ({
                                                        ...prev,
                                                        value: event.target.value
                                                    }))}
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label>显示名称</label>
                                                <input
                                                    className="input"
                                                    value={preferenceDraft.label}
                                                    placeholder="可选，不填则自动生成"
                                                    onChange={(event) => setPreferenceDraft((prev) => ({
                                                        ...prev,
                                                        label: event.target.value
                                                    }))}
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                                                <label>依据说明</label>
                                                <textarea
                                                    className="input"
                                                    rows={3}
                                                    value={preferenceDraft.evidenceSummary}
                                                    placeholder="说明这个偏好来自哪次明确要求或验收结论"
                                                    onChange={(event) => setPreferenceDraft((prev) => ({
                                                        ...prev,
                                                        evidenceSummary: event.target.value
                                                    }))}
                                                />
                                            </div>
                                        </div>
                                        <div className="preference-form-actions">
                                            <button className="btn btn-primary" type="button" onClick={handleSavePreferenceDraft}>
                                                保存偏好
                                            </button>
                                            <button className="btn btn-secondary" type="button" onClick={handleCancelPreferenceEdit}>
                                                取消
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className="integration-card preference-import-export-card" style={{ marginBottom: '16px' }}>
                                    <div className="integration-card-header">
                                        <div>
                                            <div className="integration-card-title">导入偏好</div>
                                            <div className="integration-card-subtitle">
                                                导入只接受结构化偏好 JSON；无效字段会被丢弃，默认合并到当前记忆。
                                            </div>
                                        </div>
                                        <button
                                            className="btn btn-secondary"
                                            type="button"
                                            onClick={handleImportPreferences}
                                        >
                                            导入偏好
                                        </button>
                                    </div>
                                    <textarea
                                        className="input preference-json-textarea"
                                        rows={4}
                                        value={preferenceImportText}
                                        placeholder="粘贴 designecho-preferences/v1 JSON"
                                        onChange={(event) => setPreferenceImportText(event.target.value)}
                                    />
                                    {preferenceExportText && (
                                        <textarea
                                            className="input preference-json-textarea"
                                            rows={4}
                                            value={preferenceExportText}
                                            readOnly
                                            style={{ marginTop: '12px' }}
                                        />
                                    )}
                                </div>

                                {preferenceItems.length === 0 ? (
                                    <div className="integration-empty-state">
                                        还没有本地偏好。后续显式设置的偏好会显示在这里；自动推断项会先进入待确认状态。
                                    </div>
                                ) : (
                                    <div className="preference-list">
                                        {preferenceItems.map((item) => (
                                            <div key={item.id} className={`preference-card preference-card-${item.status}`}>
                                                <div className="preference-card-main">
                                                    <div className="preference-title-row">
                                                        <span className="preference-title">{item.label}</span>
                                                        <span className={`badge preference-status-${item.status}`}>
                                                            {PREFERENCE_STATUS_LABELS[item.status]}
                                                        </span>
                                                    </div>
                                                    <div className="preference-meta">
                                                        <span>{PREFERENCE_CATEGORY_LABELS[item.category]}</span>
                                                        <span>{PREFERENCE_SOURCE_LABELS[item.sourceType]}</span>
                                                        <span>
                                                            {PREFERENCE_SCOPE_LABELS[item.scope?.type || 'user']}
                                                            {item.scope?.id ? `：${item.scope.id}` : ''}
                                                        </span>
                                                        <span>使用 {item.usageCount || 0} 次</span>
                                                    </div>
                                                    <p className="preference-evidence">{item.evidenceSummary}</p>
                                                </div>
                                                <div className="preference-actions">
                                                    {item.status !== 'archived' && (
                                                        <button
                                                            className="btn btn-secondary"
                                                            type="button"
                                                            onClick={() => handleEditPreference(item)}
                                                        >
                                                            编辑
                                                        </button>
                                                    )}
                                                    {item.status !== 'archived' && (
                                                        <button
                                                            className="btn btn-secondary"
                                                            type="button"
                                                            onClick={() => handleTogglePreference(item)}
                                                        >
                                                            {item.status === 'active'
                                                                ? '禁用'
                                                                : item.sourceType === 'inferred' || item.status === 'needs_review'
                                                                    ? '确认并启用'
                                                                    : '启用'}
                                                        </button>
                                                    )}
                                                    {item.status !== 'archived' && (
                                                        <button
                                                            className="btn btn-secondary"
                                                            type="button"
                                                            onClick={() => handleArchivePreference(item)}
                                                        >
                                                            归档
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ==================== MCP / Skills Tab ==================== */}
                    {activeTab === 'integrations' && (
                        <div className="tab-content">
                            <div className="config-section">
                                <div className="section-header">
                                    <h3 className="section-title">集成控制台</h3>
                                    <span className="badge" style={{ background: '#2563eb' }}>统一管理</span>
                                </div>
                                <p className="section-desc">
                                    这里作为 Skills 与 MCP 的单一配置入口。Skill 开关会直接影响智能体可选能力；MCP 先统一管理配置和启用状态，后续运行器接线也应以这里为唯一数据源。
                                </p>
                                <div className="integration-summary-grid">
                                    <div className="summary-stat-card">
                                        <span className="summary-stat-value">{enabledSkillCount} / {visibleSkills.length}</span>
                                        <span className="summary-stat-label">启用 Skills</span>
                                    </div>
                                    <div className="summary-stat-card">
                                        <span className="summary-stat-value">{enabledMcpCount} / {localIntegration.mcpServers.length}</span>
                                        <span className="summary-stat-label">启用外部 MCP</span>
                                    </div>
                                    <div className="summary-stat-card">
                                        <span className="summary-stat-value">{BUILTIN_MCP_SERVERS.length}</span>
                                        <span className="summary-stat-label">内置 MCP</span>
                                    </div>
                                </div>
                            </div>

                            <div className="config-section">
                                <div className="section-header">
                                    <h3 className="section-title">Skills</h3>
                                    <span className="badge" style={{ background: '#0f766e' }}>影响智能体决策</span>
                                </div>
                                <p className="section-desc">
                                    关闭某个 Skill 后，统一智能体不会再把它当成可选执行路径。这里显示声明、分类、依赖工具和本地执行器接线状态。
                                </p>
                                <div className="skill-group-stack">
                                    {skillGroups.map(([category, skills]) => (
                                        <div className="integration-card" key={category}>
                                            <div className="integration-card-header">
                                                <div>
                                                    <div className="integration-card-title">
                                                        {SKILL_CATEGORY_LABELS[category] || category}
                                                    </div>
                                                    <div className="integration-card-subtitle">
                                                        {skills.length} 个技能
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="skill-list">
                                                {skills.map((skill) => {
                                                    const enabled = localIntegration.skills?.[skill.id]?.enabled !== false;
                                                    const executor = getSkillExecutor(skill.id);
                                                    return (
                                                        <label className={`skill-item-row ${enabled ? '' : 'disabled'}`} key={skill.id}>
                                                            <input
                                                                type="checkbox"
                                                                checked={enabled}
                                                                onChange={(e) => handleToggleSkill(skill.id, e.target.checked)}
                                                                style={{ width: '16px', height: '16px', accentColor: 'var(--de-primary)' }}
                                                            />
                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                                                                    <span style={{ fontWeight: 600 }}>{skill.name}</span>
                                                                    <span className="mini-badge">{skill.id}</span>
                                                                    <span className="mini-badge">{skill.requiredTools.length} tools</span>
                                                                    <span className={`mini-badge ${executor ? 'success' : 'warning'}`}>
                                                                        {executor ? '已接执行器' : '仅声明'}
                                                                    </span>
                                                                </div>
                                                                <div style={{ fontSize: '12px', color: 'var(--de-text-secondary)', lineHeight: 1.55 }}>
                                                                    {skill.description}
                                                                </div>
                                                            </div>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="config-section">
                                <div className="section-header">
                                    <h3 className="section-title">MCP</h3>
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        <button className="btn btn-secondary" type="button" onClick={() => handleAddMcpServer('stdio')}>
                                            + 添加 Stdio
                                        </button>
                                        <button className="btn btn-secondary" type="button" onClick={() => handleAddMcpServer('http')}>
                                            + 添加 HTTP
                                        </button>
                                    </div>
                                </div>
                                <p className="section-desc">
                                    内置 MCP 能力用于 Photoshop 与桌面端桥接；外部 MCP 服务器在这里登记 transport、命令、参数或 URL，避免后续继续散落在代码里硬编码。
                                </p>

                                <div className="integration-card" style={{ marginBottom: '16px' }}>
                                    <div className="integration-card-header">
                                        <div>
                                            <div className="integration-card-title">内置 MCP</div>
                                            <div className="integration-card-subtitle">系统提供，作为只读能力展示</div>
                                        </div>
                                    </div>
                                    <div className="builtin-mcp-list">
                                        {BUILTIN_MCP_SERVERS.map((server) => (
                                            <div className="builtin-mcp-item" key={server.id}>
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                                                        <span style={{ fontWeight: 600 }}>{server.name}</span>
                                                        <span className="mini-badge success">内置</span>
                                                        <span className="mini-badge">{server.transport}</span>
                                                    </div>
                                                    <div style={{ fontSize: '12px', color: 'var(--de-text-secondary)', marginBottom: '6px' }}>
                                                        {server.description}
                                                    </div>
                                                    <code className="integration-code">{server.endpoint}</code>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="integration-card">
                                    <div className="integration-card-header">
                                        <div>
                                            <div className="integration-card-title">外部 MCP 服务器</div>
                                            <div className="integration-card-subtitle">可新增、编辑、禁用和删除</div>
                                        </div>
                                    </div>
                                    {localIntegration.mcpServers.length === 0 ? (
                                        <div className="integration-empty-state">
                                            <div style={{ fontWeight: 600, marginBottom: '6px' }}>还没有外部 MCP 服务器</div>
                                            <div style={{ fontSize: '12px', color: 'var(--de-text-secondary)' }}>
                                                先从常用的 Stdio 或 HTTP 入口开始登记，例如 Eagle、本地 Node Proxy、内部 HTTP MCP 网关。
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="mcp-server-stack">
                                            {localIntegration.mcpServers.map((server) => (
                                                <div className="mcp-server-card" key={server.id}>
                                                    <div className="mcp-server-header">
                                                        <div className="toggle-row">
                                                            <input
                                                                type="checkbox"
                                                                checked={server.enabled}
                                                                onChange={(e) => handleUpdateMcpServer(server.id, { enabled: e.target.checked })}
                                                                style={{ width: '16px', height: '16px', accentColor: 'var(--de-primary)' }}
                                                            />
                                                            <span style={{ fontWeight: 600 }}>启用此服务器</span>
                                                        </div>
                                                        <button
                                                            className="btn btn-secondary"
                                                            type="button"
                                                            onClick={() => handleRemoveMcpServer(server.id)}
                                                        >
                                                            删除
                                                        </button>
                                                    </div>
                                                    <div className="mcp-grid">
                                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                                            <label>名称</label>
                                                            <input
                                                                className="input"
                                                                value={server.name}
                                                                onChange={(e) => handleUpdateMcpServer(server.id, { name: e.target.value })}
                                                                placeholder="例如 Eagle MCP"
                                                            />
                                                        </div>
                                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                                            <label>Transport</label>
                                                            <select
                                                                className="select"
                                                                value={server.transport}
                                                                onChange={(e) => handleUpdateMcpServer(server.id, {
                                                                    transport: e.target.value as 'stdio' | 'http',
                                                                    command: e.target.value === 'stdio' ? (server.command || 'node') : '',
                                                                    url: e.target.value === 'http' ? (server.url || 'http://127.0.0.1:3000/mcp') : ''
                                                                })}
                                                            >
                                                                <option value="stdio">stdio</option>
                                                                <option value="http">http</option>
                                                            </select>
                                                        </div>
                                                        {server.transport === 'stdio' ? (
                                                            <>
                                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                                    <label>命令</label>
                                                                    <input
                                                                        className="input"
                                                                        value={server.command || ''}
                                                                        onChange={(e) => handleUpdateMcpServer(server.id, { command: e.target.value })}
                                                                        placeholder="node"
                                                                    />
                                                                </div>
                                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                                    <label>参数（每行一个）</label>
                                                                    <textarea
                                                                        className="input"
                                                                        value={(server.args || []).join('\n')}
                                                                        onChange={(e) => handleUpdateMcpServer(server.id, {
                                                                            args: e.target.value
                                                                                .split(/\r?\n/)
                                                                                .map((line) => line.trim())
                                                                                .filter(Boolean)
                                                                        })}
                                                                        placeholder="C:/path/to/mcp-proxy.js"
                                                                        style={{ minHeight: '88px', resize: 'vertical' }}
                                                                    />
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                                                                <label>URL</label>
                                                                <input
                                                                    className="input"
                                                                    value={server.url || ''}
                                                                    onChange={(e) => handleUpdateMcpServer(server.id, { url: e.target.value })}
                                                                    placeholder="http://127.0.0.1:41596/mcp"
                                                                />
                                                            </div>
                                                        )}
                                                        <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                                                            <label>备注</label>
                                                            <textarea
                                                                className="input"
                                                                value={server.notes || ''}
                                                                onChange={(e) => handleUpdateMcpServer(server.id, { notes: e.target.value })}
                                                                placeholder="记录用途、依赖应用、示例命令或接入边界"
                                                                style={{ minHeight: '72px', resize: 'vertical' }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ==================== 常规设置 Tab ==================== */}
                    {activeTab === 'general' && (
                        <div className="tab-content">
                            {/* 外观设置 */}
                            <div className="config-section">
                                <h3 className="section-title">外观</h3>
                                <div style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center',
                                    padding: '16px',
                                    background: 'var(--de-bg-light)',
                                    borderRadius: '8px',
                                    border: '1px solid var(--de-border)'
                                }}>
                                    <div>
                                        <div style={{ fontWeight: 500, marginBottom: '4px' }}>主题</div>
                                        <div style={{ fontSize: '12px', color: 'var(--de-text-secondary)' }}>
                                            选择界面外观主题
                                        </div>
                                    </div>
                                    <select 
                                        className="select"
                                        value={theme}
                                        onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
                                        style={{ 
                                            width: '120px',
                                            padding: '8px 12px',
                                            borderRadius: '6px',
                                            border: '1px solid var(--de-border)',
                                            background: 'var(--de-bg)',
                                            color: 'var(--de-text)',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        <option value="system">跟随系统</option>
                                        <option value="dark">深色</option>
                                        <option value="light">浅色</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ==================== AI 模型 Tab ==================== */}
                    {activeTab === 'ai-models' && (
                        <div className="tab-content">
                            {/* 模型模式选择 */}
                            <div className="config-section">
                                <h3 className="section-title">运行模式</h3>
                                <div className="mode-cards">
                                    <div 
                                        className={`mode-card ${localPrefs.mode === 'local' ? 'active' : ''}`}
                                        onClick={() => setLocalPrefs(p => ({ ...p, mode: 'local' }))}
                                    >
                                        <div className="mode-header">
                                            <span className="mode-icon">🏠</span>
                                            <span className="mode-name">本地模式</span>
                                            {ollamaStatus === 'online' && <span className="badge success">在线</span>}
                                            {ollamaStatus === 'offline' && <span className="badge error">离线</span>}
                                        </div>
                                        <p className="mode-desc">使用 Ollama 运行本地 LLM，完全免费</p>
                                    </div>
                                    
                                    <div 
                                        className={`mode-card ${localPrefs.mode === 'cloud' ? 'active' : ''}`}
                                        onClick={() => setLocalPrefs(p => ({ ...p, mode: 'cloud' }))}
                                    >
                                        <div className="mode-header">
                                            <span className="mode-icon">☁️</span>
                                            <span className="mode-name">云端模式</span>
                                            {localKeys.openrouter && <span className="badge success">已配置</span>}
                                        </div>
                                        <p className="mode-desc">通过 OpenRouter 使用 Claude/GPT-4o 等</p>
                                    </div>
                                    
                                    <div 
                                        className={`mode-card ${localPrefs.mode === 'auto' ? 'active' : ''}`}
                                        onClick={() => setLocalPrefs(p => ({ ...p, mode: 'auto' }))}
                                    >
                                        <div className="mode-header">
                                            <span className="mode-icon">🔄</span>
                                            <span className="mode-name">自动模式</span>
                                        </div>
                                        <p className="mode-desc">本地优先，失败自动切换到云端</p>
                                    </div>
                                </div>
                            </div>

                            {/* 本地模型配置 */}
                            {(localPrefs.mode === 'local' || localPrefs.mode === 'auto') && (
                                <div className="config-section local-section">
                                    <div className="section-header">
                                        <h3 className="section-title">🏠 本地模型 (Ollama)</h3>
                                        <div className="ollama-status">
                                            {ollamaStatus === 'online' ? (
                                                <span className="status-text success">✓ 已连接</span>
                                            ) : (
                                                <span className="status-text error">✗ 未连接</span>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {/* Ollama 服务地址配置 */}
                                    <div className="form-group ollama-url-group" style={{ marginBottom: '16px' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                            <span>服务地址</span>
                                            {ollamaStatus === 'checking' && <span className="badge">检测中...</span>}
                                        </label>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <input
                                                type="text"
                                                className="input"
                                                placeholder="http://localhost:11434"
                                                value={localKeys.ollamaUrl}
                                                onChange={e => setLocalKeys(k => ({ ...k, ollamaUrl: e.target.value }))}
                                                style={{ flex: 1 }}
                                            />
                                            <button
                                                className="btn btn-sm"
                                                onClick={async () => {
                                                    setOllamaStatus('checking');
                                                    try {
                                                        const response = await fetch(`${localKeys.ollamaUrl}/api/tags`);
                                                        if (response.ok) {
                                                            const data = await response.json();
                                                            setInstalledModels(data.models?.map((m: any) => m.name) || []);
                                                            setOllamaStatus('online');
                                                        } else {
                                                            setOllamaStatus('offline');
                                                        }
                                                    } catch {
                                                        setOllamaStatus('offline');
                                                    }
                                                }}
                                                style={{ padding: '6px 12px' }}
                                            >
                                                🔄 检测
                                            </button>
                                        </div>
                                        <p className="hint" style={{ marginTop: '4px', fontSize: '11px', color: '#888' }}>
                                            默认地址: http://localhost:11434
                                        </p>
                                    </div>
                                    
                                    {ollamaStatus === 'offline' && (
                                        <div className="alert warning">
                                            <p>Ollama 服务未运行。请先安装并启动 Ollama：</p>
                                            <code>ollama serve</code>
                                        </div>
                                    )}

                                    {/* 三个任务的模型选择 */}
                                    <div className="task-models">
                                        {TASK_CATEGORIES.map(cat => (
                                            <div key={cat.id} className="task-model-item">
                                                <label>
                                                    <TaskIcon type={cat.iconType} />
                                                    <span className="task-name">{cat.name}</span>
                                                </label>
                                                <select
                                                    className="select"
                                                    value={localPrefs.preferredLocalModels[cat.id]}
                                                    onChange={e => setLocalPrefs(p => ({
                                                        ...p,
                                                        preferredLocalModels: { ...p.preferredLocalModels, [cat.id]: e.target.value }
                                                    }))}
                                                >
                                                    {OLLAMA_MODELS.filter(m => 
                                                        cat.id !== 'visualAnalyze' || m.vision
                                                    ).map(m => (
                                                        <option key={m.id} value={m.id}>
                                                            {m.name} {isModelInstalled(m.id) ? '✓' : `(${m.size})`}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        ))}
                                    </div>

                                    {/* 已安装模型 */}
                                    {installedModels.length > 0 && (
                                        <div className="installed-list">
                                            <span className="installed-label">已安装：</span>
                                            {installedModels.map(m => (
                                                <span key={m} className="installed-tag">{m}</span>
                                            ))}
                                        </div>
                                    )}
                                    
                                    {/* 模型测试按钮 */}
                                    <div className="model-test-section" style={{ marginTop: '16px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                                            <button 
                                                className="btn btn-secondary"
                                                onClick={testSelectedModels}
                                                disabled={modelTestStatus === 'testing' || ollamaStatus === 'offline'}
                                                style={{ 
                                                    padding: '8px 16px',
                                                    fontSize: '13px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px'
                                                }}
                                            >
                                                {modelTestStatus === 'testing' ? (
                                                    <>⏳ 正在测试...</>
                                                ) : (
                                                    <>🧪 测试选中的模型</>
                                                )}
                                            </button>
                                            <span style={{ fontSize: '12px', color: '#888' }}>
                                                验证模型是否可用
                                            </span>
                                        </div>
                                        
                                        {/* 测试结果 */}
                                        {Object.keys(modelTestResults).length > 0 && (
                                            <div className="test-results" style={{ 
                                                display: 'flex', 
                                                flexDirection: 'column', 
                                                gap: '6px',
                                                fontSize: '12px'
                                            }}>
                                                {Object.entries(modelTestResults).map(([modelId, result]) => {
                                                    const isNotDownloaded = result.message.includes('模型未下载');
                                                    const isDownloading = ollamaDownloading[modelId];
                                                    const downloadMsg = ollamaDownloadMessages[modelId];
                                                    
                                                    return (
                                                    <div 
                                                        key={modelId} 
                                                        style={{ 
                                                            display: 'flex', 
                                                            alignItems: 'center', 
                                                            gap: '8px',
                                                            padding: '6px 10px',
                                                            background: result.status === 'success' ? 'rgba(16,185,129,0.1)' : 
                                                                       result.status === 'error' ? 'rgba(239,68,68,0.1)' : 
                                                                       'rgba(255,255,255,0.05)',
                                                            borderRadius: '4px',
                                                            borderLeft: `3px solid ${
                                                                result.status === 'success' ? '#10b981' : 
                                                                result.status === 'error' ? '#ef4444' : 
                                                                '#6b7280'
                                                            }`
                                                        }}
                                                    >
                                                        <span style={{ fontWeight: 500, minWidth: '120px' }}>
                                                            {OLLAMA_MODELS.find(m => m.id === modelId)?.name || modelId}
                                                        </span>
                                                        <span style={{ 
                                                            color: result.status === 'success' ? '#10b981' : 
                                                                   result.status === 'error' ? '#ef4444' : 
                                                                       '#9ca3af',
                                                                flex: 1
                                                        }}>
                                                                {downloadMsg || result.message}
                                                        </span>
                                                            {/* 下载按钮 - 当模型未下载时显示 */}
                                                            {isNotDownloaded && !isDownloading && !downloadMsg?.includes('✅') && !downloadMsg?.includes('📺') && (
                                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                                    <button
                                                                        onClick={() => handleDownloadOllamaModel(modelId)}
                                                                        title="在后台下载，可以继续使用应用"
                                                                        style={{
                                                                            padding: '2px 8px',
                                                                            fontSize: '11px',
                                                                            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                                                                            border: 'none',
                                                                            borderRadius: '4px',
                                                                            color: '#fff',
                                                                            cursor: 'pointer',
                                                                            whiteSpace: 'nowrap'
                                                                        }}
                                                                    >
                                                                        📥 下载
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDownloadOllamaModelInTerminal(modelId)}
                                                                        title="在终端中下载，可以看到详细进度"
                                                                        style={{
                                                                            padding: '2px 8px',
                                                                            fontSize: '11px',
                                                                            background: 'rgba(255,255,255,0.1)',
                                                                            border: '1px solid rgba(255,255,255,0.2)',
                                                                            borderRadius: '4px',
                                                                            color: '#9ca3af',
                                                                            cursor: 'pointer',
                                                                            whiteSpace: 'nowrap'
                                                                        }}
                                                                    >
                                                                        📺 终端
                                                                    </button>
                                                    </div>
                                                            )}
                                                            {isDownloading && (
                                                                <span style={{ 
                                                                    fontSize: '11px', 
                                                                    color: '#60a5fa'
                                                                }}>
                                                                    {downloadMsg || '⏳ 下载中...'}
                                                                </span>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* 云端模型配置 */}
                            {(localPrefs.mode === 'cloud' || localPrefs.mode === 'auto') && (() => {
                                // 检测用户选择的云端模型需要哪些 API Key
                                const selectedModels = Object.values(localPrefs.preferredCloudModels);
                                const needsGoogle = selectedModels.some(m => m?.startsWith('google-'));
                                const needsXiaomi = selectedModels.some(m => m?.startsWith('xiaomi-'));
                                const needsOpenRouter = selectedModels.some(m => m?.startsWith('openrouter-'));
                                const needsOllamaCloud = selectedModels.some(m => m?.startsWith('ollama-cloud-'));
                                const needsGPTsAPI = selectedModels.some(m => m?.startsWith('gptsapi-'));
                                const needsDeepSeek = selectedModels.some(m => m?.startsWith('deepseek-'));
                                
                                const hasGoogle = !!(localKeys.google && localKeys.google.length > 10);
                                const hasXiaomi = !!(localKeys.xiaomi && localKeys.xiaomi.length > 10);
                                const hasOpenRouter = !!(localKeys.openrouter && localKeys.openrouter.length > 10);
                                const hasOllamaCloud = !!(localKeys.ollamaApiKey && localKeys.ollamaApiKey.length > 10);
                                const hasGPTsAPI = !!(localKeys.gptsapi && localKeys.gptsapi.length > 10);
                                const hasDeepSeek = !!(localKeys.deepseek && localKeys.deepseek.length > 10);
                                
                                const missingKeys: string[] = [];
                                if (needsGoogle && !hasGoogle) missingKeys.push('Google AI Studio');
                                if (needsXiaomi && !hasXiaomi) missingKeys.push('Xiaomi MiMo');
                                if (needsOpenRouter && !hasOpenRouter) missingKeys.push('OpenRouter');
                                if (needsOllamaCloud && !hasOllamaCloud) missingKeys.push('Ollama Cloud');
                                if (needsGPTsAPI && !hasGPTsAPI) missingKeys.push('GPTs API');
                                if (needsDeepSeek && !hasDeepSeek) missingKeys.push('DeepSeek');
                                
                                const hasMissingKeys = missingKeys.length > 0;
                                
                                return (
                                <div className="config-section cloud-section">
                                    <div className="section-header">
                                        <h3 className="section-title">☁️ 云端模型</h3>
                                        {hasMissingKeys && (
                                            <span className="status-text warning">需要配置 API Key</span>
                                        )}
                                    </div>

                                    {hasMissingKeys && (
                                        <div className="alert info">
                                            请先在「API 密钥」页面配置 {missingKeys.join(' / ')} API Key
                                        </div>
                                    )}

                                    {/* 三个任务的模型选择 */}
                                    <div className="task-models">
                                        {TASK_CATEGORIES.map(cat => (
                                            <div key={cat.id} className="task-model-item">
                                                <label>
                                                    <TaskIcon type={cat.iconType} />
                                                    <span className="task-name">{cat.name}</span>
                                                </label>
                                                <select
                                                    className="select"
                                                    value={localPrefs.preferredCloudModels[cat.id]}
                                                    onChange={e => setLocalPrefs(p => ({
                                                        ...p,
                                                        preferredCloudModels: { ...p.preferredCloudModels, [cat.id]: e.target.value }
                                                    }))}
                                                >
                                                    <optgroup label="🧭 GPTs API (OpenAI 兼容)">
                                                        {GPTSAPI_MODELS.filter(m => 
                                                            cat.id !== 'visualAnalyze' || m.vision
                                                        ).map(m => (
                                                            <option key={m.id} value={m.id}>
                                                                {m.name}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                    <optgroup label="🟢 DeepSeek (官方)">
                                                        {DEEPSEEK_MODELS.filter(m =>
                                                            cat.id !== 'visualAnalyze' || m.vision
                                                        ).map(m => (
                                                            <option key={m.id} value={m.id}>
                                                                {m.name}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                    {/* Google AI Studio 官方渠道 */}
                                                    <optgroup label="🔷 Google AI Studio (官方)">
                                                        {GOOGLE_MODELS.filter(m => 
                                                            cat.id !== 'visualAnalyze' || m.vision
                                                        ).map(m => (
                                                        <option key={m.id} value={m.id}>
                                                                {m.name.replace(' (官方)', '')}
                                                        </option>
                                                    ))}
                                                    </optgroup>
                                                    <optgroup label="🟠 Xiaomi MiMo (官方)">
                                                        {XIAOMI_MODELS.filter(m =>
                                                            cat.id !== 'visualAnalyze' || m.vision
                                                        ).map(m => (
                                                            <option key={m.id} value={m.id}>
                                                                {m.name}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                    {/* Ollama 云服务 */}
                                                    <optgroup label="🦙 Ollama Cloud (免费额度)">
                                                        {OLLAMA_CLOUD_MODELS.filter(m => 
                                                            cat.id !== 'visualAnalyze' || m.vision
                                                        ).map(m => (
                                                            <option key={m.id} value={m.id}>
                                                                {m.name}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                    {/* OpenRouter 渠道 */}
                                                    <optgroup label="🌐 OpenRouter (中转)">
                                                        {OPENROUTER_MODELS.filter(m => 
                                                            cat.id !== 'visualAnalyze' || m.vision
                                                        ).map(m => (
                                                            <option key={m.id} value={m.id}>
                                                                {m.name}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                </select>
                                            </div>
                                        ))}
                                    </div>

                                    {/* 推荐模型 */}
                                    <div className="recommended-models">
                                        <span className="recommended-label">推荐模型：</span>
                                        {CLOUD_MODELS.filter(m => m.recommended).slice(0, 4).map(m => (
                                            <span key={m.id} className="recommended-tag">{m.name.replace(' (官方)', '')}</span>
                                        ))}
                                    </div>
                                </div>
                                );
                            })()}
                            
                            {/* ==================== Agent 高级设置 ==================== */}
                            <div className="config-section" style={{ marginTop: '24px' }}>
                                <h3 className="section-title">⚡ Agent 高级设置</h3>
                                <p className="section-desc" style={{ color: 'var(--de-text-secondary)', fontSize: '12px', marginBottom: '16px' }}>
                                    优化 AI 对话性能和成本
                                </p>
                                
                                {/* 对话压缩设置 */}
                                <div className="setting-card" style={{ 
                                    background: 'var(--de-bg)', 
                                    borderRadius: '8px', 
                                    padding: '16px',
                                    border: '1px solid var(--de-border)'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                        <div>
                                            <div style={{ fontWeight: 500, marginBottom: '4px' }}>🗜️ 对话上下文压缩</div>
                                            <div style={{ fontSize: '12px', color: 'var(--de-text-secondary)' }}>
                                                当对话过长时自动生成摘要，节省 token 成本
                                            </div>
                                        </div>
                                        <label className="toggle-switch">
                                            <input 
                                                type="checkbox" 
                                                checked={agentSettings.contextCompression.enabled}
                                                onChange={(e) => setAgentSettings({
                                                    contextCompression: {
                                                        ...agentSettings.contextCompression,
                                                        enabled: e.target.checked
                                                    }
                                                })}
                                            />
                                            <span className="toggle-slider"></span>
                                        </label>
                                    </div>
                                    
                                    {agentSettings.contextCompression.enabled && (
                                        <div style={{ display: 'flex', gap: '16px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--de-border)' }}>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ fontSize: '11px', color: 'var(--de-text-secondary)', display: 'block', marginBottom: '4px' }}>
                                                    触发阈值 (tokens)
                                                </label>
                                                <select 
                                                    value={agentSettings.contextCompression.tokenThreshold}
                                                    onChange={(e) => setAgentSettings({
                                                        contextCompression: {
                                                            ...agentSettings.contextCompression,
                                                            tokenThreshold: parseInt(e.target.value)
                                                        }
                                                    })}
                                                    style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', background: 'var(--de-bg-card)', border: '1px solid var(--de-border)', color: 'var(--de-text)' }}
                                                >
                                                    <option value={30000}>30k (激进)</option>
                                                    <option value={60000}>60k (推荐)</option>
                                                    <option value={100000}>100k (宽松)</option>
                                                </select>
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ fontSize: '11px', color: 'var(--de-text-secondary)', display: 'block', marginBottom: '4px' }}>
                                                    保留最近消息数
                                                </label>
                                                <select 
                                                    value={agentSettings.contextCompression.keepRecentMessages}
                                                    onChange={(e) => setAgentSettings({
                                                        contextCompression: {
                                                            ...agentSettings.contextCompression,
                                                            keepRecentMessages: parseInt(e.target.value)
                                                        }
                                                    })}
                                                    style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', background: 'var(--de-bg-card)', border: '1px solid var(--de-border)', color: 'var(--de-text)' }}
                                                >
                                                    <option value={2}>2 条</option>
                                                    <option value={4}>4 条 (推荐)</option>
                                                    <option value={6}>6 条</option>
                                                    <option value={8}>8 条</option>
                                                </select>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* 多智能体协作模式 */}
                            <div className="config-section" style={{ marginBottom: '24px' }}>
                                <div className="section-header">
                                    <h3 className="section-title">🤖 多智能体协作</h3>
                                </div>
                                <p className="section-desc">
                                    启用后，各项自动化任务将根据需要使用多个模型协作完成：
                                    视觉分析、逻辑推理、文案撰写各由最适合的模型负责，
                                    模型跟随上方「模型偏好」中的分类设置。
                                </p>
                                <div className="config-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
                                    <div>
                                        <div style={{ fontWeight: 500 }}>启用多智能体模式</div>
                                        <div style={{ fontSize: '11px', color: 'var(--de-text-secondary)', marginTop: '2px' }}>
                                            关闭时使用传统单模型流程
                                        </div>
                                    </div>
                                    <label className="toggle-switch">
                                        <input
                                            type="checkbox"
                                            checked={agentSettings.multiAgentMode}
                                            onChange={(e) => setAgentSettings({ multiAgentMode: e.target.checked })}
                                        />
                                        <span className="toggle-slider"></span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ==================== 图像处理 Tab ==================== */}
                    {activeTab === 'image-models' && (
                        <div className="tab-content">
                            {/* ==================== 智能分割模型 ==================== */}
                            <div className="config-section" style={{ marginBottom: '24px' }}>
                                <div className="section-header">
                                    <h3 className="section-title">✂️ 智能分割模型</h3>
                                    <span className="badge" style={{ background: '#10b981' }}>本地运行</span>
                                </div>
                                <p className="section-desc">
                                    使用 <strong>BiRefNet</strong> 本地 ONNX 模型实现 Photoshop 级别的智能分割。
                                    支持<strong>语义分割</strong>（识别所有对象）和<strong>选区分割</strong>（识别选区内主体）。
                                </p>
                                <SegmentationModelManager />
                            </div>

                            {/* ==================== 分割功能说明 ==================== */}
                            <div className="config-section" style={{ marginBottom: '24px' }}>
                                <div className="section-header">
                                    <h3 className="section-title">📋 功能说明</h3>
                                </div>
                                <div style={{ display: 'grid', gap: '12px' }}>
                                    <div style={{ 
                                        padding: '12px 16px', 
                                        background: 'var(--de-bg-secondary)', 
                                        borderRadius: '8px',
                                        border: '1px solid var(--de-border)'
                                    }}>
                                        <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
                                            🎯 语义分割
                                        </div>
                                        <div style={{ fontSize: '12px', color: 'var(--de-text-secondary)' }}>
                                            自动识别画布中所有对象，类似 Photoshop "选择主体" 功能
                                        </div>
                                    </div>
                                    <div style={{ 
                                        padding: '12px 16px', 
                                        background: 'var(--de-bg-secondary)', 
                                        borderRadius: '8px',
                                        border: '1px solid var(--de-border)'
                                    }}>
                                        <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
                                            ✏️ 选区分割
                                        </div>
                                        <div style={{ fontSize: '12px', color: 'var(--de-text-secondary)' }}>
                                            识别当前选区范围内的主体，精确控制分割区域
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ==================== API 密钥 Tab ==================== */}
                    {activeTab === 'api-keys' && (
                        <div className="tab-content">
                            <div className="config-section api-section xiaomi">
                                <div className="section-header">
                                    <h3 className="section-title">🟠 Xiaomi MiMo</h3>
                                    {localKeys.xiaomi && <span className="badge success">已配置</span>}
                                </div>
                                <p className="section-desc">
                                    官方 OpenAI 兼容接入，可直接使用 MiMo V2.5 Pro / MiMo V2.5 / MiMo V2 Omni。其中 V2.5 与 Omni 适合参考图理解与设计复刻。
                                </p>

                                <div className="form-group">
                                    <label>API Key</label>
                                    <input
                                        type="password"
                                        className="input"
                                        placeholder="输入 Xiaomi MiMo API Key..."
                                        value={localKeys.xiaomi}
                                        onChange={e => setLocalKeys(k => ({ ...k, xiaomi: e.target.value }))}
                                    />
                                    <button
                                        type="button"
                                        className="link-btn"
                                        onClick={() => openExternalLink('https://platform.xiaomimimo.com/#/docs/api/chat/openai-api')}
                                    >
                                        查看接入文档 →
                                    </button>
                                </div>
                            </div>

                            {/* OpenRouter */}
                            <div className="config-section api-section openrouter">
                                <div className="section-header">
                                    <h3 className="section-title">🌐 OpenRouter</h3>
                                    <span className="badge" style={{ background: '#6366f1' }}>可选增强</span>
                                </div>
                                <p className="section-desc">
                                    配置后可使用 OpenRouter 对话模型，并为 UXP 局部重绘启用 Nano Banana Pro（Gemini 3 Pro Image Preview）。
                                </p>
                                
                                <div className="form-group">
                                    <label>API Key</label>
                                    <div className="input-with-action">
                                        <input
                                            type="password"
                                            className="input"
                                            placeholder="sk-or-..."
                                            value={localKeys.openrouter}
                                            onChange={e => setLocalKeys(k => ({ ...k, openrouter: e.target.value }))}
                                        />
                                        <button
                                            className={`btn btn-test ${apiTestStatus}`}
                                            onClick={handleTestApi}
                                            disabled={apiTestStatus === 'testing'}
                                        >
                                            {apiTestStatus === 'testing' ? '测试中...' : '测试'}
                                        </button>
                                    </div>
                                    {apiTestMessage && (
                                        <div className={`test-result ${apiTestStatus}`}>{apiTestMessage}</div>
                                    )}
                                    <button type="button" className="link-btn" onClick={() => openExternalLink('https://openrouter.ai/keys')}>
                                        获取 API Key →
                                    </button>
                                </div>
                            </div>

                            <div className="config-section api-section gptsapi">
                                <div className="section-header">
                                    <h3 className="section-title">🧭 GPTs API</h3>
                                    {localKeys.gptsapi && <span className="badge success">已配置</span>}
                                </div>
                                <p className="section-desc">
                                    使用统一的 GPTs API Key 接入 Claude Sonnet 4.6，并为 UXP 图生图提供 Gemini 3 Pro Image Preview 能力
                                </p>
                                
                                <div className="form-group">
                                    <label>API Key</label>
                                    <input
                                        type="password"
                                        className="input"
                                        placeholder="sk-..."
                                        value={localKeys.gptsapi}
                                        onChange={e => setLocalKeys(k => ({ ...k, gptsapi: e.target.value }))}
                                    />
                                    <button type="button" className="link-btn" onClick={() => openExternalLink('https://api2.gptsapi.net/tutorial')}>
                                        查看接入文档 →
                                    </button>
                                </div>
                            </div>

                            <div className="config-section api-section deepseek">
                                <div className="section-header">
                                    <h3 className="section-title">🟢 DeepSeek</h3>
                                    {localKeys.deepseek && <span className="badge success">已配置</span>}
                                </div>
                                <p className="section-desc">
                                    DeepSeek 官方 API，OpenAI 兼容地址为 https://api.deepseek.com。当前接入 deepseek-v4-pro 文本聊天和流式；不声明视觉能力。
                                </p>

                                <div className="form-group">
                                    <label>API Key</label>
                                    <div className="input-with-action">
                                        <input
                                            type="password"
                                            className="input"
                                            placeholder="sk-..."
                                            value={localKeys.deepseek}
                                            onChange={e => setLocalKeys(k => ({ ...k, deepseek: e.target.value }))}
                                        />
                                        <button
                                            className={`btn btn-test ${deepSeekTestStatus}`}
                                            onClick={handleTestDeepSeek}
                                            disabled={deepSeekTestStatus === 'testing'}
                                        >
                                            {deepSeekTestStatus === 'testing' ? '测试中...' : '测试'}
                                        </button>
                                    </div>
                                    {deepSeekTestMessage && (
                                        <div className={`test-result ${deepSeekTestStatus}`}>{deepSeekTestMessage}</div>
                                    )}
                                    <button type="button" className="link-btn" onClick={() => openExternalLink('https://platform.deepseek.com/api_keys')}>
                                        获取 API Key →
                                    </button>
                                </div>
                            </div>

                            {/* Google AI Studio 官方渠道 */}
                            <div className="config-section api-section google">
                                <div className="section-header">
                                    <h3 className="section-title">🔷 Google AI Studio</h3>
                                    <span className="badge" style={{ background: '#4285f4' }}>官方渠道</span>
                                </div>
                                <p className="section-desc">
                                    官方 API，支持 Gemini 2.5/2.0/1.5 Flash/Pro 全系列模型
                                </p>
                                
                                <div className="form-group">
                                    <label>API Key</label>
                                    <div className="input-with-action">
                                    <input
                                            type="password"
                                        className="input"
                                            placeholder="AIza..."
                                            value={localKeys.google}
                                            onChange={e => setLocalKeys(k => ({ ...k, google: e.target.value }))}
                                        />
                                        <button
                                            className={`btn btn-test ${googleApiTestStatus}`}
                                            onClick={handleTestGoogleApi}
                                            disabled={googleApiTestStatus === 'testing'}
                                        >
                                            {googleApiTestStatus === 'testing' ? '测试中...' : '测试'}
                                        </button>
                                    </div>
                                    {googleApiTestMessage && (
                                        <div className={`test-result ${googleApiTestStatus}`}>{googleApiTestMessage}</div>
                                    )}
                                    <button type="button" className="link-btn" onClick={() => openExternalLink('https://aistudio.google.com/apikey')}>
                                        获取 API Key →
                                    </button>
                                </div>
                            </div>

                            {/* Ollama 云服务 */}
                            <div className="config-section api-section ollama-cloud">
                                <div className="section-header">
                                    <h3 className="section-title">🦙 Ollama (云服务)</h3>
                                    {localKeys.ollamaApiKey && <span className="badge success">已配置</span>}
                                </div>
                                <p className="section-desc">
                                    使用 Ollama 云端服务，提供免费体验额度
                                </p>
                                
                                <div className="form-group">
                                    <label>
                                        Ollama API Key
                                        <span className="label-hint">云端调用，无需本地部署</span>
                                    </label>
                                    <div className="input-with-action">
                                        <input
                                            type="password"
                                            className="input"
                                            placeholder="输入 Ollama API Key..."
                                            value={localKeys.ollamaApiKey}
                                            onChange={e => setLocalKeys(k => ({ ...k, ollamaApiKey: e.target.value }))}
                                        />
                                        <button
                                            className={`btn btn-test ${ollamaCloudTestStatus}`}
                                            onClick={handleTestOllamaCloudApi}
                                            disabled={ollamaCloudTestStatus === 'testing'}
                                        >
                                            {ollamaCloudTestStatus === 'testing' ? '测试中...' : '测试'}
                                        </button>
                                    </div>
                                    {ollamaCloudTestMessage && (
                                        <div className={`test-result ${ollamaCloudTestStatus}`}>{ollamaCloudTestMessage}</div>
                                    )}
                                    <button type="button" className="link-btn" onClick={() => openExternalLink('https://ollama.com')}>
                                        获取 API Key →
                                    </button>
                                </div>
                            </div>

                            {/* BFL (Black Forest Labs) - FLUX 图像生成 */}
                            <div className="config-section api-section bfl">
                                <div className="section-header">
                                    <h3 className="section-title">🎨 Black Forest Labs (FLUX)</h3>
                                    {localKeys.bfl && <span className="badge success">已配置</span>}
                                </div>
                                <p className="section-desc">
                                    FLUX 系列图像生成模型，支持文生图、图生图、局部重绘等
                                </p>
                                
                                <div className="form-group">
                                    <label>
                                        BFL API Key
                                        <span className="label-hint">用于 FLUX 图像生成</span>
                                    </label>
                                    <div className="input-with-action">
                                        <input
                                            type="password"
                                            className="input"
                                            placeholder="输入 BFL API Key..."
                                            value={localKeys.bfl}
                                            onChange={e => setLocalKeys(k => ({ ...k, bfl: e.target.value }))}
                                        />
                                        <button
                                            className={`btn btn-test ${bflTestStatus}`}
                                            onClick={handleTestBflApi}
                                            disabled={bflTestStatus === 'testing'}
                                        >
                                            {bflTestStatus === 'testing' ? '测试中...' : '测试'}
                                        </button>
                                    </div>
                                    {bflTestMessage && (
                                        <div className={`test-result ${bflTestStatus}`}>{bflTestMessage}</div>
                                    )}
                                    <div className="bfl-models-info">
                                        <span className="info-title">支持的模型：</span>
                                        <span className="model-tags">
                                            <span className="tag">FLUX.2 [max]</span>
                                            <span className="tag">FLUX.2 [pro]</span>
                                            <span className="tag">FLUX.2 [klein]</span>
                                            <span className="tag">Inpainting</span>
                                        </span>
                                    </div>
                                    <button type="button" className="link-btn" onClick={() => openExternalLink('https://bfl.ai/')}>
                                        获取 API Key →
                                    </button>
                                </div>
                            </div>

                            <div className="config-section api-section direct">
                                <div className="section-header">
                                    <h3 className="section-title">🌋 即梦AI（局部重绘）</h3>
                                    {localKeys.volcengineJimengAccessKeyId && localKeys.volcengineJimengSecretAccessKey && (
                                        <span className="badge success">已填写</span>
                                    )}
                                </div>
                                <p className="section-desc">
                                    按火山即梦AI OpenAPI 接入局部重绘。这里使用 Access Key ID 和 Secret Access Key，不使用 Ark API Key。测试按钮会验证鉴权和真实提交链。
                                </p>
                                <div className="form-group">
                                    <label>Access Key ID</label>
                                    <input
                                        type="password"
                                        className="input"
                                        placeholder="输入 Access Key ID..."
                                        value={localKeys.volcengineJimengAccessKeyId}
                                        onChange={e => setLocalKeys(k => ({ ...k, volcengineJimengAccessKeyId: e.target.value }))}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Secret Access Key</label>
                                    <div className="input-with-action">
                                        <input
                                            type="password"
                                            className="input"
                                            placeholder="输入 Secret Access Key..."
                                            value={localKeys.volcengineJimengSecretAccessKey}
                                            onChange={e => setLocalKeys(k => ({ ...k, volcengineJimengSecretAccessKey: e.target.value }))}
                                        />
                                        <button
                                            className={`btn btn-test ${jimengTestStatus}`}
                                            onClick={handleTestJimengApi}
                                            disabled={jimengTestStatus === 'testing'}
                                        >
                                            {jimengTestStatus === 'testing' ? '测试中...' : '测试'}
                                        </button>
                                    </div>
                                    {jimengTestMessage && (
                                        <div className={`test-result ${jimengTestStatus}`}>{jimengTestMessage}</div>
                                    )}
                                </div>
                                <button type="button" className="link-btn" onClick={() => openExternalLink('https://console.volcengine.com/iam/keymanage/')}>
                                    Access Key 管理 →
                                </button>
                            </div>

                            <div className="config-section api-section direct">
                                <div className="section-header">
                                    <h3 className="section-title">🪣 TOS（即梦 4.6 图生图输入托管）</h3>
                                    {localKeys.volcengineTosBucket && localKeys.volcengineTosPublicBaseUrl && (
                                        <span className="badge success">已填写</span>
                                    )}
                                </div>
                                <p className="section-desc">
                                    即梦图片 4.6 官方图生图使用 <code>image_urls</code> 入参，这里配置 TOS 公网桶用于上传 UXP 抓到的输入图。当前实现默认复用上面的即梦 Access Key ID / Secret Access Key。
                                </p>
                                <div className="form-group">
                                    <label>TOS Region</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="例如：cn-beijing"
                                        value={localKeys.volcengineTosRegion}
                                        onChange={e => setLocalKeys(k => ({ ...k, volcengineTosRegion: e.target.value }))}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>TOS Endpoint</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="例如：tos-s3-cn-beijing.volces.com"
                                        value={localKeys.volcengineTosEndpoint}
                                        onChange={e => setLocalKeys(k => ({ ...k, volcengineTosEndpoint: e.target.value }))}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>TOS Bucket</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="输入公开可读的 Bucket 名称..."
                                        value={localKeys.volcengineTosBucket}
                                        onChange={e => setLocalKeys(k => ({ ...k, volcengineTosBucket: e.target.value }))}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>TOS Public Base URL</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="例如：https://your-bucket.tos-cn-beijing.volces.com"
                                        value={localKeys.volcengineTosPublicBaseUrl}
                                        onChange={e => setLocalKeys(k => ({ ...k, volcengineTosPublicBaseUrl: e.target.value }))}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>对象前缀（可选）</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="designecho/jimeng-i2i"
                                        value={localKeys.volcengineTosKeyPrefix}
                                        onChange={e => setLocalKeys(k => ({ ...k, volcengineTosKeyPrefix: e.target.value }))}
                                    />
                                </div>
                                <p className="section-desc" style={{ marginTop: 8 }}>
                                    需要保证 Bucket 或对象具备公网读取能力，否则即梦 4.6 无法拉取输入图。
                                </p>
                            </div>

                            <div className="config-section api-section direct">
                                <div className="section-header">
                                    <h3 className="section-title">🖼️ Seedream 5.0（图生图）</h3>
                                    {localKeys.volcengineSeedreamApiKey && (
                                        <span className="badge success">已填写</span>
                                    )}
                                </div>
                                <p className="section-desc">
                                    Seedream 图生图走方舟图片生成 API。这里需要填写 Ark API Key，不是即梦的 Access Key ID / Secret Access Key。当前默认服务地域为华北 2（北京）。
                                </p>
                                <div className="form-group">
                                    <label>Seedream API Key</label>
                                    <div className="input-with-action">
                                        <input
                                            type="password"
                                            className="input"
                                            placeholder="输入 Seedream API Key..."
                                            value={localKeys.volcengineSeedreamApiKey}
                                            onChange={e => setLocalKeys(k => ({ ...k, volcengineSeedreamApiKey: e.target.value }))}
                                        />
                                        <button
                                            className={`btn btn-test ${seedreamTestStatus}`}
                                            onClick={handleTestSeedreamApi}
                                            disabled={seedreamTestStatus === 'testing'}
                                        >
                                            {seedreamTestStatus === 'testing' ? '测试中...' : '测试'}
                                        </button>
                                    </div>
                                    {seedreamTestMessage && (
                                        <div className={`test-result ${seedreamTestStatus}`}>{seedreamTestMessage}</div>
                                    )}
                                </div>
                                <button type="button" className="link-btn" onClick={() => openExternalLink('https://console.volcengine.com/ark/region:ark+cn-beijing/apikey')}>
                                    打开 Ark API 管理 →
                                </button>
                                <p className="section-desc" style={{ marginTop: 8 }}>
                                    登录后前往「资源管理 &gt; API Key 管理」创建 LAS API Key。
                                </p>
                            </div>

                            {/* 直连 API（折叠） */}
                            <details className="config-section api-section direct">
                                <summary className="section-header clickable">
                                    <h3 className="section-title">🔗 其他直连 API（可选）</h3>
                                    <span className="expand-hint">展开配置</span>
                                </summary>
                                <div className="direct-apis">
                                    <p className="section-desc">
                                        如果不使用 OpenRouter，可以直接配置各厂商 API
                                    </p>
                                    
                                    <div className="form-group">
                                        <label>Anthropic API Key</label>
                                        <input
                                            type="password"
                                            className="input"
                                            placeholder="sk-ant-..."
                                            value={localKeys.anthropic}
                                            onChange={e => setLocalKeys(k => ({ ...k, anthropic: e.target.value }))}
                                        />
                                    </div>
                                    
                                    <div className="form-group">
                                        <label>OpenAI API Key</label>
                                        <input
                                            type="password"
                                            className="input"
                                            placeholder="sk-..."
                                            value={localKeys.openai}
                                            onChange={e => setLocalKeys(k => ({ ...k, openai: e.target.value }))}
                                        />
                                    </div>
                                </div>
                            </details>
                        </div>
                    )}
                </div>

                {/* 底部 */}
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>取消</button>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? '保存中...' : saved ? '✓ 已保存' : '保存设置'}
                    </button>
                </div>
            </div>

            <style>{`
                .modal-backdrop {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.7);
                    backdrop-filter: blur(4px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 100;
                }

                .settings-modal {
                    width: 100%;
                    max-width: 800px;
                    max-height: 90vh;
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 16px;
                    display: flex;
                    flex-direction: column;
                    animation: slideUp 0.3s ease;
                }

                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                .modal-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 20px 24px;
                    border-bottom: 1px solid var(--de-border);
                }

                .modal-header h2 {
                    font-size: 18px;
                    font-weight: 600;
                    margin: 0;
                }

                .close-btn {
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: transparent;
                    border: none;
                    color: var(--de-text-secondary);
                    font-size: 24px;
                    cursor: pointer;
                    border-radius: 6px;
                }

                .close-btn:hover {
                    background: var(--de-bg-light);
                    color: var(--de-text);
                }

                /* Tab 导航 */
                .tabs-nav {
                    display: flex;
                    padding: 0 24px;
                    border-bottom: 1px solid var(--de-border);
                    background: var(--de-bg);
                }

                .tab-btn {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 14px 20px;
                    background: transparent;
                    border: none;
                    border-bottom: 2px solid transparent;
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .tab-btn:hover {
                    color: var(--de-text);
                    background: var(--de-bg-light);
                }

                .tab-btn.active {
                    color: var(--de-primary);
                    border-bottom-color: var(--de-primary);
                }

                .tab-icon {
                    font-size: 18px;
                }

                .tab-label {
                    font-size: 14px;
                    font-weight: 500;
                }

                /* Tab 内容 */
                .modal-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 28px 32px;
                }

                .tab-content {
                    animation: fadeIn 0.2s ease;
                }

                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                /* 配置区块 */
                .config-section {
                    margin-bottom: 24px;
                    padding: 20px;
                    background: var(--de-bg);
                    border: 1px solid var(--de-border);
                    border-radius: 12px;
                }

                .config-section:last-child {
                    margin-bottom: 0;
                }

                .section-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 12px;
                }

                .section-title {
                    font-size: 15px;
                    font-weight: 600;
                    margin: 0;
                }

                .section-desc {
                    font-size: 13px;
                    color: var(--de-text-secondary);
                    margin: 0 0 16px;
                }

                /* 模式卡片 */
                .mode-cards {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 16px;
                }

                .mode-card {
                    padding: 20px;
                    background: var(--de-bg-light);
                    border: 2px solid var(--de-border);
                    border-radius: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .mode-card:hover {
                    border-color: var(--de-primary);
                }

                .mode-card.active {
                    border-color: var(--de-primary);
                    background: rgba(0, 102, 255, 0.08);
                }

                .mode-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 8px;
                }

                .mode-icon {
                    font-size: 20px;
                }

                .mode-name {
                    font-size: 14px;
                    font-weight: 600;
                }

                .mode-desc {
                    font-size: 12px;
                    color: var(--de-text-secondary);
                    margin: 0;
                }

                /* 徽章 */
                .badge {
                    font-size: 10px;
                    padding: 2px 8px;
                    border-radius: 10px;
                    font-weight: 500;
                }

                .badge.success {
                    background: rgba(16, 185, 129, 0.15);
                    color: #10b981;
                }

                .badge.error {
                    background: rgba(239, 68, 68, 0.15);
                    color: #ef4444;
                }

                .badge.warning {
                    background: rgba(245, 158, 11, 0.15);
                    color: #f59e0b;
                }

                .badge.recommend {
                    background: rgba(139, 92, 246, 0.15);
                    color: #8b5cf6;
                }

                /* 本地/云端区块 */
                .local-section {
                    border-color: #10b981;
                    background: linear-gradient(135deg, rgba(16, 185, 129, 0.03), var(--de-bg));
                }

                .cloud-section {
                    border-color: #3b82f6;
                    background: linear-gradient(135deg, rgba(59, 130, 246, 0.03), var(--de-bg));
                }

                /* 任务模型选择 */
                .task-models {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .task-model-item {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                }

                .task-model-item label {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    min-width: 120px;
                }

                .task-svg-icon {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: rgba(255, 255, 255, 0.5);
                }

                .task-svg-icon svg {
                    width: 18px;
                    height: 18px;
                }

                .task-name {
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--de-text-primary);
                }

                .task-model-item .select {
                    flex: 1;
                }

                /* 已安装列表 */
                .installed-list, .recommended-models {
                    display: flex;
                    flex-wrap: wrap;
                    align-items: center;
                    gap: 8px;
                    margin-top: 16px;
                    padding-top: 12px;
                    border-top: 1px dashed var(--de-border);
                }

                .installed-label, .recommended-label {
                    font-size: 12px;
                    color: var(--de-text-secondary);
                }

                .installed-tag {
                    font-size: 11px;
                    padding: 2px 8px;
                    background: rgba(16, 185, 129, 0.15);
                    color: #10b981;
                    border-radius: 4px;
                }

                .recommended-tag {
                    font-size: 11px;
                    padding: 2px 8px;
                    background: rgba(59, 130, 246, 0.15);
                    color: #3b82f6;
                    border-radius: 4px;
                }

                /* 提示框 */
                .alert {
                    padding: 12px 16px;
                    border-radius: 8px;
                    font-size: 13px;
                    margin-bottom: 16px;
                }

                .alert.warning {
                    background: rgba(245, 158, 11, 0.1);
                    border: 1px solid rgba(245, 158, 11, 0.3);
                    color: #f59e0b;
                }

                .alert.info {
                    background: rgba(59, 130, 246, 0.1);
                    border: 1px solid rgba(59, 130, 246, 0.3);
                    color: #60a5fa;
                }

                .alert code {
                    background: var(--de-bg-light);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-family: monospace;
                }

                /* 表单 */
                .form-group {
                    margin-bottom: 16px;
                }

                .form-group:last-child {
                    margin-bottom: 0;
                }

                .form-group label {
                    display: block;
                    font-size: 13px;
                    font-weight: 500;
                    margin-bottom: 8px;
                    color: var(--de-text);
                }

                .input {
                    width: 100%;
                    padding: 10px 12px;
                    background: var(--de-bg-light);
                    border: 1px solid var(--de-border);
                    border-radius: 8px;
                    color: var(--de-text);
                    font-size: 14px;
                    transition: border-color 0.2s;
                }

                .input:focus {
                    outline: none;
                    border-color: var(--de-primary);
                }

                .select {
                    width: 100%;
                    padding: 10px 12px;
                    background: var(--de-bg-light);
                    border: 1px solid var(--de-border);
                    border-radius: 8px;
                    color: var(--de-text);
                    font-size: 13px;
                    cursor: pointer;
                }

                .select.small {
                    padding: 8px 10px;
                    font-size: 12px;
                }

                .select:focus {
                    outline: none;
                    border-color: var(--de-primary);
                }

                .input-with-action {
                    display: flex;
                    gap: 8px;
                }

                .input-with-action .input {
                    flex: 1;
                }

                /* API 测试 */
                .btn-test {
                    padding: 10px 16px;
                    background: var(--de-bg-light);
                    border: 1px solid var(--de-border);
                    border-radius: 8px;
                    color: var(--de-text);
                    font-size: 13px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .btn-test:hover:not(:disabled) {
                    border-color: var(--de-primary);
                }

                .btn-test.success {
                    background: rgba(16, 185, 129, 0.15);
                    border-color: #10b981;
                    color: #10b981;
                }

                .btn-test.error {
                    background: rgba(239, 68, 68, 0.15);
                    border-color: #ef4444;
                    color: #ef4444;
                }

                .test-result {
                    margin-top: 8px;
                    padding: 8px 12px;
                    border-radius: 6px;
                    font-size: 12px;
                }

                .test-result.success {
                    background: rgba(16, 185, 129, 0.1);
                    color: #10b981;
                }

                .test-result.error {
                    background: rgba(239, 68, 68, 0.1);
                    color: #ef4444;
                }

                .test-message {
                    font-size: 12px;
                    color: var(--de-text-secondary);
                }

                .test-message.success {
                    color: #10b981;
                }

                .test-message.error {
                    color: #ef4444;
                }

                .link {
                    display: inline-block;
                    margin-top: 8px;
                    font-size: 12px;
                    color: var(--de-primary);
                    text-decoration: none;
                }

                .link:hover {
                    text-decoration: underline;
                }

                .link-btn {
                    display: inline-block;
                    margin-top: 8px;
                    padding: 0;
                    font-size: 12px;
                    color: var(--de-primary);
                    background: none;
                    border: none;
                    cursor: pointer;
                    text-decoration: none;
                }

                .link-btn:hover {
                    text-decoration: underline;
                }

                /* API 区块 */
                .api-section.openrouter {
                    border-color: #8b5cf6;
                    background: linear-gradient(135deg, rgba(139, 92, 246, 0.03), var(--de-bg));
                }

                .api-section.deepseek {
                    border-color: #10b981;
                    background: linear-gradient(135deg, rgba(16, 185, 129, 0.04), var(--de-bg));
                }

                .api-section.ollama {
                    border-color: #10b981;
                    background: linear-gradient(135deg, rgba(16, 185, 129, 0.03), var(--de-bg));
                }

                .api-section.direct {
                    border-color: var(--de-border);
                }

                /* BFL (FLUX) 样式 */
                .api-section.bfl {
                    border-color: #f59e0b;
                    background: linear-gradient(135deg, rgba(245, 158, 11, 0.05), var(--de-bg));
                }
                .api-section.volcengine {
                    border-color: #f97316;
                    background: linear-gradient(135deg, rgba(249, 115, 22, 0.05), var(--de-bg));
                }

                .bfl-models-info {
                    margin-top: 12px;
                    padding: 10px 12px;
                    background: rgba(245, 158, 11, 0.08);
                    border-radius: 8px;
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    align-items: center;
                }

                .bfl-models-info .info-title {
                    font-size: 12px;
                    color: var(--de-text-secondary);
                    margin-right: 4px;
                }

                .bfl-models-info .model-tags {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 6px;
                }

                .bfl-models-info .tag {
                    font-size: 11px;
                    padding: 2px 8px;
                    background: rgba(245, 158, 11, 0.15);
                    color: #f59e0b;
                    border-radius: 4px;
                    font-weight: 500;
                }

                .api-section.direct summary {
                    cursor: pointer;
                    user-select: none;
                }

                .api-section.direct summary::-webkit-details-marker {
                    display: none;
                }

                .clickable {
                    cursor: pointer;
                }

                .expand-hint {
                    font-size: 12px;
                    color: var(--de-text-secondary);
                }

                .direct-apis {
                    margin-top: 16px;
                    padding-top: 16px;
                    border-top: 1px solid var(--de-border);
                }

                .label-hint {
                    font-size: 11px;
                    font-weight: 400;
                    color: var(--de-text-secondary);
                    margin-left: 8px;
                }

                .api-section.google {
                    border-color: #4285f4;
                    background: linear-gradient(135deg, rgba(66, 133, 244, 0.03), var(--de-bg));
                }

                /* 状态文本 */
                .status-text {
                    font-size: 12px;
                    font-weight: 500;
                }

                .status-text.success {
                    color: #10b981;
                }

                .status-text.error {
                    color: #ef4444;
                }

                .status-text.warning {
                    color: #f59e0b;
                }

                /* 图像处理 Tab */
                .model-download-section, .stage-config-section {
                    margin-top: 20px;
                    padding-top: 20px;
                    border-top: 1px solid var(--de-border);
                }

                .model-download-section h4, .stage-config-section h4 {
                    font-size: 14px;
                    font-weight: 600;
                    margin: 0 0 8px;
                }

                .hint {
                    font-size: 12px;
                    color: var(--de-text-secondary);
                    margin: 0 0 16px;
                }

                .download-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 12px;
                }

                .download-card {
                    padding: 14px;
                    background: var(--de-bg-light);
                    border: 1px solid var(--de-border);
                    border-radius: 10px;
                    transition: all 0.2s;
                }

                .download-card.downloaded {
                    border-color: #10b981;
                    background: rgba(16, 185, 129, 0.05);
                }

                .download-info {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 6px;
                }

                .download-name {
                    font-size: 13px;
                    font-weight: 600;
                }

                .download-size {
                    font-size: 11px;
                    color: var(--de-text-secondary);
                    background: var(--de-bg);
                    padding: 2px 6px;
                    border-radius: 4px;
                }

                .download-desc {
                    font-size: 11px;
                    color: var(--de-text-secondary);
                    margin: 0 0 10px;
                }

                .download-status.success {
                    font-size: 12px;
                    color: #10b981;
                }

                .btn-download {
                    width: 100%;
                    padding: 8px;
                    background: linear-gradient(135deg, #10b981, #059669);
                    border: none;
                    border-radius: 6px;
                    color: white;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .btn-download:hover:not(:disabled) {
                    background: linear-gradient(135deg, #059669, #047857);
                }

                .btn-download:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }

                /* 工作流程 */
                .workflow-info {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    padding: 16px;
                    background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(139, 92, 246, 0.1));
                    border: 1px solid rgba(99, 102, 241, 0.3);
                    border-radius: 12px;
                    margin-bottom: 20px;
                }

                .workflow-step {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 4px;
                }

                .step-icon {
                    font-size: 24px;
                }

                .step-text {
                    font-size: 11px;
                    color: var(--de-text-secondary);
                }

                .workflow-arrow {
                    color: var(--de-text-secondary);
                    font-size: 18px;
                }

                /* 推荐组合 */
                .recommended-combo {
                    margin-bottom: 20px;
                }

                .recommended-combo h4 {
                    font-size: 14px;
                    font-weight: 600;
                    margin: 0 0 12px;
                }

                .combo-list {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 10px;
                }

                .combo-item {
                    padding: 12px;
                    background: var(--de-bg-light);
                    border: 1px solid var(--de-border);
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .combo-item:hover {
                    border-color: var(--de-primary);
                }

                .combo-item.active {
                    border-color: #8b5cf6;
                    background: rgba(139, 92, 246, 0.1);
                }

                .combo-name {
                    display: block;
                    font-size: 13px;
                    font-weight: 600;
                    margin-bottom: 4px;
                }

                .combo-models {
                    display: block;
                    font-size: 11px;
                    color: var(--de-text-secondary);
                    margin-bottom: 4px;
                }

                .combo-size {
                    font-size: 10px;
                    color: var(--de-text-secondary);
                    background: var(--de-bg);
                    padding: 2px 6px;
                    border-radius: 4px;
                }

                /* 阶段下载组 */
                .stage-download-group {
                    margin-bottom: 24px;
                }

                .stage-group-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    margin: 0 0 12px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid var(--de-border);
                }

                .stage-group-desc {
                    font-size: 12px;
                    font-weight: normal;
                    color: var(--de-text-secondary);
                    margin-left: auto;
                }

                /* 模型标签 */
                .model-tags {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 4px;
                    margin: 8px 0;
                }

                .model-tag {
                    font-size: 10px;
                    padding: 2px 6px;
                    background: rgba(99, 102, 241, 0.15);
                    color: #818cf8;
                    border-radius: 4px;
                }

                /* 阶段配置 */
                .stage-list {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }

                .stage-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .stage-label {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    min-width: 120px;
                }

                .stage-icon {
                    font-size: 16px;
                }

                .stage-name {
                    font-size: 13px;
                    font-weight: 500;
                }

                .stage-count {
                    font-size: 11px;
                    color: var(--de-text-secondary);
                    margin-left: 4px;
                }

                .stage-item .select {
                    flex: 1;
                }

                .integration-summary-grid {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 12px;
                    margin-top: 16px;
                }

                .summary-stat-card {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    padding: 16px;
                    background: linear-gradient(180deg, rgba(37, 99, 235, 0.14), rgba(15, 23, 42, 0.18));
                    border: 1px solid rgba(59, 130, 246, 0.24);
                    border-radius: 12px;
                }

                .summary-stat-value {
                    font-size: 22px;
                    font-weight: 700;
                    color: var(--de-text);
                }

                .summary-stat-label {
                    font-size: 12px;
                    color: var(--de-text-secondary);
                }

                .skill-group-stack,
                .mcp-server-stack,
                .builtin-mcp-list {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .integration-card,
                .mcp-server-card,
                .builtin-mcp-item {
                    padding: 16px;
                    background: var(--de-bg-light);
                    border: 1px solid var(--de-border);
                    border-radius: 12px;
                }

                .integration-card-header,
                .mcp-server-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    margin-bottom: 14px;
                }

                .integration-card-title {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--de-text);
                }

                .integration-card-subtitle {
                    margin-top: 4px;
                    font-size: 12px;
                    color: var(--de-text-secondary);
                }

                .skill-list {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }

                .skill-item-row {
                    display: flex;
                    align-items: flex-start;
                    gap: 12px;
                    padding: 12px;
                    border-radius: 10px;
                    border: 1px solid rgba(148, 163, 184, 0.16);
                    background: rgba(15, 23, 42, 0.26);
                    cursor: pointer;
                    transition: border-color 0.18s ease, background 0.18s ease, opacity 0.18s ease;
                }

                .skill-item-row:hover {
                    border-color: rgba(59, 130, 246, 0.38);
                    background: rgba(30, 41, 59, 0.34);
                }

                .skill-item-row.disabled {
                    opacity: 0.64;
                }

                .mini-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 2px 8px;
                    border-radius: 999px;
                    border: 1px solid rgba(148, 163, 184, 0.18);
                    background: rgba(15, 23, 42, 0.46);
                    color: var(--de-text-secondary);
                    font-size: 11px;
                    line-height: 1.4;
                }

                .mini-badge.success {
                    color: #34d399;
                    border-color: rgba(52, 211, 153, 0.26);
                    background: rgba(6, 78, 59, 0.18);
                }

                .mini-badge.warning {
                    color: #fbbf24;
                    border-color: rgba(251, 191, 36, 0.24);
                    background: rgba(120, 53, 15, 0.18);
                }

                .integration-empty-state {
                    padding: 20px;
                    border: 1px dashed rgba(148, 163, 184, 0.24);
                    border-radius: 12px;
                    background: rgba(15, 23, 42, 0.2);
                    text-align: center;
                }

                .preference-list {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .preference-card {
                    display: flex;
                    justify-content: space-between;
                    gap: 16px;
                    padding: 14px;
                    border: 1px solid rgba(148, 163, 184, 0.18);
                    border-radius: 12px;
                    background: rgba(15, 23, 42, 0.24);
                }

                .preference-card-disabled,
                .preference-card-archived {
                    opacity: 0.68;
                }

                .preference-card-main {
                    min-width: 0;
                    flex: 1;
                }

                .preference-title-row {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex-wrap: wrap;
                }

                .preference-title {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--de-text);
                    word-break: break-word;
                }

                .preference-meta {
                    display: flex;
                    gap: 10px;
                    flex-wrap: wrap;
                    margin-top: 8px;
                    font-size: 12px;
                    color: var(--de-text-secondary);
                }

                .preference-evidence {
                    margin: 8px 0 0;
                    color: var(--de-text-secondary);
                    font-size: 12px;
                    line-height: 1.6;
                }

                .preference-actions {
                    display: flex;
                    align-items: flex-start;
                    gap: 8px;
                    flex-wrap: wrap;
                    justify-content: flex-end;
                }

                .preference-editor-grid {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 12px;
                }

                .preference-form-actions {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                    margin-top: 14px;
                    flex-wrap: wrap;
                }

                .preference-json-textarea {
                    min-height: 96px;
                    resize: vertical;
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    font-size: 12px;
                    line-height: 1.5;
                }

                .preference-status-active {
                    background: #059669;
                }

                .preference-status-needs_review {
                    background: #b45309;
                }

                .preference-status-disabled {
                    background: #4b5563;
                }

                .preference-status-archived {
                    background: #374151;
                }

                .toggle-row {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .mcp-grid {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 12px;
                }

                .integration-code {
                    display: inline-block;
                    max-width: 100%;
                    padding: 6px 10px;
                    border-radius: 8px;
                    background: rgba(15, 23, 42, 0.58);
                    border: 1px solid rgba(148, 163, 184, 0.16);
                    color: #cbd5e1;
                    font-size: 12px;
                    word-break: break-all;
                }

                @media (max-width: 720px) {
                    .integration-summary-grid,
                    .mcp-grid {
                        grid-template-columns: 1fr;
                    }

                    .integration-card-header,
                    .mcp-server-header {
                        flex-direction: column;
                        align-items: stretch;
                    }

                    .preference-card {
                        flex-direction: column;
                    }

                    .preference-editor-grid {
                        grid-template-columns: 1fr;
                    }

                    .preference-actions {
                        justify-content: flex-start;
                    }
                }

                /* 底部 */
                .modal-footer {
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                    padding: 16px 24px;
                    border-top: 1px solid var(--de-border);
                    background: var(--de-bg);
                }

                .btn {
                    padding: 10px 20px;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .btn-secondary {
                    background: var(--de-bg-light);
                    border: 1px solid var(--de-border);
                    color: var(--de-text);
                }

                .btn-secondary:hover {
                    background: var(--de-bg);
                }

                .btn-primary {
                    background: var(--de-primary);
                    border: none;
                    color: white;
                }

                .btn-primary:hover:not(:disabled) {
                    background: #0055cc;
                }

                .btn-primary:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
            `}</style>
        </div>
    );
};
