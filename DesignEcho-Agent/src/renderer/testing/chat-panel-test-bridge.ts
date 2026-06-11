import type {
    AgentAcceptanceCase,
} from '../../shared/agent-acceptance-contracts';
import type { AgentAcceptanceDebugExport } from '../../shared/agent-acceptance-export';

export type ChatSendOverride = {
    text?: string;
    image?: { data: string; type: string } | null;
    publicPlanConfirmationSourceMessageId?: string;
};

export type ChatPanelAcceptanceDebugResult = AgentAcceptanceDebugExport;

export type ChatPanelTestSnapshot = {
    isLoading: boolean;
    messageCount: number;
    messages: Array<{
        id: string;
        role: string;
        contentPreview: string;
        hasImage: boolean;
        thinkingStepCount: number;
        thinkingPreview: string;
        thinkingBlockTitles: string[];
        cardTitles: string[];
        cardVariants: string[];
        businessPreflightCardTitles: string[];
        businessPreflightCardCount: number;
        hasBusinessVisualEvidenceFeedback: boolean;
        hasPublicPlanExecutionRequest: boolean;
        publicPlanRequestStatus?: string;
        publicPlanApprovalStatus?: string;
        hasPublicPlanControlledRun: boolean;
        publicPlanControlledRunStatus?: string;
        toolResultCount: number;
        executionStatus?: string;
        executionSummaryPreview?: string;
    }>;
};

export type ChatPanelTestBridge = {
    version: number;
    submit: (
        text: string,
        options?: {
            image?: { data: string; type: string };
            timeoutMs?: number;
            publicPlanConfirmationSourceMessageId?: string;
        }
    ) => Promise<ChatPanelTestSnapshot>;
    getSnapshot: () => ChatPanelTestSnapshot;
    waitForIdle: (timeoutMs?: number) => Promise<ChatPanelTestSnapshot>;
    getLatestAcceptanceDebug: (
        acceptanceCase: AgentAcceptanceCase,
        options?: { messageId?: string }
    ) => ChatPanelAcceptanceDebugResult;
};

const CHAT_TEST_BRIDGE_KEY = '__DESIGNECHO_CHAT_TEST_BRIDGE__';

export function isChatPanelTestBridgeEnabled(search = window.location.search || ''): boolean {
    try {
        return new URLSearchParams(search).get('designechoChatTestBridge') === '1';
    } catch {
        return false;
    }
}

export function installChatPanelTestBridge(bridge: ChatPanelTestBridge): () => void {
    if (!isChatPanelTestBridgeEnabled()) {
        delete (window as any)[CHAT_TEST_BRIDGE_KEY];
        return () => {
            delete (window as any)[CHAT_TEST_BRIDGE_KEY];
        };
    }

    (window as any)[CHAT_TEST_BRIDGE_KEY] = bridge;
    return () => {
        const current = (window as any)[CHAT_TEST_BRIDGE_KEY];
        if (current?.version === bridge.version) {
            delete (window as any)[CHAT_TEST_BRIDGE_KEY];
        }
    };
}
