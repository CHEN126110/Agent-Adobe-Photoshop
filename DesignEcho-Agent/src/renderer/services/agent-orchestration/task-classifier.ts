import { getInternalDebugSkills, getUserFacingSkills } from '../../../shared/skills/skill-declarations';
import type { SkillDeclaration } from '../../../shared/types/skill.types';
import { normalizeSkillId } from '../../../shared/skill-routing';
import { formatDesignDomainConceptsForRouter } from '../../../shared/design-domain-knowledge';
import type { AgentContext, ProcessOptions } from './types';
import { isAgentMattingPaused } from './routing';

export interface ModelTaskRoute {
    route: 'direct_response' | 'skill_execution' | 'autonomous_agent' | 'clarification_needed';
    skillId?: string;
    mode?: 'inspect' | 'execute';
    skillParams?: Record<string, any>;
    directResponse?: string;
    clarificationQuestion?: string;
    intentSummary?: string;
    thinking?: string;
}

function parseJsonBlock(text: string): any | null {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;

    const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;

    try {
        return JSON.parse(candidate);
    } catch {
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(candidate.slice(start, end + 1));
            } catch {
                return null;
            }
        }
        return null;
    }
}

function getRouterSkillCatalog(): SkillDeclaration[] {
    return [
        ...getUserFacingSkills(),
        ...getInternalDebugSkills()
    ]
        .filter((skill) => skill.id !== 'shape-morphing')
        .filter((skill) => !(isAgentMattingPaused() && skill.id === 'matte-product'))
        .sort((left, right) => left.id.localeCompare(right.id));
}

function formatSkillVisibility(skill: SkillDeclaration): string {
    if (skill.visibility === 'user-facing') return 'user-facing';
    if (skill.visibility === 'internal-debug') return 'internal-debug';
    return 'system-only';
}

function buildRouterSkillLines(skills: SkillDeclaration[]): string[] {
    return skills.flatMap((skill) => {
        const whenToUse = skill.whenToUse.slice(0, 2).join(' / ');
        const whenNotToUse = (skill.whenNotToUse || []).slice(0, 2).join(' / ');
        const parameterNames = skill.parameters.map((param) => param.name).slice(0, 6).join(', ');
        const routing = skill.routing;

        const lines = [
            `- ${skill.id} [${skill.kind}, ${formatSkillVisibility(skill)}]: ${skill.description}`,
            `  whenToUse: ${whenToUse || 'none'}`,
            `  parameters: ${parameterNames || 'none'}`
        ];

        if (whenNotToUse) {
            lines.push(`  whenNotToUse: ${whenNotToUse}`);
        }
        if (routing?.intentSignals?.length) {
            lines.push(`  intentSignals: ${routing.intentSignals.slice(0, 6).join(' / ')}`);
        }
        if (routing?.intentSignalGroups?.length) {
            const groupSummary = routing.intentSignalGroups
                .slice(0, 3)
                .map((group) => `(${group.slice(0, 4).join(' | ')})`)
                .join(' AND ');
            lines.push(`  intentSignalGroups: ${groupSummary}`);
        }
        if (routing?.negativeSignals?.length) {
            lines.push(`  negativeSignals: ${routing.negativeSignals.slice(0, 6).join(' / ')}`);
        }
        if (routing?.preconditions?.length) {
            lines.push(`  preconditions: ${routing.preconditions.slice(0, 3).join(' / ')}`);
        }
        if (routing?.supportedModes?.length) {
            lines.push(`  supportedModes: ${routing.supportedModes.join(', ')}`);
        }
        if (routing?.parameterExtractionHints?.length) {
            lines.push(`  parameterExtractionHints: ${routing.parameterExtractionHints.slice(0, 3).join(' / ')}`);
        }
        if (routing?.clarificationHints?.length) {
            lines.push(`  clarificationHints: ${routing.clarificationHints.slice(0, 2).join(' / ')}`);
        }
        if (routing?.decisionGuidance?.length) {
            lines.push(`  decisionGuidance: ${routing.decisionGuidance.slice(0, 3).join(' / ')}`);
        }
        if (routing?.retryPolicy) {
            lines.push(`  retryPolicy: ${routing.retryPolicy}`);
        }

        return lines;
    });
}

function buildSkillParamGuidanceLines(skills: SkillDeclaration[]): string[] {
    return skills
        .filter((skill) => skill.parameters.length > 0)
        .map((skill) => {
            const parameterNames = skill.parameters
                .map((param) => param.name)
                .filter(Boolean)
                .slice(0, 10)
                .join(', ');
            return `- For ${skill.id}, you may set ${parameterNames || 'no explicit parameters'}.`;
        });
}

