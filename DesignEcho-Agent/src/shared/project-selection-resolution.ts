export type ProjectSelectionResolutionSource =
    | 'mapped_ancestor_config'
    | 'nearest_project_config'
    | 'selected_directory';

export interface ProjectSelectionResolution {
    version: 'project-selection-resolution/v0';
    selectedPath: string;
    canonicalProjectPath: string;
    projectName: string;
    source: ProjectSelectionResolutionSource;
    configPath?: string;
    folderMappings: Record<string, string>;
    shadowedConfigPaths: string[];
    warnings: string[];
}
