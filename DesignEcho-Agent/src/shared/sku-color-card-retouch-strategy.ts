export type SkuColorCardRetouchStrategyStatus = 'ready_for_strategy_review' | 'needs_current_context';

export interface SkuColorCardRetouchStrategy {
  version: 'sku-color-card-retouch-strategy/v0';
  status: SkuColorCardRetouchStrategyStatus;
  summary: {
    colorCount: number;
    comboSizes: number[];
    requestedByUser: boolean;
    sourceHintCount: number;
  };
  shapeStrategy: {
    unifiedPoseTargets: string[];
    allowedShapeAdjustments: string[];
    fidelityBoundaries: string[];
    reviewRequirements: string[];
  };
  lightStrategy: {
    goals: string[];
    methods: string[];
    textureProtection: string[];
    reviewRequirements: string[];
  };
  shadowStrategy: {
    goals: string[];
    methods: string[];
    whiteFieldPolicy: string[];
    reviewRequirements: string[];
  };
  retouchSequence: Array<{
    id: string;
    title: string;
    purpose: string;
    mustReview: boolean;
  }>;
  strategyInputPatch: {
    skuColorCardRetouchStrategy: {
      shapeStrategy: SkuColorCardRetouchStrategy['shapeStrategy'];
      lightStrategy: SkuColorCardRetouchStrategy['lightStrategy'];
      shadowStrategy: SkuColorCardRetouchStrategy['shadowStrategy'];
      retouchSequence: SkuColorCardRetouchStrategy['retouchSequence'];
      reviewRequirements: string[];
      boundary: string;
    };
  };
  reviewRequirements: string[];
  blockers: string[];
  warnings: string[];
  limitations: string[];
  canClaimOutputQuality: false;
  canClaimDesignComplete: false;
  noPhotoshopWrites: true;
  mustNotExecutePhotoshop: true;
  mustNotChangeExecutionParams: true;
}

export interface BuildSkuColorCardRetouchStrategyInput {
  userText?: string;
  colorCount?: number;
  comboSizes?: number[];
  sourceHints?: unknown[];
}

