/**
 * 工具注册表
 * 
 * 管理所有暴露给 Agent 的工具
 */

import { Tool, ToolSchema } from './types';
import { GetTextContentTool } from './text/get-text-content';
import { SetTextContentTool } from './text/set-text-content';
import { GetTextStyleTool } from './text/get-text-style';
import { SetTextStyleTool } from './text/set-text-style';
import { GetAllTextLayersTool } from './layout/get-all-text-layers';
import { GetLayerBoundsTool } from './layout/get-layer-bounds';
import { MoveLayerTool } from './layout/move-layer';
import { AlignLayersTool } from './layout/align-layers';
import { DistributeLayersTool } from './layout/distribute-layers';
import { SelectLayerTool } from './layout/select-layer';
import { GetLayerHierarchyTool } from './layout/get-layer-hierarchy';
import { CreateClippingMaskTool, ReleaseClippingMaskTool } from './layout/clipping-mask';
import { RenameLayerTool, BatchRenameLayersTool } from './layout/rename-layer';
import { ReorderLayerTool, GroupLayersTool, UngroupLayersTool } from './layout/reorder-layer';
import { GetDocumentInfoTool } from './canvas/get-document-info';
import { GetDocumentSnapshotTool } from './canvas/get-document-snapshot';
import { CreateDocumentTool } from './canvas/create-document';
import { UndoTool, RedoTool, GetHistoryInfoTool } from './canvas/undo-redo';
import { DiagnoseStateTool } from './canvas/diagnose-state';
import { SwitchDocumentTool } from './canvas/switch-document';
import { ListDocumentsTool } from './canvas/list-documents';
import { CloseDocumentTool } from './canvas/close-document';
import { SaveDocumentTool, QuickExportTool, BatchExportTool, SmartSaveTool } from './canvas/save-document';
import { GetCanvasSnapshotTool, GetElementMappingTool, AnalyzeLayoutTool } from './canvas/visual-analysis';
import { RemoveBackgroundTool, ApplyMattingResultTool, ApplyMultiMattingResultTool } from './image/remove-background';
import { PlaceImageTool } from './image/place-image';
import { GetSelectionMaskTool, ApplyInpaintingResultTool, GetSelectionBoundsTool } from './image/inpainting';
import { CreateRectangleTool, CreateEllipseTool } from './canvas/create-shape';
import { CreateTextLayerTool } from './text/create-text-layer';
import { CreateGroupTool } from './layout/create-group';
import { TransformLayerTool, QuickScaleTool } from './layer/transform-layer';
import { ReplaceLayerContentTool } from './layer/replace-content';
// 剪切蒙版信息工具（智能布局）
import { GetClippingMaskInfoTool, GetAllClippingMasksTool } from './layer/clipping-mask-info';
// 图层属性工具 (P0)
import { 
    SetLayerOpacityTool, 
    SetBlendModeTool, 
    SetLayerFillTool, 
    DuplicateLayerTool, 
    DeleteLayerTool, 
    LockLayerTool,
    GetLayerPropertiesTool
} from './layer/layer-properties';
// 图层效果工具 (P1)
import { 
    AddDropShadowTool, 
    AddStrokeTool, 
    AddGlowTool, 
    AddGradientOverlayTool, 
    ClearLayerEffectsTool 
} from './layer/layer-effects';
// 形态变形工具
import { ExtractShapePathTool, GetLayerContourTool, MorphToShapeTool, BatchMorphToShapeTool, ApplyDisplacementTool } from './morphing/tool-classes';
import { ApplyMorphedImageTool } from './morphing/apply-morphed-image';
import { WarpExplorerTool } from './morphing/warp-explorer';
import { ExportLayerAsBase64Tool } from './image/export-layer';
import { GetSubjectBoundsTool } from './image/get-subject-bounds';
// SKU 排版工具
import { SKULayoutTool } from './layout/sku-layout-tool';
// 智能布局引擎
import { SmartLayoutTool } from './layout/smart-layout-engine';
// 对齐到参考形状工具
import { AlignToReferenceTool } from './layout/align-to-reference';
// 优化图像传输
import { OptimizedImageTransferTool, OptimizedMattingImageTool } from './image/optimized-image-transfer';
// 模板渲染工具
import { 
    OpenTemplateTool, 
    GetTemplateStructureTool, 
    ReplaceImagePlaceholderTool, 
    ReplaceTextPlaceholderTool,
    BatchRenderTemplateTool 
} from './layout/template-tool';
// 图像协调工具
import { HarmonizeLayerTool, QuickHarmonizeTool } from './image/harmonization-tool';
// SKU 配置工具
import { 
    ExportColorConfigTool, 
    CreateSkuPlaceholdersTool, 
    GetSkuPlaceholdersTool,
    ExportToSkuDirTool 
} from './sku';
// 导出目录服务已简化，使用 getEntryWithUrl 绕过授权，无需工具类
// 详情页设计工具
import { DetailPageParserTool } from './layout/detail-page-parser';
import { LayerRelationDetectorTool } from './layout/layer-relation-detector';
import { AutoFixerTool } from './layout/auto-fixer';
import { DetailPageFillerTool } from './layout/detail-page-filler';
import { SliceExporterTool } from './layout/slice-exporter';
// 智能对象工具
import {
    GetSmartObjectInfoTool,
    ConvertToSmartObjectTool,
    EditSmartObjectContentsTool,
    ReplaceSmartObjectContentsTool,
    UpdateSmartObjectTool,
    GetSmartObjectLayersTool,
    DuplicateSmartObjectTool,
    RasterizeSmartObjectTool
} from './layer/smart-object-tools';
// 详情页设计工具（新版）已在下方导入：
// - DetailPageParserTool, LayerRelationDetectorTool, AutoFixerTool
// - DetailPageFillerTool, SliceExporterTool

