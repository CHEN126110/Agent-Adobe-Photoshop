import React from 'react';
import { Sidebar } from './Sidebar';
import { ChatPanel } from './ChatPanel';
import { AssetGallery } from './AssetGallery';
import type { EcommerceProjectStructure } from '../stores/app.store';
import './DesignAgentWorkbench.css';

type WorkbenchView = 'chat' | 'assets';

interface DesignAgentWorkbenchProps {
    activeView: WorkbenchView;
    onActiveViewChange: (view: WorkbenchView) => void;
    projectName: string;
    isPluginConnected: boolean;
    ecommerceStructure?: EcommerceProjectStructure | null;
}

export const DesignAgentWorkbench: React.FC<DesignAgentWorkbenchProps> = ({
    activeView,
    onActiveViewChange
}) => {
    return (
        <main className="design-agent-workbench" data-testid="design-agent-workbench">
            <nav className="workbench-view-nav" aria-label="工作台视图">
                <button
                    type="button"
                    className={`workbench-view-btn ${activeView === 'chat' ? 'active' : ''}`}
                    onClick={() => onActiveViewChange('chat')}
                    aria-current={activeView === 'chat' ? 'page' : undefined}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    对话
                </button>
                <button
                    type="button"
                    className={`workbench-view-btn ${activeView === 'assets' ? 'active' : ''}`}
                    onClick={() => onActiveViewChange('assets')}
                    aria-current={activeView === 'assets' ? 'page' : undefined}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="m21 15-5-5L5 21" />
                    </svg>
                    素材
                </button>
            </nav>

            <div className="workbench-shell">
                <section className="workbench-primary" data-testid="workbench-agent-canvas" aria-label="Agent 任务画布">
                    {activeView === 'chat' ? (
                        <div className="workbench-chat-layout">
                            <div className="workbench-conversation-rail" data-testid="workbench-conversation-rail">
                                <Sidebar />
                            </div>
                            <div className="workbench-chat-canvas">
                                <ChatPanel />
                            </div>
                        </div>
                    ) : (
                        <div className="workbench-asset-canvas" data-testid="workbench-asset-canvas">
                            <AssetGallery />
                        </div>
                    )}
                </section>
            </div>
        </main>
    );
};
