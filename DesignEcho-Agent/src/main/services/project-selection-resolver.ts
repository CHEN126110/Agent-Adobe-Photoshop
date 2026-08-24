import fs from 'fs';
import path from 'path';

import type { ProjectSelectionResolution } from '../../shared/project-selection-resolution';
import type { ProjectConfig } from './ecommerce-project-service';

const fsPromises = fs.promises;

interface ProjectConfigCandidate {
    rootPath: string;
    configPath: string;
    config: ProjectConfig;
}
function normalizePathForComparison(value: string): string {
    const normalized = path.resolve(value).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
}

function samePath(left: string, right: string): boolean {
    return normalizePathForComparison(left) === normalizePathForComparison(right);
}

function listAncestorPaths(selectedPath: string): string[] {
    const ancestors: string[] = [];
    let currentPath = selectedPath;
    while (true) {
        ancestors.push(currentPath);
        const parentPath = path.dirname(currentPath);
        if (samePath(parentPath, currentPath)) return ancestors;
        currentPath = parentPath;
    }
}

function isProjectConfig(value: unknown): value is ProjectConfig {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<ProjectConfig>;
    return typeof candidate.projectName === 'string'
        && typeof candidate.folderMappings === 'object'
        && candidate.folderMappings !== null
        && typeof candidate.imageClassifications === 'object'
        && candidate.imageClassifications !== null;
}

async function readConfigCandidate(rootPath: string): Promise<ProjectConfigCandidate | null> {
    const configPath = path.join(rootPath, '.designecho', 'project.json');
    const content = await fsPromises.readFile(configPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (content === null) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`项目配置不是有效 JSON: ${configPath}（${message}）`);
    }
    if (!isProjectConfig(parsed)) {
        throw new Error(`项目配置缺少必要字段: ${configPath}`);
    }
    return { rootPath, configPath, config: parsed };
}

function mappingDeclaresSelectedPath(candidate: ProjectConfigCandidate, selectedPath: string): boolean {
    if (samePath(candidate.rootPath, selectedPath)) return false;
    const relativePath = path.relative(candidate.rootPath, selectedPath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return false;
    const firstSegment = relativePath.split(/[\\/]+/).filter(Boolean)[0];
    if (!firstSegment) return false;

    return Object.entries(candidate.config.folderMappings).some(([mappingPath, folderType]) => {
        if (folderType === 'unknown') return false;
        const mappedFirstSegment = mappingPath.split(/[\\/]+/).filter(Boolean)[0];
        return Boolean(mappedFirstSegment)
            && mappedFirstSegment.toLocaleLowerCase() === firstSegment.toLocaleLowerCase();
    });
}

function collectShadowedConfigPaths(
    selected: ProjectConfigCandidate,
    candidates: ProjectConfigCandidate[]
): string[] {
    return candidates
        .filter((candidate) => !samePath(candidate.rootPath, selected.rootPath))
        .filter((candidate) => {
            const relativePath = path.relative(selected.rootPath, candidate.rootPath);
            return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
        })
        .map((candidate) => candidate.configPath);
}

export async function resolveProjectSelection(selectedPath: string): Promise<ProjectSelectionResolution> {
    const requestedPath = String(selectedPath || '').trim();
    if (!requestedPath) throw new Error('项目路径不能为空');

    const stats = await fsPromises.stat(requestedPath).catch((error: NodeJS.ErrnoException) => {
        throw new Error(`无法访问项目路径: ${requestedPath}（${error.message}）`);
    });
    if (!stats.isDirectory()) throw new Error(`项目路径不是文件夹: ${requestedPath}`);

    const canonicalSelectedPath = await fsPromises.realpath(requestedPath);
    const probes = await Promise.all(listAncestorPaths(canonicalSelectedPath).map(readConfigCandidate));
    const candidates = probes.filter((candidate): candidate is ProjectConfigCandidate => candidate !== null);
    const mappedAncestor = candidates.find((candidate) => mappingDeclaresSelectedPath(candidate, canonicalSelectedPath));
    const selectedCandidate = mappedAncestor || candidates[0] || null;

    if (!selectedCandidate) {
        return {
            version: 'project-selection-resolution/v0',
            selectedPath: canonicalSelectedPath,
            canonicalProjectPath: canonicalSelectedPath,
            projectName: path.basename(canonicalSelectedPath),
            source: 'selected_directory',
            folderMappings: {},
            shadowedConfigPaths: [],
            warnings: []
        };
    }

    const shadowedConfigPaths = mappedAncestor
        ? collectShadowedConfigPaths(selectedCandidate, candidates)
        : [];
    const warnings = shadowedConfigPaths.length > 0
        ? [`已忽略项目根内部的嵌套配置: ${shadowedConfigPaths.join(', ')}`]
        : [];

    return {
        version: 'project-selection-resolution/v0',
        selectedPath: canonicalSelectedPath,
        canonicalProjectPath: selectedCandidate.rootPath,
        projectName: selectedCandidate.config.projectName || path.basename(selectedCandidate.rootPath),
        source: mappedAncestor ? 'mapped_ancestor_config' : 'nearest_project_config',
        configPath: selectedCandidate.configPath,
        folderMappings: { ...selectedCandidate.config.folderMappings },
        shadowedConfigPaths,
        warnings
    };
}
