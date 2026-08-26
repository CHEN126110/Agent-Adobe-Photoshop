/**
 * 近期成稿指纹（recent designs）——「别每次都一样」的证据层。
 *
 * 用户 2026-08-19：Agent 在车间做出来的东西每次大同小异、没有自己的想法。
 * 模型每次开工都是一张白纸，它不知道自己上一稿做了什么，也没人告诉它「又是这套」。
 * 这里不替它做判断，只把事实摆出来：
 *   - 出稿时记一枚指纹（Agent 声明的版面签名 / 底色 / 标题 / 照片 / 处理方式 / 角度）；
 *   - 开工时把同项目最近几稿的指纹念给模型听（要变化，或说得出为什么必须一样）；
 *   - 评审时把「与近期稿雷同」的具体点交给评审器计入原创性。
 *
 * 纯逻辑，无 IO；落盘在项目 .designecho/recent-designs.json（人可读可删）。
 */

export interface DesignFingerprint {
    version: 'design-fingerprint/v1';
    at: number;
    /** 交付物 / 文档名 */
    documentName: string;
    /** 一句话角度（视觉锤），模型自己写的 */
    angle?: string;
    /** Agent 根据本稿 regions / blocks 生成的版面签名。 */
    layoutSignature?: string;
    /** Photoshop 文档身份；缺失只表示旧记录，不允许据此猜成同文档修订。 */
    documentId?: number;
    /**
     * Agent 本稿实际声明并交给渲染器的元素摘要。
     * 只记录角色、语义名称与内容类型，用于比较候选变化；不评价元素多寡好坏。
     */
    regions?: DesignFingerprintRegion[];
    /** @deprecated 只读兼容 2026-08-21 之前的近期稿记录。新记录不得再写。 */
    recipeId?: string;
    /** 摄影满幅 photo / 抠图合成 cutout / 无主体 none */
    treatment: 'photo' | 'cutout' | 'none';
    /** 背景：photo 时为 'photo'；否则 solid / gradient / asset / generated */
    backgroundKind: string;
    backgroundHex?: string;
    headline?: string;
    /**
     * 当前候选实际使用的素材。新记录优先写这里，以支持一个设计包含多个图片素材；
     * path 是素材身份，role 只说明本稿如何使用它，不参与“是不是同一个文件”的判断。
     */
    selectedAssets?: DesignFingerprintSelectedAsset[];
    /** 模型原样给出的选图依据；只记录 provided / missing 事实，不代表选择正确。 */
    materialSelectionReason?: string;
    /**
     * Harness 签发的请求级作用域。只用来区分独立任务与同任务修订，不包含用户文字，
     * 也不授权任何设计判断。旧记录缺失时保持未知，不能猜成跨任务重复。
     */
    taskScopeId?: string;
    /** @deprecated 旧单素材指纹的只读兼容字段；新记录应写 selectedAssets。 */
    subjectFile?: string;
    /** 评审总分（有才记） */
    overall?: number;
}

export interface DesignFingerprintSelectedAsset {
    path: string;
    role?: string;
}

export interface DesignFingerprintImagePlacement {
    fit: 'contain' | 'cover';
    anchor: 'center' | 'top-center' | 'bottom-center' | 'left-center' | 'right-center';
    cropPolicy: 'avoid-crop' | 'protect-subject' | 'allow-crop';
    subjectFillRatio?: number;
    focalPoint?: { x: number; y: number };
}

export interface DesignFingerprintRegion {
    id: string;
    role: string;
    contentKind: 'image' | 'editable_text';
    contentSummary?: string;
    /** Agent 当时真实声明的图片落位摘要；用于复盘和候选比较，不是审美分数。 */
    imagePlacement?: DesignFingerprintImagePlacement;
}

