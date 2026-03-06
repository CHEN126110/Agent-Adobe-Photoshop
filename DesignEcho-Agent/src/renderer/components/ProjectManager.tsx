/**
 * 项目管理主页
 * 
 * 显示项目列表，支持创建/导入/打开项目
 * 集成电商项目扫描和素材预览功能
 */

import React, { useState, useCallback } from 'react';
import { useAppStore, ProjectInfo, EcommerceProjectStructure } from '../stores/app.store';

export const ProjectManager: React.FC<{
    onProjectOpen: (project: ProjectInfo) => void;
}> = ({ onProjectOpen }) => {
    const { 
        recentProjects, 
        addRecentProject, 
        removeRecentProject, 
        setCurrentProject,
        setEcommerceStructure,
        currentProject
    } = useAppStore();
    const [isLoading, setIsLoading] = useState(false);
    const [loadingStatus, setLoadingStatus] = useState('');
    const [showNewProjectModal, setShowNewProjectModal] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectPath, setNewProjectPath] = useState('');
    const [exportFolderPath, setExportFolderPath] = useState<string | null>(null);
    const [showExportFolderPrompt, setShowExportFolderPrompt] = useState(false);

    const formatErrorMessage = (error: any, fallback: string): string => {
        if (!error) return fallback;
        if (typeof error === 'string') return error;
        const parts: string[] = [];
        if (error.message) parts.push(error.message);
        if (error.error && error.error !== error.message) parts.push(error.error);
        if (error.code) parts.push(`code=${error.code}`);
        if (error.path) parts.push(`path=${error.path}`);
        if (error.details && typeof error.details === 'string') parts.push(error.details);
        return parts.length > 0 ? parts.join('\n') : fallback;
    };

    /**
     * 电商项目标准目录结构
     */
    const PROJECT_SUBDIRS = [
        'SKU',
        'PSD',
        '主图',
        '模板文件',
        '配置文件',
        '主图视频'
    ];

    /**
     * 导出目录已通过 getEntryWithUrl 绕过授权，直接使用项目路径
     */
    const checkExportFolderStatus = useCallback(async () => {
        // 使用 getEntryWithUrl 绕过授权，直接使用项目路径作为导出目录
        if (currentProject?.path) {
            setExportFolderPath(currentProject.path);
        }
    }, [currentProject?.path]);

    /**
     * 确认使用当前项目目录作为导出目录
     * 使用 getEntryWithUrl 绕过授权，无需弹窗选择
     */
    const handleSelectExportFolder = async () => {
        if (currentProject?.path) {
            setExportFolderPath(currentProject.path);
            setShowExportFolderPrompt(false);
            console.log('[ProjectManager] ✅ 使用项目目录:', currentProject.path);
        }
    };

    /**
     * 选择新建项目的父目录
     */
    const handleSelectNewProjectPath = async () => {
        const result: any = await window.designEcho?.selectFolder('选择项目存放位置');
        // 兼容处理：支持返回 { success, path } 对象或直接返回 path 字符串
        const folderPath = (result && typeof result === 'object' && 'path' in result) ? result.path : result;
        
        if (folderPath) {
            setNewProjectPath(folderPath);
        }
    };

    /**
     * 创建新项目
     */
    const handleCreateProject = async () => {
        const normalizedName = newProjectName.trim();
        if (!normalizedName) {
            alert('请输入项目名称');
            return;
        }
        if (/[<>:"/\\|?*\x00-\x1F]/.test(normalizedName)) {
            alert('项目名称包含非法字符，请移除 \ / : * ? " < > |');
            return;
        }
        if (!newProjectPath) {
            alert('请选择项目存放位置');
            return;
        }

        try {
            setIsLoading(true);
            setLoadingStatus('正在创建项目目录...');

            // 完整的项目路径
            const projectFullPath = `${newProjectPath}\\${normalizedName}`;

            // 避免覆盖已有目录
            const alreadyExists = await (window.designEcho as any)?.pathExists?.(projectFullPath);
            if (alreadyExists) {
                throw new Error(`项目目录已存在: ${projectFullPath}`);
            }

            // 创建主目录
            const createResult = await window.designEcho?.invoke('fs:mkdir', projectFullPath);
            if (!createResult?.success) {
                throw createResult || new Error('创建项目目录失败');
            }

            // 创建子目录
            setLoadingStatus('正在创建子目录...');
            for (const subdir of PROJECT_SUBDIRS) {
                const subdirPath = `${projectFullPath}\\${subdir}`;
                const subdirResult = await window.designEcho?.invoke('fs:mkdir', subdirPath);
                if (!subdirResult?.success) {
                    throw { ...(subdirResult || {}), error: subdirResult?.error || `创建子目录失败: ${subdir}` };
                }
            }

            // 创建项目信息
            const project: ProjectInfo = {
                id: crypto.randomUUID(),
                name: normalizedName,
                path: projectFullPath,
                createdAt: Date.now(),
                lastOpenedAt: Date.now(),
                folders: {
                    assets: `${projectFullPath}\\SKU`,
                    psd: `${projectFullPath}\\PSD`,
                    output: `${projectFullPath}\\主图`
                }
            };

            // 扫描项目结构
            setLoadingStatus('正在初始化项目...');
            await scanEcommerceProject(projectFullPath, true);

            // 添加到最近项目
            addRecentProject(project);

            // 打开项目
            setCurrentProject(project);
            onProjectOpen(project);
            setExportFolderPath(projectFullPath);
            setShowExportFolderPrompt(false);

            // 关闭弹窗
            setShowNewProjectModal(false);
            setNewProjectName('');
            setNewProjectPath('');

        } catch (error: any) {
            console.error('[ProjectManager] 创建项目失败:', error);
            const message = formatErrorMessage(error, '创建项目失败，请检查目录权限与路径设置');
            alert(`创建项目失败:\n${message}`);
        } finally {
            setIsLoading(false);
            setLoadingStatus('');
        }
    };

    /**
     * 扫描电商项目结构
     */
    const scanEcommerceProject = useCallback(async (projectPath: string, throwOnError: boolean = false): Promise<EcommerceProjectStructure | null> => {
        try {
            setLoadingStatus('正在扫描项目结构...');
            if (!window.designEcho?.scanEcommerceProject) {
                console.warn('[ProjectManager] scanEcommerceProject API 不可用');
                if (throwOnError) throw new Error('scanEcommerceProject API 不可用');
                return null;
            }
            const structure = await window.designEcho.scanEcommerceProject(projectPath);
            if (structure) {
                setEcommerceStructure(structure as EcommerceProjectStructure);
                console.log('[ProjectManager] 电商项目扫描完成:', structure.summary);
            }
            return structure as EcommerceProjectStructure | null;
        } catch (error: any) {
            console.error('[ProjectManager] 扫描电商项目失败:', error);
            if (throwOnError) {
                throw new Error(formatErrorMessage(error, '扫描项目结构失败'));
            }
            return null;
        }
    }, [setEcommerceStructure]);

    /**
     * 选择并导入项目文件夹
     */
    const handleImportProject = async () => {
        try {
            setIsLoading(true);
            setLoadingStatus('选择文件夹...');
            
            const result: any = await window.designEcho?.selectFolder('选择项目文件夹');
            
            // 兼容处理：支持返回 { success, path } 对象或直接返回 path 字符串
            const folderPath = (result && typeof result === 'object' && 'path' in result) ? result.path : result;
            
            if (!folderPath) {
                setIsLoading(false);
                setLoadingStatus('');
                return;
            }

            // 提取项目名称（文件夹名）
            const pathParts = folderPath.split(/[/\\]/);
            const projectName = pathParts[pathParts.length - 1] || '未命名项目';

            // 使用电商项目扫描服务
            setLoadingStatus('正在识别项目结构...');
            const structure = await scanEcommerceProject(folderPath);

            // 基于扫描结果创建项目信息
            const folders: ProjectInfo['folders'] = {};
            if (structure) {
                for (const folder of structure.folders) {
                    switch (folder.type) {
                        case 'source':
                            folders.assets = folder.path;
                            break;
                        case 'psd':
                            folders.psd = folder.path;
                            break;
                        case 'mainImage':
                        case 'detail':
                        case 'sku':
                            folders.output = folder.path;
                            break;
                    }
                }
            }

            // 创建项目信息
            const project: ProjectInfo = {
                id: crypto.randomUUID(),
                name: projectName,
                path: folderPath,
                createdAt: Date.now(),
                lastOpenedAt: Date.now(),
                folders
            };

            // 添加到最近项目
            addRecentProject(project);
            
            // 打开项目
            setCurrentProject(project);
            onProjectOpen(project);

            // 使用 getEntryWithUrl 绕过授权，直接使用项目路径
            setExportFolderPath(folderPath);
            console.log('[ProjectManager] ✅ 项目目录:', folderPath);

        } catch (error) {
            console.error('[ProjectManager] 导入项目失败:', error);
            alert(`导入项目失败:\n${formatErrorMessage(error, '请检查目录权限与项目路径')}`);
        } finally {
            setIsLoading(false);
            setLoadingStatus('');
        }
    };

    /**
     * 打开已有项目
     */
    const handleOpenProject = async (project: ProjectInfo) => {
        setIsLoading(true);
        setLoadingStatus('正在加载项目...');
        
        try {
            // 扫描电商项目结构
            await scanEcommerceProject(project.path);
            
            setCurrentProject({ ...project, lastOpenedAt: Date.now() });
            addRecentProject({ ...project, lastOpenedAt: Date.now() });
            onProjectOpen(project);
            
            // 使用 getEntryWithUrl 绕过授权，直接使用项目路径
            setExportFolderPath(project.path);
            console.log('[ProjectManager] ✅ 项目目录:', project.path);
        } catch (error) {
            console.error('[ProjectManager] 打开项目失败:', error);
            alert(`打开项目失败:\n${formatErrorMessage(error, '请检查项目路径和读写权限')}`);
        } finally {
            setIsLoading(false);
            setLoadingStatus('');
        }
    };

    /**
     * 删除项目（仅从列表移除）
     */
    const handleRemoveProject = (e: React.MouseEvent, projectId: string) => {
        e.stopPropagation();
        removeRecentProject(projectId);
    };

    /**
     * 在资源管理器中打开
     */
    const handleOpenInExplorer = async (e: React.MouseEvent, path: string) => {
        e.stopPropagation();
        await window.designEcho?.openPath(path);
    };

    /**
     * 格式化日期
     */
    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now.getTime() - timestamp;
        
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
        
        return date.toLocaleDateString();
    };

    return (
        <div className="project-manager">
            {/* 头部 */}
            <div className="pm-header">
                <div className="pm-logo">
                    <span className="logo-icon">🎨</span>
                    <div className="logo-text">
                        <h1>DesignEcho</h1>
                        <p>AI 驱动的设计助手</p>
                    </div>
                </div>
            </div>

            {/* 快速操作 */}
            <div className="pm-actions">
                <button 
                    className="action-btn primary"
                    onClick={handleImportProject}
                    disabled={isLoading}
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        <line x1="12" y1="11" x2="12" y2="17"/>
                        <line x1="9" y1="14" x2="15" y2="14"/>
                    </svg>
                    <span>{isLoading ? (loadingStatus || '正在导入...') : '导入项目文件夹'}</span>
                </button>

                <button 
                    className="action-btn secondary" 
                    onClick={() => setShowNewProjectModal(true)}
                    disabled={isLoading}
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <line x1="12" y1="8" x2="12" y2="16"/>
                        <line x1="8" y1="12" x2="16" y2="12"/>
                    </svg>
                    <span>新建空白项目</span>
                </button>
            </div>

            {/* 最近项目 */}
            <div className="pm-recent">
                <h2>最近项目</h2>
                
                {recentProjects.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">📁</div>
                        <p>还没有项目</p>
                        <span>导入一个项目文件夹开始工作</span>
                    </div>
                ) : (
                    <div className="project-grid">
                        {recentProjects.map(project => (
                            <div 
                                key={project.id}
                                className="project-card"
                                onClick={() => handleOpenProject(project)}
                            >
                                <div className="card-thumbnail">
                                    {project.thumbnail ? (
                                        <img src={project.thumbnail} alt={project.name} />
                                    ) : (
                                        <div className="default-thumbnail">
                                            <span>📂</span>
                                        </div>
                                    )}
                                </div>
                                
                                <div className="card-info">
                                    <h3>{project.name}</h3>
                                    <p className="card-path" title={project.path}>
                                        {project.path}
                                    </p>
                                    <p className="card-time">
                                        {formatDate(project.lastOpenedAt)}
                                    </p>
                                </div>

                                <div className="card-actions">
                                    <button 
                                        className="card-btn"
                                        onClick={(e) => handleOpenInExplorer(e, project.path)}
                                        title="在资源管理器中打开"
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                            <polyline points="15 3 21 3 21 9"/>
                                            <line x1="10" y1="14" x2="21" y2="3"/>
                                        </svg>
                                    </button>
                                    <button 
                                        className="card-btn danger"
                                        onClick={(e) => handleRemoveProject(e, project.id)}
                                        title="从列表移除"
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <line x1="18" y1="6" x2="6" y2="18"/>
                                            <line x1="6" y1="6" x2="18" y2="18"/>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 导出目录状态 */}
            {exportFolderPath && (
                <div className="pm-export-status">
                    <div className="export-info">
                        <span className="export-label">📤 导出目录:</span>
                        <span className="export-path" title={exportFolderPath}>{exportFolderPath}</span>
                    </div>
                    <button className="btn-change-export" onClick={handleSelectExportFolder}>
                        更换
                    </button>
                </div>
            )}

            {/* 设置导出目录提示弹窗 */}
            {showExportFolderPrompt && (
                <div className="export-prompt-overlay">
                    <div className="export-prompt-card">
                        <div className="prompt-header">
                            <span className="prompt-icon">📤</span>
                            <h3>设置 SKU 导出目录</h3>
                        </div>
                        <p className="prompt-desc">
                            设置导出目录后，批量生成的 SKU 图片将直接保存到该位置，无需重复授权。
                        </p>
                        <div className="prompt-actions">
                            <button className="btn-primary" onClick={handleSelectExportFolder}>
                                选择导出目录
                            </button>
                            <button className="btn-secondary" onClick={() => setShowExportFolderPrompt(false)}>
                                稍后设置
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 提示信息 */}
            <div className="pm-tips">
                <h3>💡 电商项目结构</h3>
                <div className="tips-content">
                    <div className="tip-item">
                        <span className="tip-folder">📷 拍摄图/</span>
                        <span className="tip-desc">原始产品照片</span>
                    </div>
                    <div className="tip-item">
                        <span className="tip-folder">🎨 PSD/</span>
                        <span className="tip-desc">Photoshop 源文件</span>
                    </div>
                    <div className="tip-item">
                        <span className="tip-folder">🖼️ 主图/</span>
                        <span className="tip-desc">750/800/1200 尺寸</span>
                    </div>
                    <div className="tip-item">
                        <span className="tip-folder">📄 详情页/</span>
                        <span className="tip-desc">详情页切片</span>
                    </div>
                    <div className="tip-item">
                        <span className="tip-folder">🏷️ SKU/</span>
                        <span className="tip-desc">颜色/款式图</span>
                    </div>
                </div>
            </div>

            <style>{`
                .project-manager {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    padding: 40px;
                    overflow-y: auto;
                    background: linear-gradient(180deg, var(--de-bg-dark) 0%, #0a0a12 100%);
                }

                .pm-header {
                    margin-bottom: 48px;
                }

                .pm-logo {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                }

                .logo-icon {
                    font-size: 48px;
                }

                .logo-text h1 {
                    font-family: 'Space Grotesk', sans-serif;
                    font-size: 32px;
                    font-weight: 700;
                    background: linear-gradient(135deg, #fff 0%, #0066ff 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    margin: 0;
                }

                .logo-text p {
                    color: var(--de-text-secondary);
                    margin: 4px 0 0;
                    font-size: 14px;
                }

                .pm-actions {
                    display: flex;
                    gap: 16px;
                    margin-bottom: 48px;
                }

                .action-btn {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 16px 24px;
                    border-radius: 12px;
                    font-size: 15px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    border: 1px solid transparent;
                }

                .action-btn.primary {
                    background: var(--de-primary);
                    color: white;
                    border: 1px solid transparent;
                }

                .action-btn.primary:hover:not(:disabled) {
                    background: #0055dd;
                    transform: translateY(-2px);
                    box-shadow: 0 8px 24px rgba(0, 102, 255, 0.3);
                }

                .action-btn.secondary {
                    background: var(--de-bg-card);
                    color: var(--de-text-primary);
                    border-color: var(--de-border);
                }

                .action-btn.secondary:hover:not(:disabled) {
                    background: var(--de-bg-light);
                    border-color: var(--de-primary);
                }

                .action-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .pm-recent {
                    flex: 1;
                }

                .pm-recent h2 {
                    font-size: 18px;
                    font-weight: 600;
                    color: var(--de-text-primary);
                    margin: 0 0 20px;
                }

                .empty-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 60px;
                    text-align: center;
                }

                .empty-icon {
                    font-size: 64px;
                    margin-bottom: 16px;
                    opacity: 0.5;
                }

                .empty-state p {
                    color: var(--de-text-primary);
                    font-size: 16px;
                    margin: 0 0 8px;
                }

                .empty-state span {
                    color: var(--de-text-secondary);
                    font-size: 14px;
                }

                .project-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                    gap: 20px;
                }

                .project-card {
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 12px;
                    overflow: hidden;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .project-card:hover {
                    border-color: var(--de-primary);
                    transform: translateY(-4px);
                    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
                }

                .card-thumbnail {
                    height: 120px;
                    background: var(--de-bg-light);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .card-thumbnail img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }

                .default-thumbnail {
                    font-size: 48px;
                    opacity: 0.5;
                }

                .card-info {
                    padding: 16px;
                }

                .card-info h3 {
                    font-size: 15px;
                    font-weight: 600;
                    color: var(--de-text-primary);
                    margin: 0 0 8px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .card-path {
                    font-size: 12px;
                    color: var(--de-text-secondary);
                    margin: 0 0 8px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .card-time {
                    font-size: 12px;
                    color: var(--de-text-muted);
                    margin: 0;
                }

                .card-actions {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                    padding: 0 16px 16px;
                }

                .card-btn {
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--de-bg-light);
                    border: 1px solid var(--de-border);
                    border-radius: 6px;
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    transition: all 0.15s ease;
                }

                .card-btn:hover {
                    background: var(--de-bg-card);
                    color: var(--de-text-primary);
                    border-color: var(--de-primary);
                }

                .card-btn.danger:hover {
                    background: rgba(239, 68, 68, 0.1);
                    color: #ef4444;
                    border-color: #ef4444;
                }

                .pm-tips {
                    margin-top: 48px;
                    padding: 20px;
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 12px;
                }

                .pm-tips h3 {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--de-text-primary);
                    margin: 0 0 16px;
                }

                .tips-content {
                    display: flex;
                    flex-direction: row;
                    flex-wrap: wrap;
                    gap: 24px;
                }

                .tip-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .tip-folder {
                    font-family: 'Consolas', monospace;
                    font-size: 13px;
                    color: var(--de-primary);
                }

                .tip-desc {
                    font-size: 13px;
                    color: var(--de-text-secondary);
                }

                /* 新建项目弹窗 */
                .new-project-modal {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.7);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                    animation: fadeIn 0.2s ease-out;
                }

                .new-project-card {
                    background: var(--de-bg-card, #12121a);
                    border: 1px solid var(--de-border, #2a2a3a);
                    border-radius: 16px;
                    width: 500px;
                    max-width: 90vw;
                    animation: slideUp 0.3s ease-out;
                }

                .new-project-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 20px 24px;
                    border-bottom: 1px solid var(--de-border, #2a2a3a);
                }

                .new-project-header h3 {
                    font-size: 18px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .new-project-body {
                    padding: 24px;
                }

                .form-group {
                    margin-bottom: 20px;
                }

                .form-group label {
                    display: block;
                    font-size: 13px;
                    font-weight: 500;
                    margin-bottom: 8px;
                    color: var(--de-text-secondary);
                }

                .form-group input {
                    width: 100%;
                    padding: 12px 16px;
                    border: 1px solid var(--de-border, #2a2a3a);
                    border-radius: 8px;
                    background: var(--de-bg, #0d0d14);
                    color: var(--de-text, #e0e0e0);
                    font-size: 14px;
                }

                .form-group input:focus {
                    outline: none;
                    border-color: var(--de-primary, #0066ff);
                }

                .path-selector {
                    display: flex;
                    gap: 8px;
                }

                .path-selector input {
                    flex: 1;
                }

                .path-selector button {
                    padding: 12px 16px;
                    background: var(--de-bg-light, #1a1a24);
                    border: 1px solid var(--de-border, #2a2a3a);
                    border-radius: 8px;
                    color: var(--de-text);
                    cursor: pointer;
                    white-space: nowrap;
                }

                .path-selector button:hover {
                    background: var(--de-border, #2a2a3a);
                }

                .subdirs-preview {
                    background: var(--de-bg, #0d0d14);
                    border: 1px solid var(--de-border, #2a2a3a);
                    border-radius: 8px;
                    padding: 16px;
                }

                .subdirs-preview h4 {
                    font-size: 12px;
                    color: var(--de-text-secondary);
                    margin-bottom: 12px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .subdirs-list {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 8px;
                }

                .subdir-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 13px;
                    color: var(--de-text-secondary);
                }

                .subdir-item span:first-child {
                    font-size: 16px;
                }

                .new-project-footer {
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                    padding: 16px 24px;
                    border-top: 1px solid var(--de-border, #2a2a3a);
                }

                .new-project-footer .btn {
                    padding: 10px 20px;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .new-project-footer .btn-cancel {
                    background: transparent;
                    border: 1px solid var(--de-border, #2a2a3a);
                    color: var(--de-text-secondary);
                }

                .new-project-footer .btn-cancel:hover {
                    background: var(--de-bg-light, #1a1a24);
                }

                .new-project-footer .btn-create {
                    background: var(--de-primary, #0066ff);
                    border: none;
                    color: white;
                }

                .new-project-footer .btn-create:hover {
                    background: #0055dd;
                }

                .new-project-footer .btn-create:disabled {
                    background: #333;
                    color: #666;
                    cursor: not-allowed;
                }

                .btn-close {
                    background: transparent;
                    border: none;
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    padding: 4px 8px;
                    font-size: 20px;
                }

                .btn-close:hover {
                    color: var(--de-text);
                }

                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                /* 导出目录状态 */
                .pm-export-status {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px 16px;
                    background: rgba(0, 102, 255, 0.1);
                    border: 1px solid rgba(0, 102, 255, 0.3);
                    border-radius: 8px;
                    margin-bottom: 24px;
                }

                .export-info {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    min-width: 0;
                }

                .export-label {
                    color: var(--de-text-secondary);
                    white-space: nowrap;
                }

                .export-path {
                    color: #0066ff;
                    font-size: 13px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 400px;
                }

                .btn-change-export {
                    background: transparent;
                    border: 1px solid rgba(255,255,255,0.2);
                    color: var(--de-text-secondary);
                    padding: 4px 12px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                    white-space: nowrap;
                }

                .btn-change-export:hover {
                    border-color: #0066ff;
                    color: #0066ff;
                }

                /* 导出目录提示弹窗 */
                .export-prompt-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.7);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                    animation: fadeIn 0.2s ease;
                }

                .export-prompt-card {
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 16px;
                    padding: 32px;
                    width: 400px;
                    animation: slideUp 0.3s ease;
                }

                .prompt-header {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 16px;
                }

                .prompt-icon {
                    font-size: 32px;
                }

                .prompt-header h3 {
                    margin: 0;
                    font-size: 18px;
                    color: var(--de-text);
                }

                .prompt-desc {
                    color: var(--de-text-secondary);
                    font-size: 14px;
                    line-height: 1.6;
                    margin-bottom: 24px;
                }

                .prompt-actions {
                    display: flex;
                    gap: 12px;
                }

                .prompt-actions .btn-primary {
                    flex: 1;
                    background: #0066ff;
                    color: white;
                    border: none;
                    padding: 12px 20px;
                    border-radius: 8px;
                    font-size: 14px;
                    cursor: pointer;
                    transition: background 0.2s;
                }

                .prompt-actions .btn-primary:hover {
                    background: #0055dd;
                }

                .prompt-actions .btn-secondary {
                    background: transparent;
                    border: 1px solid var(--de-border);
                    color: var(--de-text-secondary);
                    padding: 12px 20px;
                    border-radius: 8px;
                    font-size: 14px;
                    cursor: pointer;
                }

                .prompt-actions .btn-secondary:hover {
                    border-color: var(--de-text-secondary);
                    color: var(--de-text);
                }
            `}</style>

            {/* 新建项目弹窗 */}
            {showNewProjectModal && (
                <div className="new-project-modal" onClick={() => setShowNewProjectModal(false)}>
                    <div className="new-project-card" onClick={e => e.stopPropagation()}>
                        <div className="new-project-header">
                            <h3>📁 新建项目</h3>
                            <button className="btn-close" onClick={() => setShowNewProjectModal(false)}>✕</button>
                        </div>
                        
                        <div className="new-project-body">
                            <div className="form-group">
                                <label>项目名称</label>
                                <input
                                    type="text"
                                    placeholder="输入项目名称，如：C-1016"
                                    value={newProjectName}
                                    onChange={e => setNewProjectName(e.target.value)}
                                    autoFocus
                                />
                            </div>

                            <div className="form-group">
                                <label>存放位置</label>
                                <div className="path-selector">
                                    <input
                                        type="text"
                                        placeholder="选择项目存放目录..."
                                        value={newProjectPath}
                                        readOnly
                                    />
                                    <button onClick={handleSelectNewProjectPath}>浏览...</button>
                                </div>
                            </div>

                            <div className="form-group">
                                <div className="subdirs-preview">
                                    <h4>将创建以下目录结构</h4>
                                    <div className="subdirs-list">
                                        <div className="subdir-item"><span>📷</span> SKU</div>
                                        <div className="subdir-item"><span>🎨</span> PSD</div>
                                        <div className="subdir-item"><span>🖼️</span> 主图</div>
                                        <div className="subdir-item"><span>📋</span> 模板文件</div>
                                        <div className="subdir-item"><span>⚙️</span> 配置文件</div>
                                        <div className="subdir-item"><span>🎬</span> 主图视频</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="new-project-footer">
                            <button 
                                className="btn btn-cancel" 
                                onClick={() => setShowNewProjectModal(false)}
                            >
                                取消
                            </button>
                            <button 
                                className="btn btn-create"
                                onClick={handleCreateProject}
                                disabled={!newProjectName.trim() || !newProjectPath || isLoading}
                            >
                                {isLoading ? loadingStatus : '创建项目'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
