import { BrowserWindow, desktopCapturer, ipcMain, screen, type NativeImage } from 'electron';

const PHOTOSHOP_WINDOW_NAME_PATTERN = /(?:adobe\s+)?photoshop/i;

function resolvePhotoshopWindowSource<T extends { name: string; thumbnail: NativeImage }>(
    sources: T[]
): T | undefined {
    return sources
        .filter((source) => PHOTOSHOP_WINDOW_NAME_PATTERN.test(String(source.name || '')))
        .sort((left, right) => {
            const leftSize = left.thumbnail.getSize();
            const rightSize = right.thumbnail.getSize();
            return (rightSize.width * rightSize.height) - (leftSize.width * leftSize.height);
        })[0];
}

export function registerScreenshotHandlers(): void {
    ipcMain.handle('screenshot:captureAgentWindow', async (event) => {
        try {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (!win) {
                return { success: false, error: '未找到当前窗口' };
            }

            const image = await win.capturePage();
            return {
                success: true,
                imageBase64: image.toPNG().toString('base64'),
                mimeType: 'image/png',
                source: 'agent-window'
            };
        } catch (error: any) {
            return { success: false, error: error?.message || '截取 Agent 窗口失败' };
        }
    });

    ipcMain.handle('screenshot:captureDesktop', async () => {
        try {
            const primary = screen.getPrimaryDisplay();
            const { width, height } = primary.size;
            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { width, height }
            });

            let target = sources.find((s) => s.display_id === String(primary.id));
            if (!target && sources.length > 0) target = sources[0];
            if (!target) {
                return { success: false, error: '未找到可用屏幕源' };
            }

            const png = target.thumbnail.toPNG();
            return {
                success: true,
                imageBase64: png.toString('base64'),
                mimeType: 'image/png',
                source: 'desktop'
            };
        } catch (error: any) {
            return { success: false, error: error?.message || '截取桌面失败' };
        }
    });

    ipcMain.handle('screenshot:capturePhotoshopWindow', async () => {
        try {
            const primary = screen.getPrimaryDisplay();
            const sources = await desktopCapturer.getSources({
                types: ['window'],
                thumbnailSize: primary.size,
                fetchWindowIcons: false
            });
            const target = resolvePhotoshopWindowSource(sources);
            if (!target || target.thumbnail.isEmpty()) {
                return {
                    success: false,
                    error: '未找到可截图的 Adobe Photoshop 窗口。请确认 Photoshop 已启动且窗口未最小化。',
                    environmentState: 'photoshop_window_unavailable'
                };
            }

            return {
                success: true,
                image: {
                    base64: target.thumbnail.toPNG().toString('base64'),
                    format: 'png',
                    sourceKind: 'application_window',
                    sourceName: target.name
                },
                mimeType: 'image/png',
                source: 'photoshop-window',
                sourceName: target.name,
                environmentState: 'photoshop_window_observed'
            };
        } catch (error: any) {
            return {
                success: false,
                error: error?.message || '截取 Adobe Photoshop 窗口失败',
                environmentState: 'photoshop_window_capture_failed'
            };
        }
    });
}