export interface DesignVersionComparison {
    version: 'design-version-comparison/v1';
    relation: 'same_document_revision' | 'new_document_alternative' | 'document_relation_unknown';
    previous: {
        documentName: string;
        documentId?: number;
        angle?: string;
        regionCount: number;
        regions: DesignFingerprintRegion[];
    };
    current: {
        documentName: string;
        documentId?: number;
        angle?: string;
        regionCount: number;
        regions: DesignFingerprintRegion[];
    };
    sameSubjectAsset: boolean;
    removed: DesignFingerprintRegion[];
    added: DesignFingerprintRegion[];
    retained: DesignFingerprintRegion[];
    structuralDirection: 'reduced' | 'expanded' | 'recomposed' | 'unchanged' | 'unknown';
    evidenceStatus: 'change_observed_quality_not_compared';
    needsComparativeReview: boolean;
    boundaries: {
        structuralDifferenceIsNotQualityVerdict: true;
        doesNotRequireTextOrMinimumElementCount: true;
        doesNotSelectWinner: true;
    };
}

export interface RecentDesignsLedger {
    version: 'recent-designs/v1';
    items: DesignFingerprint[];
}

export function createRecentDesignsLedger(): RecentDesignsLedger {
    return { version: 'recent-designs/v1', items: [] };
}

export function appendDesignFingerprint(ledger: RecentDesignsLedger, fingerprint: DesignFingerprint, max = 20): RecentDesignsLedger {
    const items = [...(ledger?.items || []), fingerprint].slice(-Math.max(1, max));
    return { version: 'recent-designs/v1', items };
}

function normalizeHex(value: unknown): string | undefined {
    const text = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(text) ? text.toUpperCase() : undefined;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { h: 0, s: 0, l };
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return { h, s, l };
}

/** 两个底色是否算「同一色系」：都近乎无彩且明度相近，或色相差 < 24° 且明度差 < 0.18 */
export function isSameColorFamily(a?: string, b?: string): boolean {
    const ha = normalizeHex(a);
    const hb = normalizeHex(b);
    if (!ha || !hb) return false;
    if (ha === hb) return true;
    const A = hexToHsl(ha);
    const B = hexToHsl(hb);
    if (A.s < 0.12 && B.s < 0.12) return Math.abs(A.l - B.l) < 0.18;
    if (A.s < 0.12 || B.s < 0.12) return false;
    const hueDiff = Math.min(Math.abs(A.h - B.h), 360 - Math.abs(A.h - B.h));
    return hueDiff < 24 && Math.abs(A.l - B.l) < 0.18;
}

function headlineKey(value?: string): string {
    return String(value || '').replace(/\s+/g, '').trim();
}

function baseName(value?: string): string {
    const text = String(value || '').replace(/\\/g, '/');
    return text.slice(text.lastIndexOf('/') + 1);
}

function normalizedSourcePath(value?: string): string {
    return String(value || '').replace(/\\/g, '/').replace(/\/+$/g, '').trim().toLowerCase();
}

function normalizeTaskScopeId(value: unknown): string {
    return String(value || '').trim();
}

function normalizeSelectedAssets(
    fingerprint: Pick<DesignFingerprint, 'selectedAssets' | 'subjectFile'>
): DesignFingerprintSelectedAsset[] {
    const declared = Array.isArray(fingerprint.selectedAssets)
        ? fingerprint.selectedAssets
        : [];
    const candidates = declared.length > 0
        ? declared
        : (String(fingerprint.subjectFile || '').trim()
            ? [{ path: String(fingerprint.subjectFile || '').trim(), role: 'subject' }]
            : []);
    const seen = new Set<string>();
    const normalized: DesignFingerprintSelectedAsset[] = [];
    for (const candidate of candidates) {
        const path = String(candidate?.path || '').trim();
        const identity = normalizedSourcePath(path);
        if (!identity || seen.has(identity)) continue;
        seen.add(identity);
        const role = String(candidate?.role || '').replace(/\s+/g, ' ').trim();
        normalized.push({ path, ...(role ? { role } : {}) });
    }
    return normalized;
}

function selectedAssetIdentitySet(
    fingerprint: Pick<DesignFingerprint, 'selectedAssets' | 'subjectFile'>
): Set<string> {
    return new Set(normalizeSelectedAssets(fingerprint).map((asset) => normalizedSourcePath(asset.path)));
}

