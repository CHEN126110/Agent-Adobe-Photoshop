export const SKU_COLOR_CARD_DESIGN_SPEC_VERSION = 'sku-color-card-design-spec/v1' as const;

export type SkuColorCardSubjectAnchor =
    | 'center'
    | 'top-center'
    | 'bottom-center'
    | 'left-center'
    | 'right-center';

export type SkuColorCardCanvasBackground = 'white' | 'black' | 'transparent';
export type SkuColorCardPresentationMode = 'flat' | 'card';
export type SkuColorCardGridAlignment = 'start' | 'center' | 'end';
export type SkuColorCardTextAlignment = 'left' | 'center' | 'right';

export interface SkuColorCardLabelTypography {
    fontName: string;
    tracking: number;
    leadingToFontSizeRatio: number;
    alignment: SkuColorCardTextAlignment;
    horizontalPaddingRatio: number;
    verticalPaddingRatio: number;
}

export interface SkuColorCardIndexStyle {
    colorHex: string;
    fontName: string;
    tracking: number;
    leadingToFontSizeRatio: number;
    fontSizeToCardWidthRatio: number;
    xRatio: number;
    yRatio: number;
    alignment: SkuColorCardTextAlignment;
}

export interface SkuColorCardDesignSpec {
    version: typeof SKU_COLOR_CARD_DESIGN_SPEC_VERSION;
    provenance: 'agent_authored' | 'explicit_legacy_profile';
    /** 正常 full 缺源路径中由 Agent 选择的候选 assetId 顺序；直接传 sources 时可省略。 */
    sourceAssetIds?: string[];
    presentationMode: SkuColorCardPresentationMode;
    canvasWidth: number;
    canvasHeight: number;
    canvasBackground: SkuColorCardCanvasBackground;
    cardWidth: number;
    cardHeight: number;
    cardCornerRadius: number;
    columns: number;
    columnGap: number;
    rowGap: number;
    gridAlignment: {
        horizontal: SkuColorCardGridAlignment;
        vertical: SkuColorCardGridAlignment;
        lastRow: SkuColorCardGridAlignment;
    };
    showIndexNumbers: boolean;
    cardFillColorHex: string;
    labelFillColorHex: string;
    labelTextColorHex: string;
    internalLabel: {
        xRatio: number;
        yRatio: number;
        widthRatio: number;
        heightRatio: number;
        cornerRadiusToWidthRatio: number;
        fontSizeToHeightRatio: number;
    };
    labelTypography: SkuColorCardLabelTypography;
    indexStyle?: SkuColorCardIndexStyle;
    imagePlacement: {
        subjectFillRatio: number;
        anchor: SkuColorCardSubjectAnchor;
    };
}

export interface SkuColorCardDesignSpecResolution {
    status: 'resolved' | 'blocked_missing_design_spec' | 'blocked_invalid_design_spec';
    spec?: SkuColorCardDesignSpec;
    blockers: string[];
}

const LEGACY_PROFILE = Object.freeze<SkuColorCardDesignSpec>({
    version: SKU_COLOR_CARD_DESIGN_SPEC_VERSION,
    provenance: 'explicit_legacy_profile',
    presentationMode: 'card',
    canvasWidth: 1500,
    canvasHeight: 1500,
    canvasBackground: 'white',
    cardWidth: 250,
    cardHeight: 380,
    cardCornerRadius: 10,
    columns: 5,
    columnGap: 40,
    rowGap: 170,
    gridAlignment: {
        horizontal: 'center',
        vertical: 'center',
        lastRow: 'start'
    },
    showIndexNumbers: true,
    cardFillColorHex: '#000000',
    labelFillColorHex: '#FFFFFF',
    labelTextColorHex: '#111111',
    internalLabel: {
        xRatio: 448 / 800,
        yRatio: 32 / 1216,
        widthRatio: 320 / 800,
        heightRatio: 115.2 / 1216,
        cornerRadiusToWidthRatio: 32 / 800,
        fontSizeToHeightRatio: 0.56
    },
    labelTypography: {
        // 手工面板的 legacy Profile 保留旧 Photoshop 默认字体行为；
        // 正常 Agent 路径不允许空字体。
        fontName: '',
        tracking: 0,
        leadingToFontSizeRatio: 1.2,
        alignment: 'left',
        horizontalPaddingRatio: 0.08,
        verticalPaddingRatio: 0.12
    },
    indexStyle: {
        colorHex: '#111111',
        fontName: '',
        tracking: 0,
        leadingToFontSizeRatio: 1.2,
        fontSizeToCardWidthRatio: 0.38,
        xRatio: 0.5,
        yRatio: -126 / 380,
        alignment: 'center'
    },
    imagePlacement: {
        subjectFillRatio: 0.9,
        anchor: 'center'
    }
});

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readFiniteNumber(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
}