const FORBIDDEN_PATTERNS: Array<[RegExp, string]> = [
  [/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[redacted-image-payload]'],
  [/data:image\//gi, '[redacted-image-payload]'],
  [/raw-image-payload|base64-image-payload/gi, '[redacted-image-payload]'],
  [/[A-Z]:[\\/][^\s"'`，。；;,)）\]}]+/g, '[local-path-redacted]']
];

function cleanText(value: unknown): string {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  for (const [pattern, replacement] of FORBIDDEN_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, replacement);
  }
  return text.trim();
}

function unique(values: unknown[]): string[] {
  return Array.from(new Set(values.map(cleanText).filter(Boolean)));
}

function normalizePositiveInteger(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.round(numeric);
}

function normalizeSizes(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values
    .map((value) => normalizePositiveInteger(value, 0))
    .filter((value) => value > 0 && value <= 50)))
    .sort((a, b) => a - b);
}

function userRequestsRetouchStrategy(userText: string): boolean {
  return /色卡|精修|形态|光影|阴影|白场|正片叠底|罗口|袜口|统一|自然/.test(userText);
}

function buildShapeStrategy(): SkuColorCardRetouchStrategy['shapeStrategy'] {
  return {
    unifiedPoseTargets: [
      'uniform_subject_height',
      'common_transparent_canvas',
      'centered_subject_on_canvas'
    ],
    allowedShapeAdjustments: [
      'proportional_scale_to_reference_height',
      'transparent_canvas_centering',
      'mask_edge_cleanup_without_changing_product_identity'
    ],
    fidelityBoundaries: [
      'preserve_original_aspect_ratio',
      'do_not_warp_product_shape',
      'preserve_special_cuff_and_knit_structure',
      'do_not_hide_real_style_differences_between_colors'
    ],
    reviewRequirements: [
      'uniform_subject_height_review_required',
      'aspect_ratio_preservation_review_required',
      'complete_subject_crop_review_required',
      'product_identity_preservation_required'
    ]
  };
}

function buildLightStrategy(): SkuColorCardRetouchStrategy['lightStrategy'] {
  return {
    goals: [],
    methods: [],
    textureProtection: [
      'preserve_knit_texture_detail',
      'preserve_original_product_tone'
    ],
    reviewRequirements: []
  };
}

function buildShadowStrategy(): SkuColorCardRetouchStrategy['shadowStrategy'] {
  return {
    goals: [],
    methods: [],
    whiteFieldPolicy: [],
    reviewRequirements: []
  };
}

function buildRetouchSequence(): SkuColorCardRetouchStrategy['retouchSequence'] {
  return [
    {
      id: 'source_selection',
      title: '选择项目内单色 SKU 源图',
      purpose: '优先使用当前项目 PSD/PSB 或单色导出源，避免误用已打开的其他项目文档。',
      mustReview: true
    },
    {
      id: 'scale_reference',
      title: '建立主体尺度参考',
      purpose: '从同批适用纯底素材中选择参考主体高度；它只提供尺度，不改写任何颜色的真实版型。',
      mustReview: true
    },
    {
      id: 'uniform_scale',
      title: '透明主体等比统一尺度',
      purpose: '抠出完整主体，保持原始宽高比缩放到参考高度，并居中放入同尺寸透明画布。',
      mustReview: true
    },
    {
      id: 'layout_acceptance',
      title: '色卡排版验收',
      purpose: '检查编号、色名、间距、基线、导出尺寸和人工复核记录。',
      mustReview: true
    }
  ];
}

function buildReviewRequirements(): string[] {
  return [
    'uniform_subject_height_review_required',
    'aspect_ratio_preservation_review_required',
    'complete_subject_crop_review_required',
    'knit_texture_detail_review_required',
    'result_screenshot_or_manual_review_required',
    'export_readback_required'
  ];
}

export function buildSkuColorCardRetouchStrategy(
  input: BuildSkuColorCardRetouchStrategyInput = {}
): SkuColorCardRetouchStrategy {
  const userText = cleanText(input.userText);
  const colorCount = normalizePositiveInteger(input.colorCount, 0);
  const comboSizes = normalizeSizes(input.comboSizes);
  const sourceHints = unique(input.sourceHints || []);
  const requestedByUser = userRequestsRetouchStrategy(userText);
  const shapeStrategy = buildShapeStrategy();
  const lightStrategy = buildLightStrategy();
  const shadowStrategy = buildShadowStrategy();
  const retouchSequence = buildRetouchSequence();
  const reviewRequirements = buildReviewRequirements();
  const boundary = 'SKU 色卡当前只规划透明主体等比统一尺度与排版复核；不包含形态变形、阴影分离或光影修正，也不直接取得 Photoshop 权限或质量完成权。';
  const warnings = unique([
    sourceHints.length === 0 ? '未提供可复核的 SKU 源图提示，执行前仍需从项目文件确认单色源图。' : '',
    !requestedByUser ? '用户未明确要求纯底统一尺度处理时，该策略只能作为候选质量边界，不应扩大执行范围。' : '',
    colorCount <= 0 ? '未获得颜色数量，色卡间距和统一性仍需执行前补充。' : ''
  ]);

  return {
    version: 'sku-color-card-retouch-strategy/v0',
    status: 'ready_for_strategy_review',
    summary: {
      colorCount,
      comboSizes,
      requestedByUser,
      sourceHintCount: sourceHints.length
    },
    shapeStrategy,
    lightStrategy,
    shadowStrategy,
    retouchSequence,
    strategyInputPatch: {
      skuColorCardRetouchStrategy: {
        shapeStrategy,
        lightStrategy,
        shadowStrategy,
        retouchSequence,
        reviewRequirements,
        boundary
      }
    },
    reviewRequirements,
    blockers: [],
    warnings,
    limitations: [
      '该策略不直接执行 Photoshop，也不生成或修改图层。',
      '该策略不改变 SKU 组合、自选备注、项目 CSV、模板选择或 skuLayout 参数。',
      '统一尺度必须保持原始宽高比与特殊罗口/花边结构，不能为追求整齐而改变版型。',
      '阴影、投影分离与光影修正属于后续工序；当前策略不会生成、检查或宣称这些结果。'
    ],
    canClaimOutputQuality: false,
    canClaimDesignComplete: false,
    noPhotoshopWrites: true,
    mustNotExecutePhotoshop: true,
    mustNotChangeExecutionParams: true
  };
}
