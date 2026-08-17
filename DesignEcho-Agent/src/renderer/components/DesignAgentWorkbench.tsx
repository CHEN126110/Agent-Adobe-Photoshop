import React, { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from 'react';

import type { DesignKnowledgeResult } from '../../shared/design-knowledge-search';
import {
    normalizeEagleComposerAssetRefs,
    type EagleComposerInsertRequest
} from '../../shared/eagle-composer-transfer';
import type { EagleAssetRef } from '../../shared/eagle-asset-ref';
import {
    createKnowledgeSelectionReference,
    upsertKnowledgeSelectionReference,
    type CreateKnowledgeSelectionOptions,
    type KnowledgeSelectionReference,
    type KnowledgeSelectionResult
} from '../../shared/knowledge-selection-context';
import type { AssetSelectionContext } from './AssetGallery';
import { ChatPanel } from './ChatPanel';
import type { WorkspacePageKind } from './WorkspaceTabBar';
import {
    buildWorkflowSelectionContextKey,
    WORKFLOW_PALETTE,
    WorkflowBoard,
    type WorkflowNodeAddRequest,
    type WorkflowNodeId,
    type WorkflowSelectionContext
} from './WorkflowBoard';

import './DesignAgentWorkbench.css';

const AssetGallery = lazy(() =>
    import('./AssetGallery').then((module) => ({ default: module.AssetGallery }))
);
const KnowledgeLibraryPage = lazy(() =>
    import('./KnowledgeLibraryPage').then((module) => ({ default: module.KnowledgeLibraryPage }))
);
const EagleLibraryPage = lazy(() =>
    import('./EagleLibraryPage').then((module) => ({ default: module.EagleLibraryPage }))
);

interface ChatDraftRequest {
    revision: number;
    text: string;
}

interface DesignAgentWorkbenchProps {
    activePage: WorkspacePageKind;
    openPages: WorkspacePageKind[];
    chatDraftRequest?: ChatDraftRequest | null;
    // 项目身份，供工作流画布按项目持久化图数据。
    workflowPersistenceKey?: string;
    onOpenPage?: (page: WorkspacePageKind) => void;
}

export const DesignAgentWorkbench: React.FC<DesignAgentWorkbenchProps> = ({
    activePage,
    openPages,
    chatDraftRequest,
    workflowPersistenceKey,
    onOpenPage
}) => {
    const [selectedNodeId, setSelectedNodeId] = useState<WorkflowNodeId | null>(null);
    const [addNodeRequest, setAddNodeRequest] = useState<WorkflowNodeAddRequest | null>(null);
    // WorkflowBoard 仍是图数据 owner；这里仅保存其最新只读投影，让工作流身份不依赖“是否选中节点”。
    const [workflowSelectionContext, setWorkflowSelectionContext] = useState<WorkflowSelectionContext | null>(null);
    const [selectedAssetContext, setSelectedAssetContext] = useState<AssetSelectionContext | null>(null);
    // Eagle 页的浏览选中由页面自己持有；只有拖拽、右键或显式按钮才产生一次性对话插入请求。
    const [eagleComposerInsertRequest, setEagleComposerInsertRequest] = useState<EagleComposerInsertRequest | null>(null);
    const eagleComposerInsertRevisionRef = useRef(0);
    const [knowledgeReferences, setKnowledgeReferences] = useState<KnowledgeSelectionReference[]>([]);
    const assetsOpened = openPages.includes('assets');
    const eagleOpened = openPages.includes('eagle');
    const knowledgeOpened = openPages.includes('knowledge');

    const handleWorkflowSelectionContextChange = useCallback((context: WorkflowSelectionContext): void => {
        const nextContextKey = buildWorkflowSelectionContextKey(context);
        setWorkflowSelectionContext((current) => {
            if (current && buildWorkflowSelectionContextKey(current) === nextContextKey) {
                return current;
            }
            return context;
        });
        // 画布节点只是工作流浏览状态；不应顺手清掉用户已固定到对话的素材引用。
    }, []);

    const handleAssetSelectionChange = useCallback((context: AssetSelectionContext): void => {
        setSelectedAssetContext(context);
        setSelectedNodeId(null);
    }, []);

    const handleAddEagleAssetsToConversation = useCallback((assetRefs: EagleAssetRef[]): void => {
        const normalizedRefs = normalizeEagleComposerAssetRefs(assetRefs);
        if (normalizedRefs.length === 0) return;
        eagleComposerInsertRevisionRef.current += 1;
        setEagleComposerInsertRequest({
            revision: eagleComposerInsertRevisionRef.current,
            assetRefs: normalizedRefs
        });
        setSelectedAssetContext(null);
        setSelectedNodeId(null);
    }, []);

    const handleConsumeEagleComposerInsertRequest = useCallback((revision: number): void => {
        setEagleComposerInsertRequest((current) => (
            current?.revision === revision ? null : current
        ));
    }, []);

    const handleAddKnowledgeReference = useCallback((result: DesignKnowledgeResult, options?: CreateKnowledgeSelectionOptions): KnowledgeSelectionResult => {
        const selection = createKnowledgeSelectionReference(result, new Date().toISOString(), options);
        if (selection.ok && selection.reference) {
            setKnowledgeReferences((current) => upsertKnowledgeSelectionReference(current, selection.reference!));
        }
        return selection;
    }, []);

    const handleRemoveKnowledgeReference = useCallback((bindingRef: string): void => {
        setKnowledgeReferences((current) => current.filter((item) => item.bindingRef !== bindingRef));
    }, []);

    useLayoutEffect(() => {
        // 页面切换后不沿用隐藏页面的旧指向；用户需要在当前可见页面重新选择唯一对象。
        setSelectedNodeId(null);
        setSelectedAssetContext(null);
    }, [activePage]);

    function requestPaletteNode(paletteIndex: number): void {
        setAddNodeRequest({ paletteIndex, revision: Date.now() });
    }

    return (
        <main className="design-agent-workbench" data-testid="design-agent-workbench">
            <div className={`workbench-shell page-${activePage}`}>
                <aside
                    className="workflow-left-rail"
                    data-testid="workflow-node-library"
                    aria-label="节点库"
                    aria-hidden={activePage !== 'workflow'}
                >
                    <div className="workflow-rail-heading">节点库</div>
                    <div className="workflow-palette">
                        <div className="workflow-palette-hint">拖入画布或点击添加</div>
                        {WORKFLOW_PALETTE.map((item, index) => (
                            <button
                                key={`${item.kind}-${item.title}`}
                                type="button"
                                draggable
                                className="workflow-palette-item"
                                onClick={() => requestPaletteNode(index)}
                                onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = 'copy';
                                    event.dataTransfer.setData('application/x-designecho-workflow-node', String(index));
                                }}
                            >
                                <span className="workflow-palette-row">
                                    <span className={`workflow-palette-dot kind-${item.kind}`} />
                                    <span className="workflow-palette-title">{item.title}</span>
                                    <span className="workflow-palette-type">{item.typeLabel}</span>
                                </span>
                                <span className="workflow-palette-subtitle">{item.subtitle}</span>
                            </button>
                        ))}
                    </div>
                </aside>

                <section className="workbench-primary" data-testid="workbench-page-deck" aria-label="项目页面">
                    <div
                        id="workspace-panel-workflow"
                        role="tabpanel"
                        aria-labelledby="workspace-tab-workflow"
                        className={`workbench-page workbench-workflow-page ${activePage === 'workflow' ? 'active' : ''}`}
                        data-testid="workbench-agent-canvas"
                        aria-label="Agent 任务画布"
                        aria-hidden={activePage !== 'workflow'}
                    >
                        <WorkflowBoard
                            selectedNodeId={selectedNodeId}
                            onSelectNode={setSelectedNodeId}
                            addNodeRequest={addNodeRequest}
                            onSelectionContextChange={handleWorkflowSelectionContextChange}
                            persistenceKey={workflowPersistenceKey}
                        />
                    </div>

                    {assetsOpened && (
                        <div
                            id="workspace-panel-assets"
                            role="tabpanel"
                            aria-labelledby="workspace-tab-assets"
                            className={`workbench-page workbench-assets-page ${activePage === 'assets' ? 'active' : ''}`}
                            data-testid="workbench-asset-page"
                            aria-label="项目素材"
                            aria-hidden={activePage !== 'assets'}
                        >
                            <Suspense fallback={<div className="workbench-loading">正在加载项目素材…</div>}>
                                <AssetGallery
                                    selectedImagePath={selectedAssetContext?.path}
                                    onAssetSelectionChange={handleAssetSelectionChange}
                                />
                            </Suspense>
                        </div>
                    )}

                    {knowledgeOpened && (
                        <div
                            id="workspace-panel-knowledge"
                            role="tabpanel"
                            aria-labelledby="workspace-tab-knowledge"
                            className={`workbench-page workbench-knowledge-page ${activePage === 'knowledge' ? 'active' : ''}`}
                            data-testid="workbench-knowledge-page"
                            aria-label="知识库"
                            aria-hidden={activePage !== 'knowledge'}
                        >
                            <Suspense fallback={<div className="workbench-loading">正在加载知识库…</div>}>
                                <KnowledgeLibraryPage
                                    isActive={activePage === 'knowledge'}
                                    selectedReferences={knowledgeReferences}
                                    onAddReference={handleAddKnowledgeReference}
                                    onRemoveReference={handleRemoveKnowledgeReference}
                                    onOpenEagle={() => onOpenPage?.('eagle')}
                                />
                            </Suspense>
                        </div>
                    )}

                    {eagleOpened && (
                        <div
                            id="workspace-panel-eagle"
                            role="tabpanel"
                            aria-labelledby="workspace-tab-eagle"
                            className={`workbench-page workbench-eagle-page ${activePage === 'eagle' ? 'active' : ''}`}
                            data-testid="workbench-eagle-library-page"
                            aria-label="Eagle 素材库"
                            aria-hidden={activePage !== 'eagle'}
                        >
                            <Suspense fallback={<div className="workbench-loading">正在加载 Eagle 素材库…</div>}>
                                <EagleLibraryPage
                                    isActive={activePage === 'eagle'}
                                    onAddToConversation={handleAddEagleAssetsToConversation}
                                />
                            </Suspense>
                        </div>
                    )}
                </section>

                <aside className="workbench-agent-panel" aria-label="Agent 对话">
                    <div className="workbench-panel-heading">
                        <span>对话</span>
                        <small>Agent</small>
                    </div>
                    <div className="workbench-agent-panel-content">
                        <ChatPanel
                            externalDraft={chatDraftRequest?.text}
                            externalDraftRevision={chatDraftRequest?.revision}
                            activeWorkspacePage={activePage}
                            workflowSelectionContext={workflowSelectionContext}
                            selectedAssetContext={selectedAssetContext}
                            eagleComposerInsertRequest={eagleComposerInsertRequest}
                            knowledgeReferences={knowledgeReferences}
                            onClearSelectedAssetContext={() => setSelectedAssetContext(null)}
                            onConsumeEagleComposerInsertRequest={handleConsumeEagleComposerInsertRequest}
                            onRemoveKnowledgeReference={handleRemoveKnowledgeReference}
                            onRequestOpenWorkspacePage={(page) => onOpenPage?.(page)}
                        />
                    </div>
                </aside>
            </div>
        </main>
    );
};
