/**
 * Detail page bulk filler.
 * Fills copy and images into a parsed detail-page template.
 */

import { app, action, core } from 'photoshop';
import { SetTextContentTool } from '../text/set-text-content';

const uxp = require('uxp');
const fs = uxp.storage.localFileSystem;

type FillMode = 'cover' | 'contain' | 'smart' | 'aesthetic';
type AssetType = 'product' | 'model' | 'detail' | 'scene' | 'icon';
type ContentSource = 'knowledge' | 'ai_generated' | 'user_input' | 'template';
type ScreenType = string;

interface FillPlan {
    screenId: number;
    screenName: string;
    screenType: ScreenType;
    copies: CopyFillItem[];
    images: ImageFillItem[];
    icons?: IconFillItem[];
    confidence: number;
    needsReview: boolean;
}

interface CopyFillItem {
    layerId: number;
    layerName: string;
    content: string;
    source: ContentSource;
    sourceId?: string;
    originalText?: string;
}

interface ImageFillItem {
    layerId: number;
    layerName: string;
    imagePath: string;
    fillMode: FillMode;
    assetType: AssetType;
    needsMatting?: boolean;
    subjectAlign?: 'center' | 'left' | 'right' | 'top' | 'bottom';
}

interface IconFillItem {
    layerId: number;
    layerName: string;
    iconPath?: string;
    iconContent?: string;
}

interface FillResult {
    success: boolean;
    screenId: number;
    screenName: string;
    copiesFilled: number;
    imagesFilled: number;
    errors: string[];
}

interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

function toNumber(value: any): number {
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object' && typeof value.value === 'number') return value.value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function layerRect(layer: any): Rect {
    const b = layer?.bounds || {};
    return {
        left: toNumber(b.left),
        top: toNumber(b.top),
        right: toNumber(b.right),
        bottom: toNumber(b.bottom)
    };
}

export class DetailPageFiller {
    async fill(plan: FillPlan): Promise<FillResult> {
        const errors: string[] = [];
        let copiesFilled = 0;
        let imagesFilled = 0;

        console.log(`[DetailPageFiller] Start screen: ${plan.screenName}`);

        for (const copy of plan.copies || []) {
            try {
                await this.fillCopy(copy);
                copiesFilled++;
                console.log(`[DetailPageFiller] Copy filled: ${copy.layerName}`);
            } catch (e: any) {
                const message = e?.message || String(e);
                errors.push(`copy failed [${copy.layerName}]: ${message}`);
                console.error(`[DetailPageFiller] Copy failed: ${copy.layerName}`, e);
            }
        }

        for (const image of plan.images || []) {
            if (!image.imagePath) {
                continue;
            }
            try {
                await this.fillImage(image);
                imagesFilled++;
                console.log(`[DetailPageFiller] Image filled: ${image.layerName}`);
            } catch (e: any) {
                const message = e?.message || String(e);
                errors.push(`image failed [${image.layerName}]: ${message}`);
                console.error(`[DetailPageFiller] Image failed: ${image.layerName}`, e);
            }
        }

        for (const icon of plan.icons || []) {
            try {
                await this.fillIcon(icon);
            } catch (e: any) {
                const message = e?.message || String(e);
                errors.push(`icon failed [${icon.layerName}]: ${message}`);
            }
        }

        return {
            success: errors.length === 0,
            screenId: plan.screenId,
            screenName: plan.screenName,
            copiesFilled,
            imagesFilled,
            errors
        };
    }

    async fillAll(plans: FillPlan[]): Promise<FillResult[]> {
        const results: FillResult[] = [];
        for (const plan of plans || []) {
            results.push(await this.fill(plan));
        }
        return results;
    }

    private async fillCopy(item: CopyFillItem): Promise<void> {
        // Use setTextContent tool to preserve text style and avoid style reset.
        const setTextTool = new SetTextContentTool();
        const result = await setTextTool.execute({
            layerId: item.layerId,
            content: String(item.content || '')
        });
        if (!result?.success) {
            throw new Error(result?.error || `copy fill failed: ${item.layerName}`);
        }
    }

    private async fillImage(item: ImageFillItem): Promise<void> {
        await core.executeAsModal(async () => {
            const doc = app.activeDocument;
            if (!doc) throw new Error('No active document');

            const targetLayer = this.findLayerById(doc.layers, item.layerId);
            if (!targetLayer) {
                throw new Error(`Target layer not found: ${item.layerId}`);
            }

            const targetRect = layerRect(targetLayer);
            const targetWidth = Math.max(1, targetRect.right - targetRect.left);
            const targetHeight = Math.max(1, targetRect.bottom - targetRect.top);
            const targetCenterX = targetRect.left + (targetWidth / 2);
            const targetCenterY = targetRect.top + (targetHeight / 2);

            const fileEntry = await fs.getEntryWithUrl('file:' + item.imagePath);
            if (!fileEntry) {
                throw new Error(`Cannot access file: ${item.imagePath}`);
            }
            const token = await fs.createSessionToken(fileEntry);

            await action.batchPlay([{
                _obj: 'placeEvent',
                null: { _path: token, _kind: 'local' },
                freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                offset: {
                    _obj: 'offset',
                    horizontal: { _unit: 'pixelsUnit', _value: targetCenterX },
                    vertical: { _unit: 'pixelsUnit', _value: targetCenterY }
                }
            }], { synchronousExecution: true });

            const placedLayer = doc.activeLayers?.[0];
            if (!placedLayer) {
                throw new Error('Placed layer missing');
            }

            await this.scaleToFit(placedLayer, targetWidth, targetHeight, item.fillMode || 'cover');
            await this.moveLayerAbove(placedLayer, targetLayer);

            const shouldClip = !!targetLayer.clipped || /image|图片|photo|图/.test(String(item.layerName || '').toLowerCase());
            if (shouldClip) {
                await this.createClippingMask(placedLayer);
            }

            try {
                await targetLayer.delete();
            } catch {
                targetLayer.visible = false;
            }
        }, { commandName: `Fill image: ${item.layerName}` });
    }

