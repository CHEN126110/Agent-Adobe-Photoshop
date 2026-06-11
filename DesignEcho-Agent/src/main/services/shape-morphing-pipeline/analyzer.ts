import { MattingService } from '../matting-service';
import { WebSocketServer } from '../../websocket/server';
import { getSockRegionAnalyzer } from '../morphing/sock-region-analyzer';
import sharp from 'sharp';
import type {
    ContourData,
    ContentRiskSummary,
    ExportedLayerImage,
    LayerBounds,
    Point2D,
    ProductLayerAnalysis,
    ReferenceShapeAnalysis,
    SubjectInfo
} from './types';

export class ShapeMorphingAnalyzerService {
    private readonly sockRegionAnalyzer = getSockRegionAnalyzer();

    constructor(
        private readonly wsServer: WebSocketServer,
        private readonly mattingService: MattingService
    ) {}

    async analyzeReferenceShape(
        referenceShapeId: number,
        options: { includeContour?: boolean } = {}
    ): Promise<ReferenceShapeAnalysis | null> {
        const bounds = await this.getLayerBounds(referenceShapeId);
        if (!bounds) {
            return null;
        }

        const center: Point2D = {
            x: bounds.left + bounds.width / 2,
            y: bounds.top + bounds.height / 2
        };

        const contour = options.includeContour
            ? await this.extractReferenceContour(referenceShapeId)
            : undefined;
        const regionAnalysis = contour
            ? await this.analyzeSockRegions(contour.points)
            : undefined;
        const contentSummary = await this.buildContentSummary(undefined, regionAnalysis);

        return {
            layerId: referenceShapeId,
            bounds,
            center,
            contour: contour ?? undefined,
            regionAnalysis,
            contentSummary
        };
    }

    async analyzeProductLayer(
        layerId: number,
        options: { includeSubject?: boolean; includeContour?: boolean; includeExportedImage?: boolean } = {}
    ): Promise<ProductLayerAnalysis | null> {
        const bounds = await this.getLayerBounds(layerId);
        if (!bounds) {
            return null;
        }

        const layerCenter: Point2D = {
            x: bounds.left + bounds.width / 2,
            y: bounds.top + bounds.height / 2
        };

        let exportedImage: ExportedLayerImage | undefined;
        let subjectInfo: SubjectInfo | undefined;
        let contour: ContourData | undefined;

        if (options.includeSubject || options.includeExportedImage) {
            exportedImage = await this.exportLayerAsImage(layerId) ?? undefined;
        }

        if (options.includeSubject && exportedImage) {
            subjectInfo = await this.detectSubjectBounds(
                exportedImage.base64,
                bounds,
                exportedImage.width,
                exportedImage.height
            ) ?? undefined;
        }

        if (options.includeContour) {
            contour = await this.extractLayerContour(layerId) ?? undefined;
        }
        const regionAnalysis = contour
            ? await this.analyzeSockRegions(
                contour.points,
                exportedImage?.base64
            )
            : undefined;
        const contentSummary = await this.buildContentSummary(exportedImage?.base64, regionAnalysis);

        return {
            layerId,
            bounds,
            layerCenter,
            exportedImage,
            subjectInfo,
            contour,
            regionAnalysis,
            contentSummary
        };
    }

    private async analyzeSockRegions(
        contour: Point2D[],
        imageBase64?: string
    ) {
        const imageBuffer = imageBase64 ? Buffer.from(imageBase64, 'base64') : null;
        const result = await this.sockRegionAnalyzer.analyze(imageBuffer, contour);
        return result.success ? result : undefined;
    }

    private async buildContentSummary(
        imageBase64: string | undefined,
        regionAnalysis: ProductLayerAnalysis['regionAnalysis'] | ReferenceShapeAnalysis['regionAnalysis']
    ): Promise<ContentRiskSummary | undefined> {
        if (!regionAnalysis?.success) {
            return undefined;
        }

        const textureRichness = imageBase64
            ? await this.estimateTextureRichness(imageBase64)
            : 0;

        return {
            hasPattern: textureRichness >= 0.32,
            patternComplexity: textureRichness,
            textureRichness,
            cuffType: regionAnalysis.cuffAnalysis.type,
            cuffConfidence: regionAnalysis.cuffAnalysis.confidence,
            cuffProtectionLevel: regionAnalysis.cuffAnalysis.protectionLevel
        };
    }

