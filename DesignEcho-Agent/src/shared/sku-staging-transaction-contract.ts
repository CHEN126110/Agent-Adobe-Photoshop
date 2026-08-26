export type SkuStagingTransactionPhase =
    | 'issued'
    | 'promoting'
    | 'committed'
    | 'rolled_back'
    | 'recovery_required'
    | 'root_cleaned';

export interface SkuStagingTransactionLease {
    transactionToken: string;
    transactionId: string;
    stagingRoot: string;
    stagingParent: string;
    destinationRoot: string;
    phase: SkuStagingTransactionPhase;
}

export interface SkuStagingTransactionResult {
    success: boolean;
    transactionToken?: string;
    transactionId?: string;
    stagingRoot?: string;
    stagingParent?: string;
    outputDir?: string;
    recoveryPath?: string;
    removed?: boolean;
    reason?: 'missing' | 'not_empty';
    code?: string;
    error?: string;
}

export interface SkuStagingDestinationBaseline {
    path: string;
    exists: boolean;
    modifiedTimeMs?: number;
    byteLength?: number;
    sha256?: string;
}

export interface CaptureSkuStagingDestinationBaselinesInput {
    transactionToken: string;
    destinationPaths: string[];
}

export interface CaptureSkuStagingDestinationBaselinesResult {
    success: boolean;
    baselines?: SkuStagingDestinationBaseline[];
    error?: string;
}

export interface StagedFilePromotionItem {
    sourcePath: string;
    destinationPath: string;
    expectedDestinationBaseline: Omit<SkuStagingDestinationBaseline, 'path'>;
}

export interface StagedFilePromotionInput {
    transactionToken: string;
    items: StagedFilePromotionItem[];
}

export interface StagedFilePromotionResult {
    success: boolean;
    committedPaths: string[];
    replacedPaths: string[];
    rollbackComplete: boolean;
    cleanupWarnings: string[];
    error?: string;
    code?:
        | 'destination_changed_since_baseline'
        | 'promotion_failed'
        | 'transaction_recovery_required';
    rollbackErrors?: string[];
    recoveryPath?: string;
}
