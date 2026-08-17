import {
    buildAgentIntentControlPlaneDecision,
    isAgentCapabilityOrWillingnessQuestion,
    type AgentCapabilityConstraint,
    type AgentIntentControlPlaneDecision
} from './agent-intent-control-plane';
import type { AgentTaskProgressObligation } from './agent-task-planning-contract';

export type AgentTaskSpeechAct =
    | 'explicit_execution'
    | 'non_execution'
    | 'unknown';

export type AgentTaskSpeechActBasis =
    | 'structured_execution_provenance'
    | 'capability_question'
    | 'method_or_risk_question'
    | 'text_response'
    | 'inspection_or_assessment'
    | 'conditional_action'
    | 'question'
    | 'unresolved';

export interface AgentTaskSpeechActVerdict {
    speechAct: AgentTaskSpeechAct;
    basis: AgentTaskSpeechActBasis;
}

export interface AgentTaskProgressIdentity {
    version: 'agent-task-progress-identity/v0';
    requiresTaskProgress: boolean;
    progressObligation: AgentTaskProgressObligation;
    basis:
        | 'explicit_production_request'
        | 'inspection_progress_required'
        | 'capability_ceiling'
        | 'runtime_not_write_authorized'
        | 'non_execution_request'
        | 'production_provenance_unresolved';
    speechAct: AgentTaskSpeechAct;
}

export interface ResolveAgentTaskProgressIdentityInput {
    userInput: unknown;
    runtimeDecision: Pick<
        AgentIntentControlPlaneDecision,
        | 'requestKind'
        | 'toolScope'
        | 'executionAuthorization'
        | 'requiresClarificationBeforeTools'
    >;
    semanticDecision: Pick<
        AgentIntentControlPlaneDecision,
        | 'requestKind'
        | 'toolScope'
        | 'executionAuthorization'
        | 'requiresClarificationBeforeTools'
        | 'executionDisposition'
        | 'matchedSignals'
    >;
    capabilityConstraint: Pick<AgentCapabilityConstraint, 'toolScopeCeiling'>;
}