function isHexColor(value: unknown): value is string {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim());
}

function isSubjectAnchor(value: unknown): value is SkuColorCardSubjectAnchor {
    return value === 'center'
        || value === 'top-center'
        || value === 'bottom-center'
        || value === 'left-center'
        || value === 'right-center';
}

function isCanvasBackground(value: unknown): value is SkuColorCardCanvasBackground {
    return value === 'white' || value === 'black' || value === 'transparent';
}

function isPresentationMode(value: unknown): value is SkuColorCardPresentationMode {
    return value === 'flat' || value === 'card';
}

function isGridAlignment(value: unknown): value is SkuColorCardGridAlignment {
    return value === 'start' || value === 'center' || value === 'end';
}

function isTextAlignment(value: unknown): value is SkuColorCardTextAlignment {
    return value === 'left' || value === 'center' || value === 'right';
}

function inRange(value: number | undefined, minimum: number, maximum: number): value is number {
    return value !== undefined && value >= minimum && value <= maximum;
}

function resolveAgentAuthoredSpec(value: Record<string, unknown>): SkuColorCardDesignSpecResolution {
    const internalLabel = isRecord(value.internalLabel) ? value.internalLabel : {};
    const gridAlignment = isRecord(value.gridAlignment) ? value.gridAlignment : {};
    const labelTypography = isRecord(value.labelTypography) ? value.labelTypography : {};
    const indexStyle = isRecord(value.indexStyle) ? value.indexStyle : {};
    const imagePlacement = isRecord(value.imagePlacement) ? value.imagePlacement : {};
    const canvasWidth = readFiniteNumber(value.canvasWidth);
    const canvasHeight = readFiniteNumber(value.canvasHeight);
    const cardWidth = readFiniteNumber(value.cardWidth);
    const cardHeight = readFiniteNumber(value.cardHeight);
    const cardCornerRadius = readFiniteNumber(value.cardCornerRadius);
    const columns = readFiniteNumber(value.columns);
    const columnGap = readFiniteNumber(value.columnGap);
    const rowGap = readFiniteNumber(value.rowGap);
    const xRatio = readFiniteNumber(internalLabel.xRatio);
    const yRatio = readFiniteNumber(internalLabel.yRatio);
    const widthRatio = readFiniteNumber(internalLabel.widthRatio);
    const heightRatio = readFiniteNumber(internalLabel.heightRatio);
    const cornerRadiusToWidthRatio = readFiniteNumber(internalLabel.cornerRadiusToWidthRatio);
    const fontSizeToHeightRatio = readFiniteNumber(internalLabel.fontSizeToHeightRatio);
    const labelTracking = readFiniteNumber(labelTypography.tracking);
    const labelLeadingRatio = readFiniteNumber(labelTypography.leadingToFontSizeRatio);
    const labelHorizontalPaddingRatio = readFiniteNumber(labelTypography.horizontalPaddingRatio);
    const labelVerticalPaddingRatio = readFiniteNumber(labelTypography.verticalPaddingRatio);
    const indexTracking = readFiniteNumber(indexStyle.tracking);
    const indexLeadingRatio = readFiniteNumber(indexStyle.leadingToFontSizeRatio);
    const indexFontSizeRatio = readFiniteNumber(indexStyle.fontSizeToCardWidthRatio);
    const indexXRatio = readFiniteNumber(indexStyle.xRatio);
    const indexYRatio = readFiniteNumber(indexStyle.yRatio);
    const subjectFillRatio = readFiniteNumber(imagePlacement.subjectFillRatio);
    const sourceAssetIds = Array.isArray(value.sourceAssetIds)
        ? value.sourceAssetIds.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    const blockers: string[] = [];

    if (!inRange(canvasWidth, 256, 10000) || !Number.isInteger(canvasWidth)) blockers.push('canvasWidth 必须是 256-10000 的整数');
    if (!inRange(canvasHeight, 256, 10000) || !Number.isInteger(canvasHeight)) blockers.push('canvasHeight 必须是 256-10000 的整数');
    if (!isCanvasBackground(value.canvasBackground)) blockers.push('canvasBackground 必须由 Agent 明确选择 white、black 或 transparent');
    if (!isPresentationMode(value.presentationMode)) blockers.push('presentationMode 必须由 Agent 明确选择 flat 或 card');
    if (!inRange(cardWidth, 32, 10000) || !Number.isInteger(cardWidth)) blockers.push('cardWidth 必须是正整数');
    if (!inRange(cardHeight, 32, 10000) || !Number.isInteger(cardHeight)) blockers.push('cardHeight 必须是正整数');
    if (!inRange(cardCornerRadius, 0, 5000) || !Number.isInteger(cardCornerRadius)) blockers.push('cardCornerRadius 必须是非负整数');
    if (!inRange(columns, 1, 10) || !Number.isInteger(columns)) blockers.push('columns 必须是 1-10 的整数');
    if (!inRange(columnGap, 0, 10000) || !Number.isInteger(columnGap)) blockers.push('columnGap 必须是非负整数');
    if (!inRange(rowGap, 0, 10000) || !Number.isInteger(rowGap)) blockers.push('rowGap 必须是非负整数');
    if (!isGridAlignment(gridAlignment.horizontal)) blockers.push('gridAlignment.horizontal 必须是 start、center 或 end');
    if (!isGridAlignment(gridAlignment.vertical)) blockers.push('gridAlignment.vertical 必须是 start、center 或 end');
    if (!isGridAlignment(gridAlignment.lastRow)) blockers.push('gridAlignment.lastRow 必须是 start、center 或 end');
    if (typeof value.showIndexNumbers !== 'boolean') blockers.push('showIndexNumbers 必须由 Agent 明确声明');
    if (!isHexColor(value.cardFillColorHex)) blockers.push('cardFillColorHex 必须是 6 位十六进制颜色');
    if (!isHexColor(value.labelFillColorHex)) blockers.push('labelFillColorHex 必须是 6 位十六进制颜色');
    if (!isHexColor(value.labelTextColorHex)) blockers.push('labelTextColorHex 必须是 6 位十六进制颜色');
    if (!inRange(xRatio, 0, 1)) blockers.push('internalLabel.xRatio 必须在 0-1');
    if (!inRange(yRatio, 0, 1)) blockers.push('internalLabel.yRatio 必须在 0-1');
    if (!inRange(widthRatio, 0.05, 1)) blockers.push('internalLabel.widthRatio 必须在 0.05-1');
    if (!inRange(heightRatio, 0.03, 1)) blockers.push('internalLabel.heightRatio 必须在 0.03-1');
    if (xRatio !== undefined && widthRatio !== undefined && xRatio + widthRatio > 1) {
        blockers.push('internalLabel 横向范围超出卡片');
    }
    if (yRatio !== undefined && heightRatio !== undefined && yRatio + heightRatio > 1) {
        blockers.push('internalLabel 纵向范围超出卡片');
    }
    if (!inRange(cornerRadiusToWidthRatio, 0, 0.5)) blockers.push('internalLabel.cornerRadiusToWidthRatio 必须在 0-0.5');
    if (!inRange(fontSizeToHeightRatio, 0.1, 1)) blockers.push('internalLabel.fontSizeToHeightRatio 必须在 0.1-1');
    if (typeof labelTypography.fontName !== 'string' || !labelTypography.fontName.trim()) blockers.push('labelTypography.fontName 必须由 Agent 明确声明');
    if (!inRange(labelTracking, -1000, 10000)) blockers.push('labelTypography.tracking 必须在 -1000 至 10000');
    if (!inRange(labelLeadingRatio, 0.5, 5)) blockers.push('labelTypography.leadingToFontSizeRatio 必须在 0.5-5');
    if (!isTextAlignment(labelTypography.alignment)) blockers.push('labelTypography.alignment 必须是 left、center 或 right');
    if (!inRange(labelHorizontalPaddingRatio, 0, 0.45)) blockers.push('labelTypography.horizontalPaddingRatio 必须在 0-0.45');
    if (!inRange(labelVerticalPaddingRatio, 0, 0.45)) blockers.push('labelTypography.verticalPaddingRatio 必须在 0-0.45');
    if (value.showIndexNumbers === true) {
        if (!isHexColor(indexStyle.colorHex)) blockers.push('indexStyle.colorHex 必须是 6 位十六进制颜色');
        if (typeof indexStyle.fontName !== 'string' || !indexStyle.fontName.trim()) blockers.push('indexStyle.fontName 必须由 Agent 明确声明');
        if (!inRange(indexTracking, -1000, 10000)) blockers.push('indexStyle.tracking 必须在 -1000 至 10000');
        if (!inRange(indexLeadingRatio, 0.5, 5)) blockers.push('indexStyle.leadingToFontSizeRatio 必须在 0.5-5');
        if (!inRange(indexFontSizeRatio, 0.02, 1)) blockers.push('indexStyle.fontSizeToCardWidthRatio 必须在 0.02-1');
        if (!inRange(indexXRatio, -1, 2)) blockers.push('indexStyle.xRatio 必须在 -1 至 2');
        if (!inRange(indexYRatio, -1, 2)) blockers.push('indexStyle.yRatio 必须在 -1 至 2');
        if (!isTextAlignment(indexStyle.alignment)) blockers.push('indexStyle.alignment 必须是 left、center 或 right');
    }
    if (!inRange(subjectFillRatio, 0.1, 1)) blockers.push('imagePlacement.subjectFillRatio 必须在 0.1-1');
    if (!isSubjectAnchor(imagePlacement.anchor)) blockers.push('imagePlacement.anchor 必须是受支持的显式锚点');
    if (sourceAssetIds.length !== new Set(sourceAssetIds).size) blockers.push('sourceAssetIds 不能重复');
    if (canvasWidth !== undefined && cardWidth !== undefined && cardWidth > canvasWidth) blockers.push('cardWidth 不能大于 canvasWidth');
    if (canvasHeight !== undefined && cardHeight !== undefined && cardHeight > canvasHeight) blockers.push('cardHeight 不能大于 canvasHeight');
    if (cardWidth !== undefined && cardHeight !== undefined && cardCornerRadius !== undefined
        && cardCornerRadius > Math.min(cardWidth, cardHeight) / 2) {
        blockers.push('cardCornerRadius 不能超过卡片短边的一半');
    }
    if (blockers.length > 0) {
        return { status: 'blocked_invalid_design_spec', blockers };
    }

    return {
        status: 'resolved',
        blockers: [],
        spec: {
            version: SKU_COLOR_CARD_DESIGN_SPEC_VERSION,
            provenance: 'agent_authored',
            ...(sourceAssetIds.length > 0 ? { sourceAssetIds } : {}),
            presentationMode: value.presentationMode as SkuColorCardPresentationMode,
            canvasWidth: canvasWidth as number,
            canvasHeight: canvasHeight as number,
            canvasBackground: value.canvasBackground as SkuColorCardCanvasBackground,
            cardWidth: cardWidth as number,
            cardHeight: cardHeight as number,
            cardCornerRadius: cardCornerRadius as number,
            columns: columns as number,
            columnGap: columnGap as number,
            rowGap: rowGap as number,
            gridAlignment: {
                horizontal: gridAlignment.horizontal as SkuColorCardGridAlignment,
                vertical: gridAlignment.vertical as SkuColorCardGridAlignment,
                lastRow: gridAlignment.lastRow as SkuColorCardGridAlignment
            },
            showIndexNumbers: value.showIndexNumbers as boolean,
            cardFillColorHex: String(value.cardFillColorHex).toUpperCase(),
            labelFillColorHex: String(value.labelFillColorHex).toUpperCase(),
            labelTextColorHex: String(value.labelTextColorHex).toUpperCase(),
            internalLabel: {
                xRatio: xRatio as number,
                yRatio: yRatio as number,
                widthRatio: widthRatio as number,
                heightRatio: heightRatio as number,
                cornerRadiusToWidthRatio: cornerRadiusToWidthRatio as number,
                fontSizeToHeightRatio: fontSizeToHeightRatio as number
            },
            labelTypography: {
                fontName: String(labelTypography.fontName).trim(),
                tracking: labelTracking as number,
                leadingToFontSizeRatio: labelLeadingRatio as number,
                alignment: labelTypography.alignment as SkuColorCardTextAlignment,
                horizontalPaddingRatio: labelHorizontalPaddingRatio as number,
                verticalPaddingRatio: labelVerticalPaddingRatio as number
            },
            ...(value.showIndexNumbers === true ? {
                indexStyle: {
                    colorHex: String(indexStyle.colorHex).toUpperCase(),
                    fontName: String(indexStyle.fontName).trim(),
                    tracking: indexTracking as number,
                    leadingToFontSizeRatio: indexLeadingRatio as number,
                    fontSizeToCardWidthRatio: indexFontSizeRatio as number,
                    xRatio: indexXRatio as number,
                    yRatio: indexYRatio as number,
                    alignment: indexStyle.alignment as SkuColorCardTextAlignment
                }
            } : {}),
            imagePlacement: {
                subjectFillRatio: subjectFillRatio as number,
                anchor: imagePlacement.anchor as SkuColorCardSubjectAnchor
            }
        }
    };
}

