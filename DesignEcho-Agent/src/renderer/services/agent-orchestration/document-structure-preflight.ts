import { executeToolCall } from '../tool-executor.service';
import {
    isAmbiguousTemplateInspectionIntent,
    type DeterministicRouteOptions
} from './routing';
import type { AgentContext } from './types';

function extractIssueCodes(parseResult: any): string[] {
    const issues = Array.isArray(parseResult?.issues) ? parseResult.issues : [];
    const codes = new Set<string>();

    for (const issue of issues) {
        const code = String(issue?.type || issue?.code || '').trim();
        if (code) codes.add(code);
    }

    return [...codes].slice(0, 12);
}

function hasCurrentPhotoshopDocument(context: AgentContext): boolean {
    return context.isPluginConnected === true && context.photoshopContext?.hasDocument === true;
}

function canUseRendererToolBridge(): boolean {
    return typeof window !== 'undefined';
}

function isDetailPageTemplateParse(parseResult: any): boolean {
    if (!parseResult || parseResult.success === false) return false;
    const screenCount = Number(parseResult.screenCount || 0);
    if (screenCount >= 3) return true;

    const screens = Array.isArray(parseResult.screens) ? parseResult.screens : [];
    return screens.length >= 3;
}

export async function buildCurrentDocumentStructureRouteOptions(
    context: AgentContext
): Promise<Partial<DeterministicRouteOptions>> {
    if (!hasCurrentPhotoshopDocument(context)) return {};
    if (!canUseRendererToolBridge()) return {};
    if (!isAmbiguousTemplateInspectionIntent(context.userInput)) return {};

    try {
        const parseResult = await executeToolCall('parseDetailPageTemplate', { includeStructure: false });
        if (!isDetailPageTemplateParse(parseResult)) return {};

        return {
            detailPageTemplateDetected: true,
            detailPageTemplateScreenCount: Number(parseResult.screenCount || parseResult.screens?.length || 0),
            detailPageTemplateIssueCodes: extractIssueCodes(parseResult)
        };
    } catch {
        return {};
    }
}