export class ToolRegistry {
    private tools: Map<string, Tool> = new Map();
    
    // 保存特定工具实例的引用（用于二进制传输等场景）
    private removeBackgroundTool: RemoveBackgroundTool | null = null;
    private applyMattingResultTool: ApplyMattingResultTool | null = null;
    private applyMultiMattingResultTool: ApplyMultiMattingResultTool | null = null;
    private harmonizeLayerTool: HarmonizeLayerTool | null = null;

    constructor() {
        this.registerDefaultTools();
    }

    /**
     * 获取 RemoveBackgroundTool 实例（用于设置 WebSocket 客户端）
     */
    getRemoveBackgroundTool(): RemoveBackgroundTool | null {
        return this.removeBackgroundTool;
    }

    /**
     * 获取 ApplyMattingResultTool 实例（用于二进制蒙版传输）
     */
    getApplyMattingResultTool(): ApplyMattingResultTool | null {
        return this.applyMattingResultTool;
    }
    
    /**
     * 获取 ApplyMultiMattingResultTool 实例（用于多目标二进制蒙版传输）
     */
    getApplyMultiMattingResultTool(): typeof ApplyMultiMattingResultTool | null {
        // 返回类本身，因为使用静态方法接收二进制数据
        return ApplyMultiMattingResultTool;
    }

    /**
     * 获取 HarmonizeLayerTool 实例（用于设置 WebSocket 客户端）
     */
    getHarmonizeLayerTool(): HarmonizeLayerTool | null {
        return this.harmonizeLayerTool;
    }

