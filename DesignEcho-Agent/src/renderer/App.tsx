import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ChatPanel } from './components/ChatPanel';
import { SettingsModal } from './components/SettingsModal';
import { ProjectManager } from './components/ProjectManager';
import { AssetGallery } from './components/AssetGallery';
// RAG 知识库 - 新版语义搜索面板
import { UnifiedKnowledgePanel } from './components/knowledge/UnifiedKnowledgePanel';
import { useAppStore, EcommerceProjectStructure } from './stores/app.store';

// 获取系统主题
function getSystemTheme(): 'light' | 'dark' {
    if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
}

// 视图类型 - AI 驱动设计，设计和SKU功能通过对话完成
type ViewType = 'chat' | 'assets' | 'knowledge';

function App() {
    const [showSettings, setShowSettings] = useState(false);
    const [activeView, setActiveView] = useState<ViewType>('chat');
    const { setPluginConnected, isPluginConnected, currentProject, setCurrentProject, apiKeys, modelPreferences, recentProjects, ecommerceStructure, setEcommerceStructure, theme } = useAppStore();
    
    // 计算实际主题（处理 system 模式）
    const effectiveTheme = useMemo(() => {
        if (theme === 'system') {
            return getSystemTheme();
        }
        return theme;
    }, [theme]);
    
    // 应用主题到 document
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', effectiveTheme);
    }, [effectiveTheme]);
    const [, setConnectionAttempts] = useState(0);
    const apiKeysSynced = useRef(false);
    const projectScanned = useRef<string | null>(null);  // 记录已扫描的项目路径
    const stateFallbackLoaded = useRef(false);
    const stateSaveTimer = useRef<number | null>(null);

    // 检查连接状态
    const checkConnection = useCallback(async () => {
        try {
            const status = await window.designEcho?.getConnectionStatus();
            const connected = status?.connected ?? false;
            setPluginConnected(connected);
            
            if (connected) {
                console.log('[App] ✅ Photoshop 插件已连接');
            }
            return connected;
        } catch (error) {
            console.error('[App] 检查连接状态失败:', error);
            return false;
        }
    }, [setPluginConnected]);

    useEffect(() => {
        // 立即检查连接状态
        checkConnection();

        // 监听连接状态变化
        const unsubConnect = window.designEcho?.onPluginConnected(() => {
            console.log('[App] 📡 收到插件连接事件');
            setPluginConnected(true);
            setConnectionAttempts(0);
        });

        const unsubDisconnect = window.designEcho?.onPluginDisconnected(() => {
            console.log('[App] ⚠️ 收到插件断开事件');
            setPluginConnected(false);
        });

        // 定时检查连接状态（每 3 秒）
        const intervalId = setInterval(async () => {
            const connected = await checkConnection();
            if (!connected) {
                setConnectionAttempts(prev => prev + 1);
            }
        }, 3000);

        // 启动时显示提示
        console.log('[App] 🚀 DesignEcho Agent 已启动，等待 Photoshop 插件连接...');
        console.log('[App] 💡 请在 Photoshop 中打开 DesignEcho 插件面板');

        // 监听来自 UXP 的跳转消息
        const handleMessage = (event: MessageEvent) => {
            if (event.data?.type === 'NAVIGATE_TO_VIEW') {
                const targetView = event.data.view as ViewType;
                if (['chat', 'assets', 'knowledge'].includes(targetView)) {
                    console.log(`[App] 🔄 收到跳转指令: ${targetView}`);
                    setActiveView(targetView);
                }
            }
        };
        window.addEventListener('message', handleMessage);

        return () => {
            unsubConnect?.();
            unsubDisconnect?.();
            clearInterval(intervalId);
            window.removeEventListener('message', handleMessage);
        };
    }, [setPluginConnected, checkConnection]);

    // 启动时同步 API Keys 到主进程（zustand persist 恢复后）
    useEffect(() => {
        // 只在首次加载时同步一次
        if (apiKeysSynced.current) return;
        
        // 延迟执行，确保 zustand persist 已经恢复数据
        const timer = setTimeout(async () => {
            if (apiKeys && Object.keys(apiKeys).length > 0) {
                console.log('[App] 🔄 同步 API Keys 到主进程...');
                try {
                    await window.designEcho?.setApiKeys(apiKeys);
                    console.log('[App] ✅ API Keys 已同步到主进程');
                    if (apiKeys.openrouter) {
                        console.log('[App] ✅ OpenRouter API Key 已配置，语义分割功能可用');
                    } else {
                        console.warn('[App] ⚠️ 未配置 OpenRouter API Key，语义分割将使用降级方案');
                    }
                } catch (error) {
                    console.error('[App] ❌ 同步 API Keys 失败:', error);
                }
            } else {
                console.log('[App] ℹ️ 未配置 API Keys，请在设置中配置');
            }
            apiKeysSynced.current = true;
        }, 500);

        return () => clearTimeout(timer);
    }, [apiKeys]);

    useEffect(() => {
        if (stateFallbackLoaded.current) return;
        stateFallbackLoaded.current = true;
        const loadFallbackState = async () => {
            try {
                const result = await window.designEcho?.invoke?.('config:loadRendererState');
                if (!result?.success || !result.state) return;
                const current = useAppStore.getState();
                const fallbackState = result.state as any;
                const shouldPatch =
                    (!current.recentProjects?.length && Array.isArray(fallbackState.recentProjects) && fallbackState.recentProjects.length > 0) ||
                    (!current.currentProject && fallbackState.currentProject) ||
                    ((!current.apiKeys || Object.keys(current.apiKeys).length === 0) && fallbackState.apiKeys && Object.keys(fallbackState.apiKeys).length > 0);
                if (!shouldPatch) return;
                useAppStore.setState({
                    apiKeys: fallbackState.apiKeys || current.apiKeys,
                    modelPreferences: fallbackState.modelPreferences || current.modelPreferences,
                    currentProject: fallbackState.currentProject || current.currentProject,
                    recentProjects: Array.isArray(fallbackState.recentProjects) ? fallbackState.recentProjects : current.recentProjects
                });
                console.log('[App] ✅ 已从主进程配置恢复项目与密钥');
            } catch (error) {
                console.warn('[App] 加载主进程备份状态失败:', error);
            }
        };
        const timer = setTimeout(loadFallbackState, 800);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (!stateFallbackLoaded.current) return;
        if (stateSaveTimer.current) {
            clearTimeout(stateSaveTimer.current);
        }
        stateSaveTimer.current = window.setTimeout(() => {
            window.designEcho?.invoke?.('config:saveRendererState', {
                apiKeys,
                modelPreferences,
                currentProject,
                recentProjects
            }).catch((error: any) => {
                console.warn('[App] 保存主进程备份状态失败:', error);
            });
        }, 300);
        return () => {
            if (stateSaveTimer.current) {
                clearTimeout(stateSaveTimer.current);
            }
        };
    }, [apiKeys, modelPreferences, currentProject, recentProjects]);

        // 当项目从存储恢复或切换时，自动扫描电商项目结构
    useEffect(() => {
        const scanProject = async () => {
            if (!currentProject?.path) return;

            const needsScan = !ecommerceStructure || ecommerceStructure.projectPath !== currentProject.path;
            if (!needsScan || projectScanned.current === currentProject.path) return;

            console.log('[App] 🔄 自动扫描项目结构:', currentProject.path);
            try {
                if (window.designEcho?.scanEcommerceProject) {
                    const structure = await window.designEcho.scanEcommerceProject(currentProject.path);
                    if (structure) {
                        setEcommerceStructure(structure as EcommerceProjectStructure);
                        projectScanned.current = currentProject.path;
                        console.log('[App] ✅ 项目结构扫描完成:', structure.summary);
                    }
                }
            } catch (error) {
                // 扫描失败时不锁死，允许后续重试
                projectScanned.current = null;
                console.error('[App] ❌ 扫描项目结构失败:', error);
            }
        };

        const timer = setTimeout(scanProject, 300);
        return () => clearTimeout(timer);
    }, [currentProject?.path, ecommerceStructure?.projectPath, setEcommerceStructure]);

    // 关闭项目回到主页
    const handleCloseProject = () => {
        setCurrentProject(null);
    };

    return (
        <div className="app-container">
            {/* 背景 */}
            <div className="app-background" />

            {/* 主界面 - 根据是否有项目显示不同内容 */}
            {currentProject ? (
                // 项目模式 - 显示对话界面或素材视图
                <div className="app-layout">
                    <Header 
                        isConnected={isPluginConnected} 
                        onSettingsClick={() => setShowSettings(true)}
                        projectName={currentProject.name}
                        onCloseProject={handleCloseProject}
                    />
                    
                    {/* 视图导航栏 - AI 驱动设计，核心交互在对话中完成 */}
                    <div className="view-nav">
                        <button 
                            className={`view-nav-btn ${activeView === 'chat' ? 'active' : ''}`}
                            onClick={() => setActiveView('chat')}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                            </svg>
                            对话
                        </button>
                        <button 
                            className={`view-nav-btn ${activeView === 'assets' ? 'active' : ''}`}
                            onClick={() => setActiveView('assets')}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                <circle cx="8.5" cy="8.5" r="1.5"/>
                                <polyline points="21 15 16 10 5 21"/>
                            </svg>
                            素材
                        </button>
                        <button 
                            className={`view-nav-btn ${activeView === 'knowledge' ? 'active' : ''}`}
                            onClick={() => setActiveView('knowledge')}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                            </svg>
                            知识库
                        </button>
                    </div>
                    
                    <div className="app-main">
                        <div style={{ display: activeView === 'chat' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
                            <Sidebar />
                            <ChatPanel />
                        </div>
                        <div style={{ display: activeView === 'assets' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
                            <AssetGallery />
                        </div>
                        <div style={{ display: activeView === 'knowledge' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
                            <UnifiedKnowledgePanel />
                        </div>
                    </div>
                </div>
            ) : (
                // 主页模式 - 显示项目管理器
                <div className="app-layout home-mode">
                    <Header 
                        isConnected={isPluginConnected} 
                        onSettingsClick={() => setShowSettings(true)}
                        isHome={true}
                    />
                    <ProjectManager onProjectOpen={(project) => setCurrentProject(project)} />
                </div>
            )}

            {/* 设置弹窗 */}
            {showSettings && (
                <SettingsModal onClose={() => setShowSettings(false)} />
            )}
        </div>
    );
}

export default App;
