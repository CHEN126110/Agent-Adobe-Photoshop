/**
 * 执行状态管理 Hook
 * 
 * 从 ChatPanel.tsx 抽离的执行状态相关逻辑
 */

import { useState, useCallback } from 'react';
import type { ExecutionStep } from '../components/ExecutionStatus';
import { EXECUTION_TEMPLATES } from '../components/ExecutionStatus';

export interface UseExecutionReturn {
    /** 执行步骤列表 */
    executionSteps: ExecutionStep[];
    /** 是否显示执行状态 */
    showExecution: boolean;
    /** 设置显示状态 */
    setShowExecution: (show: boolean) => void;
    /** 开始执行 */
    startExecution: (templateName: keyof typeof EXECUTION_TEMPLATES) => void;
    /** 更新步骤状态 */
    updateStep: (stepId: string, status: ExecutionStep['status'], detail?: string) => void;
    /** 完成执行 */
    finishExecution: (delay?: number) => void;
}

/**
 * 执行状态管理
 */
export function useExecution(): UseExecutionReturn {
    const [executionSteps, setExecutionSteps] = useState<ExecutionStep[]>([]);
    const [showExecution, setShowExecution] = useState(false);

    const startExecution = useCallback((templateName: keyof typeof EXECUTION_TEMPLATES) => {
        const template = EXECUTION_TEMPLATES[templateName];
        setExecutionSteps(template.map((s: any) => ({ ...s })));
        setShowExecution(true);
    }, []);

    const updateStep = useCallback((stepId: string, status: ExecutionStep['status'], detail?: string) => {
        setExecutionSteps(prev => prev.map(step => 
            step.id === stepId ? { ...step, status, detail: detail || step.detail } : step
        ));
    }, []);

    const finishExecution = useCallback((delay: number = 1500) => {
        setTimeout(() => {
            setShowExecution(false);
            setExecutionSteps([]);
        }, delay);
    }, []);

    return {
        executionSteps,
        showExecution,
        setShowExecution,
        startExecution,
        updateStep,
        finishExecution
    };
}
