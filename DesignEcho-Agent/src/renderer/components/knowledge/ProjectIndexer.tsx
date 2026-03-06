/**
 * 项目索引器 UI
 * 
 * 让用户轻松索引自己的设计作品到 RAG 知识库
 */

import React, { useState } from 'react';
import './ProjectIndexer.css';

interface ProjectStats {
    projectId: string;
    fileCount: number;
    status: 'pending' | 'indexing' | 'completed' | 'failed';
    success?: number;
    failed?: number;
}

export const ProjectIndexer: React.FC = () => {
    const [basePath, setBasePath] = useState('D:\\A1 neveralone旗舰店');
    const [loading, setLoading] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [projects, setProjects] = useState<ProjectStats[]>([]);
    const [currentProject, setCurrentProject] = useState<string>('');
    const [progress, setProgress] = useState(0);
    const [useVision, setUseVision] = useState(false);
    const [message, setMessage] = useState('');
    
    /**
     * 选择目录
     */
    const handleSelectFolder = async () => {
        try {
            const result = await window.designEcho.invoke('fs:selectFolder');
            if (result.success && result.path) {
                setBasePath(result.path);
            }
        } catch (error) {
            console.error('选择文件夹失败:', error);
        }
    };
    
    /**
     * 扫描项目
     */
    const handleScanProjects = async () => {
        setScanning(true);
        setMessage('');
        setProjects([]);
        
        try {
            const result = await window.designEcho.invoke('project:scanAll', basePath);
            
            if (result.success) {
                const projectStats: ProjectStats[] = [];
                
                for (const [projectId, items] of Object.entries(result.projects)) {
                    projectStats.push({
                        projectId,
                        fileCount: (items as any[]).length,
                        status: 'pending'
                    });
                }
                
                setProjects(projectStats);
                setMessage(`找到 ${projectStats.length} 个项目`);
            } else {
                setMessage(`扫描失败: ${result.error}`);
            }
        } catch (error: any) {
            setMessage(`扫描失败: ${error.message}`);
        } finally {
            setScanning(false);
        }
    };
    
    /**
     * 索引所有项目
     */
    const handleIndexAll = async () => {
        if (projects.length === 0) {
            setMessage('请先扫描项目');
            return;
        }
        
        setLoading(true);
        setMessage('');
        setProgress(0);
        setCurrentProject('');
        
        const unsub = window.designEcho?.onProjectIndexProgress?.((data: { projectId: string; current: number; total: number; phase?: string }) => {
            setCurrentProject(data.projectId);
            setProgress(data.total > 0 ? Math.round((data.current / data.total) * 100) : 0);
        });
        
        try {
            const result = await window.designEcho.invoke('project:scanAll', basePath);
            if (!result.success) {
                throw new Error(result.error);
            }
            
            const indexResult = await window.designEcho.invoke('project:indexAll', result.projects, useVision);
            
            if (indexResult.success) {
                const stats = indexResult.stats;
                const fallbackTip = useVision && (stats.visionFallbacks || 0) > 0
                    ? `，视觉降级: ${stats.visionFallbacks}`
                    : '';
                setMessage(`✅ 索引完成！成功: ${stats.indexed}, 失败: ${stats.failed}${fallbackTip}, 耗时: ${(stats.duration / 1000).toFixed(1)}s`);
                setProjects(prev => prev.map(p => ({ ...p, status: 'completed' as const })));
            } else {
                setMessage(`索引失败: ${indexResult.error}`);
            }
        } catch (error: any) {
            setMessage(`索引失败: ${error.message}`);
        } finally {
            setLoading(false);
            setCurrentProject('');
            setProgress(0);
            unsub?.();
        }
    };
    
    /**
     * 索引单个项目
     */
    const handleIndexSingle = async (projectId: string) => {
        setLoading(true);
        setMessage('');
        setCurrentProject(projectId);
        setProgress(0);
        
        setProjects(prev => prev.map(p => 
            p.projectId === projectId ? { ...p, status: 'indexing' as const } : p
        ));
        
        const unsub = window.designEcho?.onProjectIndexProgress?.((data: { projectId: string; current: number; total: number; fileName?: string }) => {
            if (data.projectId === projectId && data.total > 0) {
                setProgress(Math.round((data.current / data.total) * 100));
            }
        });
        
        try {
            const scanResult = await window.designEcho.invoke('project:scan', `${basePath}\\${projectId}`);
            if (!scanResult.success) {
                throw new Error(scanResult.error);
            }
            
            const indexResult = await window.designEcho.invoke('project:index', projectId, scanResult.items, useVision);
            
            if (indexResult.success) {
                const visionFallbacks = indexResult.stats?.visionFallbacks || 0;
                const fallbackTip = useVision && visionFallbacks > 0
                    ? `，视觉降级: ${visionFallbacks}`
                    : '';
                setMessage(`✅ ${projectId} 索引完成！成功: ${indexResult.stats?.success ?? indexResult.success}, 失败: ${indexResult.stats?.failed ?? indexResult.failed}${fallbackTip}`);
                setProjects(prev => prev.map(p => 
                    p.projectId === projectId 
                        ? { ...p, status: 'completed' as const, success: indexResult.stats?.success ?? indexResult.success, failed: indexResult.stats?.failed ?? indexResult.failed }
                        : p
                ));
            } else {
                throw new Error(indexResult.error);
            }
        } catch (error: any) {
            setMessage(`索引失败: ${error.message}`);
            setProjects(prev => prev.map(p => 
                p.projectId === projectId ? { ...p, status: 'failed' as const } : p
            ));
        } finally {
            setLoading(false);
            setCurrentProject('');
            setProgress(0);
            unsub?.();
        }
    };
    
    return (
        <div className="project-indexer">
            <div className="indexer-header">
                <h2>📦 作品索引器</h2>
                <p className="subtitle">将你的设计作品索引到 RAG 知识库，让 AI 能够学习和复用你的设计风格</p>
            </div>
            
            {/* 路径选择 */}
            <div className="indexer-controls">
                <div className="path-selector">
                    <input
                        type="text"
                        className="path-input"
                        value={basePath}
                        onChange={(e) => setBasePath(e.target.value)}
                        placeholder="项目根目录，例如: D:\A1 neveralone旗舰店"
                    />
                    <button
                        className="btn btn-secondary"
                        onClick={handleSelectFolder}
                    >
                        📁 选择
                    </button>
                </div>
                
                <div className="action-row">
                    <button
                        className="btn btn-primary"
                        onClick={handleScanProjects}
                        disabled={scanning || loading || !basePath}
                    >
                        {scanning ? '扫描中...' : '🔍 扫描项目'}
                    </button>
                    
                    <button
                        className="btn btn-success"
                        onClick={handleIndexAll}
                        disabled={loading || projects.length === 0}
                    >
                        {loading ? '索引中...' : '⚡ 批量索引'}
                    </button>
                    
                    <label className="vision-toggle">
                        <input
                            type="checkbox"
                            checked={useVision}
                            onChange={(e) => setUseVision(e.target.checked)}
                        />
                        <span>使用视觉模型 (更准确但更慢)</span>
                    </label>
                </div>
            </div>
            
            {/* 进度条 */}
            {loading && (
                <div className="progress-section">
                    <div className="progress-text">
                        {currentProject ? `正在索引: ${currentProject} (${progress}%)` : '准备中...'}
                    </div>
                    <div className="progress-bar">
                        <div
                            className="progress-fill"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>
            )}
            
            {/* 消息提示 */}
            {message && (
                <div className={`message ${message.startsWith('✅') ? 'success' : 'info'}`}>
                    {message}
                </div>
            )}
            
            {/* 项目列表 */}
            {projects.length > 0 && (
                <div className="projects-list">
                    <h3>项目列表 ({projects.length} 个)</h3>
                    <div className="projects-grid">
                        {projects.map((project) => (
                            <div key={project.projectId} className={`project-card status-${project.status}`}>
                                <div className="project-header">
                                    <span className="project-icon">📁</span>
                                    <span className="project-name">{project.projectId}</span>
                                </div>
                                <div className="project-meta">
                                    <span className="file-count">{project.fileCount} 个文件</span>
                                    {project.status === 'completed' && (
                                        <span className="status-badge success">
                                            ✓ {project.success}/{project.fileCount}
                                        </span>
                                    )}
                                    {project.status === 'failed' && (
                                        <span className="status-badge error">✗ 失败</span>
                                    )}
                                    {project.status === 'indexing' && (
                                        <span className="status-badge indexing">⌛ 索引中...</span>
                                    )}
                                    {project.status === 'pending' && (
                                        <button
                                            className="btn btn-sm"
                                            onClick={() => handleIndexSingle(project.projectId)}
                                            disabled={loading}
                                        >
                                            索引
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProjectIndexer;
