import type { DesignKnowledgeResult } from './design-knowledge-search';

export interface AgentResponseSkillFact {
    id: string;
    name: string;
    visibility?: string;
    enabled?: boolean;
}

export interface AgentResponsePreferenceFact {
    id: string;
    category?: string;
    value: string;
    label?: string;
    sourceType?: string;
    status?: string;
    evidenceSummary?: string;
}

export interface AgentResponseProjectFact {
    projectPath?: string;
    projectImageCount?: number;
    assetIndex?: {
        summary?: {
            totalImages?: number;
        };
    };
    selectedProjectImageName?: string;
    selectedProjectImagePath?: string;
}

export interface AgentResponseKnowledgeBundleInput {
    userText?: string;
    skillFacts?: AgentResponseSkillFact[];
    preferenceItems?: AgentResponsePreferenceFact[];
    knowledgeResults?: DesignKnowledgeResult[];
    projectContext?: AgentResponseProjectFact;
}

export interface AgentResponseKnowledgePreference {
    id: string;
    category: string;
    value: string;
    label: string;
    evidenceSummary: string;
}

export interface AgentResponseKnowledgeContextItem {
    id: string;
    title: string;
    summary: string;
    sourceType: string;
    evidenceLevel: string;
    tags: string[];
}

export interface AgentResponseKnowledgeBundle {
    version: 'agent-response-knowledge/v0';
    persona: {
        role: string;
        language: 'zh-Hans';
        responseStyle: string[];
    };
    capabilities: {
        enabledUserFacingSkills: string[];
        disabledOrHiddenSkillCount: number;
    };
    preferences: {
        activeExplicitPreferences: AgentResponseKnowledgePreference[];
        excludedPreferenceCount: number;
        boundary: string;
    };
    knowledge: {
        contextItems: AgentResponseKnowledgeContextItem[];
        excludedKnowledgeCount: number;
        boundary: string;
    };
    project: {
        hasProject: boolean;
        availableProjectImages: number;
        selectedProjectImage?: string;
    };
    guardrails: {
        noPhotoshopExecution: true;
        noToolSimulation: true;
        noConfidence: true;
        doNotOverrideCurrentUserInstruction: true;
    };
    limitations: string[];
}

const FORBIDDEN_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

const UNSAFE_KNOWLEDGE_MARKERS = [
    'inferred_from_operations',
    'legacy_local_preference',
    'deprecated',
    'needs_review',
    'disabled',
    'archived',
    'direct_photoshop_action'
];

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return text.replace(/\s+/g, ' ').trim();
}

function uniqueClean(values: unknown[], limit = 12): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean))).slice(0, limit);
}

function safeTags(value: unknown): string[] {
    return Array.isArray(value) ? uniqueClean(value, 12) : [];
}

function hasPromptContextUse(result: DesignKnowledgeResult): boolean {
    return Array.isArray(result.allowedUses) && result.allowedUses.includes('prompt_context');
}

function knowledgeText(result: DesignKnowledgeResult): string {
    return [
        result.id,
        result.title,
        result.summary,
        ...(Array.isArray(result.evidence) ? result.evidence : []),
        ...safeTags(result.tags),
        ...(Array.isArray(result.allowedUses) ? result.allowedUses : [])
    ].map(cleanString).join(' ').toLowerCase();
}

function isSafeResponseKnowledge(result: DesignKnowledgeResult): boolean {
    if (!result || result.sourceType !== 'local_case' || result.evidenceLevel !== 'local_case') return false;
    if (!hasPromptContextUse(result)) return false;
    const text = knowledgeText(result);
    if (!text.includes('explicit_user_feedback') && !text.includes('sourceType: explicit'.toLowerCase()) && !text.includes(' explicit ')) {
        return false;
    }
    return !UNSAFE_KNOWLEDGE_MARKERS.some((marker) => text.includes(marker.toLowerCase()));
}

function isActiveExplicitPreference(item: AgentResponsePreferenceFact): boolean {
    return cleanString(item.sourceType) === 'explicit'
        && cleanString(item.status || 'active') === 'active'
        && Boolean(cleanString(item.value));
}

function preferenceToFact(item: AgentResponsePreferenceFact): AgentResponseKnowledgePreference {
    const value = cleanString(item.value);
    const category = cleanString(item.category) || 'unknown';
    return {
        id: cleanString(item.id) || `${category}:${value}`,
        category,
        value,
        label: cleanString(item.label) || value,
        evidenceSummary: cleanString(item.evidenceSummary) || '来自用户明确设置的偏好，只能作为回复和策略候选上下文。'
    };
}

function knowledgeToContextItem(result: DesignKnowledgeResult): AgentResponseKnowledgeContextItem {
    return {
        id: cleanString(result.id),
        title: cleanString(result.title),
        summary: cleanString(result.summary),
        sourceType: cleanString(result.sourceType),
        evidenceLevel: cleanString(result.evidenceLevel),
        tags: safeTags(result.tags)
    };
}

function enabledUserFacingSkillNames(skillFacts: AgentResponseSkillFact[] | undefined): string[] {
    return uniqueClean((skillFacts || [])
        .filter((skill) => skill.visibility === 'user-facing' && skill.enabled !== false)
        .map((skill) => skill.name || skill.id), 18);
}

