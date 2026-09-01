/**
 * 应用自更新 UI（唯一的家：顶栏徽章 + 设置「关于与更新」区块共用一份状态订阅）。
 *
 * 顶栏徽章只在「下载中 / 已就绪」两个用户相关阶段渲染，后台检查与网络错误不打扰
 * 主界面；设置区块则完整投影全部七个阶段（含开发态 / 未配置的诚实说明），并提供
 * 用户主动的「检查更新」入口。安装会重启应用，因此必须由用户显式点击，且点击前
 * 明确告知进行中任务会中断。
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { AppUpdateState } from '../../shared/app-update-contract';

/** 订阅主进程更新状态：先拉一次当前值，再跟随 appUpdate:state 推送。 */
export function useAppUpdateState(): AppUpdateState | null {
    const [updateState, setUpdateState] = useState<AppUpdateState | null>(null);

    useEffect(() => {
        let disposed = false;
        const pull = async (): Promise<void> => {
            const state = await window.designEcho?.getAppUpdateState?.().catch(() => null);
            if (!disposed && state) setUpdateState(state);
        };
        void pull();
        const unsubscribe = window.designEcho?.onAppUpdateState?.((state) => {
            if (!disposed) setUpdateState(state);
        });
        return () => {
            disposed = true;
            unsubscribe?.();
        };
    }, []);

    return updateState;
}

/** 用户确认后触发安装重启；返回失败原因（成功或用户取消时返回空串）。 */
async function confirmAndInstall(): Promise<string> {
    const confirmed = window.confirm(
        '更新将关闭并重启 DesignEcho，进行中的设计任务会中断。现在更新吗？'
    );
    if (!confirmed) return '';
    const result = await window.designEcho?.installAppUpdate?.().catch((error: unknown) => ({
        success: false,
        error: error instanceof Error ? error.message : String(error)
    }));
    if (result && !result.success) {
        return result.error || '安装未能启动，请稍后重试。';
    }
    return '';
}

interface AppUpdateBadgeProps {}

export const AppUpdateBadge: React.FC<AppUpdateBadgeProps> = () => {
    const updateState = useAppUpdateState();
    const [installError, setInstallError] = useState<string>('');

    // 主进程状态一旦变化，过期的安装失败文案必须让位给实时投影。
    useEffect(() => {
        setInstallError('');
    }, [updateState]);

    const handleInstall = useCallback(async () => {
        setInstallError(await confirmAndInstall());
    }, []);

    if (!updateState) return null;
    const { phase, latestVersion, progressPercent } = updateState;
    if (phase !== 'downloading' && phase !== 'downloaded') return null;

    return (
        <div className="app-update-badge">
            {phase === 'downloading' ? (
                <span className="app-update-downloading">
                    新版本{latestVersion ? ` v${latestVersion}` : ''} 下载中 {progressPercent ?? 0}%
                </span>
            ) : (
                <button
                    type="button"
                    className="app-update-ready"
                    onClick={handleInstall}
                    title={installError || `新版本${latestVersion ? ` v${latestVersion}` : ''}已下载完成，点击重启更新`}
                >
                    <span className="app-update-dot" />
                    新版本{latestVersion ? ` v${latestVersion}` : ''}已就绪 · 点击更新
                </button>
            )}
            <style>{`
                .app-update-badge { display: flex; align-items: center; margin-right: 8px; }
                .app-update-downloading {
                    font-size: 12px; color: var(--de-text-secondary, #8a8f98); white-space: nowrap;
                }
                .app-update-ready {
                    display: flex; align-items: center; gap: 6px;
                    padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(64, 158, 255, 0.45);
                    background: rgba(64, 158, 255, 0.12); color: var(--de-primary, #409eff);
                    font-size: 12px; cursor: pointer; white-space: nowrap;
                }
                .app-update-ready:hover { background: rgba(64, 158, 255, 0.2); }
                .app-update-dot {
                    width: 6px; height: 6px; border-radius: 50%;
                    background: var(--de-primary, #409eff);
                    animation: appUpdatePulse 1.6s ease-in-out infinite;
                }
                @keyframes appUpdatePulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.35; }
                }
            `}</style>
        </div>
    );
};

function formatCheckedAt(iso: string | undefined): string {
    if (!iso) return '';
    const time = new Date(iso);
    if (Number.isNaN(time.getTime())) return '';
    return time.toLocaleString('zh-CN', { hour12: false });
}

function describePhase(state: AppUpdateState): string {
    switch (state.phase) {
        case 'unsupported_dev':
            return '当前以开发模式运行，自动更新仅在正式安装版中生效。';
        case 'unconfigured':
            return '更新源尚未配置（仍是占位地址），发布首个正式版本后自动启用。';
        case 'idle': {
            const checked = formatCheckedAt(state.checkedAt);
            return checked ? `已是最新版本（上次检查：${checked}）` : '尚未检查过更新。';
        }
        case 'checking':
            return '正在检查更新…';
        case 'downloading':
            return `新版本${state.latestVersion ? ` v${state.latestVersion}` : ''}正在后台下载：${state.progressPercent ?? 0}%`;
        case 'downloaded':
            return `新版本${state.latestVersion ? ` v${state.latestVersion}` : ''}已下载完成，点击「重启并安装」生效。`;
        case 'error':
            return state.error || '更新失败，请稍后重试。';
        default:
            return '';
    }
}

interface AppUpdateSettingsSectionProps {}

/** 设置 → 常规 →「关于与更新」：版本信息 + 用户主动检查入口 + 全阶段状态投影。 */
export const AppUpdateSettingsSection: React.FC<AppUpdateSettingsSectionProps> = () => {
    const updateState = useAppUpdateState();
    const [installError, setInstallError] = useState<string>('');

    // 与徽章一致：状态推送到达即清除过期安装错误，避免红字盖住实时进度。
    useEffect(() => {
        setInstallError('');
    }, [updateState]);

    const handleCheck = useCallback(async () => {
        await window.designEcho?.checkForAppUpdate?.().catch(() => null);
    }, []);

    const handleInstall = useCallback(async () => {
        setInstallError(await confirmAndInstall());
    }, []);

    const phase = updateState?.phase;
    const checkDisabled = !updateState
        || phase === 'unsupported_dev'
        || phase === 'unconfigured'
        || phase === 'checking'
        || phase === 'downloading'
        || phase === 'downloaded';
    const statusText = updateState ? describePhase(updateState) : '正在读取更新状态…';
    const statusIsError = phase === 'error' || Boolean(installError);

    return (
        <div className="config-section">
            <h3 className="section-title">关于与更新</h3>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '16px',
                padding: '16px',
                background: 'var(--de-bg-light)',
                borderRadius: '8px',
                border: '1px solid var(--de-border)'
            }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                        DesignEcho{updateState ? ` v${updateState.currentVersion}` : ''}
                    </div>
                    <div style={{
                        fontSize: '12px',
                        color: statusIsError ? 'var(--de-error, #e5534b)' : 'var(--de-text-secondary)',
                        overflowWrap: 'anywhere'
                    }}>
                        {installError || statusText}
                    </div>
                </div>
                {phase === 'downloaded' ? (
                    <button
                        type="button"
                        className="btn btn-primary"
                        style={{ flexShrink: 0 }}
                        onClick={handleInstall}
                    >
                        重启并安装
                    </button>
                ) : (
                    <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ flexShrink: 0 }}
                        onClick={handleCheck}
                        disabled={checkDisabled}
                    >
                        {phase === 'checking' ? '检查中…' : '检查更新'}
                    </button>
                )}
            </div>
        </div>
    );
};