function shareSelectedAsset(
    left: Pick<DesignFingerprint, 'selectedAssets' | 'subjectFile'>,
    right: Pick<DesignFingerprint, 'selectedAssets' | 'subjectFile'>
): boolean {
    const leftIdentities = selectedAssetIdentitySet(left);
    if (leftIdentities.size === 0) return false;
    return normalizeSelectedAssets(right).some((asset) => leftIdentities.has(normalizedSourcePath(asset.path)));
}

function normalizeFingerprintRegions(value: unknown): DesignFingerprintRegion[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item): DesignFingerprintRegion | undefined => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
            const record = item as Record<string, unknown>;
            const id = String(record.id || '').replace(/\s+/g, ' ').trim();
            const role = String(record.role || '').replace(/\s+/g, ' ').trim();
            const contentKind = record.contentKind === 'image' ? 'image' : 'editable_text';
            const contentSummary = String(record.contentSummary || '').replace(/\s+/g, ' ').trim().slice(0, 120);
            const placementRecord = record.imagePlacement
                && typeof record.imagePlacement === 'object'
                && !Array.isArray(record.imagePlacement)
                ? record.imagePlacement as Record<string, unknown>
                : undefined;
            const placementFit = placementRecord?.fit === 'cover' ? 'cover' : 'contain';
            const placementAnchor = String(placementRecord?.anchor || '');
            const placementCropPolicy = String(placementRecord?.cropPolicy || '');
            const placementValid = contentKind === 'image'
                && ['center', 'top-center', 'bottom-center', 'left-center', 'right-center'].includes(placementAnchor)
                && ['avoid-crop', 'protect-subject', 'allow-crop'].includes(placementCropPolicy);
            const subjectFillRatio = Number(placementRecord?.subjectFillRatio);
            const focalPointRecord = placementRecord?.focalPoint
                && typeof placementRecord.focalPoint === 'object'
                && !Array.isArray(placementRecord.focalPoint)
                ? placementRecord.focalPoint as Record<string, unknown>
                : undefined;
            const focalX = Number(focalPointRecord?.x);
            const focalY = Number(focalPointRecord?.y);
            if (!id || !role) return undefined;
            return {
                id,
                role,
                contentKind,
                ...(contentSummary ? { contentSummary } : {}),
                ...(placementValid ? {
                    imagePlacement: {
                        fit: placementFit,
                        anchor: placementAnchor as DesignFingerprintImagePlacement['anchor'],
                        cropPolicy: placementCropPolicy as DesignFingerprintImagePlacement['cropPolicy'],
                        ...(Number.isFinite(subjectFillRatio) && subjectFillRatio > 0 && subjectFillRatio <= 1
                            ? { subjectFillRatio }
                            : {}),
                        ...(Number.isFinite(focalX) && Number.isFinite(focalY)
                            && focalX >= 0 && focalX <= 1 && focalY >= 0 && focalY <= 1
                            ? { focalPoint: { x: focalX, y: focalY } }
                            : {})
                    }
                } : {})
            };
        })
        .filter((item): item is DesignFingerprintRegion => Boolean(item));
}

function fingerprintRegionKey(region: DesignFingerprintRegion): string {
    return [
        region.contentKind,
        region.role.toLowerCase(),
        region.id.toLowerCase(),
        String(region.contentSummary || '').toLowerCase(),
        region.imagePlacement
            ? JSON.stringify(region.imagePlacement)
            : ''
    ].join('|');
}

/**
 * 找同项目中最近一个可比较候选。当前只把同一主体素材视为可比较关系；
 * 不同商品 / 不同素材不会因为文档名相似就被 Harness 擅自串成一条修订链。
 */
export function findLatestComparableDesign(
    current: Pick<DesignFingerprint, 'selectedAssets' | 'subjectFile'>,
    recent: DesignFingerprint[]
): DesignFingerprint | undefined {
    if (selectedAssetIdentitySet(current).size === 0) return undefined;
    return [...(recent || [])].reverse().find((item) => shareSelectedAsset(current, item));
}

