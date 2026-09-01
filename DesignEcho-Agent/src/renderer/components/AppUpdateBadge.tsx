/**
 * 应用更新徽章（Header 常驻挂载，自含状态订阅）。
 *
 * 只在「下载中 / 已就绪」两个用户相关阶段渲染：开发态、未配置、空闲、后台检查与
 * 网络错误都不打扰界面（错误由下次周期检查自愈，状态仍可经 IPC 查询）。
 * 安装会重启应用，因此必须由用户显式点击，且点击前明确告知进行中任务会中断。
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { AppUpdateState } from '../../shared/app-update-contract';

interface AppUpdateBadgeProps {}

export const AppUpdateBadge: React.FC<AppUpdateBadgeProps> = () => {
    const [updateState, setUpdateState] = useState<AppUpdateState | null>(null);
    const [installError, setInstallError] = useState<string>('');

    useEffect(() => {
        let disposed = false;
        const pull = async (): Promise<void> => {
            const state = await window.designEcho?.getAppUpdateState?.().catch(() => null);
            if (!disposed && state) setUpdateState(state);
        };
        void pull();
        const unsubscribe = window.designEcho?.onAppUpdateState?.((state) => {
            if (!disposed) {
                setUpdateState(state);
                setInstallError('');
            }
        });
        return () => {
            disposed = true;
            unsubscribe?.();
        };
    }, []);

    const handleInstall = useCallback(async () => {
        const confirmed = window.confirm(
            '更新将关闭并重启 DesignEcho，进行中的设计任务会中断。现在更新吗？'
        );
        if (!confirmed) return;
        const result = await window.designEcho?.installAppUpdate?.().catch((error: unknown) => ({
            success: false,
            error: error instanceof Error ? error.message : String(error)
        }));
        if (result && !result.success) {
            setInstallError(result.error || '安装未能启动，请稍后重试。');
        }
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
