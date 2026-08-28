/**
 * UXP Handlers 共享类型定义
 */

import type { WebSocketServer } from '../websocket/server';
import type { LogService } from '../services/log-service';
import type { TaskOrchestrator } from '../services/task-orchestrator';
import type { MattingService } from '../services/matting-service';
import type { InpaintingService } from '../services/inpainting-service';
import type { SubjectDetectionService } from '../services/subject-detection-service';
import type { ContourService } from '../services/contour-service';
import type { SAMService } from '../services/sam-service';
import type { GroundingDinoService } from '../services/grounding-dino-service';

/**
 * UXP Handler 上下文 - 包含所有可能需要的服务引用
 */
export interface UXPContext {
    wsServer: WebSocketServer;
    logService: LogService | null;
    taskOrchestrator: TaskOrchestrator | null;
    mattingService: MattingService | null;
    inpaintingService: InpaintingService | null;
    subjectDetectionService: SubjectDetectionService | null;
    contourService: ContourService | null;
    samService: SAMService | null;
    /** 开放词汇检测器：文字短语 → 目标框，语义抠图的第一段 */
    groundingDinoService: GroundingDinoService | null;
    mainWindow: Electron.BrowserWindow | null;
}

/**
 * UXP Handler 注册函数类型
 */
export type UXPHandlerRegistrar = (context: UXPContext) => void;

/**
 * 主体位置缓存接口
 */
export interface SubjectPositionCache {
    relativeX: number;
    relativeY: number;
    relativeWidth: number;
    relativeHeight: number;
    timestamp: number;
}

/**
 * 发送进度通知的辅助函数类型
 */
export type SendProgressFn = (progress: number, message: string) => void;