export function resolveSkuColorCardDesignSpec(
    value: unknown,
    options: { allowExplicitLegacyProfile?: boolean } = {}
): SkuColorCardDesignSpecResolution {
    if (!isRecord(value)) {
        return {
            status: 'blocked_missing_design_spec',
            blockers: ['缺少 Agent 在首次写入前声明的 colorCardDesignSpec']
        };
    }
    if (value.provenance === 'explicit_legacy_profile') {
        if (options.allowExplicitLegacyProfile !== true) {
            return {
                status: 'blocked_invalid_design_spec',
                blockers: ['固定历史色卡 Profile 只允许用户明确选择的手动面板入口使用']
            };
        }
        const requestedColumns = readFiniteNumber(value.columns);
        const columns = requestedColumns !== undefined
            && Number.isInteger(requestedColumns)
            && requestedColumns >= 1
            && requestedColumns <= 10
            ? requestedColumns
            : LEGACY_PROFILE.columns;
        const showIndexNumbers = typeof value.showIndexNumbers === 'boolean'
            ? value.showIndexNumbers
            : LEGACY_PROFILE.showIndexNumbers;
        const presentationMode = isPresentationMode(value.presentationMode)
            ? value.presentationMode
            : LEGACY_PROFILE.presentationMode;
        return {
            status: 'resolved',
            blockers: [],
            spec: {
                ...LEGACY_PROFILE,
                presentationMode,
                columns,
                showIndexNumbers,
                gridAlignment: { ...LEGACY_PROFILE.gridAlignment },
                internalLabel: { ...LEGACY_PROFILE.internalLabel },
                labelTypography: { ...LEGACY_PROFILE.labelTypography },
                ...(showIndexNumbers && LEGACY_PROFILE.indexStyle
                    ? { indexStyle: { ...LEGACY_PROFILE.indexStyle } }
                    : { indexStyle: undefined }),
                imagePlacement: { ...LEGACY_PROFILE.imagePlacement }
            }
        };
    }
    if (value.provenance !== 'agent_authored') {
        return {
            status: 'blocked_invalid_design_spec',
            blockers: ['colorCardDesignSpec.provenance 必须是 agent_authored']
        };
    }
    return resolveAgentAuthoredSpec(value);
}
