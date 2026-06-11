import type {
    DesignTeammateDefinition,
    DesignTeammateRole
} from '../../../shared/types/design-team.types';
import { buildDesignTeamRuntimeBudget } from '../../../shared/agent-performance-policy';

const TEAMMATE_DEFINITIONS: Record<DesignTeammateRole, DesignTeammateDefinition> = {
    'scene-analyst': {
        role: 'scene-analyst',
        displayName: 'Scene Analyst',
        description: 'Inspect the current Photoshop scene and summarize structure, hierarchy, and visual risks.',
        systemPrompt: [
            'You are the Scene Analyst teammate for DesignEcho.',
            'Inspect before concluding.',
            'Focus on document structure, selected element context, module boundaries, visual hierarchy, and layout risks.',
            'Prefer read-only tools.',
            'Respond in concise Simplified Chinese.'
        ].join('\n'),
        allowedTools: [
            'getDocumentInfo',
            'getCanvasSnapshot',
            'getDocumentSnapshot',
            'getLayerHierarchy',
            'getElementMapping',
            'analyzeLayout',
            'getLayerProperties',
            'getLayerBounds',
            'getAllTextLayers',
            'describeImage'
        ],
        maxIterations: buildDesignTeamRuntimeBudget({ role: 'scene-analyst' }).maxIterations,
        outputType: 'scene_summary',
        canWriteToPhotoshop: false
    },
    'design-strategist': {
        role: 'design-strategist',
        displayName: 'Design Strategist',
        description: 'Turn scene understanding into a concrete design plan for copy, image, and composition.',
        systemPrompt: [
            'You are the Design Strategist teammate for DesignEcho.',
            'Translate scene understanding into a concrete design plan.',
            'Do not edit Photoshop directly unless explicitly required by the coordinator.',
            'Focus on module intent, screen role, image strategy, copy strategy, and revision priorities.',
            'Respond in concise Simplified Chinese.'
        ].join('\n'),
        allowedTools: [
            'getDocumentInfo',
            'getCanvasSnapshot',
            'getLayerHierarchy',
            'getAllTextLayers',
            'getTextContent',
            'getTextStyle',
            'getLayerBounds',
            'describeImage',
            'analyzeLayout'
        ],
        maxIterations: buildDesignTeamRuntimeBudget({ role: 'design-strategist' }).maxIterations,
        outputType: 'design_plan',
        canWriteToPhotoshop: false
    },
    executor: {
        role: 'executor',
        displayName: 'Executor',
        description: 'Apply precise Photoshop edits from an approved design plan.',
        systemPrompt: [
            'You are the Executor teammate for DesignEcho.',
            'Execute precise Photoshop edits from an approved plan.',
            'Inspect state before changing it.',
            'Prefer deterministic, non-destructive edits.',
            'Respond in concise Simplified Chinese.'
        ].join('\n'),
        allowedTools: [
            'getDocumentInfo',
            'getLayerHierarchy',
            'getLayerBounds',
            'getLayerProperties',
            'selectLayer',
            'moveLayer',
            'moveLayerToGroup',
            'transformLayer',
            'quickScale',
            'alignLayers',
            'setLayerOpacity',
            'setBlendMode',
            'duplicateLayer',
            'renameLayer',
            'createRectangle',
            'createTextLayer',
            'createGroup',
            'groupLayers',
            'placeImage',
            'replaceLayerContent',
            'getTextContent',
            'setTextContent',
            'getTextStyle',
            'setTextStyle',
            'addDropShadow',
            'addStroke'
        ],
        maxIterations: buildDesignTeamRuntimeBudget({ role: 'executor' }).maxIterations,
        outputType: 'execution_report',
        canWriteToPhotoshop: true
    },
    critic: {
        role: 'critic',
        displayName: 'Critic',
        description: 'Review the current design result, identify risks, and suggest concrete revisions.',
        systemPrompt: [
            'You are the Critic teammate for DesignEcho.',
            'Review the current result after execution.',
            'Focus on placement, hierarchy, copy fit, and visual coherence.',
            'Do not edit Photoshop directly.',
            'Respond in concise Simplified Chinese.'
        ].join('\n'),
        allowedTools: [
            'getDocumentInfo',
            'getCanvasSnapshot',
            'getDocumentSnapshot',
            'getLayerHierarchy',
            'getLayerBounds',
            'getTextContent',
            'describeImage',
            'getScreenSnapshots',
            'auditDetailPagePlacement',
            'getScreenSnapshotsWithOverlay'
        ],
        maxIterations: buildDesignTeamRuntimeBudget({ role: 'critic' }).maxIterations,
        outputType: 'review_report',
        canWriteToPhotoshop: false
    }
};

export const DESIGN_TEAMMATE_ROLES = Object.freeze(
    Object.keys(TEAMMATE_DEFINITIONS) as DesignTeammateRole[]
);

export function getDesignTeammateDefinition(role: DesignTeammateRole): DesignTeammateDefinition {
    return TEAMMATE_DEFINITIONS[role];
}

export function listDesignTeammateDefinitions(): DesignTeammateDefinition[] {
    return DESIGN_TEAMMATE_ROLES.map((role) => TEAMMATE_DEFINITIONS[role]);
}
