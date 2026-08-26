export interface PhotoshopRuntimeBuildInfo {
    version: 'designecho-uxp-runtime-build/v1';
    buildId: string;
    builtAt: string;
    loadedAt: string;
    buildMode: 'development' | 'production';
    gitCommit: string;
    gitDirty: boolean;
    dirtyScope: string;
    sourceDigest: string;
    features: string[];
}

declare const __DESIGNECHO_UXP_RUNTIME_BUILD__: Omit<
    PhotoshopRuntimeBuildInfo,
    'loadedAt' | 'features'
>;

const embeddedRuntimeBuild = __DESIGNECHO_UXP_RUNTIME_BUILD__;

export const PHOTOSHOP_RUNTIME_BUILD_ID = embeddedRuntimeBuild.buildId;

export const PHOTOSHOP_RUNTIME_FEATURES = [
    'diagnoseState.runtimeInfo',
    'getSubjectBounds.smartLayerKindGuard',
    'getSubjectBounds.avoidsEmptySelectionDeselect',
    'selectionRead.noDialogSynchronousBatchPlay',
    'adjustmentLayers.noDialogSynchronousMake',
    'toolFailures.normalized',
    'createDocument.readbackCandidateValidation',
    'toolErrorNormalizer.fontUnavailableCategory',
    'saveDocument.rasterExportUsesJsx'
] as const;

const loadedAt = new Date().toISOString();

export function getPhotoshopRuntimeBuildInfo(): PhotoshopRuntimeBuildInfo {
    return {
        ...embeddedRuntimeBuild,
        loadedAt,
        features: [...PHOTOSHOP_RUNTIME_FEATURES]
    };
}
