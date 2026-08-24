import React, { useCallback, useEffect, useState } from 'react';

import type {
    CodexSubscriptionImageGenerationCapabilityResult,
    CodexSubscriptionRateLimits,
    CodexSubscriptionStatus
} from '../../shared/codex-subscription-contract';
import type { ModelConfig } from '../../shared/config/models.config';
import type { ImageGenerationProvider } from '../stores/app.store';
import { SubscriptionInfoItem } from './SubscriptionCardParts';

interface ChatGptSubscriptionCardProps {
    onModelsLoaded: (models: ModelConfig[]) => void;
    imageGenerationProvider: ImageGenerationProvider;
    onImageGenerationProviderChange: (provider: ImageGenerationProvider) => void;
}

function formatResetTime(timestamp: number | undefined): string {
    if (!timestamp || !Number.isFinite(timestamp)) return '重置时间未提供';
    const milliseconds = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
    return `重置于 ${new Date(milliseconds).toLocaleString('zh-CN')}`;
}

function reportUiFailure(action: string, error: unknown): string {
    console.warn(`[ChatGPTSubscription] ${action}失败:`, error);
    return `${action}失败；请刷新状态后重试。`;
}

/** 区块右上角的登录态标记：检查中 / 恢复中优先于登录结果展示。 */
function describeCodexBadge(
    status: CodexSubscriptionStatus | null,
    recovering: boolean,
    signedIn: boolean
): { text: string; tone: string } {
    if (status === null) return { text: '检查中', tone: 'warning' };
    if (recovering) return { text: '恢复中', tone: 'warning' };
    if (signedIn) return { text: '已登录', tone: 'success' };
    if (status.runtimeAvailable) return { text: '未登录', tone: 'warning' };
    return { text: '不可用', tone: 'error' };
}

function RateLimitRow(props: {
    label: string;
    value: CodexSubscriptionRateLimits['primary'];
}): JSX.Element | null {
    if (!props.value) return null;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '12px' }}>
                <span>{props.label}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>已使用 {Math.round(props.value.usedPercent)}%</span>
            </div>
            <div style={{ height: '4px', background: 'var(--de-border)', borderRadius: '99px', overflow: 'hidden' }}>
                <div
                    style={{
                        height: '100%',
                        width: `${Math.max(0, Math.min(100, props.value.usedPercent))}%`,
                        background: 'var(--de-primary)',
                        borderRadius: '99px'
                    }}
                />
            </div>
            <span className="subscription-card__note">
                {formatResetTime(props.value.resetsAt)}
            </span>
        </div>
    );
}

