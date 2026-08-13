/**
 * Runtime Artifact 收尾授权。
 *
 * 主进程为每一代 Runtime 生成身份与一次性 capability，并绑定 WebContents 与项目真实路径。
 * Renderer 只持有不可解析的 token；最终 Artifact 的 project/runtime provenance 不再由调用方自报。
 */

import * as crypto from 'crypto';
import * as path from 'path';
import {
    RUNTIME_ARTIFACT_AUTHORIZATION_GRANT_VERSION,
    RUNTIME_SESSION_IDENTITY_ISSUANCE_GRANT_VERSION,
    type RuntimeArtifactAuthorizationGrant,
    type RuntimeArtifactAuthorizationRequest,
    type RuntimeSessionIdentityIssuanceGrant,
    type RuntimeSessionIdentityIssuanceRequest
} from '../../shared/agent-runtime-v5/runtime-artifact-finalization';
import {
    advanceRuntimeSessionIdentity,
    bindRuntimeSessionIdentity,
    createRuntimeSessionIdentity
} from '../../shared/agent-runtime-v5/runtime-session';
import {
    getManifestBySkillId,
    getManifestByTaskType
} from '../../shared/agent-runtime-v5/skill-runtime';
import { canonicalize, sha256Hex } from '../../shared/agent-runtime-v5/content-hash';

const DEFAULT_AUTHORIZATION_TTL_MS = 30 * 60 * 1000;
const MAX_AUTHORIZATION_RECORDS = 2048;
const MAX_ACTIVE_AUTHORIZATIONS_PER_SENDER_PROJECT = 64;

type AuthorizationStatus = 'issued' | 'finalizing' | 'completed';

interface AuthorizationRecord {
    grant: RuntimeArtifactAuthorizationGrant;
    requestKey: string;
    senderId: number;
    canonicalProjectPathKey: string;
    status: AuthorizationStatus;
    finalizationHash?: string;
    childRunId?: string;
    issuedAtMs: number;
    expiresAtMs: number;
}

/**
 * 主进程签发的 plan-neutral TaskRun identity。
 * 它不预判业务类型（无 skillId/taskType），在模型理解需求前就已稳定；
 * 模型结构化声明成功后，由 `issue` 在同一 runId 上原地绑定 Manifest。
 */
interface PlanNeutralIdentityRecord {
    grant: RuntimeSessionIdentityIssuanceGrant;
    requestKey: string;
    senderId: number;
    canonicalProjectPathKey: string;
    issuedAtMs: number;
    expiresAtMs: number;
    /** 已绑定到某次 Artifact 授权（runId 不变）后置位，防止同一身份被二次绑定。 */
    boundToRunId?: string;
}

export class RuntimeArtifactAuthorizationError extends Error {
    constructor(
        public readonly code: string,
        message: string
    ) {
        super(message);
        this.name = 'RuntimeArtifactAuthorizationError';
    }
}

export interface RuntimeArtifactAuthorizationServiceOptions {
    now?: () => Date;
    nonce?: () => string;
    ttlMs?: number;
}

