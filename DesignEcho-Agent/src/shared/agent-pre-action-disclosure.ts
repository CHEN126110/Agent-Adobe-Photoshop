export interface AgentPreActionDisclosure {
    message: string;
    actionLabels: string[];
    canClaimTaskCompletion: false;
    canClaimDesignQuality: false;
    executesPhotoshop: false;
    grantsPermission: false;
}

/**
 * 当 provider 没有返回可展示的动手前说明时，Harness 只补充事实性的动作预告。
 * 它不替模型推理、不授予执行权限，也不声称任何结果已经发生。
 */
export function buildAgentPreActionDisclosure(
    labels: readonly string[]
): AgentPreActionDisclosure {
    const actionLabels = Array.from(new Set(
        labels
            .map((label) => String(label || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
    )).slice(0, 3);
    const actionSummary = actionLabels.length > 0
        ? actionLabels.join('、')
        : '当前必要操作';
    return {
        message: `我准备先执行${actionSummary}，完成后会读取文档或画面结果进行复核。`,
        actionLabels,
        canClaimTaskCompletion: false,
        canClaimDesignQuality: false,
        executesPhotoshop: false,
        grantsPermission: false
    };
}
