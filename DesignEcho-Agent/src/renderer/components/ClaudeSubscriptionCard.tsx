import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { ClaudeSubscriptionStatus } from '../../shared/claude-subscription-contract';
import type { ModelConfig } from '../../shared/config/models.config';
import { SubscriptionInfoItem } from './SubscriptionCardParts';

interface ClaudeSubscriptionCardProps {
    onModelsLoaded: (models: ModelConfig[]) => void;
}

const LOGIN_POLL_INTERVAL_MS = 2500;
const LOGIN_POLL_MAX_TICKS = 72; // 3 分钟

type LoginPhase = 'idle' | 'waiting_login' | 'loading_models';

/** 数据格里的「状态」文案：登录进行时优先说明当前动作，静止时说明验证结果。 */
function describeClaudeStatus(phase: LoginPhase, verified: boolean, signedIn: boolean, modelLabel: string): string {
    switch (phase) {
        case 'waiting_login':
            return '等待浏览器授权…';
        case 'loading_models':
            return '正在载入模型…';
        default:
            break;
    }
    if (verified) return `已验证（${modelLabel}）`;
    if (signedIn) return '正在自动验证…';
    return '未登录';
}

/** 模型目录载入进度：只有验证通过后才谈得上载入中。 */
function describeClaudeModels(modelsLoaded: boolean, verified: boolean): string {
    if (modelsLoaded) return '已载入当前订阅可用型号';
    if (verified) return '载入中…';
    return '—';
}

/** 区块右上角的登录态标记，与 ChatGPT 订阅卡使用同一套 status-text 配色。 */
function describeClaudeBadge(verified: boolean, signedIn: boolean): { text: string; tone: string } {
    if (verified) return { text: '已登录', tone: 'success' };
    if (signedIn) return { text: '验证中', tone: 'warning' };
    return { text: '未登录', tone: '' };
}

