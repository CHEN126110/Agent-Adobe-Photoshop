import type { ModelReasoningEffort } from './config/models.config';

const REASONING_EFFORT_ORDER: readonly ModelReasoningEffort[] = [
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'ultra'
];

/**
 * 把任务请求的推理偏好投影到 Provider 真实声明的档位。请求档位不受支持时选择
 * 距离最近的真实档位；距离相同时优先较高质量。Provider 没有披露能力时保留其
 * 默认值，不伪造支持。
 */
export function resolveModelReasoningEffort(input: {
    supportedEfforts?: readonly string[];
    defaultEffort?: string;
    requestedEffort?: ModelReasoningEffort;
}): string {
    const supported = new Set(
        (input.supportedEfforts || []).map((effort) => String(effort || '').trim()).filter(Boolean)
    );
    if (input.requestedEffort && supported.has(input.requestedEffort)) {
        return input.requestedEffort;
    }
    if (input.requestedEffort && supported.size > 0) {
        const requestedIndex = REASONING_EFFORT_ORDER.indexOf(input.requestedEffort);
        const nearest = REASONING_EFFORT_ORDER
            .filter((effort) => supported.has(effort))
            .sort((left, right) => {
                const leftDistance = Math.abs(REASONING_EFFORT_ORDER.indexOf(left) - requestedIndex);
                const rightDistance = Math.abs(REASONING_EFFORT_ORDER.indexOf(right) - requestedIndex);
                if (leftDistance !== rightDistance) return leftDistance - rightDistance;
                return REASONING_EFFORT_ORDER.indexOf(right)
                    - REASONING_EFFORT_ORDER.indexOf(left);
            })[0];
        if (nearest) return nearest;
    }
    const defaultEffort = String(input.defaultEffort || '').trim();
    if (defaultEffort && (supported.size === 0 || supported.has(defaultEffort))) {
        return defaultEffort;
    }
    if (supported.has('medium')) return 'medium';
    return Array.from(supported)[0] || 'medium';
}
