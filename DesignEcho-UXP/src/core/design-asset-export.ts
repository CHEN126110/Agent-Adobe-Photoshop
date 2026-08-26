/**
 * 设计库「导出当前选中」——UXP 原生实现（不经 ExtendScript）
 *
 * 2026-08-25 真机定案：从 Photoshop 图层面板拖拽、松手落到面板的瞬间触发
 * ExtendScript 自动化（AdobeScriptAutomation）会弹「JavaScript 代码丢失」且
 * 事件空返回——脚本文件在拖拽收尾状态下加载失败；同一台机器上非拖拽入口
 * 跑同一条 JSX 通道完全正常。这条链路从此不再依赖脚本文件加载：
 * 建源尺寸临时文档 → 按 ID 选中后整组复制（保顺序/剪切/编组）→ 裁切到
 * 并集矩形加留白 → 存 PSD/PSB 与 JPEG 预览，全部走 UXP DOM 与 batchPlay，
 * 失败会抛出真实可捕获的异常，不再出现"无声空返回"。
 */

import { app, core, action } from 'photoshop';
import { storage } from 'uxp';

// typings 版本落后于运行时（NewDocumentMode/DocumentFill/ElementPlacement 缺失），
// constants 按运行时取值；缺失时报出具体常量名，不静默传 undefined 给 Photoshop
const photoshopRuntimeConstants: any = (require('photoshop') as any).constants;

function getRequiredPhotoshopConstant(group: string, name: string): unknown {
    const value = photoshopRuntimeConstants?.[group]?.[name];
    if (value === undefined || value === null) {
        throw new Error(`导出选中图层失败：当前 Photoshop 运行时缺少常量 ${group}.${name}，无法继续。请确认 Photoshop 版本满足插件最低要求。`);
    }
    return value;
}

const uxpFs = storage.localFileSystem;

export interface ExportSelectedLayersParams {
    /** 源文档（当前活动文档） */
    sourceDocument: any;
    /** 目标图层对象，按图层面板从上到下排序；选中组整组复制，不含其子层 */
    orderedLayers: any[];
    /** 所有目标图层的并集 bounds（源文档坐标系） */
    unionBounds: { left: number; top: number; right: number; bottom: number };
    /** 输出目录 Entry（uxp storage Folder） */
    targetFolder: any;
    /** 主文件名（不带扩展名），扩展名按尺寸自动取 psd/psb */
    fileBaseName: string;
    /** 预览 JPEG 文件名（含 .jpg），不传则不出预览 */
    previewFileName?: string;
    /** 临时文档显示名 */
    assetName?: string;
    /** 预览最长边像素，0/缺省 = 不缩 */
    previewMaxDimension?: number;
    /** Photoshop 原生 JPEG 质量 0-12 */
    jpegQuality?: number;
}

export interface ExportSelectedLayersResult {
    filePath: string;
    previewFilePath?: string;
    format: 'psd' | 'psb';
    width: number;
    height: number;
    selectionCount: number;
    sourceDocumentName: string;
    tempDocumentName: string;
}

function pixelsUnit(value: number): { _unit: string; _value: number } {
    return { _unit: 'pixelsUnit', _value: value };
}

// 仅用于 PSD/PSB（照抄 save-document.ts 的成熟形态，含 saveStage 后台保存协议字段）。
// JPEG 不走这里：带图层文档的「存储为 JPEG」在 PS v22+ 是非法操作，batchPlay save
// 无法静默执行会弹"存储为"对话框（2026-08-25 真机两轮确证）；JPEG 必须走
// DOM saveAs.jpg 的「存储副本」语义（asCopy=true）。
async function saveActiveDocumentAsPhotoshopFile(descriptor: any, fileEntry: any): Promise<void> {
    const token = await uxpFs.createSessionToken(fileEntry);
    await action.batchPlay([
        {
            _obj: 'save',
            as: descriptor,
            in: { _kind: 'local', _path: token },
            lowerCase: true,
            saveStage: { _enum: 'saveStageType', _value: 'saveBegin' },
            _options: { dialogOptions: 'dontDisplay' }
        }
    ], { synchronousExecution: true } as any);
}

