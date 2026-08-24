// DesignEcho 浏览器助手 —— MV3 service worker 入口。
// 基线：Chrome ≥ 116（该版本起 WebSocket 活动会重置 service worker 的空闲计时，
// 心跳即可保活；更早版本的 SW 会在 30 秒空闲后被回收，导致连接频繁中断）。
// 注意：service worker 环境没有 window / document，所有页面级操作
// 都通过 chrome.scripting.executeScript 注入 lib/*-scripts.js 中的纯函数执行。

import { initConnection, getStatus, reconnectNow } from './lib/connection.js';
import { runCollectAction, COLLECT_ACTIONS } from './lib/collect.js';

// 事件监听必须在 service worker 首轮同步求值时注册（chrome.runtime.onStartup /
// chrome.alarms.onAlarm 等在 initConnection 内注册），否则事件无法唤醒休眠的 SW。
initConnection();

// ---------- 右键菜单（用户主动收藏入口，Eagle 式能力） ----------

const CONTEXT_MENU_PARENT_ID = 'designecho-collect';
const CONTEXT_MENU_ITEMS = [
  { id: 'collect-image', title: '收藏这张图片', contexts: ['image'] },
  { id: 'collect-save-link', title: '收藏页面链接', contexts: ['page'] },
  { id: 'collect-batch', title: '批量收藏页面图片', contexts: ['page'] },
  { id: 'collect-region', title: '区域截图收藏', contexts: ['page'] },
  { id: 'collect-visible', title: '可视范围截图收藏', contexts: ['page'] },
  { id: 'collect-fullpage', title: '整页截图收藏', contexts: ['page'] },
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_PARENT_ID,
      title: 'DesignEcho 收藏',
      contexts: ['page', 'image'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
    for (const item of CONTEXT_MENU_ITEMS) {
      chrome.contextMenus.create({
        id: item.id,
        parentId: CONTEXT_MENU_PARENT_ID,
        title: item.title,
        contexts: item.contexts,
        documentUrlPatterns: ['http://*/*', 'https://*/*'],
      });
    }
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || typeof info.menuItemId !== 'string') {
    return;
  }
  if (info.menuItemId === 'collect-image') {
    runCollectAction('collect-image', { tab, imageSrc: info.srcUrl || '' });
    return;
  }
  if (COLLECT_ACTIONS.includes(info.menuItemId)) {
    runCollectAction(info.menuItemId, { tab });
  }
});

// ---------- 快捷键（manifest commands；默认 Alt+Shift+0~3，避开 Eagle 的 Alt+0~4） ----------

chrome.commands.onCommand.addListener((command, tab) => {
  if (COLLECT_ACTIONS.includes(command)) {
    runCollectAction(command, tab ? { tab } : {});
  }
});

// ---------- popup 消息：状态查询 / 重连 / 收藏动作 ----------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') {
    return false;
  }
  if (message.type === 'getStatus') {
    sendResponse(getStatus());
    return false;
  }
  if (message.type === 'reconnect') {
    reconnectNow();
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'collect') {
    // popup 点击后立即返回并关闭弹窗，动作在 SW 继续执行，结果由页面 toast 反馈。
    runCollectAction(String(message.action || ''), {});
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