const QUOTED_PAYLOAD_PATTERN = /["“'‘「『][^"”'’」』\r\n]{0,240}["”'’」』]/g;
const CLAUSE_SEPARATOR_PATTERN = /[，,。；;\n]+/;
const SEQUENCE_SEPARATOR_PATTERN = /(?:然后|随后|接着|之后|接下来|再|并且|而且)/i;
const METHOD_OR_RISK_QUESTION_PATTERN = /^(?:怎么|如何|为什么|为何|什么是|是否|能否|能不能|可不可以)|(?:怎么|如何)(?:完成|制作|设计|修改|调整|处理|生成|导出)|(?:(?:的|相关)?(?:流程|步骤|方法|教程|做法)|怎么做|如何做|为什么|为何|要多久|需要什么|有什么(?:要求|风险|影响|后果|问题|注意)|有哪些(?:要求|风险|影响|后果|问题|注意)|会不会(?:影响|覆盖|破坏|删除|改动)|是否(?:安全|可行|值得|需要|应该)|行不行|好不好|可不可行|注意事项|风险|影响|后果|副作用|安全|可行性)\s*[?？吗嘛么呢]*$/i;
const TEXT_RESPONSE_DELIVERABLE_PATTERN = /(?:方案|计划|思路|建议|清单|说明|报告|总结|教程|流程|步骤|方法|做法|文案)\s*$/i;
const TEXTUAL_DESIGN_OPTION_PATTERN = /(?:字体搭配|配色|构图|设计方向|创意方向|排版方向)[^。！？!?；;\n]{0,16}(?:候选|备选)\s*$/i;
const MATERIALIZE_TEXT_PLAN_PATTERN = /(?:落地|执行|实施|应用|采用)[^。！？!?；;\n]{0,24}(?:方案|计划)\s*$/i;
const NEGATED_TEXT_RESPONSE_PATTERN = /(?:不要|别|不(?:要)?只|不能只|不是只|无需)[^。！？!?；;\n]{0,20}(?:方案|计划|思路|建议|清单|说明|报告|总结|教程|流程|步骤|方法|做法|文案)\s*$/i;
const CONDITIONAL_ACTION_PATTERN = /(?:如果|若|要是|假如|倘若|视情况|必要时|需要时|在需要时|(?<!没)有问题(?:时)?|在有问题时|发现问题(?:时)?|存在问题(?:时)?|不合适(?:时)?|需要再|没问题(?:就|再))/i;
const CONDITIONAL_REPORT_ONLY_PATTERN = /(?:告诉|说明|汇报|询问|问)(?:我|用户)?(?:一下)?(?:即可|就行)?\s*$/i;
const INSPECTION_OR_ASSESSMENT_LEAD_PATTERN = /^(?:(?:请|请你|帮我|麻烦(?:你)?|我想(?:让|请)?你|需要你)\s*)?(?:(?:先|只|仅|先只)\s*)?(?:说明|解释|回答|告诉|介绍|聊聊|讨论|分析|评估|评价|判断|确认|检查|查看|审核|审查|验收|复核|诊断|梳理|盘点|了解|比较|建议|评审|点评)/i;
const NEGATED_ACTION_CLAUSE_PATTERN = /^(?:(?:本轮|这次|当前|现在|先|暂时)\s*)*(?:不要|别|勿|禁止|无需|不用|不再|不)\s*(?:再\s*)?[^。！？!?；;]{0,48}$/i;
const REPORTING_CLAUSE_PATTERN = /^(?:完成后|做完后|生成后|导出后|保存后)?[^。！？!?；;]{0,40}(?:风险|影响|后果|结果)[^。！？!?；;]{0,24}(?:告诉|说明|汇报)|^(?:完成后|做完后|生成后|导出后|保存后)[^。！？!?；;]{0,40}(?:告诉|说明|汇报)/i;
const DELEGATION_CUE_PATTERN = /(?:帮我|给我|替我|为我|请你|麻烦(?:你)?|交给你)/i;
const GENERAL_QUESTION_END_PATTERN = /(?:吗|嘛|么|呢|[?？])\s*$/i;
const TASK_BEARING_QUESTION_CONTENT_PATTERN = /(?:风险|影响|后果|副作用|安全|覆盖|破坏|损坏|删除|丢失|改动|修改|原稿|原图|源文件|文档|图层|素材|怎么|如何|为什么|为何|流程|步骤|方法|教程|要多久|需要什么|(?:有|存在|发现)(?:什么|哪些)?问题)/i;
const EXECUTION_WITHDRAWAL_PATTERN = /(?:^|\s)(?:本轮|这次|现在|先|暂时)?\s*(?:不要|别|不用|无需|不再|先不)\s*(?:再\s*)?(?:做|执行|动手|操作|开始|继续)/i;
function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function maskQuotedPayloads(value: string): string {
    return value.replace(QUOTED_PAYLOAD_PATTERN, ' 引用内容 ');
}

function isConfirmedWriteDecision(
    decision: Pick<
        AgentIntentControlPlaneDecision,
        | 'requestKind'
        | 'toolScope'
        | 'executionAuthorization'
        | 'requiresClarificationBeforeTools'
    >
): boolean {
    return (decision.requestKind === 'autonomous_execution'
        || decision.requestKind === 'execute_skill')
        && decision.toolScope === 'write_photoshop'
        && decision.executionAuthorization === 'confirmed_tool_required'
        && !decision.requiresClarificationBeforeTools;
}

function buildFallbackSemanticDecision(text: string): AgentIntentControlPlaneDecision {
    return buildAgentIntentControlPlaneDecision({ userInput: text });
}

