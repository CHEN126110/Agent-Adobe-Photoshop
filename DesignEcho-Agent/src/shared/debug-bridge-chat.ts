/**
 * 开发期真实任务可能包含多轮视觉观察、Photoshop 写入与复核，五分钟不足以
 * 区分“仍在认真完成”与“已卡死”。三端共用同一上限，避免请求链路任一段
 * 悄悄把调用方提供的超时截短。
 */
export const MAX_DEBUG_BRIDGE_CHAT_TIMEOUT_MS = 30 * 60 * 1000;
