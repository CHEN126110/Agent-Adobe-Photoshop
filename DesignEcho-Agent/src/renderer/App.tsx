import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Header } from './components/Header';
import { lazy, Suspense } from 'react';
import { useReducer } from 'react';
import { ProjectManager } from './components/ProjectManager';
import {
    INITIAL_WORKSPACE_TABS_STATE,
    WorkspaceTabBar,
    workspaceTabsReducer,
    type WorkspacePageKind
} from './components/WorkspaceTabBar';
import { useAppStore, EcommerceProjectStructure, type ProjectInfo } from './stores/app.store';
import { createDesignLearningRuntimeEntryController } from './services/design-learning-runtime-entry.service';
import { installManualSkuColorCardBridge } from './services/manual-sku-color-card-bridge';
import { canonicalizeProjectSession } from './services/project-session-identity';
import { isCodexSubscriptionModelId } from '../shared/codex-subscription-contract';
import { normalizeModelPreferences } from '../shared/config/models.config';

const DesignAgentWorkbench = lazy(() =>
    import('./components/DesignAgentWorkbench').then((module) => ({ default: module.DesignAgentWorkbench }))
);

const SettingsModal = lazy(() =>
    import('./components/SettingsModal').then((module) => ({ default: module.SettingsModal }))
);

// 获取系统主题
function getSystemTheme(): 'light' | 'dark' {
    if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
}