function isInterpersonalQuestionWrapper(
    clause: string,
    hasAssertedDelegation: boolean,
    semanticDecision?: ResolveAgentTaskProgressIdentityInput['semanticDecision']
): boolean {
    if (!hasAssertedDelegation || !GENERAL_QUESTION_END_PATTERN.test(clause)) return false;
    if (isAgentCapabilityOrWillingnessQuestion(clause)
        || CONDITIONAL_ACTION_PATTERN.test(clause)
        || NEGATED_ACTION_CLAUSE_PATTERN.test(clause)
        || EXECUTION_WITHDRAWAL_PATTERN.test(clause)
        || REPORTING_CLAUSE_PATTERN.test(clause)
        || INSPECTION_OR_ASSESSMENT_LEAD_PATTERN.test(clause)
        || TASK_BEARING_QUESTION_CONTENT_PATTERN.test(clause)) {
        return false;
    }
    if (semanticDecision
        && isConfirmedWriteDecision(semanticDecision)
        && semanticDecision.executionDisposition === 'explicit_execution'
        && DELEGATION_CUE_PATTERN.test(clause)) {
        return true;
    }
    const wrapperDecision = buildFallbackSemanticDecision(clause);
    return wrapperDecision.requestKind === 'chat_only'
        && wrapperDecision.executionDisposition === 'non_execution'
        && wrapperDecision.matchedSignals.includes('unrouted_question');
}

function clauseHasUnconditionalFollowUp(clause: string): boolean {
    const parts = clause.split(SEQUENCE_SEPARATOR_PATTERN).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return false;
    return parts.slice(1).some((part) => {
        if (CONDITIONAL_ACTION_PATTERN.test(part)) return false;
        const decision = buildFallbackSemanticDecision(part);
        return isConfirmedWriteDecision(decision)
            && decision.executionDisposition === 'explicit_execution';
    });
}

function resolveExplicitExecutionBeforeConditional(
    clause: string
): AgentTaskSpeechActVerdict | undefined {
    const match = CONDITIONAL_ACTION_PATTERN.exec(clause);
    if (!match || match.index <= 0) return undefined;
    const prefix = clause.slice(0, match.index).trim();
    if (!prefix) return undefined;
    const decision = buildFallbackSemanticDecision(prefix);
    if (!isConfirmedWriteDecision(decision)
        || decision.executionDisposition !== 'explicit_execution') {
        return undefined;
    }
    return { speechAct: 'explicit_execution', basis: 'structured_execution_provenance' };
}

function classifyTaskSpeechActClause(
    clause: string,
    semanticDecision?: ResolveAgentTaskProgressIdentityInput['semanticDecision']
): AgentTaskSpeechActVerdict {
    const normalized = clause.trim();
    if (!normalized || REPORTING_CLAUSE_PATTERN.test(normalized)) {
        return { speechAct: 'unknown', basis: 'unresolved' };
    }
    if (isInterpersonalQuestionWrapper(
        normalized,
        DELEGATION_CUE_PATTERN.test(normalized),
        semanticDecision
    )) {
        return { speechAct: 'explicit_execution', basis: 'structured_execution_provenance' };
    }
    if (isAgentCapabilityOrWillingnessQuestion(normalized)) {
        return { speechAct: 'non_execution', basis: 'capability_question' };
    }
    if (METHOD_OR_RISK_QUESTION_PATTERN.test(normalized)) {
        return { speechAct: 'non_execution', basis: 'method_or_risk_question' };
    }
    if ((TEXT_RESPONSE_DELIVERABLE_PATTERN.test(normalized)
        || TEXTUAL_DESIGN_OPTION_PATTERN.test(normalized))
        && !MATERIALIZE_TEXT_PLAN_PATTERN.test(normalized)
        && !NEGATED_TEXT_RESPONSE_PATTERN.test(normalized)) {
        return { speechAct: 'non_execution', basis: 'text_response' };
    }
    if (GENERAL_QUESTION_END_PATTERN.test(normalized)
        && !DELEGATION_CUE_PATTERN.test(normalized)) {
        return { speechAct: 'non_execution', basis: 'question' };
    }
    if (NEGATED_ACTION_CLAUSE_PATTERN.test(normalized)) {
        // 否定分句只是约束，不得自己签发执行义务，也不能覆盖同句里独立的肯定交付。
        return { speechAct: 'unknown', basis: 'unresolved' };
    }
    if (CONDITIONAL_ACTION_PATTERN.test(normalized)) {
        const precedingExecution = resolveExplicitExecutionBeforeConditional(normalized);
        if (precedingExecution) return precedingExecution;
        if (CONDITIONAL_REPORT_ONLY_PATTERN.test(normalized)) {
            return { speechAct: 'unknown', basis: 'unresolved' };
        }
        const decision = semanticDecision || buildFallbackSemanticDecision(normalized);
        if (isConfirmedWriteDecision(decision)
            && decision.executionDisposition === 'explicit_execution') {
            return { speechAct: 'non_execution', basis: 'conditional_action' };
        }
        return { speechAct: 'unknown', basis: 'unresolved' };
    }
    if (INSPECTION_OR_ASSESSMENT_LEAD_PATTERN.test(normalized)
        && !clauseHasUnconditionalFollowUp(normalized)) {
        return { speechAct: 'non_execution', basis: 'inspection_or_assessment' };
    }

    const decision = semanticDecision || buildFallbackSemanticDecision(normalized);
    if (isConfirmedWriteDecision(decision)
        && decision.executionDisposition === 'explicit_execution') {
        return { speechAct: 'explicit_execution', basis: 'structured_execution_provenance' };
    }
    return { speechAct: 'unknown', basis: 'unresolved' };
}