    /**
     * 注册默认工具
     */
    private registerDefaultTools(): void {
        // 文本工具
        this.register(new GetTextContentTool());
        this.register(new SetTextContentTool());
        this.register(new GetTextStyleTool());
        this.register(new SetTextStyleTool());

        // 布局工具
        this.register(new GetAllTextLayersTool());
        this.register(new GetLayerBoundsTool());
        this.register(new MoveLayerTool());
        this.register(new AlignLayersTool());
        this.register(new DistributeLayersTool());
        this.register(new SelectLayerTool());

        // 图层管理工具
        this.register(new GetLayerHierarchyTool());
        this.register(new CreateClippingMaskTool());
        this.register(new ReleaseClippingMaskTool());
        this.register(new RenameLayerTool());
        this.register(new BatchRenameLayersTool());
        this.register(new ReorderLayerTool());
        this.register(new GroupLayersTool());
        this.register(new UngroupLayersTool());

        // 画布/文档工具
        this.register(new GetDocumentInfoTool());
        this.register(new GetDocumentSnapshotTool());
        this.register(new CreateDocumentTool());  // 创建新文档
        this.register(new ListDocumentsTool());
        this.register(new SwitchDocumentTool());
        this.register(new CloseDocumentTool());

        // 历史记录工具
        this.register(new UndoTool());
        this.register(new RedoTool());
        this.register(new GetHistoryInfoTool());

        // 诊断工具
        this.register(new DiagnoseStateTool());

        // 文档保存/导出工具
        this.register(new SaveDocumentTool());
        this.register(new QuickExportTool());
        this.register(new BatchExportTool());
        this.register(new SmartSaveTool());

        // 视觉分析工具
        this.register(new GetCanvasSnapshotTool());
        this.register(new GetElementMappingTool());
        this.register(new AnalyzeLayoutTool());

        // 图像处理工具
        // 保存 RemoveBackgroundTool 实例引用（用于二进制图像传输）
        this.removeBackgroundTool = new RemoveBackgroundTool();
        this.register(this.removeBackgroundTool);
        // 保存 ApplyMattingResultTool 实例引用（用于二进制蒙版传输）
        this.applyMattingResultTool = new ApplyMattingResultTool();
        this.register(this.applyMattingResultTool);
        this.register(new ApplyMultiMattingResultTool());  // 多目标语义分割
        this.register(new PlaceImageTool());
        
        // 局部重绘工具
        this.register(new GetSelectionMaskTool());
        this.register(new ApplyInpaintingResultTool());
        this.register(new GetSelectionBoundsTool());

        // 创建工具
        this.register(new CreateRectangleTool());
        this.register(new CreateEllipseTool());
        this.register(new CreateTextLayerTool());
        this.register(new CreateGroupTool());

        // 图层变换工具
        this.register(new TransformLayerTool());
        this.register(new QuickScaleTool());
        this.register(new ReplaceLayerContentTool());

        // 图层属性工具 (P0)
        this.register(new SetLayerOpacityTool());
        this.register(new SetBlendModeTool());
        this.register(new SetLayerFillTool());
        this.register(new DuplicateLayerTool());
        this.register(new DeleteLayerTool());
        this.register(new LockLayerTool());
        this.register(new GetLayerPropertiesTool());

        // 图层效果工具 (P1)
        this.register(new AddDropShadowTool());
        this.register(new AddStrokeTool());
        this.register(new AddGlowTool());
        this.register(new AddGradientOverlayTool());
        this.register(new ClearLayerEffectsTool());

        // 形态变形工具
        this.register(new ExtractShapePathTool());
        this.register(new GetLayerContourTool());
        this.register(new MorphToShapeTool());
        this.register(new BatchMorphToShapeTool());
        this.register(new ApplyMorphedImageTool());
        this.register(new WarpExplorerTool());
        this.register(new ExportLayerAsBase64Tool());
        this.register(new GetSubjectBoundsTool());  // 获取主体边界
        this.register(new ApplyDisplacementTool()); // 稀疏位移场变形

        // 剪切蒙版信息工具（智能布局）
        this.register(new GetClippingMaskInfoTool());
        this.register(new GetAllClippingMasksTool());

        // SKU 排版工具
        this.register(new SKULayoutTool());

        // 智能布局引擎
        this.register(new SmartLayoutTool());
        
        // 对齐到参考形状工具
        this.register(new AlignToReferenceTool());


        // 优化图像传输（参考 sd-ppp 设计）
        this.register(new OptimizedImageTransferTool());
        this.register(new OptimizedMattingImageTool());

        // 模板渲染工具
        this.register(new OpenTemplateTool());
        this.register(new GetTemplateStructureTool());
        this.register(new ReplaceImagePlaceholderTool());
        this.register(new ReplaceTextPlaceholderTool());
        this.register(new BatchRenderTemplateTool());

        // 图像协调工具
        this.harmonizeLayerTool = new HarmonizeLayerTool();
        this.register(this.harmonizeLayerTool);
        this.register(new QuickHarmonizeTool());

        // SKU 配置工具
        this.register(new ExportColorConfigTool());
        this.register(new CreateSkuPlaceholdersTool());
        this.register(new GetSkuPlaceholdersTool());
        this.register(new ExportToSkuDirTool());

        // 导出目录服务已简化，使用 getEntryWithUrl 直接绕过授权

        // 智能对象工具
        this.register(new GetSmartObjectInfoTool());
        this.register(new ConvertToSmartObjectTool());
        this.register(new EditSmartObjectContentsTool());
        this.register(new ReplaceSmartObjectContentsTool());
        this.register(new UpdateSmartObjectTool());
        this.register(new GetSmartObjectLayersTool());
        this.register(new DuplicateSmartObjectTool());
        this.register(new RasterizeSmartObjectTool());

        // 详情页设计工具
        this.register(new DetailPageParserTool());
        this.register(new LayerRelationDetectorTool());
        this.register(new AutoFixerTool());
        this.register(new DetailPageFillerTool());
        this.register(new SliceExporterTool());

        console.log(`[ToolRegistry] Registered ${this.tools.size} tools`);
    }

    /**
     * 注册工具
     */
    register(tool: Tool): void {
        this.tools.set(tool.name, tool);
        console.log(`[ToolRegistry] Registered tool: ${tool.name}`);
    }

    /**
     * 获取工具
     */
    getTool(name: string): Tool | undefined {
        return this.tools.get(name);
    }

    /**
     * 获取所有工具 Schema (用于告知 Agent 可用的工具)
     */
    getAllSchemas(): ToolSchema[] {
        return Array.from(this.tools.values()).map(tool => tool.schema);
    }

    /**
     * 列出所有工具名称
     */
    listTools(): string[] {
        return Array.from(this.tools.keys());
    }
}