function disabledOrHiddenSkillCount(skillFacts: AgentResponseSkillFact[] | undefined): number {
    return (skillFacts || [])
        .filter((skill) => skill.visibility !== 'user-facing' || skill.enabled === false)
        .length;
}

function resolveProjectImageCount(project?: AgentResponseProjectFact): number {
    return Math.max(
        0,
        Number(project?.projectImageCount || 0),
        Number(project?.assetIndex?.summary?.totalImages || 0)
    );
}

export function buildAgentResponseKnowledgeBundle(
    input: AgentResponseKnowledgeBundleInput
): AgentResponseKnowledgeBundle {
    const preferenceItems = Array.isArray(input.preferenceItems) ? input.preferenceItems : [];
    const activeExplicitPreferences = preferenceItems
        .filter(isActiveExplicitPreference)
        .map(preferenceToFact)
        .slice(0, 8);

    const safeKnowledge = (Array.isArray(input.knowledgeResults) ? input.knowledgeResults : [])
        .filter(isSafeResponseKnowledge)
        .sort((a, b) => (Number(b.sourceRank) || 0) - (Number(a.sourceRank) || 0))
        .map(knowledgeToContextItem)
        .slice(0, 6);

    const skillNames = enabledUserFacingSkillNames(input.skillFacts);
    const projectImageCount = resolveProjectImageCount(input.projectContext);
    const selectedProjectImage = cleanString(
        input.projectContext?.selectedProjectImageName || input.projectContext?.selectedProjectImagePath
    );

    return {
        version: 'agent-response-knowledge/v0',
        persona: {
            role: 'DesignEcho 桌面端设计 Agent',
            language: 'zh-Hans',
            responseStyle: [
                '先理解用户真正意图，再决定是否需要工具。',
                '回答自然、专业、直接，避免机械固定话术。',
                '涉及 Photoshop 写入前必须说明依据、边界和需要的证据。'
            ]
        },
        capabilities: {
            enabledUserFacingSkills: skillNames,
            disabledOrHiddenSkillCount: disabledOrHiddenSkillCount(input.skillFacts)
        },
        preferences: {
            activeExplicitPreferences,
            excludedPreferenceCount: Math.max(0, preferenceItems.length - activeExplicitPreferences.length),
            boundary: '只使用 active + explicit 用户偏好作为回复上下文；推断、待确认、禁用、归档或旧版偏好不得当作当前要求。'
        },
        knowledge: {
            contextItems: safeKnowledge,
            excludedKnowledgeCount: Math.max(0, (input.knowledgeResults || []).length - safeKnowledge.length),
            boundary: '知识库结果只用于 prompt_context 和 user_reference，不得转换成 Photoshop 工具参数、质量结论或用户已确认事实。'
        },
        project: {
            hasProject: Boolean(cleanString(input.projectContext?.projectPath)),
            availableProjectImages: projectImageCount,
            ...(selectedProjectImage ? { selectedProjectImage } : {})
        },
        guardrails: {
            noPhotoshopExecution: true,
            noToolSimulation: true,
            noConfidence: true,
            doNotOverrideCurrentUserInstruction: true
        },
        limitations: [
            '回复知识契约不会触发 Photoshop、UXP 或文件写入。',
            '偏好和知识不能替代当前用户指令、项目素材证据、平台规范、视觉识别或执行后验收。',
            '如果上下文不足，应解释缺口或继续推理，不应编造已经读取到的文档状态。'
        ]
    };
}

function listOrNone(values: string[], fallback = '无'): string {
    return values.length > 0 ? values.join('、') : fallback;
}

export function renderAgentResponseKnowledgePromptSection(bundle: AgentResponseKnowledgeBundle): string {
    const preferenceLines = bundle.preferences.activeExplicitPreferences
        .map((item) => `- ${item.category}: ${item.label} = ${item.value}; evidence=${item.evidenceSummary}`)
        .slice(0, 8);
    const knowledgeLines = bundle.knowledge.contextItems
        .map((item) => `- ${item.title}: ${item.summary}`)
        .slice(0, 6);
    return [
        '## Agent response knowledge bundle',
        `version=${bundle.version}`,
        `persona=${bundle.persona.role}; language=${bundle.persona.language}`,
        `responseStyle=${bundle.persona.responseStyle.join(' / ')}`,
        `enabledUserFacingSkills=${listOrNone(bundle.capabilities.enabledUserFacingSkills, '当前没有启用的用户可见技能')}`,
        `projectImages=${bundle.project.availableProjectImages}; selectedProjectImage=${bundle.project.selectedProjectImage || 'none'}`,
        `preferenceBoundary=${bundle.preferences.boundary}`,
        preferenceLines.length ? preferenceLines.join('\n') : '- activeExplicitPreferences: none',
        `knowledgeBoundary=${bundle.knowledge.boundary}`,
        knowledgeLines.length ? knowledgeLines.join('\n') : '- responseKnowledge: none',
        'guardrails=read-only response context; no Photoshop execution; no tool simulation; no confidence fields; do not override current user instruction'
    ].join('\n');
}
