/**
 * 简化的作品导入组件
 * 
 * 只支持文件夹拖拽导入，自动索引用户作品到知识库
 */

import React, { useState, useCallback } from 'react';
import './QuickImport.css';

// ==================== 类型定义 ====================

interface QuickImportProps {
    onImportComplete?: (result: ImportResult) => void;
    onError?: (error: string) => void;
    className?: string;
}

interface ImportResult {
    success: boolean;
    type: 'folder';
    projectId: string;
    counts: {
        mainImages: number;
        detailPages: number;
        skus: number;
        total: number;
    };
}

interface ProjectStats {
    projectId: string;
    fileCount: number;
    status: 'pending' | 'indexing' | 'completed' | 'failed';
    success?: number;
    failed?: number;
}

type DragState = 'idle' | 'hover' | 'processing' | 'success' | 'error';

// ==================== 主组件 ====================

export const QuickImport: React.FC<QuickImportProps> = ({
    onImportComplete,
    onError,
    className = ''
}) => {
    const [dragState, setDragState] = useState<DragState>('idle');
    const [message, setMessage] = useState<string>('');
    const [projects, setProjects] = useState<ProjectStats[]>([]);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    
    // 处理拖拽进入
    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragState('hover');
    }, []);
    
    // 处理拖拽离开
    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // 只有当离开整个容器时才重置状态
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            setDragState('idle');
        }
    }, []);
    
    // 处理拖拽悬停
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);
    
    // 处理文件夹放下
    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        setDragState('processing');
        setMessage('正在处理...');
        
        try {
            // 获取拖放的项目
            const items = e.dataTransfer.items;
            
            if (items.length === 0) {
                setDragState('idle');
                setMessage('');
                return;
            }
            
            // 检查是否是文件夹
            const firstItem = items[0];
            if (firstItem.kind !== 'file') {
                setMessage('请拖入项目文件夹');
                setDragState('error');
                setTimeout(() => setDragState('idle'), 2000);
                return;
            }
            
            // 由于浏览器安全限制，无法直接获取文件夹路径
            // 提示用户使用"选择文件夹"按钮
            setMessage('检测到拖入内容，请使用下方按钮选择文件夹');
            setDragState('idle');
            
        } catch (err: any) {
            console.error('处理拖放失败:', err);
            setMessage(err.message || '处理失败');
            setDragState('error');
            onError?.(err.message);
            setTimeout(() => {
                setDragState('idle');
                setMessage('');
            }, 3000);
        }
    }, [onError]);
    
    // 选择文件夹
    const handleSelectFolder = async () => {
        try {
            const result = await window.designEcho.invoke('fs:selectFolder');
            if (result.success && result.path) {
                await indexFolder(result.path);
            }
        } catch (error: any) {
            console.error('选择文件夹失败:', error);
            setMessage('选择文件夹失败: ' + error.message);
            onError?.(error.message);
        }
    };
    
    // 索引文件夹
    const indexFolder = async (folderPath: string) => {
        setLoading(true);
        setDragState('processing');
        setMessage('正在扫描项目...');
        setProgress(0);
        
        const unsub = window.designEcho?.onProjectIndexProgress?.((data: { projectId: string; current: number; total: number }) => {
            setProgress(data.total > 0 ? Math.round((data.current / data.total) * 100) : 10);
            setMessage(`正在索引: ${data.projectId} (${data.current}/${data.total})`);
        });
        
        try {
            const scanResult = await window.designEcho.invoke('project:scanAll', folderPath);
            
            if (!scanResult.success) {
                throw new Error(scanResult.error || '扫描失败');
            }
            
            const projectEntries = Object.entries(scanResult.projects);
            
            if (projectEntries.length === 0) {
                setMessage('未找到有效的项目文件夹');
                setDragState('error');
                setTimeout(() => setDragState('idle'), 3000);
                setLoading(false);
                unsub?.();
                return;
            }
            
            const projectStats: ProjectStats[] = projectEntries.map(([id, items]) => ({
                projectId: id,
                fileCount: (items as any[]).length,
                status: 'pending' as const
            }));
            setProjects(projectStats);
            
            setMessage(`找到 ${projectEntries.length} 个项目，正在索引...`);
            setProgress(5);
            
            const indexResult = await window.designEcho.invoke(
                'project:indexAll',
                scanResult.projects,
                false
            );
            
            if (indexResult.success) {
                const stats = indexResult.stats;
                setMessage(`✅ 索引完成！成功: ${stats.indexed}, 失败: ${stats.failed}`);
                setDragState('success');
                setProgress(100);
                
                // 更新项目状态
                setProjects(prev => prev.map(p => ({
                    ...p,
                    status: 'completed' as const,
                    success: p.fileCount
                })));
                
                onImportComplete?.({
                    success: true,
                    type: 'folder',
                    projectId: projectEntries[0][0],
                    counts: {
                        mainImages: stats.indexed,
                        detailPages: 0,
                        skus: 0,
                        total: stats.indexed
                    }
                });
                
                setTimeout(() => setDragState('idle'), 5000);
            } else {
                throw new Error(indexResult.error || '索引失败');
            }
            
        } catch (err: any) {
            console.error('索引失败:', err);
            setMessage('❌ ' + (err.message || '索引失败'));
            setDragState('error');
            onError?.(err.message);
            setTimeout(() => setDragState('idle'), 5000);
        } finally {
            setLoading(false);
            unsub?.();
        }
    };
    
    // 获取状态样式
    const getStateClass = () => {
        switch (dragState) {
            case 'hover': return 'quick-import--hover';
            case 'processing': return 'quick-import--processing';
            case 'success': return 'quick-import--success';
            case 'error': return 'quick-import--error';
            default: return '';
        }
    };
    
    return (
        <div className={`quick-import ${getStateClass()} ${className}`}>
            {/* 拖放区域 */}
            <div
                className="drop-zone"
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            >
                <div className="drop-zone-content">
                    <div className="drop-icon">
                        {dragState === 'processing' && '⏳'}
                        {dragState === 'success' && '✅'}
                        {dragState === 'error' && '❌'}
                        {dragState === 'hover' && '📂'}
                        {dragState === 'idle' && '📁'}
                    </div>
                    
                    <div className="drop-title">
                        {dragState === 'idle' && '导入你的设计作品'}
                        {dragState === 'hover' && '放开以导入'}
                        {dragState === 'processing' && '正在处理...'}
                        {dragState === 'success' && '导入成功！'}
                        {dragState === 'error' && '导入失败'}
                    </div>
                    
                    <div className="drop-hint">
                        {message || '选择项目文件夹，自动索引主图、详情页、SKU 等设计作品'}
                    </div>
                    
                    {/* 进度条 */}
                    {loading && (
                        <div className="progress-bar">
                            <div 
                                className="progress-fill" 
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    )}
                </div>
            </div>
            
            {/* 操作按钮 */}
            <div className="import-actions">
                <button
                    className="btn-select-folder"
                    onClick={handleSelectFolder}
                    disabled={loading}
                >
                    📂 选择项目文件夹
                </button>
            </div>
            
            {/* 项目列表 */}
            {projects.length > 0 && (
                <div className="project-list">
                    <div className="project-list-title">
                        已索引的项目 ({projects.length})
                    </div>
                    <div className="project-items">
                        {projects.slice(0, 5).map((project) => (
                            <div key={project.projectId} className={`project-item status-${project.status}`}>
                                <span className="project-name">{project.projectId}</span>
                                <span className="project-count">{project.fileCount} 个文件</span>
                                {project.status === 'completed' && (
                                    <span className="status-badge success">✓</span>
                                )}
                                {project.status === 'indexing' && (
                                    <span className="status-badge indexing">⏳</span>
                                )}
                            </div>
                        ))}
                        {projects.length > 5 && (
                            <div className="project-more">
                                还有 {projects.length - 5} 个项目...
                            </div>
                        )}
                    </div>
                </div>
            )}
            
            {/* 使用说明 */}
            <div className="import-tips">
                <div className="tips-title">💡 支持的项目结构</div>
                <div className="tips-content">
                    <code>项目文件夹/</code>
                    <code>├── 主图/</code>
                    <code>├── SKU/</code>
                    <code>├── images/ (详情页)</code>
                    <code>└── PSD/</code>
                </div>
            </div>
        </div>
    );
};

export default QuickImport;
