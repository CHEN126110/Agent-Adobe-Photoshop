export const BUSINESS_DESIGN_SKILL_IDS = [
  'main-image-design',
  'detail-page-design',
  'sku-batch'
] as const;

export type BusinessDesignSkillId = typeof BUSINESS_DESIGN_SKILL_IDS[number];

export type BusinessSkillIntendedChange = 'infra-only' | 'business-strategy';

export type BusinessSkillImplementationCheckpointStatus =
  | 'blocked_needs_user_checkpoint'
  | 'ready_for_infra_only'
  | 'ready_for_business_strategy';

export type BusinessSkillImplementationEvidenceKey =
  | 'designStandards'
  | 'knowledgeRecipeSource'
  | 'visualEvidencePlan'
  | 'photoshopToolPlan'
  | 'qaAcceptancePlan'
  | 'performanceBudget';

export interface BusinessSkillImplementationEvidence {
  designStandards?: boolean;
  knowledgeRecipeSource?: boolean;
  visualEvidencePlan?: boolean;
  photoshopToolPlan?: boolean;
  qaAcceptancePlan?: boolean;
  performanceBudget?: boolean;
  fexBenchmarkOnly?: boolean;
  toolOnlyPanelFeature?: boolean;
  [key: string]: unknown;
}

export interface BuildBusinessSkillImplementationCheckpointInput {
  skillId: BusinessDesignSkillId;
  intendedChange?: BusinessSkillIntendedChange;
  userCheckpointConfirmed?: boolean;
  evidence?: BusinessSkillImplementationEvidence;
}

export interface BusinessSkillImplementationCheckpoint {
  version: 'business-skill-implementation-checkpoint/v0';
  skillId: BusinessDesignSkillId;
  intendedChange: BusinessSkillIntendedChange;
  status: BusinessSkillImplementationCheckpointStatus;
  canChangeBusinessStrategy: boolean;
  userCheckpointConfirmed: boolean;
  requiredInputs: BusinessSkillImplementationEvidenceKey[];
  missingEvidence: BusinessSkillImplementationEvidenceKey[];
  evidenceKeys: string[];
  requiredCapabilities: string[];
  requiredQaEvidence: string[];
  blockers: string[];
  warnings: string[];
  boundaries: string[];
}

export const BUSINESS_SKILL_IMPLEMENTATION_REQUIRED_INPUTS: BusinessSkillImplementationEvidenceKey[] = [
  'designStandards',
  'knowledgeRecipeSource',
  'visualEvidencePlan',
  'photoshopToolPlan',
  'qaAcceptancePlan',
  'performanceBudget'
];

const BUSINESS_SKILL_REQUIRED_CAPABILITIES = [
  'business_skill_design_governance',
  'visual_evidence_before_design',
  'design_knowledge_or_recipe_source',
  'design_dsl_execution_plan',
  'photoshop_tool_capability_map',
  'verification_report',
  'performance_budget'
];

const BUSINESS_SKILL_REQUIRED_QA_EVIDENCE = [
  'photoshop_output_acceptance',
  'screenshot_or_snapshot_evidence',
  'manual_review_when_quality_claimed',
  'no_synthetic_or_fex_quality_claim'
];

const BUSINESS_SKILL_BOUNDARIES = [
  'This checkpoint does not change Photoshop write order.',
  'This checkpoint does not prove main-image, detail-page, or SKU design quality.',
  'FEX and synthetic benchmarks are regression fixtures, not business strategy evidence.',
  'UXP panel-only tools are not Agent business skill strategy evidence.'
];

export function buildBusinessSkillImplementationCheckpoint(
  input: BuildBusinessSkillImplementationCheckpointInput
): BusinessSkillImplementationCheckpoint {
  const intendedChange = input.intendedChange || 'business-strategy';
  const userCheckpointConfirmed = input.userCheckpointConfirmed === true;
  const evidence = input.evidence || {};
  const missingEvidence = BUSINESS_SKILL_IMPLEMENTATION_REQUIRED_INPUTS.filter((key) => evidence[key] !== true);
  const evidenceKeys = Object.keys(evidence)
    .filter((key) => evidence[key] === true)
    .sort();
  const blockers = buildBlockers(intendedChange, userCheckpointConfirmed, missingEvidence);
  const warnings = buildWarnings(evidence);
  const status = buildStatus(intendedChange, blockers, missingEvidence);

  return {
    version: 'business-skill-implementation-checkpoint/v0',
    skillId: input.skillId,
    intendedChange,
    status,
    canChangeBusinessStrategy: status === 'ready_for_business_strategy',
    userCheckpointConfirmed,
    requiredInputs: [...BUSINESS_SKILL_IMPLEMENTATION_REQUIRED_INPUTS],
    missingEvidence,
    evidenceKeys,
    requiredCapabilities: [...BUSINESS_SKILL_REQUIRED_CAPABILITIES],
    requiredQaEvidence: [...BUSINESS_SKILL_REQUIRED_QA_EVIDENCE],
    blockers,
    warnings,
    boundaries: [...BUSINESS_SKILL_BOUNDARIES]
  };
}

function buildBlockers(
  intendedChange: BusinessSkillIntendedChange,
  userCheckpointConfirmed: boolean,
  missingEvidence: BusinessSkillImplementationEvidenceKey[]
): string[] {
  if (intendedChange === 'infra-only') {
    return [];
  }

  const blockers: string[] = [];
  if (!userCheckpointConfirmed) {
    blockers.push('user_checkpoint_required');
  }

  if (missingEvidence.length > 0) {
    blockers.push('required_business_skill_evidence_missing');
  }

  return blockers;
}

function buildWarnings(evidence: BusinessSkillImplementationEvidence): string[] {
  const warnings: string[] = [];

  if (evidence.fexBenchmarkOnly === true) {
    warnings.push('fex_benchmark_is_not_business_strategy_evidence');
  }

  if (evidence.toolOnlyPanelFeature === true) {
    warnings.push('tool_only_panel_feature_is_not_agent_skill_strategy_evidence');
  }

  return warnings;
}

function buildStatus(
  intendedChange: BusinessSkillIntendedChange,
  blockers: string[],
  missingEvidence: BusinessSkillImplementationEvidenceKey[]
): BusinessSkillImplementationCheckpointStatus {
  if (intendedChange === 'infra-only') {
    return 'ready_for_infra_only';
  }

  if (blockers.length === 0 && missingEvidence.length === 0) {
    return 'ready_for_business_strategy';
  }

  return 'blocked_needs_user_checkpoint';
}
