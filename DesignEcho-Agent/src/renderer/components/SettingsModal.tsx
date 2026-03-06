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

// 从统一配置导入模型定义
import { 
    LOCAL_MODELS as LOCAL_MODELS_CONFIG, 
    GOOGLE_MODELS as GOOGLE_MODELS_CONFIG,
    OPENROUTER_MODELS as OPENROUTER_MODELS_CONFIG,
    OLLAMA_CLOUD_MODELS as OLLAMA_CLOUD_CONFIG,
    matchOllamaModel,
    DEFAULT_MODEL_PREFERENCES
} from '../../shared/config/models.config';

// ========== 类型定义 ==========

// 设置 Tab 类型
type SettingsTab = 'general' | 'ai-models' | 'image-models' | 'api-keys';

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
    { id: 'textOptimize' as TaskCategory, name: '文案撰写', desc: '文案优化、营销文案', iconType: 'edit' },
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

// 合并所有云端模型（按推荐渠道排序）
const CLOUD_MODELS = [...GOOGLE_MODELS, ...OPENROUTER_MODELS, ...OLLAMA_CLOUD_MODELS];

interface SettingsModalProps {
    onClose: () => void;
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
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');
    const [localKeys, setLocalKeys] = useState({
        openrouter: apiKeys.openrouter || '',
        anthropic: apiKeys.anthropic || '',
        google: apiKeys.google || '',
        openai: apiKeys.openai || '',
        ollamaUrl: apiKeys.ollamaUrl || 'http://localhost:11434',
        ollamaApiKey: apiKeys.ollamaApiKey || '',  // Ollama 云服务 API Key
        bfl: apiKeys.bfl || '',  // Black Forest Labs (FLUX) API Key
        volcengineAccessKeyId: (() => {
            if (apiKeys.volcengineAccessKeyId) return apiKeys.volcengineAccessKeyId;
            const old = (apiKeys as { volcengine?: string }).volcengine;
            if (old?.includes(':')) return old.split(':')[0] || '';
            return '';
        })(),
        volcengineSecretAccessKey: (() => {
            if (apiKeys.volcengineSecretAccessKey) return apiKeys.volcengineSecretAccessKey;
            const old = (apiKeys as { volcengine?: string }).volcengine;
            if (old?.includes(':')) return old.split(':').slice(1).join(':') || '';
            return '';
        })(),
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
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    
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
    
    // API 测试状态 - BFL (Black Forest Labs)
    const [bflTestStatus, setBflTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [bflTestMessage, setBflTestMessage] = useState('');
    
    // API 测试状态 - 火山引擎
    const [volcengineTestStatus, setVolcengineTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [volcengineTestMessage, setVolcengineTestMessage] = useState('');
    
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

    const handleSave = async () => {
        setSaving(true);
        try {
            setApiKeys(localKeys);
            setModelPreferences(localPrefs);
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

    // 测试火山引擎凭证
    const handleTestVolcengineApi = async () => {
        const ak = localKeys.volcengineAccessKeyId?.trim();
        const sk = localKeys.volcengineSecretAccessKey?.trim();
        if (!ak || !sk) {
            setVolcengineTestStatus('error');
            setVolcengineTestMessage('请先填写 Access Key ID 和 Secret Access Key');
            setTimeout(() => setVolcengineTestStatus('idle'), 5000);
            return;
        }
        setVolcengineTestStatus('testing');
        setVolcengineTestMessage('正在验证...');
        try {
            const designEcho = (window as any).designEcho;
            if (designEcho?.volcengine?.testCredentials) {
                const result = await designEcho.volcengine.testCredentials(ak, sk);
                if (result.success) {
                    setVolcengineTestStatus('success');
                    setVolcengineTestMessage(result.message || '✅ 凭证有效');
                } else {
                    setVolcengineTestStatus('error');
                    setVolcengineTestMessage(result.error || '❌ 验证失败');
                }
            } else {
                setVolcengineTestStatus('error');
                setVolcengineTestMessage('测试功能不可用');
            }
        } catch (err: any) {
            setVolcengineTestStatus('error');
            setVolcengineTestMessage(`❌ ${err.message || '验证失败'}`);
        }
        setTimeout(() => setVolcengineTestStatus('idle'), 5000);
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
                        className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`}
                        onClick={() => setActiveTab('general')}
                    >
                        <span className="tab-icon">⚙️</span>
                        <span className="tab-label">常规</span>
                    </button>
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
                </div>

                {/* Tab 内容 */}
                <div className="modal-content">
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
                                const needsOpenRouter = selectedModels.some(m => m?.startsWith('openrouter-'));
                                const needsOllamaCloud = selectedModels.some(m => m?.startsWith('ollama-cloud-'));
                                
                                const hasGoogle = !!(localKeys.google && localKeys.google.length > 10);
                                const hasOpenRouter = !!(localKeys.openrouter && localKeys.openrouter.length > 10);
                                const hasOllamaCloud = !!(localKeys.ollamaApiKey && localKeys.ollamaApiKey.length > 10);
                                
                                // 检测缺少的 API Key
                                const missingKeys: string[] = [];
                                if (needsGoogle && !hasGoogle) missingKeys.push('Google AI Studio');
                                if (needsOpenRouter && !hasOpenRouter) missingKeys.push('OpenRouter');
                                if (needsOllamaCloud && !hasOllamaCloud) missingKeys.push('Ollama Cloud');
                                
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
                            {/* OpenRouter */}
                            <div className="config-section api-section openrouter">
                                <div className="section-header">
                                    <h3 className="section-title">🌐 OpenRouter</h3>
                                    <span className="badge" style={{ background: '#6366f1' }}>可选增强</span>
                                </div>
                                <p className="section-desc">
                                    配置后可使用 AI 对话功能。<strong style={{ color: '#888' }}>语义分割已支持本地检测</strong>，无需此 API 也能使用。
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

                            {/* 火山引擎 - 局部重绘 */}
                            <div className="config-section api-section volcengine">
                                <div className="section-header">
                                    <h3 className="section-title">🌋 火山引擎（图像生成）</h3>
                                    {localKeys.volcengineAccessKeyId && localKeys.volcengineSecretAccessKey && <span className="badge success">已配置</span>}
                                </div>
                                <p className="section-desc">
                                    即梦文生图3.1 / 即梦AI-图片生成4.0，支持局部重绘（图生图 + mask 合成）。需开通「即梦AI-图片生成」→「即梦文生图3.1」或「即梦AI-图片生成4.0」。凭证：控制台 → 访问控制 → 密钥管理
                                </p>
                                <div className="form-group">
                                    <label>
                                        Access Key ID
                                        <span className="label-hint">火山引擎访问密钥 ID</span>
                                    </label>
                                    <input
                                        type="password"
                                        className="input"
                                        placeholder="输入 Access Key ID"
                                        value={localKeys.volcengineAccessKeyId}
                                        onChange={e => setLocalKeys(k => ({ ...k, volcengineAccessKeyId: e.target.value }))}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>
                                        Secret Access Key
                                        <span className="label-hint">火山引擎访问密钥 Secret</span>
                                    </label>
                                    <div className="input-with-action">
                                        <input
                                            type="password"
                                            className="input"
                                            placeholder="输入 Secret Access Key"
                                            value={localKeys.volcengineSecretAccessKey}
                                            onChange={e => setLocalKeys(k => ({ ...k, volcengineSecretAccessKey: e.target.value }))}
                                        />
                                        <button
                                            className={`btn btn-test ${volcengineTestStatus}`}
                                            onClick={handleTestVolcengineApi}
                                            disabled={volcengineTestStatus === 'testing'}
                                        >
                                            {volcengineTestStatus === 'testing' ? '测试中...' : '测试'}
                                        </button>
                                    </div>
                                    {volcengineTestMessage && (
                                        <div className={`test-result ${volcengineTestStatus}`}>{volcengineTestMessage}</div>
                                    )}
                                    <button type="button" className="link-btn" onClick={() => openExternalLink('https://www.volcengine.com/docs/85621/1817045')}>
                                        接入文档 →
                                    </button>
                                </div>
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
