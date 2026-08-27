import { ensureAgentToolFailureDiagnostics } from '../../../shared/agent-tool-failure-diagnostic';
import { getSkillById } from '../../../shared/skills/skill-declarations';
import {
    markExecutedToolResultProvenance,
    readExecutedToolResultProvenance
} from './tool-result-provenance';

/** 为真实工具结果补齐诊断，同时把执行器登记的对象身份迁移到新对象。 */
export function normalizeAgentToolFailureResult(name: string, result: unknown): unknown {
    const normalized = ensureAgentToolFailureDiagnostics({
        toolName: name,
        toolKind: getSkillById(name) ? 'skill' : 'tool',
        result
    });
    if (normalized !== result) {
        const provenance = readExecutedToolResultProvenance(result);
        if (provenance) markExecutedToolResultProvenance(provenance.toolName, normalized);
    }
    return normalized;
}