function resolveAgentTaskSpeechActWithSemanticDecision(
    value: unknown,
    semanticDecision?: ResolveAgentTaskProgressIdentityInput['semanticDecision']
): AgentTaskSpeechActVerdict {
    const rawText = normalizeText(value);
    const text = maskQuotedPayloads(rawText);
    if (!text) return { speechAct: 'unknown', basis: 'unresolved' };

    const clauses = text.split(CLAUSE_SEPARATOR_PATTERN).map((clause) => clause.trim()).filter(Boolean);
    let latestExecutionIndex = -1;
    let latestBlockingIndex = -1;
    let latestNegatedActionIndex = -1;
    let latestNonExecution: AgentTaskSpeechActVerdict | undefined;

    clauses.forEach((clause, index) => {
        if (NEGATED_ACTION_CLAUSE_PATTERN.test(clause)) {
            latestNegatedActionIndex = index;
        }
        const clauseSemanticDecision = clauses.length === 1
            || CONDITIONAL_ACTION_PATTERN.test(clause)
            ? semanticDecision
            : undefined;
        const verdict = classifyTaskSpeechActClause(
            clause,
            clauseSemanticDecision
        );
        if (verdict.speechAct === 'explicit_execution') {
            latestExecutionIndex = index;
            return;
        }
        if (verdict.speechAct !== 'non_execution') return;
        if (index > 0
            && latestExecutionIndex >= 0
            && isInterpersonalQuestionWrapper(
                clause,
                DELEGATION_CUE_PATTERN.test(clauses.slice(0, index).join('，'))
            )) {
            // 前面的直接委托已建立执行身份；末尾无任务内容的人际确认只改变语气。
            // 能力、风险、撤回、条件或带对象的问题不会进入此分支。
            return;
        }
        latestNonExecution = verdict;
        latestBlockingIndex = index;
    });

    if (latestExecutionIndex >= 0 && latestExecutionIndex >= latestBlockingIndex) {
        return { speechAct: 'explicit_execution', basis: 'structured_execution_provenance' };
    }
    const hasConditionalClause = clauses.some((clause) => CONDITIONAL_ACTION_PATTERN.test(clause));
    if (!hasConditionalClause
        && latestNonExecution?.basis === 'inspection_or_assessment'
        && latestBlockingIndex >= 0
        && latestBlockingIndex < clauses.length - 1
        && semanticDecision
        && isConfirmedWriteDecision(semanticDecision)
        && semanticDecision.executionDisposition === 'explicit_execution') {
        // “先检查，随后直接修改”是无条件的复合执行；与“有问题再改”不同，后者只签观察义务。
        // 这里依据分句关系和控制面 provenance，不维护检查对象或修改动词的品类词表。
        return { speechAct: 'explicit_execution', basis: 'structured_execution_provenance' };
    }
    if (latestNonExecution) return latestNonExecution;
    const hasStructuredDocumentExecutionRelation = semanticDecision?.matchedSignals
        .some((signal) => signal === 'protected_source_with_alternate_target'
            || signal === 'explicit_current_document_reuse') === true;
    if (semanticDecision
        && isConfirmedWriteDecision(semanticDecision)
        && semanticDecision.executionDisposition === 'explicit_execution'
        && (latestNegatedActionIndex < 0 || hasStructuredDocumentExecutionRelation)) {
        // 否定动作本身不能借用整句的宽写包络铸造交付义务。保护源稿并另建目标
        // 是控制面已经解析出的结构化双对象关系，可由该 provenance 明确例外。
        return { speechAct: 'explicit_execution', basis: 'structured_execution_provenance' };
    }
    return { speechAct: 'unknown', basis: 'unresolved' };
}

