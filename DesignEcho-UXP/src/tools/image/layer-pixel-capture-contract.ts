export const LAYER_PIXEL_CAPTURE_VERSION = 'layer-pixel-capture/v1' as const;

export interface LayerPixelCaptureBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface LayerPixelCaptureReceipt {
    version: typeof LAYER_PIXEL_CAPTURE_VERSION;
    binaryRequestId: number;
    mimeType: 'image/x-raw-rgba';
    width: number;
    height: number;
    components: 4;
    componentSize: 8;
    byteLength: number;
    checksum: string;
    contentBounds: LayerPixelCaptureBounds;
    targetIdentity: {
        documentId: number;
        historyStateId: number;
        layerId: number;
    };
    colorProfile?: string;
    noMutation: true;
}