export const ChatGptSubscriptionCard: React.FC<ChatGptSubscriptionCardProps> = ({
    onModelsLoaded,
    imageGenerationProvider,
    onImageGenerationProviderChange
}) => {
    const [status, setStatus] = useState<CodexSubscriptionStatus | null>(null);
    const [rateLimits, setRateLimits] = useState<CodexSubscriptionRateLimits | null>(null);
    const [modelCount, setModelCount] = useState(0);
    const [imageCapability, setImageCapability] = useState<CodexSubscriptionImageGenerationCapabilityResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [recovering, setRecovering] = useState(false);
    const [message, setMessage] = useState('正在检查内置 Codex Runtime…');

    const loadModels = useCallback(async (forceRefresh: boolean): Promise<void> => {
        const api = window.designEcho;
        if (!api.listCodexSubscriptionModels) return;
        try {
            const result = await api.listCodexSubscriptionModels(forceRefresh);
            setModelCount(result.models.length);
            onModelsLoaded(result.models);
            if (!result.success || result.error) {
                setMessage(result.error || '没有取得 GPT-5.6 模型目录。');
            } else {
                setMessage(`已载入 ${result.models.length} 个当前账户可用的 GPT-5.6 模型。`);
            }
        } catch (error) {
            setModelCount(0);
            onModelsLoaded([]);
            setMessage(reportUiFailure('读取订阅模型', error));
        }
    }, [onModelsLoaded]);

    const loadRateLimits = useCallback(async (): Promise<void> => {
        const api = window.designEcho;
        if (!api.getCodexSubscriptionRateLimits) return;
        try {
            const result = await api.getCodexSubscriptionRateLimits();
            setRateLimits(result.success ? result.rateLimits || null : null);
        } catch (error) {
            setRateLimits(null);
            console.warn('[ChatGPTSubscription] 读取订阅额度失败:', error);
        }
    }, []);

    const loadImageCapability = useCallback(async (): Promise<void> => {
        const api = window.designEcho;
        if (!api.getCodexSubscriptionImageGenerationCapability) {
            setImageCapability({
                success: false,
                available: false,
                model: 'gpt-image-2',
                usageKind: 'codex_subscription',
                error: '当前构建未包含订阅生图通道。'
            });
            return;
        }
        try {
            setImageCapability(await api.getCodexSubscriptionImageGenerationCapability());
        } catch (error) {
            setImageCapability({
                success: false,
                available: false,
                model: 'gpt-image-2',
                usageKind: 'codex_subscription',
                error: reportUiFailure('检查订阅生图', error)
            });
        }
    }, []);

    const loadStatus = useCallback(async (hydrateAccountData: boolean): Promise<void> => {
        const api = window.designEcho;
        if (!api.getCodexSubscriptionStatus) {
            setMessage('当前构建未包含 ChatGPT 订阅登录能力。');
            return;
        }
        try {
            const result = await api.getCodexSubscriptionStatus();
            setStatus(result.status);
            if (!result.success) {
                setModelCount(0);
                onModelsLoaded([]);
                setMessage(result.error || result.status.error || '内置 Codex Runtime 不可用。');
                return;
            }
            if (result.status.signedIn) {
                if (hydrateAccountData) {
                    await Promise.all([loadModels(false), loadRateLimits(), loadImageCapability()]);
                }
                return;
            }
            setRateLimits(null);
            setImageCapability(null);
            if (!result.status.loginPending) {
                setModelCount(0);
                onModelsLoaded([]);
            }
            if (result.status.loginPending) {
                setMessage('浏览器登录进行中；完成后这里会自动刷新。');
            } else if (result.status.error) {
                setMessage(result.status.error);
            } else {
                setMessage('登录后将从当前账户实时读取可用的 GPT-5.6 模型。');
            }
        } catch (error) {
            setModelCount(0);
            onModelsLoaded([]);
            setStatus(null);
            setMessage(reportUiFailure('检查订阅登录', error));
        } finally {
            setRecovering(false);
        }
    }, [loadImageCapability, loadModels, loadRateLimits, onModelsLoaded]);

    useEffect(() => {
        void loadStatus(true);
    }, [loadStatus]);

    useEffect(() => {
        const subscribe = window.designEcho.onCodexSubscriptionStateChanged;
        if (!subscribe) return undefined;
        let recoveryTimer: number | null = null;
        const unsubscribe = subscribe((event) => {
            setRateLimits(null);
            setImageCapability(null);
            if (event.reason === 'runtime_exit') {
                setRecovering(true);
                setStatus((current) => current
                    ? {
                        ...current,
                        runtimeAvailable: false,
                        loginPending: false,
                        error: undefined
                    }
                    : {
                        runtimeAvailable: false,
                        runtimeVersion: '0.149.0',
                        signedIn: false,
                        authMode: 'none',
                        loginPending: false
                    });
                setMessage('内置 Codex Runtime 已退出，正在自动恢复账户与模型目录…');
                if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
                recoveryTimer = window.setTimeout(() => {
                    recoveryTimer = null;
                    void loadStatus(true);
                }, 1200);
                return;
            }
            if (event.reason === 'account') {
                setModelCount(0);
                onModelsLoaded([]);
            }
            void loadStatus(true);
        });
        return () => {
            if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
            unsubscribe();
        };
    }, [loadStatus, onModelsLoaded]);

    useEffect(() => {
        if (!status?.loginPending) return undefined;
        const timer = window.setInterval(() => {
            void loadStatus(true);
        }, 1500);
        return () => window.clearInterval(timer);
    }, [loadStatus, status?.loginPending]);

    const handleLogin = async (): Promise<void> => {
        if (!window.designEcho.startCodexSubscriptionLogin) return;
        setBusy(true);
        try {
            const result = await window.designEcho.startCodexSubscriptionLogin();
            if (!result.success) {
                setMessage(result.error || '启动 ChatGPT 登录失败。');
                return;
            }
            setMessage(result.pending ? '已在系统浏览器打开 ChatGPT 登录。' : '登录状态已更新。');
            await loadStatus(true);
        } catch (error) {
            setMessage(reportUiFailure('启动 ChatGPT 登录', error));
        } finally {
            setBusy(false);
        }
    };

    const handleCancelLogin = async (): Promise<void> => {
        if (!window.designEcho.cancelCodexSubscriptionLogin) return;
        setBusy(true);
        try {
            const result = await window.designEcho.cancelCodexSubscriptionLogin();
            if (!result.success) {
                setMessage(result.error || '取消 ChatGPT 登录失败。');
                return;
            }
            setMessage('已取消本次登录。');
            await loadStatus(false);
        } catch (error) {
            setMessage(reportUiFailure('取消 ChatGPT 登录', error));
        } finally {
            setBusy(false);
        }
    };

    const handleLogout = async (): Promise<void> => {
        if (!window.designEcho.logoutCodexSubscription) return;
        setBusy(true);
        try {
            const result = await window.designEcho.logoutCodexSubscription();
            if (!result.success) {
                setMessage(result.error || '退出订阅登录失败。');
                return;
            }
            setModelCount(0);
            setRateLimits(null);
            setImageCapability(null);
            onModelsLoaded([]);
            setMessage('已退出 DesignEcho 的隔离 ChatGPT 登录。');
            await loadStatus(false);
        } catch (error) {
            setMessage(reportUiFailure('退出订阅登录', error));
        } finally {
            setBusy(false);
        }
    };

    const handleRefresh = async (): Promise<void> => {
        setBusy(true);
        try {
            await loadStatus(true);
        } finally {
            setBusy(false);
        }
    };

    const signedIn = status?.signedIn === true;
    const hasUnsupportedAuthentication = status?.authMode === 'api_key' || status?.authMode === 'unsupported';
    const subscriptionImageAvailable = signedIn && imageCapability?.available === true;

    const badge = describeCodexBadge(status, recovering, signedIn);
    const hasRateLimits = Boolean(rateLimits?.primary || rateLimits?.secondary);

    return (
        <div className="config-section">
            <div className="section-header">
                <div>
                    <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        ChatGPT 订阅模型
                        <span className="badge">Beta</span>
                    </h3>
                    <p className="section-desc" style={{ marginBottom: 0 }}>
                        通过内置 Codex Runtime 使用 ChatGPT 订阅，与 OpenAI API Key 和 API 账单彼此独立。
                    </p>
                </div>
                <span className={`status-text ${badge.tone}`}>{badge.text}</span>
            </div>

            <div className="subscription-card">
                {signedIn && (
                    <div className="subscription-card__grid">
                        <SubscriptionInfoItem label="账户" value={status?.accountLabel || '已脱敏'} title={status?.accountLabel} />
                        <SubscriptionInfoItem label="套餐" value={status?.planType || '运行时未提供'} />
                        <SubscriptionInfoItem label="模型" value={`${modelCount} 个 GPT-5.6`} />
                        <SubscriptionInfoItem label="Runtime" value={status?.runtimeVersion || '未知'} />
                    </div>
                )}

                {hasRateLimits && (
                    <div className={`subscription-card__meters${signedIn ? ' subscription-card__divided' : ''}`}>
                        <RateLimitRow label="主要额度窗口" value={rateLimits?.primary} />
                        <RateLimitRow label="次要额度窗口" value={rateLimits?.secondary} />
                    </div>
                )}

                <div
                    className={signedIn || hasRateLimits ? 'subscription-card__divided' : undefined}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '16px'
                    }}
                >
                    <div style={{ display: 'flex', minWidth: 0, flexDirection: 'column', gap: '5px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 500 }}>Agent 生图渠道</span>
                        <span className="subscription-card__note">
                            {subscriptionImageAvailable
                                ? '订阅通道已验证：gpt-image-2，计入 Codex 通用用量。'
                                : imageCapability?.error || '登录后会检测当前账户是否开放 gpt-image-2。'}
                        </span>
                    </div>
                    <select
                        className="select"
                        value={imageGenerationProvider}
                        onChange={(event) => onImageGenerationProviderChange(
                            event.target.value === 'codex-subscription' ? 'codex-subscription' : 'bfl'
                        )}
                        style={{ width: '210px', flexShrink: 0 }}
                    >
                        <option value="bfl">BFL API（FLUX）</option>
                        <option value="codex-subscription" disabled={!subscriptionImageAvailable}>
                            ChatGPT/Codex 订阅（gpt-image-2）
                        </option>
                    </select>
                </div>

                <div className="subscription-card__divided">
                    <span className={`status-text ${status?.error ? 'error' : ''}`}>{message}</span>
                </div>

                <div className="subscription-card__actions" style={{ marginTop: '-4px' }}>
                    {!signedIn && !status?.loginPending && !hasUnsupportedAuthentication && !recovering && (
                        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void handleLogin()}>
                            {busy ? '正在启动…' : '登录 ChatGPT'}
                        </button>
                    )}
                    {status?.loginPending && (
                        <button className="btn btn-sm" disabled={busy} onClick={() => void handleCancelLogin()}>
                            取消登录
                        </button>
                    )}
                    {signedIn && (
                        <>
                            <button className="btn btn-primary btn-sm" disabled={busy || recovering} onClick={() => void handleRefresh()}>
                                {busy ? '刷新中…' : '刷新模型与额度'}
                            </button>
                            <button className="btn btn-sm" disabled={busy || recovering} onClick={() => void handleLogout()}>
                                退出订阅登录
                            </button>
                        </>
                    )}
                    {hasUnsupportedAuthentication && (
                        <button className="btn btn-sm" disabled={busy} onClick={() => void handleLogout()}>
                            清除当前 Codex 认证
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