function projectPathKey(canonicalProjectPath: string): string {
    const resolved = path.resolve(canonicalProjectPath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function cloneGrant(grant: RuntimeArtifactAuthorizationGrant): RuntimeArtifactAuthorizationGrant {
    return {
        ...grant,
        runtimeIdentity: {
            ...grant.runtimeIdentity,
            boundaries: { ...grant.runtimeIdentity.boundaries }
        },
        boundaries: { ...grant.boundaries }
    };
}

function clonePlanNeutralGrant(
    grant: RuntimeSessionIdentityIssuanceGrant
): RuntimeSessionIdentityIssuanceGrant {
    return {
        ...grant,
        runtimeIdentity: {
            ...grant.runtimeIdentity,
            boundaries: { ...grant.runtimeIdentity.boundaries }
        },
        boundaries: { ...grant.boundaries }
    };
}

function buildRepositoryProjectId(canonicalProjectPathKey: string): string {
    const digest = sha256Hex(canonicalize({ canonicalProjectPath: canonicalProjectPathKey }));
    return `project-local-${digest.slice(0, 24)}`;
}

export class RuntimeArtifactAuthorizationService {
    private readonly byToken = new Map<string, AuthorizationRecord>();
    private readonly byRunId = new Map<string, AuthorizationRecord>();
    private readonly byRequestKey = new Map<string, AuthorizationRecord>();
    private readonly byPlanNeutralIdentity = new Map<string, PlanNeutralIdentityRecord>();
    private readonly byPlanNeutralRequestKey = new Map<string, PlanNeutralIdentityRecord>();
    private readonly now: () => Date;
    private readonly nonce: () => string;
    private readonly ttlMs: number;

    constructor(options: RuntimeArtifactAuthorizationServiceOptions = {}) {
        this.now = options.now || (() => new Date());
        this.nonce = options.nonce || (() => crypto.randomBytes(32).toString('base64url'));
        this.ttlMs = Number.isFinite(options.ttlMs) && Number(options.ttlMs) > 0
            ? Number(options.ttlMs)
            : DEFAULT_AUTHORIZATION_TTL_MS;
    }

    issue(input: {
        senderId: number;
        canonicalProjectPath: string;
        request: RuntimeArtifactAuthorizationRequest;
    }): RuntimeArtifactAuthorizationGrant {
        this.assertSenderId(input.senderId);
        const manifest = getManifestBySkillId(input.request.skillId);
        const taskTypeManifest = getManifestByTaskType(input.request.taskType);
        if (!manifest || taskTypeManifest?.skill_id !== manifest.skill_id) {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_manifest_mismatch',
                'Runtime Artifact 授权失败：Skill 与 task type 不对应已注册的 Runtime Manifest。'
            );
        }
        const request: RuntimeArtifactAuthorizationRequest = {
            ...input.request,
            skillId: manifest.skill_id,
            taskType: manifest.task_type
        };
        const now = this.now();
        const nowMs = now.getTime();
        if (!Number.isFinite(nowMs)) {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_clock_invalid',
                'Runtime Artifact 授权失败：主进程时间无效。'
            );
        }
        this.prune(nowMs);
        const canonicalProjectPathKey = projectPathKey(input.canonicalProjectPath);
        const requestKey = this.buildRequestKey(
            input.senderId,
            canonicalProjectPathKey,
            request.requestId
        );
        const existing = this.byRequestKey.get(requestKey);
        if (existing) {
            const existingParentRunId = existing.grant.runtimeIdentity.parentRunId;
            if (existing.grant.skillId !== request.skillId
                || existing.grant.taskType !== request.taskType
                || existingParentRunId !== request.previousRunId) {
                throw new RuntimeArtifactAuthorizationError(
                    'authorization_request_id_conflict',
                    'Runtime Artifact 授权失败：同一请求 ID 被用于不同运行作用域。'
                );
            }
            if (existing.status !== 'issued') {
                throw new RuntimeArtifactAuthorizationError(
                    'authorization_request_already_used',
                    'Runtime Artifact 授权失败：该请求对应的授权已经进入收尾。'
                );
            }
            return cloneGrant(existing.grant);
        }
        const activeForSenderProject = Array.from(this.byToken.values()).filter((record) => (
            record.senderId === input.senderId
            && record.canonicalProjectPathKey === canonicalProjectPathKey
            && record.status !== 'completed'
        )).length;
        if (activeForSenderProject >= MAX_ACTIVE_AUTHORIZATIONS_PER_SENDER_PROJECT) {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_scope_capacity_exceeded',
                'Runtime Artifact 授权失败：当前窗口与项目的待处理授权过多，请稍后重试。'
            );
        }
        const previous = request.previousRunId
            ? this.resolvePrevious({ ...input, request }, canonicalProjectPathKey)
            : undefined;
        // 同 TaskRun 原地绑定：模型结构化声明后，把 plan-neutral 身份绑定到已选 Manifest，
        // 保持 sessionId/runId/generation 不变，不创建第二身份、不递归重启 Agent。
        const planNeutral = request.identityRunId
            ? this.bindPlanNeutralIdentity(input, canonicalProjectPathKey, request)
            : undefined;
        const runtimeIdentity = planNeutral
            ? planNeutral.runtimeIdentity
            : (previous
                ? advanceRuntimeSessionIdentity({
                    previous: previous.grant.runtimeIdentity,
                    now: now.toISOString(),
                    nonce: this.nonce()
                })
                : createRuntimeSessionIdentity({
                    now: now.toISOString(),
                    nonce: this.nonce(),
                    skillId: request.skillId,
                    taskType: request.taskType
                }));
        const authorizationToken = this.createUniqueToken();
        const expiresAtMs = nowMs + this.ttlMs;
        const grant: RuntimeArtifactAuthorizationGrant = {
            version: RUNTIME_ARTIFACT_AUTHORIZATION_GRANT_VERSION,
            authorizationToken,
            projectId: buildRepositoryProjectId(canonicalProjectPathKey),
            skillId: request.skillId,
            taskType: request.taskType,
            runtimeIdentity,
            expiresAt: new Date(expiresAtMs).toISOString(),
            boundaries: {
                mainProcessIssued: true,
                senderBound: true,
                projectPathBound: true,
                singleUse: true,
                grantsToolPermission: false
            }
        };
        const record: AuthorizationRecord = {
            grant,
            requestKey,
            senderId: input.senderId,
            canonicalProjectPathKey,
            status: 'issued',
            issuedAtMs: nowMs,
            expiresAtMs
        };
        this.byToken.set(authorizationToken, record);
        this.byRunId.set(runtimeIdentity.runId, record);
        this.byRequestKey.set(requestKey, record);
        if (previous) previous.childRunId = runtimeIdentity.runId;
        try {
            this.enforceCapacity();
        } catch (error) {
            if (previous?.childRunId === runtimeIdentity.runId) delete previous.childRunId;
            this.removeRecord(record);
            throw error;
        }
        return cloneGrant(grant);
    }

    /**
     * 签发不预判业务类型的 plan-neutral TaskRun identity。
     *
     * 在模型理解需求前由主进程先签发稳定身份（sessionId/runId/generation，无 skillId/taskType），
     * 使 taskRunId 在品类确定前就已稳定。模型结构化声明成功后，调用方在同一 runId 上
     * 通过 `issue`（携带 identityRunId）原地绑定 Manifest，不创建第二身份。
     * 该身份本身不授予 Tool 权限、不授予 Artifact 收尾权。
     */
    issueSessionIdentity(input: {
        senderId: number;
        canonicalProjectPath: string;
        request: RuntimeSessionIdentityIssuanceRequest;
    }): RuntimeSessionIdentityIssuanceGrant {
        this.assertSenderId(input.senderId);
        const now = this.now();
        const nowMs = now.getTime();
        if (!Number.isFinite(nowMs)) {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_clock_invalid',
                'Runtime 身份签发失败：主进程时间无效。'
            );
        }
        this.prune(nowMs);
        const canonicalProjectPathKey = projectPathKey(input.canonicalProjectPath);
        const requestKey = this.buildRequestKey(
            input.senderId,
            canonicalProjectPathKey,
            input.request.requestId
        );
        const existing = this.byPlanNeutralRequestKey.get(requestKey);
        if (existing) {
            // 幂等：同一 requestId 只返回同一 plan-neutral identity。
            if (existing.boundToRunId) {
                throw new RuntimeArtifactAuthorizationError(
                    'authorization_request_id_conflict',
                    'Runtime 身份签发失败：同一请求 ID 已被用于已绑定业务类型的授权。'
                );
            }
            return clonePlanNeutralGrant(existing.grant);
        }
        const activeForSenderProject = Array.from(this.byPlanNeutralIdentity.values()).filter((record) => (
            record.senderId === input.senderId
            && record.canonicalProjectPathKey === canonicalProjectPathKey
        )).length;
        if (activeForSenderProject >= MAX_ACTIVE_AUTHORIZATIONS_PER_SENDER_PROJECT) {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_scope_capacity_exceeded',
                'Runtime 身份签发失败：当前窗口与项目的待处理身份过多，请稍后重试。'
            );
        }
        const runtimeIdentity = createRuntimeSessionIdentity({
            now: now.toISOString(),
            nonce: this.nonce()
        });
        const expiresAtMs = nowMs + this.ttlMs;
        const grant: RuntimeSessionIdentityIssuanceGrant = {
            version: RUNTIME_SESSION_IDENTITY_ISSUANCE_GRANT_VERSION,
            projectId: buildRepositoryProjectId(canonicalProjectPathKey),
            runtimeIdentity,
            expiresAt: new Date(expiresAtMs).toISOString(),
            boundaries: {
                mainProcessIssued: true,
                senderBound: true,
                projectPathBound: true,
                planNeutral: true,
                grantsToolPermission: false,
                grantsArtifactFinalization: false
            }
        };
        const record: PlanNeutralIdentityRecord = {
            grant,
            requestKey,
            senderId: input.senderId,
            canonicalProjectPathKey,
            issuedAtMs: nowMs,
            expiresAtMs
        };
        this.byPlanNeutralIdentity.set(runtimeIdentity.runId, record);
        this.byPlanNeutralRequestKey.set(requestKey, record);
        return clonePlanNeutralGrant(grant);
    }

    claim(input: {
        senderId: number;
        canonicalProjectPath: string;
        authorizationToken: string;
        finalizationHash: string;
    }): RuntimeArtifactAuthorizationGrant {
        this.assertSenderId(input.senderId);
        const nowMs = this.now().getTime();
        const record = this.byToken.get(input.authorizationToken);
        if (!record) {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_missing',
                'Runtime Artifact 收尾被拒绝：授权不存在或已经过期。'
            );
        }
        if (record.expiresAtMs <= nowMs) {
            this.removeRecord(record);
            throw new RuntimeArtifactAuthorizationError(
                'authorization_expired',
                'Runtime Artifact 收尾被拒绝：授权已经过期。'
            );
        }
        if (record.senderId !== input.senderId) {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_sender_mismatch',
                'Runtime Artifact 收尾被拒绝：授权与当前窗口不匹配。'
            );
        }
        if (record.canonicalProjectPathKey !== projectPathKey(input.canonicalProjectPath)) {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_project_mismatch',
                'Runtime Artifact 收尾被拒绝：授权与当前项目不匹配。'
            );
        }
        if (record.status !== 'issued') {
            throw new RuntimeArtifactAuthorizationError(
                record.status === 'finalizing' ? 'authorization_in_use' : 'authorization_consumed',
                record.status === 'finalizing'
                    ? 'Runtime Artifact 收尾被拒绝：一次性授权正在由另一个请求使用。'
                    : 'Runtime Artifact 收尾被拒绝：一次性授权已经使用。'
            );
        }
        if (record.finalizationHash && record.finalizationHash !== input.finalizationHash) {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_retry_payload_mismatch',
                'Runtime Artifact 收尾被拒绝：重试批次与首次提交不一致。'
            );
        }
        record.finalizationHash = input.finalizationHash;
        record.status = 'finalizing';
        return cloneGrant(record.grant);
    }

    complete(authorizationToken: string): void {
        const record = this.byToken.get(authorizationToken);
        if (!record || record.status !== 'finalizing') {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_completion_invalid',
                'Runtime Artifact 收尾失败：授权不处于可完成状态。'
            );
        }
        record.status = 'completed';
    }

    fail(authorizationToken: string): void {
        const record = this.byToken.get(authorizationToken);
        if (record?.status === 'finalizing') record.status = 'issued';
    }

    private resolvePrevious(
        input: {
            senderId: number;
            request: RuntimeArtifactAuthorizationRequest;
        },
        canonicalProjectPathKey: string
    ): AuthorizationRecord {
        const previous = this.byRunId.get(String(input.request.previousRunId));
        if (!previous) {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_parent_missing',
                'Runtime Artifact 授权失败：上一代运行身份不存在。'
            );
        }
        if (previous.status !== 'completed') {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_parent_not_finalized',
                'Runtime Artifact 授权失败：上一代尚未完成 Repository 收尾。'
            );
        }
        if (previous.childRunId) {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_parent_already_advanced',
                'Runtime Artifact 授权失败：上一代已经签发唯一后继。'
            );
        }
        if (previous.senderId !== input.senderId
            || previous.canonicalProjectPathKey !== canonicalProjectPathKey
            || previous.grant.skillId !== input.request.skillId
            || previous.grant.taskType !== input.request.taskType) {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_parent_scope_mismatch',
                'Runtime Artifact 授权失败：上一代运行不属于当前窗口、项目或能力。'
            );
        }
        return previous;
    }

    /**
     * 把一次主进程签发的 plan-neutral identity 原地绑定到已选 Manifest。
     *
     * 绑定不改 sessionId/runId/generation；只记录选中 Skill/taskType，不授予 Tool 权限、
     * 不递归重启 Agent、不创建第二 TaskRun。绑定后该身份不可再次绑定（保持单一次绑定）。
     */
    private bindPlanNeutralIdentity(
        input: {
            senderId: number;
            request: RuntimeArtifactAuthorizationRequest;
        },
        canonicalProjectPathKey: string,
        request: RuntimeArtifactAuthorizationRequest
    ): RuntimeSessionIdentityIssuanceGrant {
        const identityRunId = String(input.request.identityRunId || '');
        const record = this.byPlanNeutralIdentity.get(identityRunId);
        if (!record) {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_identity_missing',
                'Runtime Artifact 授权失败：plan-neutral 身份不存在或已经过期。'
            );
        }
        const nowMs = this.now().getTime();
        if (record.expiresAtMs <= nowMs) {
            this.removePlanNeutralRecord(record);
            throw new RuntimeArtifactAuthorizationError(
                'authorization_identity_expired',
                'Runtime Artifact 授权失败：plan-neutral 身份已经过期。'
            );
        }
        if (record.senderId !== input.senderId
            || record.canonicalProjectPathKey !== canonicalProjectPathKey) {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_identity_scope_mismatch',
                'Runtime Artifact 授权失败：plan-neutral 身份不属于当前窗口或项目。'
            );
        }
        if (record.boundToRunId) {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_identity_already_bound',
                'Runtime Artifact 授权失败：plan-neutral 身份已经绑定，不能重复绑定。'
            );
        }
        const boundIdentity = bindRuntimeSessionIdentity({
            identity: record.grant.runtimeIdentity,
            skillId: request.skillId,
            taskType: request.taskType
        });
        if (boundIdentity.skillId !== request.skillId
            || boundIdentity.taskType !== request.taskType
            || boundIdentity.runId !== identityRunId) {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_identity_binding_invalid',
                'Runtime Artifact 授权失败：plan-neutral 身份绑定结果与请求不一致。'
            );
        }
        record.boundToRunId = identityRunId;
        record.grant = clonePlanNeutralGrant({
            ...record.grant,
            runtimeIdentity: boundIdentity
        });
        // 绑定后该身份不再作为 plan-neutral 幂等产物返回。
        this.byPlanNeutralRequestKey.delete(record.requestKey);
        return record.grant;
    }

    private createUniqueToken(): string {
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const token = this.nonce().replace(/[^A-Za-z0-9_-]/g, '');
            if (token.length >= 32 && token.length <= 160 && !this.byToken.has(token)) {
                return token;
            }
        }
        throw new RuntimeArtifactAuthorizationError(
            'authorization_token_generation_failed',
            'Runtime Artifact 授权失败：无法生成唯一授权。'
        );
    }

    private buildRequestKey(senderId: number, projectKey: string, requestId: string): string {
        return sha256Hex(canonicalize({ senderId, projectKey, requestId }));
    }

    private assertSenderId(senderId: number): void {
        if (!Number.isInteger(senderId) || senderId < 1) {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_sender_invalid',
                'Runtime Artifact 授权失败：调用窗口身份无效。'
            );
        }
    }

    private prune(nowMs: number): void {
        for (const record of this.byToken.values()) {
            if (record.expiresAtMs <= nowMs) this.removeRecord(record);
        }
        for (const record of this.byPlanNeutralIdentity.values()) {
            if (record.expiresAtMs <= nowMs) this.removePlanNeutralRecord(record);
        }
    }

    private removePlanNeutralRecord(record: PlanNeutralIdentityRecord): void {
        this.byPlanNeutralIdentity.delete(record.grant.runtimeIdentity.runId);
        if (this.byPlanNeutralRequestKey.get(record.requestKey) === record) {
            this.byPlanNeutralRequestKey.delete(record.requestKey);
        }
    }

    private enforceCapacity(): void {
        if (this.byToken.size <= MAX_AUTHORIZATION_RECORDS) return;
        const removable = Array.from(this.byToken.values())
            .filter((record) => record.status === 'completed')
            .sort((left, right) => left.issuedAtMs - right.issuedAtMs);
        while (this.byToken.size > MAX_AUTHORIZATION_RECORDS && removable.length > 0) {
            const record = removable.shift();
            if (record) this.removeRecord(record);
        }
        if (this.byToken.size > MAX_AUTHORIZATION_RECORDS) {
            throw new RuntimeArtifactAuthorizationError(
                'authorization_capacity_exceeded',
                'Runtime Artifact 授权失败：待处理授权过多，请稍后重试。'
            );
        }
    }

    private removeRecord(record: AuthorizationRecord): void {
        this.byToken.delete(record.grant.authorizationToken);
        if (this.byRequestKey.get(record.requestKey) === record) {
            this.byRequestKey.delete(record.requestKey);
        }
        if (this.byRunId.get(record.grant.runtimeIdentity.runId) === record) {
            this.byRunId.delete(record.grant.runtimeIdentity.runId);
        }
    }

}

export const runtimeArtifactAuthorizationService = new RuntimeArtifactAuthorizationService();