function buildClassifierPrompt(context: AgentContext): string {
    const routerSkills = getRouterSkillCatalog();
    const routerSkillIds = routerSkills.map((skill) => `- ${skill.id}`);
    const skillParamGuidanceLines = buildSkillParamGuidanceLines(routerSkills);
    const domainConceptLines = formatDesignDomainConceptsForRouter();
    const photoshop = context.photoshopContext;
    const project = context.projectContext;
    const recentConversation = context.conversationHistory
        .slice(-4)
        .map((item) => `${item.role === 'assistant' ? 'Assistant' : 'User'}: ${String(item.content || '').trim()}`)
        .filter(Boolean)
        .join('\n');

    return [
        'You are the intent router for DesignEcho desktop agent.',
        'Your job is to understand the real user intent before any tool or skill is executed.',
        'This is a desktop AI agent, not a fixed tool menu. Prefer semantic understanding over keyword routing.',
        'Return strict JSON only.',
        '',
        'Available routes:',
        '1. direct_response: for pure chat, simple explanation, or when no tool execution should happen now.',
        '2. skill_execution: for deterministic skills.',
        '3. autonomous_agent: for open-ended tasks that still need the autonomous agent.',
        '4. clarification_needed: for actionable requests where the target is real but key information is missing or ambiguous, so the agent should ask one concise Chinese question before acting.',
        '',
        'Deterministic skill ids come from the live skill registry. Only choose from these ids:',
        ...routerSkillIds,
        '',
        'Live skill registry summary:',
        ...buildRouterSkillLines(routerSkills),
        '',
        'Project domain definitions:',
        ...domainConceptLines,
        '',
        'Routing guidance:',
        '- Treat the live skill registry as the routing truth source. Pay special attention to intentSignals, negativeSignals, parameterExtractionHints, clarificationHints, and decisionGuidance.',
        '- Use Project domain definitions to distinguish business concepts such as 主图, 详情页, SKU, 模板, and 参考图复刻 before choosing a skill.',
        '- Use recent conversation to resolve follow-up requests. Do not force the user to repeat context that is already available.',
        '- For short retry or failure feedback such as “没改成功 / 再改一下 / 还是不对”, continue the previous actionable editing task unless the user explicitly pivots to debugging.',
        '- Never choose internal-debug skills for ordinary Photoshop operations. Only route to internal-debug when the user explicitly asks to debug panel, MCP, bridge, websocket, or 联调.',
        '',
        'Return JSON schema:',
        '{',
        '  "route": "direct_response" | "skill_execution" | "autonomous_agent" | "clarification_needed",',
        '  "skillId": string | null,',
        '  "mode": "inspect" | "execute" | null,',
        '  "skillParams": object | null,',
        '  "intentSummary": "short Chinese sentence describing the real user intent",',
        '  "directResponse": "Chinese reply only when route=direct_response",',
        '  "clarificationQuestion": "Chinese question only when route=clarification_needed"',
        '}',
        '',
        'Requirements:',
        '- Treat the live skill registry as the source of truth. Prefer matching the user request against skill description, whenToUse, whenNotToUse, and parameter names instead of inventing a new route.',
        '- intentSummary must be concise Chinese and describe the user intent, not technical internals or simulated chain-of-thought.',
        '- If the request is actionable but still ambiguous, prefer clarification_needed over forcing a wrong skill.',
        '- clarificationQuestion must be one short Chinese question, no bullets, no JSON, no technical wording.',
        '- If the intent is to inspect structure only, do not choose execute mode.',
        '- When route=skill_execution, prefer returning useful skillParams inferred from the user request instead of relying on fixed defaults.',
        '- skillParams should be minimal and practical. Do not invent unsupported fields.',
        '- For sku-batch note-only tasks, do not route to text editing or generic autonomous execution.',
        ...skillParamGuidanceLines,
        '- If unsure, choose autonomous_agent instead of an incorrect deterministic skill.',
        '',
        'Current context:',
        `- Photoshop connected: ${context.isPluginConnected ? 'yes' : 'no'}`,
        `- Has document: ${photoshop?.hasDocument ? 'yes' : 'no'}`,
        `- Document name: ${photoshop?.documentName || 'unknown'}`,
        `- Active layer: ${photoshop?.activeLayerName || 'unknown'}`,
        `- Project path: ${project?.projectPath || 'unknown'}`,
        `- Project image count: ${project?.projectImageCount ?? 0}`,
        `- Project image folders: ${(project?.projectImageFolders || []).map((item) => `${item.path}(${item.imageCount})`).join(', ') || 'none'}`,
        `- Project sample images: ${(project?.sampleImagePaths || []).slice(0, 4).join(', ') || 'none'}`,
        recentConversation ? `- Recent conversation:\n${recentConversation}` : '- Recent conversation: none',
        '',
        `User input: ${JSON.stringify(context.userInput)}`
    ].join('\n');
}

export async function classifyActionableIntent(
    context: AgentContext,
    callModel: NonNullable<ProcessOptions['callModel']>
): Promise<ModelTaskRoute | null> {
    try {
        const messages = [
            {
                role: 'system' as const,
                content: buildClassifierPrompt(context)
            },
            {
                role: 'user' as const,
                content: context.userInput
            }
        ];

        const result = await callModel(messages, {
            temperature: 0.1,
            maxTokens: 260,
            purpose: 'router',
            silent: true,
            stream: false
        });
        const parsed = parseJsonBlock(String(result?.text || ''));
        if (!parsed || typeof parsed !== 'object') return null;

        const route = String(parsed.route || '').trim();
        if (!['direct_response', 'skill_execution', 'autonomous_agent', 'clarification_needed'].includes(route)) {
            return null;
        }

        const normalizedSkillId = normalizeSkillId(parsed.skillId);
        const mode = parsed.mode === 'inspect' ? 'inspect' : parsed.mode === 'execute' ? 'execute' : undefined;
        const skillParams = parsed.skillParams && typeof parsed.skillParams === 'object' && !Array.isArray(parsed.skillParams)
            ? parsed.skillParams as Record<string, any>
            : undefined;
        const intentSummary = typeof parsed.intentSummary === 'string'
            ? parsed.intentSummary.trim()
            : typeof parsed.thinking === 'string'
                ? parsed.thinking.trim()
                : '';
        const directResponse = typeof parsed.directResponse === 'string' ? parsed.directResponse.trim() : '';
        const clarificationQuestion = typeof parsed.clarificationQuestion === 'string'
            ? parsed.clarificationQuestion.trim()
            : '';

        return {
            route: route as ModelTaskRoute['route'],
            skillId: normalizedSkillId,
            mode,
            skillParams,
            directResponse,
            clarificationQuestion,
            intentSummary,
            thinking: intentSummary
        };
    } catch {
        return null;
    }
}