/** 与 ChatGPT 订阅卡同级体验：一键登录 → 浏览器授权 → 自动验证 → 模型自动载入，无中间手动步骤。 */
export function ClaudeSubscriptionCard(props: ClaudeSubscriptionCardProps): JSX.Element {
    const { onModelsLoaded } = props;
    const [status, setStatus] = useState<ClaudeSubscriptionStatus | null>(null);
    const [phase, setPhase] = useState<'idle' | 'waiting_login' | 'loading_models'>('idle');
    const [notice, setNotice] = useState<string>('');
    const [modelsLoaded, setModelsLoaded] = useState(false);
    const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollTicks = useRef(0);

    const stopPolling = useCallback((): void => {
        if (pollTimer.current) {
            clearInterval(pollTimer.current);
            pollTimer.current = null;
        }
        pollTicks.current = 0;
    }, []);

    const loadModels = useCallback(async (): Promise<void> => {
        const api = (window as any).designEcho;
        // 主进程可能是未含 Claude handlers 的旧构建（真机 2026-08-23：No handler registered 未捕获拒绝）：
        // IPC 失败一律静默降级，不让卡片把异常抛成全局未处理拒绝。
        const listResult = await api?.listClaudeSubscriptionModels?.().catch(() => null);
        if (listResult?.success && Array.isArray(listResult.models)) {
            onModelsLoaded(listResult.models);
            setModelsLoaded(true);
        }
    }, [onModelsLoaded]);

    const refreshStatus = useCallback(async (): Promise<ClaudeSubscriptionStatus | null> => {
        const api = (window as any).designEcho;
        if (!api?.getClaudeSubscriptionStatus) return null;
        const result = await api.getClaudeSubscriptionStatus().catch(() => null);
        if (result?.success) {
            setStatus(result.status);
            return result.status;
        }
        return null;
    }, []);

    // 挂载：读状态。已验证的旧登录直接把模型带上；有凭据但未验证时（应用刚重启），
    // 主进程会自动后台验证，这里短轮询等它完成——全程不需要用户点任何东西。
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const current = await refreshStatus();
            if (cancelled || !current) return;
            if (current.lastProbe?.ok) {
                void loadModels();
                return;
            }
            if (current.credentialSource !== 'credential_file') return;
            for (let tick = 0; tick < 24 && !cancelled; tick += 1) {
                await new Promise((resolve) => setTimeout(resolve, LOGIN_POLL_INTERVAL_MS));
                const polled = await refreshStatus();
                if (cancelled || !polled?.lastProbe) continue;
                if (polled.lastProbe.ok) void loadModels();
                break;
            }
        })();
        return () => {
            cancelled = true;
            stopPolling();
        };
    }, [refreshStatus, loadModels, stopPolling]);

    const handleLogin = useCallback(async (): Promise<void> => {
        setNotice('');
        const api = (window as any).designEcho;
        const result = await api?.openClaudeSubscriptionLoginTerminal?.().catch((error: any) => ({ success: false, error: String(error?.message || error) }));
        if (!result?.success) {
            setNotice(result?.error || '启动登录失败。');
            return;
        }
        setPhase('waiting_login');
        setNotice('已启动登录：在浏览器里完成授权即可，这里会自动继续。');
        stopPolling();
        pollTimer.current = setInterval(() => {
            void (async () => {
                pollTicks.current += 1;
                const current = await refreshStatus();
                if (current?.lastProbe?.ok) {
                    stopPolling();
                    setPhase('loading_models');
                    await loadModels();
                    setPhase('idle');
                    setNotice(`登录完成：${current.lastProbe.model || 'Claude'} 已验证，订阅模型已加入模型列表。`);
                    return;
                }
                if (current?.lastProbe && !current.lastProbe.ok) {
                    stopPolling();
                    setPhase('idle');
                    setNotice(`登录后的自动验证未通过：${current.lastProbe.error || '未知原因'}。请重试登录。`);
                    return;
                }
                if (pollTicks.current >= LOGIN_POLL_MAX_TICKS) {
                    stopPolling();
                    setPhase('idle');
                    setNotice('等待登录超时。如已在浏览器完成授权，请再点一次「登录 Claude 订阅」。');
                }
            })();
        }, LOGIN_POLL_INTERVAL_MS);
    }, [refreshStatus, loadModels, stopPolling]);

    const handleLogout = useCallback(async (): Promise<void> => {
        const api = (window as any).designEcho;
        const result = await api?.logoutClaudeSubscription?.().catch((error: any) => ({ success: false, error: String(error?.message || error) }));
        if (result?.success) {
            setModelsLoaded(false);
            setNotice('已退出 Claude 订阅登录。');
            void refreshStatus();
        } else {
            setNotice(result?.error || '退出登录失败。');
        }
    }, [refreshStatus]);

    const verified = Boolean(status?.lastProbe?.ok);
    const signedIn = verified || status?.credentialSource === 'credential_file';
    const busy = phase !== 'idle';

    const modelLabel = (status?.lastProbe?.model || 'Claude').replace(/\[.*\]$/, '');
    const statusText = describeClaudeStatus(phase, verified, signedIn, modelLabel);
    const badge = describeClaudeBadge(verified, signedIn);

    return (
        <div className="config-section">
            <div className="section-header">
                <div>
                    <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        Claude 订阅模型
                        <span className="badge">Beta</span>
                    </h3>
                    <p className="section-desc" style={{ marginBottom: 0 }}>
                        通过内置 Claude Code 运行时使用你的 Claude 订阅（Pro / Max），与 Anthropic API Key 彼此独立。登录凭据由官方运行时自管，本应用不经手。
                    </p>
                </div>
                <span className={`status-text ${badge.tone}`}>{badge.text}</span>
            </div>

            <div className="subscription-card">
                <div className="subscription-card__grid">
                    <SubscriptionInfoItem label="状态" value={statusText} title={statusText} />
                    <SubscriptionInfoItem
                        label="Runtime"
                        value={status?.runtimeAvailable ? `Agent SDK ${status.runtimeVersion || ''}`.trim() : '不可用'}
                    />
                    <SubscriptionInfoItem label="模型" value={describeClaudeModels(modelsLoaded, verified)} />
                    <SubscriptionInfoItem
                        label="本次会话用量"
                        value={status?.sessionUsage
                            ? `${status.sessionUsage.calls} 次调用 · ${(status.sessionUsage.inputTokens + status.sessionUsage.outputTokens).toLocaleString()} tokens`
                            : '暂无调用'}
                    />
                </div>

                <div className="subscription-card__actions">
                    {!signedIn && (
                        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => { void handleLogin(); }}>
                            {phase === 'waiting_login' ? '等待授权中…' : '登录 Claude 订阅'}
                        </button>
                    )}
                    {signedIn && (
                        <button className="btn btn-sm" disabled={busy} onClick={() => { void handleLogout(); }}>
                            退出订阅登录
                        </button>
                    )}
                </div>

                {notice && (
                    <div className="subscription-card__note subscription-card__divided" style={{ whiteSpace: 'pre-wrap' }}>
                        {notice}
                    </div>
                )}

                {/* 承诺（不静默降级）必须常显；额度窗口为何缺进度条是对比 ChatGPT 卡时的必答疑问，
                    合并成一句既不丢信息，也不让脚注吃掉卡片三分之一高度。 */}
                <div className={`subscription-card__note${notice ? '' : ' subscription-card__divided'}`}>
                    额度随官方订阅共享，耗尽或未登录时会如实报错、不静默换用其他模型；
                    额度窗口进度官方运行时未提供程序化读取，请在 claude.ai 设置页查看。
                </div>
            </div>
        </div>
    );
}