    private async fillIcon(item: IconFillItem): Promise<void> {
        if (!item.iconPath && !item.iconContent) {
            return;
        }

        await core.executeAsModal(async () => {
            const doc = app.activeDocument;
            if (!doc) throw new Error('No active document');

            const targetLayer = this.findLayerById(doc.layers, item.layerId);
            if (!targetLayer) {
                throw new Error(`Icon layer not found: ${item.layerId}`);
            }

            if (!item.iconPath) {
                return;
            }

            const fileEntry = await fs.getEntryWithUrl('file:' + item.iconPath);
            if (!fileEntry) return;

            const token = await fs.createSessionToken(fileEntry);
            const rect = layerRect(targetLayer);

            await action.batchPlay([{
                _obj: 'placeEvent',
                null: { _path: token, _kind: 'local' },
                offset: {
                    _obj: 'offset',
                    horizontal: { _unit: 'pixelsUnit', _value: (rect.left + rect.right) / 2 },
                    vertical: { _unit: 'pixelsUnit', _value: (rect.top + rect.bottom) / 2 }
                }
            }], { synchronousExecution: true });

            const placedLayer = doc.activeLayers?.[0];
            if (!placedLayer) {
                return;
            }

            const targetSize = Math.max(1, Math.min(rect.right - rect.left, rect.bottom - rect.top));
            await this.scaleToSize(placedLayer, targetSize, targetSize);

            try {
                await targetLayer.delete();
            } catch {
                targetLayer.visible = false;
            }
        }, { commandName: `Fill icon: ${item.layerName}` });
    }

    private async scaleToFit(
        layer: any,
        targetWidth: number,
        targetHeight: number,
        mode: FillMode
    ): Promise<void> {
        const rect = layerRect(layer);
        const currentWidth = Math.max(1, rect.right - rect.left);
        const currentHeight = Math.max(1, rect.bottom - rect.top);

        let scale: number;
        if (mode === 'contain') {
            scale = Math.min(targetWidth / currentWidth, targetHeight / currentHeight);
        } else if (mode === 'aesthetic') {
            const containScale = Math.min(targetWidth / currentWidth, targetHeight / currentHeight);
            scale = containScale * 0.7;
        } else {
            scale = Math.max(targetWidth / currentWidth, targetHeight / currentHeight);
        }

        const scalePercent = Math.max(1, scale * 100);
        await action.batchPlay([{
            _obj: 'transform',
            _target: [{ _ref: 'layer', _id: layer.id }],
            freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
            width: { _unit: 'percentUnit', _value: scalePercent },
            height: { _unit: 'percentUnit', _value: scalePercent },
            interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' }
        }], { synchronousExecution: true });
    }

    private async scaleToSize(layer: any, targetWidth: number, targetHeight: number): Promise<void> {
        const rect = layerRect(layer);
        const currentWidth = Math.max(1, rect.right - rect.left);
        const currentHeight = Math.max(1, rect.bottom - rect.top);
        const scaleX = (targetWidth / currentWidth) * 100;
        const scaleY = (targetHeight / currentHeight) * 100;
        const scale = Math.max(1, Math.min(scaleX, scaleY));

        await action.batchPlay([{
            _obj: 'transform',
            _target: [{ _ref: 'layer', _id: layer.id }],
            freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
            width: { _unit: 'percentUnit', _value: scale },
            height: { _unit: 'percentUnit', _value: scale },
            interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' }
        }], { synchronousExecution: true });
    }

    private async moveLayerAbove(layer: any, targetLayer: any): Promise<void> {
        await action.batchPlay([{
            _obj: 'move',
            _target: [{ _ref: 'layer', _id: layer.id }],
            to: { _ref: 'layer', _id: targetLayer.id },
            adjustment: false
        }], { synchronousExecution: true });
    }

    private async createClippingMask(layer: any): Promise<void> {
        await action.batchPlay([{
            _obj: 'groupEvent',
            _target: [{ _ref: 'layer', _id: layer.id }]
        }], { synchronousExecution: true });
    }

    private findLayerById(layers: any, id: number): any {
        if (!layers) return null;
        const list = Array.isArray(layers) ? layers : [layers];
        for (const layer of list) {
            if (layer?.id === id) return layer;
            if (layer?.layers) {
                const found = this.findLayerById(layer.layers, id);
                if (found) return found;
            }
        }
        return null;
    }
}

export class DetailPageFillerTool {
    name = 'fillDetailPage';

    schema = {
        name: 'fillDetailPage',
        description: 'Bulk fill copy and images into detail-page template.',
        parameters: {
            type: 'object' as const,
            properties: {
                plan: {
                    type: 'object',
                    description: 'Single fill plan'
                },
                plans: {
                    type: 'array',
                    description: 'Batch fill plan list'
                }
            },
            required: [] as string[]
        }
    };

    async execute(params: { plan?: FillPlan; plans?: FillPlan[] }): Promise<FillResult | FillResult[]> {
        const filler = new DetailPageFiller();
        if (params.plans) {
            return filler.fillAll(params.plans);
        }
        if (params.plan) {
            return filler.fill(params.plan);
        }
        throw new Error('Missing fill plan');
    }
}