/**
 * 只比较候选事实，不给审美结论。
 *
 * “元素减少”只说明方向发生结构性减法；它可能是更克制，也可能只是把设计删空。
 * 因此结果只标记“变化已观察、是否更优尚未比较”，把选择权留给模型的视觉判断。
 */
export function compareDesignVersions(
    previous: DesignFingerprint,
    current: DesignFingerprint
): DesignVersionComparison {
    const previousRegions = normalizeFingerprintRegions(previous.regions);
    const currentRegions = normalizeFingerprintRegions(current.regions);
    const previousByKey = new Map(previousRegions.map((region) => [fingerprintRegionKey(region), region]));
    const currentByKey = new Map(currentRegions.map((region) => [fingerprintRegionKey(region), region]));
    const removed = previousRegions.filter((region) => !currentByKey.has(fingerprintRegionKey(region)));
    const added = currentRegions.filter((region) => !previousByKey.has(fingerprintRegionKey(region)));
    const retained = currentRegions.filter((region) => previousByKey.has(fingerprintRegionKey(region)));
    const previousDocumentId = Number(previous.documentId);
    const currentDocumentId = Number(current.documentId);
    let relation: DesignVersionComparison['relation'] = 'document_relation_unknown';
    if (Number.isInteger(previousDocumentId) && previousDocumentId > 0
        && Number.isInteger(currentDocumentId) && currentDocumentId > 0) {
        relation = previousDocumentId === currentDocumentId
            ? 'same_document_revision'
            : 'new_document_alternative';
    }
    const sameSubjectAsset = shareSelectedAsset(previous, current);
    let structuralDirection: DesignVersionComparison['structuralDirection'] = 'unknown';
    if (previousRegions.length > 0 || currentRegions.length > 0) {
        if (currentRegions.length < previousRegions.length) structuralDirection = 'reduced';
        else if (currentRegions.length > previousRegions.length) structuralDirection = 'expanded';
        else if (removed.length > 0 || added.length > 0) structuralDirection = 'recomposed';
        else structuralDirection = 'unchanged';
    }
    return {
        version: 'design-version-comparison/v1',
        relation,
        previous: {
            documentName: previous.documentName,
            ...(Number.isInteger(previousDocumentId) && previousDocumentId > 0
                ? { documentId: previousDocumentId }
                : {}),
            ...(previous.angle ? { angle: previous.angle } : {}),
            regionCount: previousRegions.length,
            regions: previousRegions
        },
        current: {
            documentName: current.documentName,
            ...(Number.isInteger(currentDocumentId) && currentDocumentId > 0
                ? { documentId: currentDocumentId }
                : {}),
            ...(current.angle ? { angle: current.angle } : {}),
            regionCount: currentRegions.length,
            regions: currentRegions
        },
        sameSubjectAsset,
        removed,
        added,
        retained,
        structuralDirection,
        evidenceStatus: 'change_observed_quality_not_compared',
        needsComparativeReview: relation !== 'document_relation_unknown'
            && sameSubjectAsset
            && structuralDirection === 'reduced',
        boundaries: {
            structuralDifferenceIsNotQualityVerdict: true,
            doesNotRequireTextOrMinimumElementCount: true,
            doesNotSelectWinner: true
        }
    };
}

/**
 * 当前稿与同项目近期稿的雷同点。只看最近 `window` 稿；返回可直接念给模型 / 评审器的句子。
 * 「同一张照片 + 同一版面签名 + 同一色系」这种组合才值得提醒；单项相同不算。
 */
