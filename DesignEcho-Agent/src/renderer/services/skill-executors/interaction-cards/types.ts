import type {
    InteractiveCardDefinition,
    InteractiveCardSubmission
} from '../../../../shared/interactive-card-contract';

export type SkillInteractiveCardSubmissionPreparation =
    | {
        status: 'unsupported';
    }
    | {
        status: 'invalid';
        message: string;
    }
    | {
        status: 'ready';
        submission: InteractiveCardSubmission;
        confirmationText: string;
        memorySavedText: string;
        memoryFailurePrefix: string;
        resumePolicy: 'required';
    };

export type SkillInteractiveReviewPreparation =
    | {
        status: 'unsupported';
    }
    | {
        status: 'invalid';
        message: string;
    }
    | {
        status: 'ready';
        submission: InteractiveCardSubmission;
        reviewLabel: string;
        persist(): {
            summary: string;
        };
    };

/**
 * 业务卡片属于 Skill package。通用 UI 只向注册表提交 card/value，
 * 不认识 SKU、主图或详情页字段，也不能自行构造业务续跑参数。
 */
export interface SkillInteractiveCardProvider {
    /** 领域语义 owner；通用 UI 不据此选择 Skill，只用于注册审计和追责。 */
    ownerSkillId: string;
    kind: string;
    payloadVersion: string;
    submitAction?: string;
    legacySubmitActions?: readonly string[];
    prepareSubmission?(
        card: InteractiveCardDefinition,
        value: unknown
    ): SkillInteractiveCardSubmissionPreparation;
    prepareRecordedReview?(
        card: InteractiveCardDefinition,
        value: unknown
    ): SkillInteractiveReviewPreparation;
}
