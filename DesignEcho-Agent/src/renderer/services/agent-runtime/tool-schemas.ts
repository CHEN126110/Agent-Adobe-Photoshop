import type { ToolSchema } from './types';

function objectSchema(
    properties: Record<string, any>,
    required?: string[]
): ToolSchema['inputSchema'] {
    return {
        type: 'object',
        properties,
        ...(required?.length ? { required } : {})
    };
}

const TOOL_CATALOG: ToolSchema[] = [
    {
        name: 'createDocument',
        description: 'Create a new Photoshop document.',
        inputSchema: objectSchema({
            preset: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
            name: { type: 'string' },
            backgroundColor: { type: 'string', enum: ['white', 'black', 'transparent'] }
        })
    },
    {
        name: 'listDocuments',
        description: 'List currently opened Photoshop documents.',
        inputSchema: objectSchema({
            includeDetails: { type: 'boolean' }
        })
    },
    {
        name: 'switchDocument',
        description: 'Switch to an already-open Photoshop document by name.',
        inputSchema: objectSchema({
            documentName: { type: 'string' }
        }, ['documentName'])
    },
    {
        name: 'closeDocument',
        description: 'Close a Photoshop document. Use save=false for close-without-saving requests.',
        inputSchema: objectSchema({
            documentName: { type: 'string' },
            documentId: { type: 'number' },
            save: { type: 'boolean' }
        })
    },
    {
        name: 'getDocumentInfo',
        description: 'Read the current Photoshop document state.',
        inputSchema: objectSchema({})
    },
    {
        name: 'getDocumentSnapshot',
        description: 'Capture a snapshot of the current document for visual reasoning.',
        inputSchema: objectSchema({
            maxSize: { type: 'number' }
        })
    },
    {
        name: 'getAcceptanceSnapshot',
        description: 'Capture lightweight document, layer, text, selection, and bounds evidence for task verification.',
        inputSchema: objectSchema({
            includeHidden: { type: 'boolean' },
            includeText: { type: 'boolean' },
            includeBounds: { type: 'boolean' },
            maxLayers: { type: 'number' }
        })
    },
    {
        name: 'getCanvasSnapshot',
        description: 'Capture the current canvas as an image.',
        inputSchema: objectSchema({
            maxSize: { type: 'number' }
        })
    },
    {
        name: 'diagnoseState',
        description: 'Diagnose current Photoshop runtime state.',
        inputSchema: objectSchema({
            verbose: { type: 'boolean' }
        })
    },
    {
        name: 'selectLayer',
        description: 'Select one or more Photoshop layers.',
        inputSchema: objectSchema({
            layerId: { type: 'number' },
            layerIds: { type: 'array', items: { type: 'number' } },
            layerName: { type: 'string' },
            addToSelection: { type: 'boolean' }
        })
    },
    {
        name: 'focusLayer',
        description: 'Focus user attention on a Photoshop layer by selecting it, bringing Photoshop forward, refreshing UI, and returning real bounds. It does not claim exact canvas pan/zoom.',
        inputSchema: objectSchema({
            layerId: { type: 'number' },
            layerName: { type: 'string' },
            includeBounds: { type: 'boolean' }
        })
    },
    {
        name: 'getLayerHierarchy',
        description: 'Read the layer tree of the active document.',
        inputSchema: objectSchema({
            includeHidden: { type: 'boolean' }
        })
    },
    {
        name: 'getAllTextLayers',
        description: 'List all text layers in the current document.',
        inputSchema: objectSchema({})
    },
    {
        name: 'getLayerBounds',
        description: 'Read the bounds of a layer.',
        inputSchema: objectSchema({
            layerId: { type: 'number' },
            includeEffects: { type: 'boolean' }
        })
    },
    {
        name: 'getLayerProperties',
        description: 'Read properties of a layer.',
        inputSchema: objectSchema({
            layerId: { type: 'number' }
        })
    },
    {
        name: 'moveLayer',
        description: 'Move a layer on the canvas to a target x/y position. This changes spatial placement only; it does not change the Photoshop layer stack order.',
        inputSchema: objectSchema({
            layerId: { type: 'number' },
            x: { type: 'number' },
            y: { type: 'number' },
            relative: { type: 'boolean' }
        })
    },
    {
        name: 'reorderLayer',
        description: 'Change the Photoshop layer stack order. Use this for bring forward/backward, send to top/bottom, or move above/below another layer. Do not use moveLayer for layer stack order.',
        inputSchema: objectSchema({
            layerId: { type: 'number' },
            action: { type: 'string', enum: ['up', 'down', 'top', 'bottom', 'above', 'below'] },
            targetLayerId: { type: 'number' },
            steps: { type: 'number' },
            useCurrentSelection: { type: 'boolean' }
        }, ['action'])
    },
    {
        name: 'moveLayerToGroup',
        description: 'Move a Photoshop layer or group into a target group. Use this for parent/child layer hierarchy, not canvas x/y movement.',
        inputSchema: objectSchema({
            layerId: { type: 'number' },
            targetGroupId: { type: 'number' },
            position: { type: 'string', enum: ['inside', 'inside-top', 'inside-bottom'] }
        }, ['layerId', 'targetGroupId'])
    },
    {
        name: 'alignLayers',
        description: 'Align the current layer selection.',
        inputSchema: objectSchema({
            alignment: { type: 'string', enum: ['left', 'center', 'right', 'top', 'middle', 'bottom'] }
        }, ['alignment'])
    },
    {
        name: 'distributeLayers',
        description: 'Distribute the current layer selection evenly.',
        inputSchema: objectSchema({
            direction: { type: 'string', enum: ['horizontal', 'vertical'] }
        }, ['direction'])
    },
    {
        name: 'transformLayer',
        description: 'Transform a layer with scale, rotation, or flip.',
        inputSchema: objectSchema({
            scaleUniform: { type: 'number' },
            rotate: { type: 'number' },
            flipHorizontal: { type: 'boolean' }
        })
    },
    {
        name: 'quickScale',
        description: 'Scale the current layer quickly by percentage.',
        inputSchema: objectSchema({
            percent: { type: 'number' },
            fitCanvas: { type: 'boolean' }
        }, ['percent'])
    },
    {
        name: 'setLayerOpacity',
        description: 'Set layer opacity.',
        inputSchema: objectSchema({
            opacity: { type: 'number' },
            layerId: { type: 'number' }
        }, ['opacity'])
    },
    {
        name: 'setBlendMode',
        description: 'Set layer blend mode.',
        inputSchema: objectSchema({
            blendMode: { type: 'string' },
            layerId: { type: 'number' }
        }, ['blendMode'])
    },
    {
        name: 'duplicateLayer',
        description: 'Duplicate the current layer.',
        inputSchema: objectSchema({
            layerId: { type: 'number' },
            newName: { type: 'string' }
        })
    },
    {
        name: 'deleteLayer',
        description: 'Delete a Photoshop layer. Prefer explicit layerId after reading the layer hierarchy.',
        inputSchema: objectSchema({
            layerId: { type: 'number' }
        })
    },
    {
        name: 'renameLayer',
        description: 'Rename the current layer.',
        inputSchema: objectSchema({
            layerId: { type: 'number' },
            newName: { type: 'string' }
        }, ['newName'])
    },
    {
        name: 'groupLayers',
        description: 'Group the selected layers.',
        inputSchema: objectSchema({
            groupName: { type: 'string' }
        })
    },
    {
        name: 'createGroup',
        description: 'Create a new layer group.',
        inputSchema: objectSchema({
            groupName: { type: 'string' }
        }, ['groupName'])
    },
    {
        name: 'ungroupLayers',
        description: 'Ungroup an existing Photoshop layer group.',
        inputSchema: objectSchema({
            groupId: { type: 'number' }
        }, ['groupId'])
    },
    {
        name: 'addDropShadow',
        description: 'Add a drop shadow effect to the selected layer.',
        inputSchema: objectSchema({
            layerId: { type: 'number' },
            color: { type: 'object', properties: {} },
            opacity: { type: 'number' },
            angle: { type: 'number' },
            distance: { type: 'number' },
            spread: { type: 'number' },
            size: { type: 'number' }
        })
    },
    {
        name: 'addStroke',
        description: 'Add a stroke effect to the selected layer.',
        inputSchema: objectSchema({
            color: { type: 'object', properties: {} },
            size: { type: 'number' }
        })
    },
    {
        name: 'getTextContent',
        description: 'Read text content from one or more text layers.',
        inputSchema: objectSchema({
            layerId: { type: 'number' },
            layerIds: { type: 'array', items: { type: 'number' } }
        })
    },
    {
        name: 'setTextContent',
        description: 'Write text content into one or more layers.',
        inputSchema: objectSchema({
            layerId: { type: 'number' },
            content: { type: 'string' },
            baselineContent: { type: 'string' },
            updates: {
                type: 'array',
                items: objectSchema({
                    layerId: { type: 'number' },
                    content: { type: 'string' },
                    baselineContent: { type: 'string' }
                }, ['layerId', 'content'])
            }
        })
    },
    {
        name: 'getTextStyle',
        description: 'Read current text style information.',
        inputSchema: objectSchema({})
    },
    {
        name: 'resolveFontName',
        description: 'Read-only font resolver. Use before writing fontName. Only exact PostScript/name/family matches return a writable resolvedFont; fuzzy matches are suggestions only.',
        inputSchema: objectSchema({
            fontName: { type: 'string' },
            limit: { type: 'number' }
        })
    },
    {
        name: 'setTextStyle',
        description: 'Set text style properties such as size or font.',
        inputSchema: objectSchema({
            layerId: { type: 'number' },
            fontSize: { type: 'number' },
            fontName: { type: 'string' },
            tracking: { type: 'number' },
            leading: { type: 'number' }
        })
    },
    {
        name: 'createRectangle',
        description: 'Create a rectangle shape layer.',
        inputSchema: objectSchema({
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            name: { type: 'string' },
            fillColorHex: { type: 'string' },
            cornerRadius: { type: 'number' }
        }, ['x', 'y', 'width', 'height'])
    },
    {
        name: 'createTextLayer',
        description: 'Create a new text layer.',
        inputSchema: objectSchema({
            content: { type: 'string' },
            text: { type: 'string' },
            name: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            fontSize: { type: 'number' },
            fontName: { type: 'string' },
            tracking: { type: 'number' },
            leading: { type: 'number' },
            colorHex: { type: 'string' },
            color: {
                type: 'object',
                properties: {
                    r: { type: 'number' },
                    g: { type: 'number' },
                    b: { type: 'number' }
                }
            },
            alignment: { type: 'string', enum: ['left', 'center', 'right'] }
        }, ['content', 'x', 'y'])
    },
    {
        name: 'placeImage',
        description: 'Place an image into the current document, optionally using project search and auto-selection.',
        inputSchema: objectSchema({
            filePath: { type: 'string' },
            fileToken: { type: 'string' },
            imageData: { type: 'string' },
            requirement: { type: 'string' },
            query: { type: 'string' },
            category: { type: 'string', enum: ['products', 'backgrounds', 'elements', 'references', 'others'] },
            autoSelect: { type: 'boolean' },
            selectionMode: { type: 'string', enum: ['auto', 'suggest', 'force'] },
            strictDeterministic: { type: 'boolean' },
            minScore: { type: 'number' },
            minMargin: { type: 'number' },
            candidateCount: { type: 'number' },
            name: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            center: { type: 'boolean' },
            scale: { type: 'number' },
            fitToCanvas: { type: 'boolean' }
        })
    },
    {
        name: 'replaceLayerContent',
        description: 'Replace the contents of a selected image layer.',
        inputSchema: objectSchema({
            filePath: { type: 'string' },
            layerId: { type: 'number' }
        }, ['filePath'])
    },
    {
        name: 'getElementMapping',
        description: 'Read a layout-oriented mapping of visual elements in the current document.',
        inputSchema: objectSchema({
            includeHidden: { type: 'boolean' }
        })
    },
    {
        name: 'analyzeLayout',
        description: 'Analyze current layout structure and hierarchy.',
        inputSchema: objectSchema({
            detectHierarchy: { type: 'boolean' }
        })
    },
    {
        name: 'saveDocument',
        description: 'Save or export the current document.',
        inputSchema: objectSchema({
            format: { type: 'string', enum: ['psd', 'psb', 'png', 'jpg', 'jpeg', 'tiff', 'pdf'] },
            path: { type: 'string' },
            saveAs: { type: 'boolean' },
            quality: { type: 'number' }
        })
    },
    {
        name: 'quickExport',
        description: 'Quick-export the current document.',
        inputSchema: objectSchema({
            format: { type: 'string', enum: ['png', 'jpg'] },
            quality: { type: 'number' }
        })
    },
    {
        name: 'exportGroup',
        description: 'Export a specific Photoshop group or layer to a PNG output path without changing the source document visibility.',
        inputSchema: objectSchema({
            groupPath: { type: 'array', items: { type: 'string' } },
            layerId: { type: 'number' },
            outputPath: { type: 'string' },
            format: { type: 'string', enum: ['png'] },
            maxSize: { type: 'number' },
            targetWidth: { type: 'number' },
            targetHeight: { type: 'number' }
        }, ['outputPath'])
    },
    {
        name: 'smartSave',
        description: 'Save using the current document path or an explicit export path.',
        inputSchema: objectSchema({
            exportFormat: { type: 'string', enum: ['psd', 'psb', 'jpg', 'png'] },
            path: { type: 'string' },
            exportQuality: { type: 'number' }
        })
    },
    {
        name: 'listProjectResources',
        description: 'List files inside the active project directory.',
        inputSchema: objectSchema({
            directory: { type: 'string' }
        })
    },
    {
        name: 'searchProjectResources',
        description: 'Search project files by keyword and type.',
        inputSchema: objectSchema({
            query: { type: 'string' },
            type: { type: 'string', enum: ['image', 'design', 'all'] }
        }, ['query'])
    },
    {
        name: 'openProjectFile',
        description: 'Open a PSD or PSB file from the current project using a keyword query.',
        inputSchema: objectSchema({
            query: { type: 'string' }
        }, ['query'])
    },
    {
        name: 'describeImage',
        description: 'Analyze a local image file with a vision model.',
        inputSchema: objectSchema({
            filePath: { type: 'string' },
            hint: { type: 'string' }
        }, ['filePath'])
    },
    {
        name: 'generateImage',
        description: 'Generate a new image with the BFL image generation models.',
        inputSchema: objectSchema({
            prompt: { type: 'string' },
            model: { type: 'string', enum: ['flux-2-max', 'flux-2-pro', 'flux-2-klein'] },
            width: { type: 'number' },
            height: { type: 'number' }
        }, ['prompt'])
    },
    {
        name: 'parseDetailPageTemplate',
        description: 'Parse the current detail-page template into screens and editable placeholders.',
        inputSchema: objectSchema({
            includeStructure: { type: 'boolean' }
        })
    },
    {
        name: 'detectLayerIssues',
        description: 'Detect structural issues in detail-page screens.',
        inputSchema: objectSchema({
            screens: { type: 'array', items: { type: 'object' } },
            screenId: { type: 'number' }
        })
    },
    {
        name: 'fixLayerIssues',
        description: 'Fix detected structural issues in detail-page layers.',
        inputSchema: objectSchema({
            issues: { type: 'array', items: { type: 'object' } }
        }, ['issues'])
    },
    {
        name: 'matchDetailPageContent',
        description: 'Match project assets to detail-page placeholders and build fill plans.',
        inputSchema: objectSchema({
            screens: { type: 'array', items: { type: 'object' } },
            projectPath: { type: 'string' },
            screenPlans: { type: 'array', items: { type: 'object' } },
            selectedScene: { type: 'object', properties: {} },
            selectedDesignContext: { type: 'object', properties: {} },
            selectedElementContext: { type: 'object', properties: {} },
            selectedModuleContext: { type: 'object', properties: {} }
        }, ['screens'])
    },
    {
        name: 'fillDetailPage',
        description: 'Fill text and images into detail-page placeholders.',
        inputSchema: objectSchema({
            plan: { type: 'object', properties: {} },
            plans: { type: 'array', items: { type: 'object' } }
        })
    },
    {
        name: 'exportDetailPageSlices',
        description: 'Export each detail-page screen as an image slice.',
        inputSchema: objectSchema({
            screens: { type: 'array', items: { type: 'object' } },
            config: {
                type: 'object',
                properties: {
                    outputDir: { type: 'string' },
                    format: { type: 'string', enum: ['jpeg', 'png'] },
                    quality: { type: 'number' },
                    createSubfolder: { type: 'boolean' },
                    subfolder: { type: 'string' }
                }
            }
        }, ['screens', 'config'])
    },
    {
        name: 'analyzeProjectForDetailPage',
        description: 'Analyze the active project and classify source assets for detail-page design.',
        inputSchema: objectSchema({
            projectPath: { type: 'string' }
        })
    },
    {
        name: 'getScreenSnapshots',
        description: 'Capture isolated snapshots for detail-page screens.',
        inputSchema: objectSchema({
            screens: { type: 'array', items: { type: 'object' } },
            maxWidth: { type: 'number' },
            screenIndices: { type: 'array', items: { type: 'number' } }
        }, ['screens'])
    },
    {
        name: 'auditDetailPagePlacement',
        description: 'Audit actual detail-page image placements against target containers and detect offset or stacking risks.',
        inputSchema: objectSchema({
            screens: { type: 'array', items: { type: 'object' } },
            placements: { type: 'array', items: { type: 'object' } }
        }, ['screens'])
    },
    {
        name: 'getScreenSnapshotsWithOverlay',
        description: 'Capture detail-page screen snapshots with target and actual placement boxes overlaid for debugging.',
        inputSchema: objectSchema({
            screens: { type: 'array', items: { type: 'object' } },
            placements: { type: 'array', items: { type: 'object' } },
            maxWidth: { type: 'number' },
            screenIndices: { type: 'array', items: { type: 'number' } }
        }, ['screens'])
    }
];

