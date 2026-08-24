import type { ProjectSelectionResolution } from '../../shared/project-selection-resolution';
import type { ProjectInfo } from '../stores/app.store';

function joinProjectPath(projectPath: string, relativePath: string): string {
    if (relativePath === '(根目录)' || relativePath === '.') return projectPath;
    const separator = projectPath.includes('\\') ? '\\' : '/';
    return `${projectPath.replace(/[\\/]+$/, '')}${separator}${relativePath.replace(/^[\\/]+/, '')}`;
}
function buildProjectFolders(resolution: ProjectSelectionResolution): ProjectInfo['folders'] {
    const entries = Object.entries(resolution.folderMappings);
    const findFolder = (...types: string[]): string | undefined => {
        const mapping = entries.find(([, folderType]) => types.includes(folderType));
        return mapping ? joinProjectPath(resolution.canonicalProjectPath, mapping[0]) : undefined;
    };
    const folders: ProjectInfo['folders'] = {};
    const assets = findFolder('source', 'sku');
    const psd = findFolder('psd');
    const output = findFolder('mainImage', 'detail', 'sku');
    if (assets) folders.assets = assets;
    if (psd) folders.psd = psd;
    if (output) folders.output = output;
    return folders;
}

export async function canonicalizeProjectSession(project: ProjectInfo): Promise<ProjectInfo> {
    const resolver = window.designEcho?.resolveProjectSelection;
    if (!resolver) throw new Error('当前 Harness 缺少项目定位能力，请重新启动 DesignEcho');
    const resolution = await resolver(project.path);
    for (const warning of resolution.warnings) console.warn(`[ProjectIdentity] ${warning}`);

    const pathChanged = resolution.canonicalProjectPath !== project.path;
    const mappedFolders = buildProjectFolders(resolution);
    return {
        ...project,
        name: resolution.projectName,
        path: resolution.canonicalProjectPath,
        folders: pathChanged ? mappedFolders : { ...project.folders, ...mappedFolders }
    };
}
