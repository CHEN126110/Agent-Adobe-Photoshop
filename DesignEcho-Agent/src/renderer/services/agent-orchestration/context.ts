import {
    buildContextSnapshot,
    buildProjectAssetIndex,
    type ContextSnapshot,
    type ProjectAssetFolderRole,
    type ProjectAssetIndex,
    type ProjectAssetIndexFileInput
} from '../../../shared/project-asset-index';
import {
    buildProjectVisualSamplingPlan,
    type ProjectVisualSamplingPlan,
    type ProjectVisualSamplingScenario
} from '../../../shared/project-visual-sampling';
import {
    buildProjectVisualInsightCacheReadResult,
    type ProjectVisualInsightCacheReadResult
} from '../../../shared/project-visual-insight-cache';
import { useAppStore } from '../../stores/app.store';
import { executeToolCall } from '../tool-executor.service';
import type { PhotoshopContext, ProjectContext } from './types';

type ProjectImageRecord = {
    path?: string;
    relativePath?: string;
    parentFolder?: string;
    folderType?: string;
    name?: string;
    ext?: string;
    size?: number;
    width?: number;
    height?: number;
};

interface RuntimeSnapshotResult {
    source: 'runtime-project-service' | 'renderer-project-structure';
    assetIndex: ProjectAssetIndex;
    visualSamplingPlan: ProjectVisualSamplingPlan;
    visualInsightCache: ProjectVisualInsightCacheReadResult;
    contextSnapshot: ContextSnapshot;
    warnings: string[];
    limitations: string[];
}

let cachedRuntimeSnapshot: {
    key: string;
    result: RuntimeSnapshotResult;
    createdAt: number;
} | null = null;

const RUNTIME_SNAPSHOT_CACHE_MS = 60_000;

function readImageFolderType(folder: any, image: any): string | undefined {
    if (typeof image?.folderType === 'string') {
        return image.folderType;
    }
    if (typeof folder?.type === 'string') {
        return folder.type;
    }
    return undefined;
}

function collectProjectImages(structure: any): ProjectImageRecord[] {
    const collected: ProjectImageRecord[] = [];
    const seen = new Set<string>();

    const visitFolder = (folder: any) => {
        if (!folder || typeof folder !== 'object') return;
        const images = Array.isArray(folder.images) ? folder.images : [];
        for (const image of images) {
            const imagePath = String(image?.path || '').trim();
            if (!imagePath || seen.has(imagePath)) continue;
            seen.add(imagePath);
            collected.push({
                path: imagePath,
                relativePath: typeof image?.relativePath === 'string' ? image.relativePath : undefined,
                parentFolder: typeof folder?.relativePath === 'string' ? folder.relativePath : undefined,
                folderType: readImageFolderType(folder, image),
                name: typeof image?.name === 'string' ? image.name : undefined,
                ext: typeof image?.ext === 'string' ? image.ext : undefined,
                size: typeof image?.size === 'number' ? image.size : undefined,
                width: typeof image?.width === 'number' ? image.width : undefined,
                height: typeof image?.height === 'number' ? image.height : undefined
            });
        }

        const children = Array.isArray(folder.children) ? folder.children : [];
        for (const child of children) {
            visitFolder(child);
        }
    };

    const folders = Array.isArray(structure?.folders) ? structure.folders : [];
    for (const folder of folders) {
        visitFolder(folder);
    }

    return collected;
}

function buildProjectImageFolders(structure: any): Array<{ path: string; imageCount: number }> {
    const folders = Array.isArray(structure?.folders) ? structure.folders : [];
    type FolderStat = { path: string; imageCount: number };
    const results = folders
        .map((folder: any): FolderStat => ({
            path: String(folder?.relativePath || folder?.name || '').trim(),
            imageCount: Number(folder?.totalImageCount || folder?.imageCount || 0)
        }))
        .filter((folder: FolderStat) => Boolean(folder.path) && folder.imageCount > 0)
        .sort((a: FolderStat, b: FolderStat) => b.imageCount - a.imageCount);
    return results.slice(0, 8);
}