const TOOL_LOOKUP = new Map(TOOL_CATALOG.map((tool) => [tool.name, tool]));

const DEFAULT_AGENT_TOOL_NAMES = [
    'createDocument',
    'listDocuments',
    'switchDocument',
    'closeDocument',
    'getDocumentInfo',
    'getDocumentSnapshot',
    'getAcceptanceSnapshot',
    'getCanvasSnapshot',
    'getLayerHierarchy',
    'getAllTextLayers',
    'getLayerBounds',
    'getLayerProperties',
    'getTextContent',
    'resolveFontName',
    'setTextContent',
    'setTextStyle',
    'selectLayer',
    'focusLayer',
    'moveLayer',
    'reorderLayer',
    'moveLayerToGroup',
    'alignLayers',
    'distributeLayers',
    'transformLayer',
    'quickScale',
    'setLayerOpacity',
    'setBlendMode',
    'duplicateLayer',
    'deleteLayer',
    'renameLayer',
    'groupLayers',
    'ungroupLayers',
    'createGroup',
    'createRectangle',
    'createTextLayer',
    'placeImage',
    'replaceLayerContent',
    'getElementMapping',
    'analyzeLayout',
    'listProjectResources',
    'searchProjectResources',
    'openProjectFile',
    'describeImage',
    'generateImage',
    'saveDocument',
    'quickExport',
    'exportGroup',
    'smartSave'
];

export function generateToolSchemas(): ToolSchema[] {
    return TOOL_CATALOG.map((tool) => ({ ...tool }));
}

export function selectTools(names: string[]): ToolSchema[] {
    const selected: ToolSchema[] = [];
    const seen = new Set<string>();

    for (const name of names) {
        const tool = TOOL_LOOKUP.get(name);
        if (!tool || seen.has(name)) continue;
        seen.add(name);
        selected.push({ ...tool });
    }

    return selected;
}

export const DELEGATE_TOOL: ToolSchema = {
    name: 'delegateToAgent',
    description: 'Delegate a focused sub-task to a specialist sub-agent.',
    inputSchema: objectSchema({
        role: {
            type: 'string',
            enum: ['scene-analyst', 'design-strategist', 'executor', 'critic']
        },
        task: { type: 'string' },
        context: { type: 'string' }
    }, ['role', 'task'])
};

export function getDefaultAgentTools(): ToolSchema[] {
    return selectTools(DEFAULT_AGENT_TOOL_NAMES);
}