function App() {
    const [showSettings, setShowSettings] = useState(false);
    const [workspaceTabs, dispatchWorkspaceTabs] = useReducer(
        workspaceTabsReducer,
        INITIAL_WORKSPACE_TABS_STATE
    );
    const [chatDraftRequest, setChatDraftRequest] = useState<{ revision: number; text: string } | null>(null);
    const [canonicalProjectReadyPath, setCanonicalProjectReadyPath] = useState<string | null>(null);
    const {
        setPluginConnected,
        isPluginConnected,
        currentProject,
        setCurrentProject,
        apiKeys,
        modelPreferences,
        dynamicModels,
        upsertDynamicModels,
        recentProjects,
        ecommerceStructure,
        setEcommerceStructure,
        theme
    } = useAppStore();
    
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
    const lastSyncedApiKeys = useRef<string | null>(null);
    const projectRootSynced = useRef<string | null>(null);
    const projectScanned = useRef<string | null>(null);  // 记录已扫描的项目路径
    const designLearningEntry = useRef(createDesignLearningRuntimeEntryController());
    const designLearningPreparedFor = useRef<string | null>(null);
    const debugBridgeProjectSeeded = useRef(false);
    const stateFallbackLoaded = useRef(false);
    const stateSaveTimer = useRef<number | null>(null);
    const connectionStatusRevision = useRef(0);
    const workspaceProjectSessionRef = useRef<string | null>(null);
    const chatDraftRevisionRef = useRef(0);

    useEffect(() => installManualSkuColorCardBridge(), []);

    // ChatGPT 订阅目录属于当前登录会话，不能持久化成永久模型配置。只有当前 Agent
    // 明确选择 Codex 订阅模型时才在启动期恢复目录；其他 Provider 不应为未使用能力
    // 拉起 Codex app-server。设置页、登录和显式订阅调用仍通过原 IPC 按需启动。
    useEffect(() => {
        if (!isCodexSubscriptionModelId(modelPreferences.primaryModel)) return undefined;

        let disposed = false;
        let retryTimer: number | null = null;
        let revision = 0;

        const scheduleHydration = (delayMs: number, attempt = 0): void => {
            if (retryTimer !== null) window.clearTimeout(retryTimer);
            retryTimer = window.setTimeout(() => {
                retryTimer = null;
                void hydrateSubscriptionModels(attempt);
            }, delayMs);
        };

        const hydrateSubscriptionModels = async (attempt: number): Promise<void> => {
            const requestRevision = ++revision;
            const api = window.designEcho;
            if (!api?.getCodexSubscriptionStatus || !api.listCodexSubscriptionModels) return;

            try {
                const statusResult = await api.getCodexSubscriptionStatus();
                if (disposed || requestRevision !== revision) return;
                if (!statusResult.success || !statusResult.status.runtimeAvailable) {
                    if (attempt < 4) scheduleHydration(500 * (attempt + 1), attempt + 1);
                    return;
                }
                if (!statusResult.status.signedIn) {
                    upsertDynamicModels('openai-codex', []);
                    return;
                }

                const modelResult = await api.listCodexSubscriptionModels(false);
                if (disposed || requestRevision !== revision) return;
                if (!modelResult.success) {
                    // 已登录但目录暂时不可用，不等于账号没有模型。保留上一次已验证目录并
                    // 有限重试；清空会让 renderer 与主进程在冷启动阶段形成不同模型事实。
                    if (attempt < 4) {
                        scheduleHydration(500 * (attempt + 1), attempt + 1);
                        return;
                    }
                    console.warn('[App] ChatGPT 订阅模型目录恢复失败:', modelResult.error || 'unknown');
                    return;
                }
                upsertDynamicModels('openai-codex', modelResult.models);
            } catch (error) {
                if (disposed || requestRevision !== revision) return;
                if (attempt < 4) {
                    retryTimer = window.setTimeout(() => {
                        retryTimer = null;
                        void hydrateSubscriptionModels(attempt + 1);
                    }, 400 * (attempt + 1));
                    return;
                }
                console.warn('[App] ChatGPT 订阅模型目录恢复失败:', error);
            }
        };

        const unsubscribe = window.designEcho?.onCodexSubscriptionStateChanged?.((event) => {
            revision += 1;
            if (event.reason === 'account') {
                upsertDynamicModels('openai-codex', []);
                scheduleHydration(0);
                return;
            }
            if (event.reason === 'ready') {
                scheduleHydration(0);
                return;
            }
            // Runtime 进程退出不代表账户或已验证模型目录失效。保留目录让下一次调用仍能
            // 正确路由到订阅 provider，同时后台做有限次数的 Runtime 重启与目录复核。
            scheduleHydration(750, 1);
        });

        scheduleHydration(0);
        return () => {
            disposed = true;
            revision += 1;
            if (retryTimer !== null) window.clearTimeout(retryTimer);
            unsubscribe?.();
        };
    }, [modelPreferences.primaryModel, upsertDynamicModels]);

    // Claude 订阅模型目录：启动拉一次（覆盖持久化旧条目），主进程完成真实型号解析后再拉一次。
    // 不依赖设置页卡片挂载——用户直接聊天也能拿到带具体型号 id 的最新目录。
    useEffect(() => {
        let disposed = false;
        const pullClaudeModels = async (): Promise<void> => {
            // 旧主进程可能没有 Claude handlers：IPC 失败静默降级，不抛全局未处理拒绝。
            const result = await window.designEcho?.listClaudeSubscriptionModels?.().catch(() => null);
            if (!disposed && result?.success && Array.isArray(result.models) && result.models.length > 0) {
                upsertDynamicModels('claude-subscription', result.models);
            }
        };
        void pullClaudeModels();
        const unsubscribeModelsReady = window.designEcho?.onClaudeSubscriptionModelsReady?.(() => {
            void pullClaudeModels();
        });
        return () => {
            disposed = true;
            unsubscribeModelsReady?.();
        };
    }, [upsertDynamicModels]);

    const commitProjectSession = useCallback((project: ProjectInfo | null, pendingDraft?: string): void => {
        const nextSession = project ? `${project.id}:${project.path}` : null;
        if (workspaceProjectSessionRef.current !== nextSession) {
            workspaceProjectSessionRef.current = nextSession;
            projectScanned.current = null;
            setEcommerceStructure(null);
            dispatchWorkspaceTabs({ type: 'reset' });
            setChatDraftRequest(null);
        }

        setCurrentProject(project);
        const normalizedDraft = pendingDraft?.trim();
        if (!project || !normalizedDraft) return;
        chatDraftRevisionRef.current += 1;
        setChatDraftRequest({
            revision: chatDraftRevisionRef.current,
            text: normalizedDraft
        });
    }, [setCurrentProject, setEcommerceStructure]);

    useEffect(() => {
        const selectedProject = currentProject;
        if (!selectedProject?.path) {
            setCanonicalProjectReadyPath(null);
            return;
        }
        if (canonicalProjectReadyPath === selectedProject.path) return;

        let cancelled = false;
        setCanonicalProjectReadyPath(null);
        const resolveIdentity = async (): Promise<void> => {
            try {
                const canonicalProject = await canonicalizeProjectSession(selectedProject);
                if (cancelled) return;
                const latestProject = useAppStore.getState().currentProject;
                if (latestProject?.id !== selectedProject.id || latestProject.path !== selectedProject.path) return;

                const identityChanged = canonicalProject.path !== selectedProject.path
                    || canonicalProject.name !== selectedProject.name
                    || JSON.stringify(canonicalProject.folders) !== JSON.stringify(selectedProject.folders);
                if (identityChanged) {
                    useAppStore.getState().addRecentProject(canonicalProject);
                    setCurrentProject(canonicalProject);
                    return;
                }
                setCanonicalProjectReadyPath(canonicalProject.path);
            } catch (error) {
                console.error('[App] 项目身份解析失败，已停止项目扫描以避免写入错误目录:', error);
            }
        };
        void resolveIdentity();
        return () => {
            cancelled = true;
        };
    }, [canonicalProjectReadyPath, currentProject, setCurrentProject]);

    const activateWorkspacePage = useCallback((tabId: WorkspacePageKind): void => {
        dispatchWorkspaceTabs({ type: 'activate', tabId });
    }, []);

    const openWorkspacePage = useCallback((kind: WorkspacePageKind): void => {
        dispatchWorkspaceTabs({ type: 'open', kind });
    }, []);

    const closeWorkspacePage = useCallback((tabId: WorkspacePageKind): void => {
        dispatchWorkspaceTabs({ type: 'close', tabId });
    }, []);

    useEffect(() => {
        const projectPath = window.designEcho?.getDebugBridgeLaunchProjectPath?.();
        if (!projectPath) return;

        const seedTestProject = () => {
            if (debugBridgeProjectSeeded.current) return;
            const hydratedProject = useAppStore.getState().currentProject;
            debugBridgeProjectSeeded.current = true;
            if (hydratedProject?.path === projectPath) return;
            commitProjectSession({
                id: 'debug-bridge-project-session',
                name: projectPath.split(/[\\/]+/).filter(Boolean).pop() || 'Debug Bridge Project',
                path: projectPath,
                createdAt: Date.now(),
                lastOpenedAt: Date.now(),
                folders: {}
            });
        };

        const persistedStore = (useAppStore as any).persist;
        if (persistedStore?.hasHydrated?.()) {
            seedTestProject();
            return;
        }

        const unsubscribe = persistedStore?.onFinishHydration?.(() => {
            seedTestProject();
        });
        const fallbackTimer = window.setTimeout(seedTestProject, 1000);
        return () => {
            unsubscribe?.();
            clearTimeout(fallbackTimer);
        };
    }, [commitProjectSession]);

    // 检查连接状态
    const checkConnection = useCallback(async () => {
        const revision = ++connectionStatusRevision.current;
        try {
            const status = await window.designEcho?.getConnectionStatus();
            const connected = status?.connected ?? false;
            if (revision !== connectionStatusRevision.current) {
                return useAppStore.getState().isPluginConnected;
            }
            setPluginConnected(connected);
            
            if (connected) {
                console.log('[App] ✅ Photoshop 插件已连接');
            }
            return connected;
        } catch (error) {
            console.error('[App] 检查连接状态失败:', error);
            if (revision !== connectionStatusRevision.current) {
                return useAppStore.getState().isPluginConnected;
            }
            return false;
        }
    }, [setPluginConnected]);

    useEffect(() => {
        // 立即检查连接状态
        checkConnection();

        // 监听连接状态变化
        const unsubConnect = window.designEcho?.onPluginConnected(() => {
            console.log('[App] 📡 收到插件连接事件');
            connectionStatusRevision.current += 1;
            setPluginConnected(true);
            setConnectionAttempts(0);
        });

        const unsubDisconnect = window.designEcho?.onPluginDisconnected(() => {
            console.log('[App] ⚠️ 收到插件断开事件');
            connectionStatusRevision.current += 1;
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
                if (!useAppStore.getState().currentProject) return;
                const targetView = String(event.data.view || '');
                if (targetView === 'chat') activateWorkspacePage('workflow');
                if (targetView === 'assets') openWorkspacePage('assets');
            }
        };
        window.addEventListener('message', handleMessage);

        return () => {
            unsubConnect?.();
            unsubDisconnect?.();
            clearInterval(intervalId);
            window.removeEventListener('message', handleMessage);
        };
    }, [activateWorkspacePage, checkConnection, openWorkspacePage, setPluginConnected]);

    // 持久化恢复或受控测试桥之外的直接 Store 切换也必须进入同一个会话事务。
    useEffect(() => {
        const synchronizedProject = useAppStore.getState().currentProject;
        if (synchronizedProject && canonicalProjectReadyPath !== synchronizedProject.path) return;
        const currentSession = synchronizedProject
            ? `${synchronizedProject.id}:${synchronizedProject.path}`
            : null;
        if (workspaceProjectSessionRef.current === currentSession) return;
        commitProjectSession(synchronizedProject);
    }, [canonicalProjectReadyPath, commitProjectSession, currentProject?.id, currentProject?.path]);

    // 启动时同步 API Keys 到主进程（zustand persist 恢复后）
    useEffect(() => {
        const normalizedApiKeys = {
            anthropic: apiKeys?.anthropic || '',
            google: apiKeys?.google || '',
            xiaomi: apiKeys?.xiaomi || '',
            openai: apiKeys?.openai || '',
            openrouter: apiKeys?.openrouter || '',
            deepseek: apiKeys?.deepseek || '',
            smileAi: apiKeys?.smileAi || '',
            ollamaUrl: apiKeys?.ollamaUrl || '',
            ollamaApiKey: apiKeys?.ollamaApiKey || '',
            volcengineJimengAccessKeyId: apiKeys?.volcengineJimengAccessKeyId || '',
            volcengineJimengSecretAccessKey: apiKeys?.volcengineJimengSecretAccessKey || '',
            volcengineSeedreamApiKey: apiKeys?.volcengineSeedreamApiKey || ''
        };
        const snapshot = JSON.stringify(normalizedApiKeys);
        if (lastSyncedApiKeys.current === snapshot) return;

        const timer = setTimeout(async () => {
            if (Object.values(normalizedApiKeys).some(Boolean)) {
                console.log('[App] 🔄 同步 API Keys 到主进程...');
                try {
                    await window.designEcho?.setApiKeys(normalizedApiKeys);
                    console.log('[App] ✅ API Keys 已同步到主进程');
                    if (normalizedApiKeys.openrouter) {
                        console.log('[App] ✅ OpenRouter API Key 已配置，语义分割功能可用');
                    } else {
                        console.warn('[App] ⚠️ 未配置 OpenRouter API Key，语义分割将使用降级方案');
                    }
                    lastSyncedApiKeys.current = snapshot;
                } catch (error) {
                    console.error('[App] ❌ 同步 API Keys 失败:', error);
                }
            } else {
                console.log('[App] ℹ️ 未配置 API Keys，请在设置中配置');
                lastSyncedApiKeys.current = snapshot;
            }
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
                const skipFallbackProjectRestore = debugBridgeProjectSeeded.current;
                const shouldPatch =
                    (!current.recentProjects?.length && Array.isArray(fallbackState.recentProjects) && fallbackState.recentProjects.length > 0) ||
                    (!skipFallbackProjectRestore && !current.currentProject && fallbackState.currentProject) ||
                    ((!current.apiKeys || Object.keys(current.apiKeys).length === 0) && fallbackState.apiKeys && Object.keys(fallbackState.apiKeys).length > 0);
                if (!shouldPatch) return;
                useAppStore.setState({
                    apiKeys: fallbackState.apiKeys || current.apiKeys,
                    modelPreferences: normalizeModelPreferences(
                        fallbackState.modelPreferences || current.modelPreferences
                    ),
                    currentProject: skipFallbackProjectRestore ? current.currentProject : (fallbackState.currentProject || current.currentProject),
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

    // 主进程资源分析与 renderer 主 Agent 必须使用同一个模型选择。模型偏好已由
    // Zustand 同步水合，挂载和每次修改后立即投影到主进程；备份状态的 300ms 防抖
    // 只负责磁盘冗余，不能再充当运行时模型同步机制。
    useEffect(() => {
        Promise.resolve(
            window.designEcho?.setModelPreferences?.({ ...modelPreferences, dynamicModels })
        ).catch((error: any) => {
            console.warn('[App] 同步模型偏好到主进程失败:', error);
        });
    }, [dynamicModels, modelPreferences]);

    useEffect(() => {
        if (currentProject && canonicalProjectReadyPath !== currentProject.path) return;
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
    }, [apiKeys, canonicalProjectReadyPath, modelPreferences, currentProject, recentProjects]);

    // 项目恢复、切换或关闭时，把同一根目录同步给主进程资源服务。
    // UI 项目状态与资源服务必须共享一个真相源，否则重启后 Agent 会看到素材索引，却读不到活动项目身份。
    useEffect(() => {
        if (currentProject && canonicalProjectReadyPath !== currentProject.path) return;
        const nextProjectRoot = String(currentProject?.path || '').trim();
        if (projectRootSynced.current === nextProjectRoot) return;

        let cancelled = false;
        const syncProjectRoot = async (): Promise<void> => {
            try {
                const result = await window.designEcho?.setProjectRoot?.(nextProjectRoot);
                if (cancelled || result?.success !== true) return;
                projectRootSynced.current = nextProjectRoot;
                console.log('[App] ✅ 项目根目录已同步到资源服务:', nextProjectRoot || '(已清空)');
            } catch (error) {
                console.warn('[App] 项目根目录同步失败:', error);
            }
        };
        void syncProjectRoot();
        return () => {
            cancelled = true;
        };
    }, [canonicalProjectReadyPath, currentProject?.path]);

    // 当项目从存储恢复或切换时，自动扫描电商项目结构
    useEffect(() => {
        const scanProject = async () => {
            if (!currentProject?.path) return;
            if (canonicalProjectReadyPath !== currentProject.path) return;
            const requestedProjectPath = currentProject.path;

            const needsScan = !ecommerceStructure || ecommerceStructure.projectPath !== requestedProjectPath;
            if (!needsScan || projectScanned.current === requestedProjectPath) return;

            console.log('[App] 🔄 自动扫描项目结构:', requestedProjectPath);
            try {
                if (window.designEcho?.scanEcommerceProject) {
                    const structure = await window.designEcho.scanEcommerceProject(requestedProjectPath);
                    if (useAppStore.getState().currentProject?.path !== requestedProjectPath) return;
                    if (structure) {
                        setEcommerceStructure(structure as EcommerceProjectStructure);
                        projectScanned.current = requestedProjectPath;
                        console.log('[App] ✅ 项目结构扫描完成:', structure.summary);
                    }
                }
            } catch (error) {
                // 扫描失败时不锁死，允许后续重试
                if (useAppStore.getState().currentProject?.path === requestedProjectPath) {
                    projectScanned.current = null;
                }
                console.error('[App] ❌ 扫描项目结构失败:', error);
            }
        };

        const timer = setTimeout(scanProject, 300);
        return () => clearTimeout(timer);
    }, [canonicalProjectReadyPath, currentProject?.path, ecommerceStructure?.projectPath, setEcommerceStructure]);

    useEffect(() => {
        if (!currentProject && !ecommerceStructure) return;
        if (currentProject && canonicalProjectReadyPath !== currentProject.path) return;
        const projectKey = [
            currentProject?.id || '',
            currentProject?.path || '',
            ecommerceStructure?.projectPath || ''
        ].join('|');
        if (!projectKey.trim() || designLearningPreparedFor.current === projectKey) return;

        const timer = window.setTimeout(async () => {
            try {
                const result = await designLearningEntry.current.prepareOnAppStart({
                    currentProject,
                    ecommerceStructure,
                    now: new Date().toISOString(),
                    cadence: 'daily'
                });
                designLearningPreparedFor.current = projectKey;
                console.log('[App] 设计学习入口已准备:', {
                    status: result.status,
                    selectedImages: result.projectImages.selectedCount,
                    pendingReview: result.reviewQueue.queuedCount
                });
            } catch (error) {
                console.warn('[App] 设计学习入口准备失败:', error);
            }
        }, 600);

        return () => clearTimeout(timer);
    }, [canonicalProjectReadyPath, currentProject, ecommerceStructure]);

    const handleProjectOpen = useCallback((project: ProjectInfo, pendingDraft?: string): void => {
        commitProjectSession(project, pendingDraft);
    }, [commitProjectSession]);

    // 关闭项目回到主页，并销毁当前项目的页面会话。
    const handleCloseProject = (): void => {
        commitProjectSession(null);
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
                        workspaceNavigation={(
                            <WorkspaceTabBar
                                state={workspaceTabs}
                                onActivate={activateWorkspacePage}
                                onOpen={openWorkspacePage}
                                onClose={closeWorkspacePage}
                            />
                        )}
                    />
                    
                    <div className="app-main">
                        <Suspense fallback={<div className="app-main-loading" aria-label="正在打开项目" />}>
                            <DesignAgentWorkbench
                                key={`${currentProject.id}:${currentProject.path}`}
                                activePage={workspaceTabs.activeTabId}
                                openPages={workspaceTabs.tabs.map((tab) => tab.kind)}
                                chatDraftRequest={chatDraftRequest}
                                workflowPersistenceKey={`${currentProject.id}:${currentProject.path}`}
                                onOpenPage={openWorkspacePage}
                            />
                        </Suspense>
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
                    <ProjectManager onProjectOpen={handleProjectOpen} />
                </div>
            )}

            {/* 设置弹窗 */}
            {showSettings && (
                <Suspense fallback={null}>
                    <SettingsModal onClose={() => setShowSettings(false)} />
                </Suspense>
            )}
        </div>
    );
}

export default App;
