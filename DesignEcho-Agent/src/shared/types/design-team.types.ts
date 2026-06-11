export type DesignTeammateRole =
    | 'scene-analyst'
    | 'design-strategist'
    | 'executor'
    | 'critic';

export type DesignTeamMessageType =
    | 'scene_summary'
    | 'design_plan'
    | 'execution_report'
    | 'review_report'
    | 'revision_request'
    | 'task_context'
    | 'task_status';

export type DesignTeammateTaskStatus =
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled';

export interface DesignTeamMessage<TPayload = Record<string, unknown>> {
    type: DesignTeamMessageType;
    fromRole: DesignTeammateRole;
    toRole?: DesignTeammateRole | 'coordinator';
    taskId?: string;
    timestamp?: string;
    payload: TPayload;
}

export interface DesignTeammateDefinition {
    role: DesignTeammateRole;
    displayName: string;
    description: string;
    systemPrompt: string;
    allowedTools: string[];
    maxIterations: number;
    outputType: DesignTeamMessageType;
    canWriteToPhotoshop: boolean;
}

export interface DesignTeammateTaskRequest {
    role: DesignTeammateRole;
    task: string;
    context?: string;
    modelId?: string;
    maxIterations?: number;
}

export interface DesignTeammateTaskResult {
    success: boolean;
    taskId: string;
    role: DesignTeammateRole;
    status: DesignTeammateTaskStatus;
    message: string;
    iterations: number;
    toolsUsed: string[];
    outputType: DesignTeamMessageType;
    startedAt: string;
    finishedAt: string;
    messages: DesignTeamMessage[];
    outputMessage?: DesignTeamMessage<{
        success: boolean;
        message: string;
        iterations: number;
        toolsUsed: string[];
        error?: string;
    }>;
    error?: string;
}
