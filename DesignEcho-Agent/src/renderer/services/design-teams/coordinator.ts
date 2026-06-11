import { Agent, selectTools } from '../agent-runtime';
import type {
    AgentCallbacks,
    CallModelFn,
    ExecuteToolFn
} from '../agent-runtime';
import { getDesignTeammateDefinition } from './registry';
import { DesignTeammateTask } from './task';
import type {
    DesignTeammateTaskRequest,
    DesignTeammateTaskResult
} from '../../../shared/types/design-team.types';
import { buildDesignTeamRuntimeBudget } from '../../../shared/agent-performance-policy';

export interface DesignTeamCoordinatorOptions {
    callModel: CallModelFn;
    executeTool: ExecuteToolFn;
    resolveDefaultModelId: () => string;
}

export class DesignTeamCoordinator {
    private readonly callModel: CallModelFn;
    private readonly executeTool: ExecuteToolFn;
    private readonly resolveDefaultModelId: () => string;

    constructor(options: DesignTeamCoordinatorOptions) {
        this.callModel = options.callModel;
        this.executeTool = options.executeTool;
        this.resolveDefaultModelId = options.resolveDefaultModelId;
    }

    async runTeammateTask(
        request: DesignTeammateTaskRequest,
        callbacks?: AgentCallbacks,
        signal?: AbortSignal
    ): Promise<DesignTeammateTaskResult> {
        const definition = getDesignTeammateDefinition(request.role);
        const tools = selectTools(definition.allowedTools);
        const modelId = request.modelId || this.resolveDefaultModelId();
        const taskId = this.createTaskId(request.role);
        const task = new DesignTeammateTask(taskId, request);
        const runtimeBudget = buildDesignTeamRuntimeBudget({
            role: request.role,
            requestedMaxIterations: request.maxIterations
        });

        const systemPrompt = request.context
            ? `${definition.systemPrompt}\n\nCoordinator context:\n${request.context}`
            : definition.systemPrompt;

        const agent = new Agent(
            {
                systemPrompt,
                tools,
                modelId,
                maxIterations: runtimeBudget.maxIterations,
                requireInitialToolCall: false,
                callbacks: callbacks || {},
                signal
            },
            this.callModel,
            this.executeTool
        );

        task.markRunning();
        const result = await agent.run(request.task);

        return task.finalize({
            success: result.success,
            message: result.message,
            iterations: result.iterations,
            toolsUsed: result.toolCallLog.map((item) => item.name),
            error: result.error,
            cancelled: result.cancelled
        });
    }

    private createTaskId(role: DesignTeammateTaskRequest['role']): string {
        const stamp = Date.now().toString(36);
        const random = Math.random().toString(36).slice(2, 8);
        return `design-task-${role}-${stamp}-${random}`;
    }
}
