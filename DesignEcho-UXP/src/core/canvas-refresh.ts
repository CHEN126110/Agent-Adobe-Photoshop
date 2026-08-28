/**
 * 强制刷新 Photoshop 画布显示。
 *
 * 抠图、蒙版或栅格结果应用后，Photoshop 画布有时不会立即重绘。
 * 这里通过短暂切换当前图层可见性触发刷新，失败时只记录警告，
 * 不影响上层工具的真实执行结果。
 */
export async function forceRefreshCanvas(): Promise<void> {
    const { app, core, action } = require('photoshop');
    const doc = app.activeDocument;
    if (!doc) return;

    try {
        await core.executeAsModal(async () => {
            console.log('[DesignEcho] 开始刷新画布...');

            if (doc.activeLayers.length > 0) {
                const layer = doc.activeLayers[0];
                const layerId = layer.id;

                // 背景图层不能隐藏：PS 会弹出「命令"隐藏"当前不可用」的原生模态框，
                // 而 dialogOptions:'dontDisplay' 只抑制命令自身的参数对话框，挡不住它。
                // 模态框会阻塞 UXP 消息循环，比"画布没刷新"严重得多。
                if ((layer as any).isBackgroundLayer === true) {
                    console.log('[DesignEcho] 背景图层跳过可见性刷新');
                    return;
                }

                try {
                    await action.batchPlay([
                        {
                            _obj: 'hide',
                            null: [{ _ref: 'layer', _id: layerId }],
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });

                    await action.batchPlay([
                        {
                            _obj: 'show',
                            null: [{ _ref: 'layer', _id: layerId }],
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });

                    console.log('[DesignEcho] 画布刷新成功');
                } catch (e) {
                    console.log('[DesignEcho] 画布刷新失败:', e);
                }
            }
        }, { commandName: 'DesignEcho: 刷新画布' });
    } catch (error) {
        console.warn('[DesignEcho] 画布刷新出错:', error);
    }
}
