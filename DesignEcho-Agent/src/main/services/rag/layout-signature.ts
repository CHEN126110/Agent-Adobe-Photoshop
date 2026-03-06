export interface LayoutBox {
    id: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
}

function clamp01(v: number): number {
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}

function safeDiv(a: number, b: number): number {
    if (!b) return 0;
    return a / b;
}

function area(b: LayoutBox): number {
    const w = Math.max(0, b.right - b.left);
    const h = Math.max(0, b.bottom - b.top);
    return w * h;
}

function intersectionArea(aBox: LayoutBox, bBox: LayoutBox): number {
    const left = Math.max(aBox.left, bBox.left);
    const top = Math.max(aBox.top, bBox.top);
    const right = Math.min(aBox.right, bBox.right);
    const bottom = Math.min(aBox.bottom, bBox.bottom);
    const w = Math.max(0, right - left);
    const h = Math.max(0, bottom - top);
    return w * h;
}

function addBinned(hist: Float32Array, offset: number, v: number, edges: number[]): void {
    for (let i = 0; i < edges.length; i++) {
        if (v <= edges[i]) {
            hist[offset + i] += 1;
            return;
        }
    }
    hist[offset + edges.length] += 1;
}

export function encodeLayoutSignature(boxes: LayoutBox[], outDim = 512): Float32Array {
    const coreDim = Math.min(128, outDim);
    const core = new Float32Array(coreDim);
    if (!boxes || boxes.length < 2) return outDim === coreDim ? core : new Float32Array(outDim);

    let minL = Infinity;
    let minT = Infinity;
    let maxR = -Infinity;
    let maxB = -Infinity;
    for (const b of boxes) {
        if (!Number.isFinite(b.left) || !Number.isFinite(b.top) || !Number.isFinite(b.right) || !Number.isFinite(b.bottom)) continue;
        minL = Math.min(minL, b.left);
        minT = Math.min(minT, b.top);
        maxR = Math.max(maxR, b.right);
        maxB = Math.max(maxB, b.bottom);
    }
    const W = Math.max(1, maxR - minL);
    const H = Math.max(1, maxB - minT);

    const norm = boxes
        .map(b => {
            const left = (b.left - minL) / W;
            const right = (b.right - minL) / W;
            const top = (b.top - minT) / H;
            const bottom = (b.bottom - minT) / H;
            return { id: b.id, left, right, top, bottom };
        })
        .filter(b => Number.isFinite(b.left) && Number.isFinite(b.right) && Number.isFinite(b.top) && Number.isFinite(b.bottom))
        .filter(b => b.right > b.left && b.bottom > b.top);

    if (norm.length < 2) return outDim === coreDim ? core : new Float32Array(outDim);

    const relationOffset = 0;
    const relationDim = 6;
    const alignOffset = relationOffset + relationDim;
    const alignDim = 6;
    const spacingOffset = alignOffset + alignDim;
    const spacingDim = 12;
    const dxOffset = spacingOffset + spacingDim;
    const dxDim = 11;
    const dyOffset = dxOffset + dxDim;
    const dyDim = 11;
    const iouOffset = dyOffset + dyDim;
    const iouDim = 11;
    const sizeOffset = iouOffset + iouDim;
    const sizeDim = 11;
    const aspectOffset = sizeOffset + sizeDim;
    const aspectDim = coreDim - aspectOffset;

    const edgeBins = [0.02, 0.05, 0.1, 0.2, 0.35];
    const distBins = [0.05, 0.12, 0.2, 0.35, 0.55];
    const signedBins = [-0.6, -0.35, -0.2, -0.12, -0.05, 0.05, 0.12, 0.2, 0.35, 0.6];
    const ratioBins = [-1.2, -0.7, -0.35, -0.15, -0.05, 0.05, 0.15, 0.35, 0.7, 1.2];
    const iouBins = [0.01, 0.05, 0.12, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.97];

    let pairs = 0;

    for (let i = 0; i < norm.length; i++) {
        const a = norm[i];
        const aw = a.right - a.left;
        const ah = a.bottom - a.top;
        const acx = (a.left + a.right) / 2;
        const acy = (a.top + a.bottom) / 2;
        const aArea = aw * ah;
        const aAspect = safeDiv(aw, ah);

        for (let j = i + 1; j < norm.length; j++) {
            const b = norm[j];
            const bw = b.right - b.left;
            const bh = b.bottom - b.top;
            const bcx = (b.left + b.right) / 2;
            const bcy = (b.top + b.bottom) / 2;
            const bArea = bw * bh;
            const bAspect = safeDiv(bw, bh);

            const dx = bcx - acx;
            const dy = bcy - acy;

            const inter = intersectionArea(a, b);
            const union = aArea + bArea - inter;
            const iou = clamp01(safeDiv(inter, union));
            const containA = clamp01(safeDiv(inter, aArea));
            const containB = clamp01(safeDiv(inter, bArea));

            if (dx < 0) core[relationOffset + 0] += 1;
            else core[relationOffset + 1] += 1;

            if (dy < 0) core[relationOffset + 2] += 1;
            else core[relationOffset + 3] += 1;

            if (iou >= 0.05) core[relationOffset + 4] += 1;
            if (Math.max(containA, containB) >= 0.9) core[relationOffset + 5] += 1;

            if (Math.abs(a.left - b.left) <= edgeBins[2]) core[alignOffset + 0] += 1;
            if (Math.abs(acx - bcx) <= edgeBins[2]) core[alignOffset + 1] += 1;
            if (Math.abs(a.right - b.right) <= edgeBins[2]) core[alignOffset + 2] += 1;
            if (Math.abs(a.top - b.top) <= edgeBins[2]) core[alignOffset + 3] += 1;
            if (Math.abs(acy - bcy) <= edgeBins[2]) core[alignOffset + 4] += 1;
            if (Math.abs(a.bottom - b.bottom) <= edgeBins[2]) core[alignOffset + 5] += 1;

            const adx = Math.abs(dx);
            const ady = Math.abs(dy);
            addBinned(core, spacingOffset + 0, adx, distBins);
            addBinned(core, spacingOffset + 6, ady, distBins);

            addBinned(core, dxOffset + 0, dx, signedBins);
            addBinned(core, dyOffset + 0, dy, signedBins);

            addBinned(core, iouOffset + 0, iou, iouBins);

            const ratio = Math.log(safeDiv(bArea, aArea) || 1);
            addBinned(core, sizeOffset + 0, ratio, ratioBins);

            if (aspectDim > 0) {
                const ar = Math.log(safeDiv(bAspect, aAspect) || 1);
                const localBins = ratioBins.slice(0, Math.min(ratioBins.length, aspectDim - 1));
                addBinned(core, aspectOffset + 0, ar, localBins);
            }

            pairs += 1;
        }
    }

    if (pairs > 0) {
        for (let i = 0; i < core.length; i++) core[i] = core[i] / pairs;
    }

    if (outDim === coreDim) return core;
    const out = new Float32Array(outDim);
    out.set(core, 0);
    return out;
}