function pickSampleImagePaths(images: ProjectImageRecord[], limit = 6): string[] {
    if (!images.length || limit <= 0) return [];
    if (images.length <= limit) {
        return images.map((image) => String(image.path || '').trim()).filter(Boolean);
    }

    const preferred = images.filter((image) => image.folderType === 'source');
    const source = preferred.length >= limit ? preferred : images;
    const step = (source.length - 1) / Math.max(1, limit - 1);
    const picked: string[] = [];
    const seen = new Set<string>();

    for (let index = 0; index < limit; index += 1) {
        const image = source[Math.round(index * step)];
        const imagePath = String(image?.path || '').trim();
        if (!imagePath || seen.has(imagePath)) continue;
        seen.add(imagePath);
        picked.push(imagePath);
    }

    if (picked.length < limit) {
        for (const image of source) {
            const imagePath = String(image?.path || '').trim();
            if (!imagePath || seen.has(imagePath)) continue;
            seen.add(imagePath);
            picked.push(imagePath);
            if (picked.length >= limit) break;
        }
    }

    return picked;
}

function mapFolderTypeToAssetRole(folderType?: string): ProjectAssetFolderRole {
    switch (folderType) {
        case 'source':
            return 'source';
        case 'psd':
            return 'psd';
        case 'mainImage':
            return 'main-image';
        case 'detail':
            return 'detail';
        case 'sku':
            return 'sku';
        default:
            return 'unknown';
    }
}

function mapFolderMappings(rawMappings: Record<string, string> | undefined): Record<string, string> {
    const mappings: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawMappings || {})) {
        mappings[key] = mapFolderTypeToAssetRole(value);
    }
    return mappings;
}

function buildFilesFromProjectImages(images: ProjectImageRecord[]): ProjectAssetIndexFileInput[] {
    return images.map((image) => ({
        path: String(image.path || ''),
        relativePath: image.relativePath,
        name: image.name || String(image.path || '').split(/[\\/]/).pop(),
        extension: image.ext,
        sizeBytes: image.size,
        width: image.width,
        height: image.height,
        folderRole: mapFolderTypeToAssetRole(image.folderType)
    })).filter((file) => Boolean(file.path));
}

function buildContextSnapshotFromStructure(
    project: any,
    structure: any,
    selectedProjectImagePath?: string,
    visualSamplingScenario?: ProjectVisualSamplingScenario
): RuntimeSnapshotResult | null {
    if (!project?.path || !structure) return null;

    const projectImages = collectProjectImages(structure);
    const files = buildFilesFromProjectImages(projectImages);
    if (files.length === 0) return null;

    const assetIndex = buildProjectAssetIndex({
        projectPath: project.path,
        projectName: project.name || structure.projectName,
        folderMappings: mapFolderMappings(structure.config?.folderMappings),
        files
    });
    const visualSamplingPlan = buildProjectVisualSamplingPlan({
        assetIndex,
        scenario: visualSamplingScenario || 'general-design'
    });
    const visualInsightCache = buildProjectVisualInsightCacheReadResult({
        source: 'missing',
        exists: false
    });
    const contextSnapshot = buildContextSnapshot({
        projectPath: project.path,
        projectName: project.name || structure.projectName,
        selectedAssetPaths: selectedProjectImagePath ? [selectedProjectImagePath] : [],
        assetIndex,
        visualSamplingPlan,
        visualInsightCache
    });

    return {
        source: 'renderer-project-structure',
        assetIndex,
        visualSamplingPlan,
        visualInsightCache,
        contextSnapshot,
        warnings: contextSnapshot.warnings,
        limitations: contextSnapshot.limitations
    };
}

function buildRuntimeCacheKey(
    projectPath: string,
    selectedProjectImagePath?: string,
    visualSamplingScenario?: ProjectVisualSamplingScenario
): string {
    return `${projectPath}::${selectedProjectImagePath || ''}::${visualSamplingScenario || 'general-design'}`;
}