export async function exportSelectedLayersAsDesignAsset(
    params: ExportSelectedLayersParams
): Promise<ExportSelectedLayersResult> {
    const sourceDocument = params.sourceDocument;
    if (!sourceDocument) {
        throw new Error('导出选中图层失败：没有可用的 Photoshop 源文档。');
    }
    const orderedLayers = (params.orderedLayers || []).filter(Boolean);
    if (orderedLayers.length === 0) {
        throw new Error('导出选中图层失败：没有拿到要导出的图层对象。请重新选择图层后再试。');
    }

    const unionLeft = Math.round(Number(params.unionBounds?.left));
    const unionTop = Math.round(Number(params.unionBounds?.top));
    const unionRight = Math.round(Number(params.unionBounds?.right));
    const unionBottom = Math.round(Number(params.unionBounds?.bottom));
    if (![unionLeft, unionTop, unionRight, unionBottom].every(Number.isFinite)
        || unionRight <= unionLeft
        || unionBottom <= unionTop) {
        throw new Error('导出选中图层失败：选中内容的可见区域无效（并集 bounds 不可用），无法确定导出画布尺寸。');
    }
    const unionWidth = Math.max(1, unionRight - unionLeft);
    const unionHeight = Math.max(1, unionBottom - unionTop);

    // 画布比内容并集大 5%（2026-08-25 用户要求：内容不要贴边）。
    // 边距按长边取半（四边等宽），细长内容的窄轴才不会只留一两个像素。
    const canvasMargin = Math.round(Math.max(unionWidth, unionHeight) * 0.05 / 2);
    const paddedLeft = unionLeft - canvasMargin;
    const paddedTop = unionTop - canvasMargin;
    const paddedRight = unionRight + canvasMargin;
    const paddedBottom = unionBottom + canvasMargin;
    const paddedWidth = paddedRight - paddedLeft;
    const paddedHeight = paddedBottom - paddedTop;

    if (!params.targetFolder) {
        throw new Error('导出选中图层失败：没有可写入的输出目录。');
    }
    const fileBaseName = String(params.fileBaseName || '').trim();
    if (!fileBaseName) {
        throw new Error('导出选中图层失败：输出文件名为空。');
    }

    const format: 'psd' | 'psb' = (paddedWidth > 30000 || paddedHeight > 30000) ? 'psb' : 'psd';
    const assetName = String(params.assetName || 'Design Asset').trim() || 'Design Asset';
    const tempDocumentName = `${assetName.slice(0, 48) || 'DesignEcho'}_${Date.now()}`;
    const previewFileName = String(params.previewFileName || '').trim();
    const previewMaxDimensionRaw = Number(params.previewMaxDimension);
    const previewMaxDimension = Number.isFinite(previewMaxDimensionRaw)
        ? Math.max(0, Math.floor(previewMaxDimensionRaw))
        : 0;
    const jpegQualityRaw = Number(params.jpegQuality);
    const jpegQuality = Number.isFinite(jpegQualityRaw)
        ? Math.max(0, Math.min(12, Math.round(jpegQualityRaw)))
        : 8;

    let result: ExportSelectedLayersResult | null = null;

    // 临时文档取源文档同尺寸：复制过来的图层坐标天然吻合，
    // 再用一次 batchPlay 裁切把画布收到并集矩形——坐标系平移由 Photoshop
    // 原生裁切完成，确定性强。不做逐层 translate（2026-08-25 真机：translate
    // 在部分图层上不生效，导出物出现内容未对位/偏出画布的布局错乱）。
    const sourceWidth = Math.max(1, Math.round(Number(sourceDocument.width) || 1));
    const sourceHeight = Math.max(1, Math.round(Number(sourceDocument.height) || 1));

    await core.executeAsModal(async () => {
        const newDoc: any = await (app.documents as any).add({
            width: sourceWidth,
            height: sourceHeight,
            resolution: Number(sourceDocument.resolution) || 72,
            mode: getRequiredPhotoshopConstant('NewDocumentMode', 'RGB'),
            fill: getRequiredPhotoshopConstant('DocumentFill', 'TRANSPARENT'),
            name: tempDocumentName
        });
        if (!newDoc) {
            throw new Error('导出选中图层失败：创建临时文档失败（Photoshop 未返回新文档）。');
        }

        try {
            // 新文档自带的空白图层，复制完后按 id 移除
            const blankLayerIds: number[] = Array.from(newDoc.layers || []).map(
                (layer: any) => Number(layer?.id)
            ).filter((id: number) => Number.isSafeInteger(id) && id > 0);

            // 整组一次性复制：先按 ID 精确选中这组图层，再用一条 duplicate 事件
            // 复制到目标文档（描述符抄 remove-background.ts 的真机形态）。
            // 不做逐层 duplicate——单层搬运会丢剪切蒙版关系，且落点参数在真机上
            // 不可靠导致顺序倒置（2026-08-25 真机）；整体复制由 Photoshop 保持
            // 顺序、剪切与编组，与界面里"复制图层到文档"同款。
            app.activeDocument = sourceDocument;
            const layerIds = orderedLayers
                .map(layer => Math.floor(Number(layer?.id)))
                .filter(id => Number.isSafeInteger(id) && id > 0);
            if (layerIds.length === 0) {
                throw new Error('导出选中图层失败：目标图层缺少有效 ID，无法在源文档中选中它们。');
            }
            const selectCommands = layerIds.map((id, index) => {
                const command: any = {
                    _obj: 'select',
                    _target: [{ _ref: 'layer', _id: id }],
                    makeVisible: false,
                    _options: { dialogOptions: 'dontDisplay' }
                };
                if (index > 0) {
                    command.selectionModifier = { _enum: 'selectionModifierType', _value: 'addToSelection' };
                }
                return command;
            });
            await action.batchPlay(selectCommands, { synchronousExecution: true } as any);
            await action.batchPlay([
                {
                    _obj: 'duplicate',
                    _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                    to: { _ref: 'document', _id: Number(newDoc.id) },
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], { synchronousExecution: true } as any);

            app.activeDocument = newDoc;

            for (const blankId of blankLayerIds) {
                const blankLayer = Array.from(newDoc.layers || []).find(
                    (layer: any) => Number(layer?.id) === blankId
                ) as any;
                if (blankLayer) {
                    await blankLayer.delete();
                }
            }

            // 画布裁切到"并集矩形 + 四边留白"（描述符照抄 cropDocument 工具的真机验证形态）；
            // 裁切矩形超出临时画布的部分由 Photoshop 以透明扩边补齐
            await action.batchPlay([
                {
                    _obj: 'crop',
                    to: {
                        _obj: 'rectangle',
                        top: pixelsUnit(paddedTop),
                        left: pixelsUnit(paddedLeft),
                        bottom: pixelsUnit(paddedBottom),
                        right: pixelsUnit(paddedRight)
                    },
                    angle: { _unit: 'angleUnit', _value: 0 },
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], { synchronousExecution: true } as any);

            const mainFileEntry = await params.targetFolder.createFile(
                `${fileBaseName}.${format}`,
                { overwrite: true }
            );
            const mainDescriptor = format === 'psb'
                ? { _obj: 'largeDocumentFormat', maximizeCompatibility: true }
                : { _obj: 'photoshop35Format', maximizeCompatibility: true };
            await saveActiveDocumentAsPhotoshopFile(mainDescriptor, mainFileEntry);

            let previewFilePath = '';
            if (previewFileName) {
                // 先存主文件再缩图出预览：预览缩放只发生在即将丢弃的临时文档上
                const longestSide = Math.max(paddedWidth, paddedHeight);
                if (previewMaxDimension > 0 && longestSide > previewMaxDimension) {
                    const scale = previewMaxDimension / longestSide;
                    await newDoc.resizeImage(
                        Math.max(1, Math.round(paddedWidth * scale)),
                        Math.max(1, Math.round(paddedHeight * scale)),
                        undefined,
                        getRequiredPhotoshopConstant('ResampleMethod', 'BICUBICSHARPER')
                    );
                }
                const previewEntry = await params.targetFolder.createFile(previewFileName, { overwrite: true });
                if (typeof newDoc?.saveAs?.jpg !== 'function') {
                    throw new Error('导出选中图层失败：当前 Photoshop 运行时缺少 Document.saveAs.jpg 接口，无法静默生成预览图。请确认 Photoshop 版本满足插件最低要求。');
                }
                // asCopy=true =「存储副本」：带图层文档静默出 JPEG 的唯一合法通道
                await newDoc.saveAs.jpg(previewEntry, { quality: jpegQuality }, true);
                previewFilePath = String(previewEntry?.nativePath || '').trim();
            }

            result = {
                filePath: String(mainFileEntry?.nativePath || '').trim(),
                previewFilePath: previewFilePath || undefined,
                format: format,
                width: paddedWidth,
                height: paddedHeight,
                selectionCount: layerIds.length,
                sourceDocumentName: String(sourceDocument?.name || '').trim(),
                tempDocumentName: String(newDoc?.name || tempDocumentName).trim()
            };
        } finally {
            await newDoc.closeWithoutSaving();
            app.activeDocument = sourceDocument;
        }
    }, { commandName: '导出选中图层到设计库' });

    if (!result) {
        throw new Error('导出选中图层失败：Photoshop 模态执行结束但没有产出结果（未知中断）。请重试一次。');
    }
    return result;
}