/**
 * 解析请求是否已具备肯定执行语义。正向身份只消费 Control Plane 已统一生成的
 * executionDisposition；本模块只补问答、纯检查和条件任务的非执行边界，
 * 不维护业务品类、Skill 或 Photoshop 动作词表。
 */
export function resolveAgentTaskSpeechAct(value: unknown): AgentTaskSpeechActVerdict {
    return resolveAgentTaskSpeechActWithSemanticDecision(value);
}

/**
 * 将既有结构化生产 provenance 物化为 TaskPlan 进展义务。它不选择 Skill、不授予
 * Tool，也不改变 Runtime 写包络；未知表达继续交给主 Agent，而不是折成阻断。
 */
export function resolveAgentTaskProgressIdentity(
    input: ResolveAgentTaskProgressIdentityInput
): AgentTaskProgressIdentity {
    const speechAct = resolveAgentTaskSpeechActWithSemanticDecision(
        input.userInput,
        input.semanticDecision
    );
    const semanticReadOnlyInspection = input.semanticDecision.requestKind === 'read_only_inspect'
        || input.semanticDecision.toolScope === 'read_only';
    const requiresObservation = speechAct.speechAct === 'non_execution'
        && (
            speechAct.basis === 'conditional_action'
            || (speechAct.basis === 'inspection_or_assessment' && semanticReadOnlyInspection)
        );
    if (input.capabilityConstraint.toolScopeCeiling) {
        const observationAllowed = input.capabilityConstraint.toolScopeCeiling === 'read_only'
            && requiresObservation;
        return {
            version: 'agent-task-progress-identity/v0',
            requiresTaskProgress: observationAllowed,
            progressObligation: observationAllowed ? 'observation' : 'none',
            basis: observationAllowed ? 'inspection_progress_required' : 'capability_ceiling',
            speechAct: speechAct.speechAct
        };
    }
    if (requiresObservation
        && input.runtimeDecision.toolScope !== 'none') {
        return {
            version: 'agent-task-progress-identity/v0',
            requiresTaskProgress: true,
            progressObligation: 'observation',
            basis: 'inspection_progress_required',
            speechAct: speechAct.speechAct
        };
    }
    if (!isConfirmedWriteDecision(input.runtimeDecision)) {
        return {
            version: 'agent-task-progress-identity/v0',
            requiresTaskProgress: false,
            progressObligation: 'none',
            basis: 'runtime_not_write_authorized',
            speechAct: speechAct.speechAct
        };
    }
    if (speechAct.speechAct !== 'explicit_execution') {
        return {
            version: 'agent-task-progress-identity/v0',
            requiresTaskProgress: false,
            progressObligation: 'none',
            basis: speechAct.speechAct === 'non_execution'
                ? 'non_execution_request'
                : 'production_provenance_unresolved',
            speechAct: speechAct.speechAct
        };
    }
    return {
        version: 'agent-task-progress-identity/v0',
        requiresTaskProgress: true,
        progressObligation: 'delivery',
        basis: 'explicit_production_request',
        speechAct: speechAct.speechAct
    };
}