export function findDesignSameness(current: Omit<DesignFingerprint, 'version' | 'at'>, recent: DesignFingerprint[], window = 3): string[] {
    const items = (recent || []).slice(-window);
    if (items.length === 0) return [];
    const findings: string[] = [];

    const currentLayoutSignature = current.layoutSignature || current.recipeId;
    const sameLayoutSignature = items.filter((item) => (
        Boolean(item.layoutSignature || item.recipeId)
        && (item.layoutSignature || item.recipeId) === currentLayoutSignature
    ));
    if (currentLayoutSignature && sameLayoutSignature.length >= 1) {
        findings.push(`本稿的 Agent 版面签名与最近 ${sameLayoutSignature.length} 稿完全相同（${sameLayoutSignature.map((item) => item.documentName).join('、')}）`);
    }

    const sameBg = items.filter((item) => isSameColorFamily(item.backgroundHex, current.backgroundHex));
    if (current.backgroundHex && sameBg.length >= 1) {
        findings.push(`底色 ${current.backgroundHex} 与最近 ${sameBg.length} 稿同一色系（${sameBg.map((item) => `${item.documentName} ${item.backgroundHex}`).join('、')}）`);
    }

    const currentHeadline = headlineKey(current.headline);
    if (currentHeadline) {
        const sameHeadline = items.filter((item) => headlineKey(item.headline) === currentHeadline);
        if (sameHeadline.length >= 1) {
            findings.push(`主标题「${current.headline}」与最近 ${sameHeadline.length} 稿一字不差`);
        }
    }

    const currentTaskScopeId = normalizeTaskScopeId(current.taskScopeId);
    if (currentTaskScopeId) {
        for (const asset of normalizeSelectedAssets(current)) {
            const identity = normalizedSourcePath(asset.path);
            const priorIndependentTasks = new Map<string, DesignFingerprint>();
            for (const item of items) {
                const priorTaskScopeId = normalizeTaskScopeId(item.taskScopeId);
                if (!priorTaskScopeId || priorTaskScopeId === currentTaskScopeId) continue;
                if (!selectedAssetIdentitySet(item).has(identity)) continue;
                priorIndependentTasks.set(priorTaskScopeId, item);
            }
            if (priorIndependentTasks.size >= 2) {
                const roleText = asset.role ? `（本稿角色：${asset.role}）` : '';
                findings.push(
                    `素材 ${baseName(asset.path)}${roleText} 在最近 ${priorIndependentTasks.size} 个不同任务中也被使用；`
                    + '复用本身不是质量结论。若本次有意复用，请在设计说明中写明它仍适合当前目标的依据'
                );
            }
        }
    }

    const currentAngle = String(current.angle || '').trim();
    if (currentAngle) {
        const sameAngle = items.filter((item) => String(item.angle || '').trim() === currentAngle);
        if (sameAngle.length >= 1) {
            findings.push(`角度「${currentAngle}」与最近 ${sameAngle.length} 稿相同`);
        }
    }
    return findings;
}

/** 开工时念给模型听的近期稿摘要（事实 + 一句要求；不给建议方向，方向由它自己想）。 */
export function summarizeRecentDesignsForModel(recent: DesignFingerprint[], limit = 3): string {
    const items = (recent || []).slice(-limit);
    if (items.length === 0) return '';
    const lines = items.map((item, index) => {
        const parts = [
            item.documentName,
            item.angle ? `角度「${item.angle}」` : '',
            item.layoutSignature || item.recipeId ? `版面签名 ${item.layoutSignature || item.recipeId}` : '',
            item.treatment === 'photo' ? '照片满幅' : item.treatment === 'cutout' ? `抠图 + ${item.backgroundKind}${item.backgroundHex ? ` ${item.backgroundHex}` : ''}` : '',
            item.headline ? `标题「${item.headline.replace(/\n/g, ' / ')}」` : '',
            normalizeSelectedAssets(item).length > 0
                ? `素材 ${normalizeSelectedAssets(item).map((asset) => baseName(asset.path)).join('、')}`
                : '',
            item.materialSelectionReason ? `选图依据「${String(item.materialSelectionReason).replace(/\s+/g, ' ').trim()}」` : '',
            typeof item.overall === 'number' ? `评审 ${item.overall.toFixed(1)}` : ''
        ].filter(Boolean);
        return `${index + 1}. ${parts.join(' · ')}`;
    });
    return [
        `这个项目最近 ${items.length} 稿你是这么做的：`,
        ...lines,
        '以上只是近期成稿事实，不规定本次必须变化或更换素材。请根据当前任务和真实画面自行判断；若有意复用相同素材或方向，在设计说明中写明它仍适合当前目标的依据。'
    ].join('\n');
}