    private async estimateTextureRichness(imageBase64: string): Promise<number> {
        try {
            const imageBuffer = Buffer.from(imageBase64, 'base64');
            const { data, info } = await sharp(imageBuffer)
                .resize(128, 128, { fit: 'inside' })
                .removeAlpha()
                .greyscale()
                .raw()
                .toBuffer({ resolveWithObject: true });

            if (!info.width || !info.height || data.length === 0) {
                return 0;
            }

            let sum = 0;
            for (let i = 0; i < data.length; i++) {
                sum += data[i];
            }
            const mean = sum / data.length;

            let variance = 0;
            for (let i = 0; i < data.length; i++) {
                const diff = data[i] - mean;
                variance += diff * diff;
            }

            const stdDev = Math.sqrt(variance / data.length);
            return Math.max(0, Math.min(1, stdDev / 64));
        } catch {
            return 0;
        }
    }

    private async getLayerBounds(layerId: number): Promise<LayerBounds | null> {
        const result = await this.wsServer.sendRequest('getLayerBounds', {
            layerId,
            includeEffects: true
        });

        if (!result?.success) {
            return null;
        }

        return result.boundsNoEffects || result.bounds;
    }

    private async exportLayerAsImage(layerId: number, maxSize: number = 1024): Promise<ExportedLayerImage | null> {
        const result = await this.wsServer.sendRequest('exportLayerAsBase64', {
            layerId,
            format: 'png',
            maxSize
        });

        if (!result?.success || !result?.data?.base64) {
            return null;
        }

        let imageBase64 = result.data.base64;
        if (imageBase64.includes('|||ALPHA:')) {
            imageBase64 = imageBase64.split('|||')[0];
        }

        return {
            base64: imageBase64,
            width: result.data.width,
            height: result.data.height
        };
    }

    private async detectSubjectBounds(
        imageBase64: string,
        layerBounds: LayerBounds,
        exportedWidth: number,
        exportedHeight: number
    ): Promise<SubjectInfo | null> {
        const detections = await this.mattingService.detectWithYoloWorld(
            imageBase64,
            '袜子 socks clothing'
        );

        if (!detections || detections.length === 0) {
            return null;
        }

        const bestDetection = detections.sort((a, b) => b.confidence - a.confidence)[0];
        const detectionWidth = bestDetection.x2 - bestDetection.x1;
        const detectionHeight = bestDetection.y2 - bestDetection.y1;
        const detectionCenterX = bestDetection.x1 + detectionWidth / 2;
        const detectionCenterY = bestDetection.y1 + detectionHeight / 2;

        const scaleX = layerBounds.width / exportedWidth;
        const scaleY = layerBounds.height / exportedHeight;

        return {
            center: {
                x: layerBounds.left + detectionCenterX * scaleX,
                y: layerBounds.top + detectionCenterY * scaleY
            },
            size: {
                width: detectionWidth * scaleX,
                height: detectionHeight * scaleY
            }
        };
    }

    private async extractReferenceContour(referenceShapeId: number): Promise<ContourData | null> {
        const result = await this.wsServer.sendRequest('extractShapePath', {
            layerId: referenceShapeId,
            samplePoints: 100
        });

        const points = result?.sampledPoints || result?.points;
        if (!result?.success || !points || points.length === 0) {
            return null;
        }

        const boundingBox = result?.contour?.boundingBox;
        return {
            points,
            width: boundingBox?.width ?? 800,
            height: boundingBox?.height ?? 800
        };
    }

    private async extractLayerContour(layerId: number): Promise<ContourData | null> {
        const result = await this.wsServer.sendRequest('getLayerContour', {
            layerId,
            method: 'mask',
            threshold: 128,
            samplePoints: 100
        });

        const points = result?.sampledPoints || result?.points;
        if (!result?.success || !points || points.length === 0) {
            return null;
        }

        const boundingBox = result?.contour?.boundingBox;
        return {
            points,
            width: boundingBox?.width ?? 800,
            height: boundingBox?.height ?? 800
        };
    }
}