async function buildContextSnapshotFromRuntimeService(
    project: any,
    selectedProjectImagePath?: string,
    visualSamplingScenario?: ProjectVisualSamplingScenario
): Promise<RuntimeSnapshotResult | null> {
    const projectPath = String(project?.path || '').trim();
    if (!projectPath || !window.designEcho?.buildProjectContextSnapshot) return null;

    const cacheKey = buildRuntimeCacheKey(projectPath, selectedProjectImagePath, visualSamplingScenario);
    if (
        cachedRuntimeSnapshot
        && cachedRuntimeSnapshot.key === cacheKey
        && Date.now() - cachedRuntimeSnapshot.createdAt < RUNTIME_SNAPSHOT_CACHE_MS
    ) {
        return cachedRuntimeSnapshot.result;
    }

    try {
        const result = await window.designEcho.buildProjectContextSnapshot({
            projectPath,
            projectName: project.name,
            selectedAssetPaths: selectedProjectImagePath ? [selectedProjectImagePath] : [],
            visualSamplingScenario: visualSamplingScenario || 'general-design'
        });
        if (!result?.success || !result.assetIndex || !result.contextSnapshot) {
            return null;
        }

        const visualSamplingPlan = result.visualSamplingPlan || buildProjectVisualSamplingPlan({
            assetIndex: result.assetIndex,
            scenario: visualSamplingScenario || 'general-design'
        });
        const visualInsightCache = result.visualInsightCache || buildProjectVisualInsightCacheReadResult({
            source: 'missing',
            exists: false
        });
        const snapshot: RuntimeSnapshotResult = {
            source: 'runtime-project-service',
            assetIndex: result.assetIndex,
            visualSamplingPlan,
            visualInsightCache,
            contextSnapshot: result.contextSnapshot,
            warnings: result.warnings || result.contextSnapshot.warnings || [],
            limitations: result.limitations || result.contextSnapshot.limitations || []
        };
        cachedRuntimeSnapshot = {
            key: cacheKey,
            result: snapshot,
            createdAt: Date.now()
        };
        return snapshot;
    } catch {
        return null;
    }
}

export async function getPhotoshopContext(): Promise<PhotoshopContext | undefined> {
    try {
        const docInfo = await executeToolCall('getDocumentInfo', {});
        if (!docInfo || docInfo.success === false) {
            return { hasDocument: false };
        }

        const data = docInfo.document || docInfo.data || docInfo;
        const hasDocument = Boolean(data?.name || data?.documentName || docInfo?.success);

        return {
            hasDocument,
            documentName: data?.name || data?.documentName,
            canvasSize: data?.size || (data?.width && data?.height ? { width: data.width, height: data.height } : undefined),
            activeLayerName: data?.activeLayerName,
            layerCount: data?.layerCount
        };
    } catch {
        return undefined;
    }
}

export async function getProjectContext(options: {
    visualSamplingScenario?: ProjectVisualSamplingScenario;
} = {}): Promise<ProjectContext | undefined> {
    try {
        const state = useAppStore.getState() as any;
        const project = state?.currentProject;
        if (!project) return undefined;

        const structure = state?.ecommerceStructure;
        const projectImages = collectProjectImages(structure);
        const selectedProjectImagePath = String(state?.selectedProjectImagePath || '').trim() || undefined;
        const visualSamplingScenario = options.visualSamplingScenario || 'general-design';
        const runtimeSnapshot = await buildContextSnapshotFromRuntimeService(project, selectedProjectImagePath, visualSamplingScenario);
        const structureSnapshot = runtimeSnapshot ? null : buildContextSnapshotFromStructure(project, structure, selectedProjectImagePath, visualSamplingScenario);
        const snapshot = runtimeSnapshot || structureSnapshot;
        const indexedSamplePaths = (
            snapshot?.visualSamplingPlan.selectedCandidates
            || snapshot?.assetIndex.visionCandidates
            || []
        )
            .map((candidate) => candidate.path)
            .filter(Boolean)
            .slice(0, 6);
        const sampleImagePaths = indexedSamplePaths.length > 0
            ? indexedSamplePaths
            : pickSampleImagePaths(projectImages, 6);

        return {
            projectPath: project.path,
            hasSkuFiles: Array.isArray(structure?.skuFolder?.files) ? structure.skuFolder.files.length > 0 : undefined,
            hasTemplates: Array.isArray(structure?.templateFolder?.files) ? structure.templateFolder.files.length > 0 : undefined,
            availableColors: Array.isArray(structure?.colors) ? structure.colors : undefined,
            projectImageCount: Number(
                snapshot?.assetIndex.summary.totalImages
                || structure?.summary?.totalImages
                || projectImages.length
                || 0
            ),
            projectImageFolders: buildProjectImageFolders(structure),
            sampleImagePaths,
            selectedProjectImagePath,
            selectedProjectImageName: selectedProjectImagePath
                ? selectedProjectImagePath.split(/[\\/]/).pop()
                : undefined,
            assetIndex: snapshot?.assetIndex,
            visualSamplingPlan: snapshot?.visualSamplingPlan,
            visualInsightCache: snapshot?.visualInsightCache,
            contextSnapshot: snapshot?.contextSnapshot,
            contextSnapshotSource: snapshot?.source,
            contextSnapshotWarnings: snapshot?.warnings,
            contextSnapshotLimitations: snapshot?.limitations
        };
    } catch {
        return undefined;
    }
}
