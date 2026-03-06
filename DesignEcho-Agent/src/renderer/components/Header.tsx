/**
 * 顶部导航栏
 */

import React, { useState } from 'react';

interface HeaderProps {
    isConnected: boolean;
    onSettingsClick: () => void;
    projectName?: string;
    onCloseProject?: () => void;
    isHome?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ 
    isConnected, 
    onSettingsClick, 
    projectName, 
    onCloseProject,
    isHome 
}) => {
    const [isUndoing, setIsUndoing] = useState(false);
    const [isRedoing, setIsRedoing] = useState(false);

    const handleUndo = async () => {
        if (!isConnected || isUndoing) return;
        setIsUndoing(true);
        try {
            await window.designEcho?.sendToPlugin('undo', {});
        } catch (error) {
            console.error('Undo failed:', error);
        } finally {
            setIsUndoing(false);
        }
    };

    const handleRedo = async () => {
        if (!isConnected || isRedoing) return;
        setIsRedoing(true);
        try {
            await window.designEcho?.sendToPlugin('redo', {});
        } catch (error) {
            console.error('Redo failed:', error);
        } finally {
            setIsRedoing(false);
        }
    };

    return (
        <header className="app-header">
            <div className="header-left">
                {/* 返回按钮（项目模式下显示） */}
                {projectName && onCloseProject && (
                    <button 
                        className="back-btn" 
                        onClick={onCloseProject}
                        title="返回项目列表"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 12H5M12 19l-7-7 7-7"/>
                        </svg>
                    </button>
                )}

                <div className="logo">
                    <span className="logo-icon">🎨</span>
                    <span className="logo-text">
                        {projectName || 'DesignEcho'}
                    </span>
                    {projectName && (
                        <span className="project-badge">项目</span>
                    )}
                </div>
            </div>

            {/* 撤销/重做按钮（仅在项目模式下显示） */}
            {!isHome && (
                <div className="history-buttons">
                    <button 
                        className="history-btn" 
                        onClick={handleUndo} 
                        disabled={!isConnected || isUndoing}
                        title="撤销 (Ctrl+Z)"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 7v6h6" />
                            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                        </svg>
                    </button>
                    <button 
                        className="history-btn" 
                        onClick={handleRedo} 
                        disabled={!isConnected || isRedoing}
                        title="重做 (Ctrl+Shift+Z)"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 7v6h-6" />
                            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
                        </svg>
                    </button>
                </div>
            )}

            <div className="header-center">
                <div className={`connection-badge ${!isConnected ? 'waiting' : ''}`}>
                    <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
                    <span className="connection-text">
                        {isConnected ? '✓ Photoshop 已连接' : '等待 Photoshop 连接...'}
                    </span>
                    {!isConnected && (
                        <span className="connection-hint">请在 PS 中打开插件面板</span>
                    )}
                </div>
            </div>

            <div className="header-right">
                <button className="btn btn-ghost" onClick={onSettingsClick}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    设置
                </button>
            </div>

            <style>{`
                .app-header {
                    display: flex;
                    align-items: center;
                    height: 60px;
                    padding: 0;
                    background: var(--de-bg-card);
                    backdrop-filter: blur(20px);
                    border-bottom: 1px solid var(--de-border);
                    -webkit-app-region: drag;
                }

                .header-left {
                    width: 260px;
                    min-width: 260px;
                    max-width: 260px;
                    display: flex;
                    align-items: center;
                    padding: 0 16px;
                    box-sizing: border-box;
                    -webkit-app-region: no-drag;
                    flex-shrink: 0;
                    border-right: 1px solid var(--de-border);
                    height: 100%;
                }

                .header-right {
                    min-width: 160px;
                    display: flex;
                    align-items: center;
                    justify-content: flex-end;
                    padding-right: 16px;
                    -webkit-app-region: no-drag;
                    flex-shrink: 0;
                }

                .logo {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex-shrink: 0;
                    white-space: nowrap;
                    overflow: hidden;
                }

                .logo-icon {
                    font-size: 24px;
                    flex-shrink: 0;
                }

                .logo-text {
                    font-family: 'Space Grotesk', sans-serif;
                    font-size: 20px;
                    font-weight: 600;
                    background: linear-gradient(135deg, #fff 0%, #0066ff 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 200px;
                }

                .header-center {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding-left: 16px;
                }

                .connection-badge {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px 16px;
                    background: var(--de-bg-light);
                    border: 1px solid var(--de-border);
                    border-radius: 20px;
                    font-size: 13px;
                }

                .connection-text {
                    color: var(--de-text-secondary);
                }

                .connection-badge.waiting {
                    animation: pulse 2s ease-in-out infinite;
                }

                .connection-badge.waiting .status-dot {
                    animation: blink 1s ease-in-out infinite;
                }

                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }

                @keyframes blink {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.3; }
                }

                .connection-hint {
                    font-size: 11px;
                    color: var(--de-text-secondary);
                    opacity: 0.7;
                    margin-left: 4px;
                }

                .history-buttons {
                    display: flex;
                    gap: 4px;
                    padding: 0 12px;
                    align-items: center;
                    flex-shrink: 0;
                }

                .history-btn {
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--de-bg-light);
                    border: 1px solid var(--de-border);
                    border-radius: 6px;
                    color: var(--de-text);
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .history-btn:hover:not(:disabled) {
                    background: var(--de-primary);
                    border-color: var(--de-primary);
                    color: white;
                }

                .history-btn:disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                }

                .back-btn {
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--de-bg-light);
                    border: 1px solid var(--de-border);
                    border-radius: 6px;
                    color: var(--de-text);
                    cursor: pointer;
                    transition: all 0.2s;
                    margin-right: 10px;
                    flex-shrink: 0;
                }

                .back-btn:hover {
                    background: var(--de-bg-card);
                    border-color: var(--de-primary);
                    color: var(--de-primary);
                }

                .project-badge {
                    font-size: 10px;
                    font-weight: 500;
                    padding: 2px 8px;
                    background: var(--de-primary);
                    color: white;
                    border-radius: 10px;
                    margin-left: 8px;
                }
            `}</style>
        </header>
    );
};
