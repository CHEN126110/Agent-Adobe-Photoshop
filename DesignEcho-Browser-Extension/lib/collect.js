// 用户主动收藏（Eagle 式能力）：保存链接 / 批量收藏图片 / 区域·可视·整页截图 / 右键收藏单图。
// 入口：快捷键（chrome.commands）、右键菜单（chrome.contextMenus）、弹窗按钮。
// 所有内容经 connection.js 的 client_request 通道推给本机 DesignEcho Agent 落盘；
// 结果用页面内 toast 反馈，内部页面注入失败时退回扩展角标闪烁。

import { sendClientRequest } from './connection.js';
import { captureSingleSlice, captureFullPage, runPageScript } from './handlers.js';
import {
  selectRegionScript,
  pickImagesScript,
  showToastScript,
  findImageAttributesScript,
} from './collect-scripts.js';

// 收藏用途的截图保真度比 Agent 上下文用途更高（保存的是素材，不是模型输入）：
// 上限取到超过常见屏宽，实际效果是「不缩放、保留原分辨率」（scaleJpegDataUrl 只缩不放）。
const COLLECT_CAPTURE_MAX_WIDTH = 4096;
const COLLECT_FULLPAGE_MAX_WIDTH = 2560;
const COLLECT_FULLPAGE_MAX_SLICES = 4;
const LINK_PREVIEW_MAX_WIDTH = 800;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 20000;
const BADGE_FLASH_MS = 3000;
const SUPPORTED_IMAGE_FORMATS = ['jpeg', 'png', 'webp', 'gif'];

// 同一时间只允许一个收藏动作（框选/选择器都是独占交互，重复触发只会互相打断）。
let collectBusy = false;

function errorText(error) {
  return error && error.message ? error.message : String(error);
}

async function getActiveCollectTab() {
  let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  }
  if (!tab) {
    throw new Error('找不到当前活动标签页，请先切换到要收藏的网页。');
  }
  return tab;
}

function assertCollectableUrl(tab) {
  if (!/^https?:\/\//i.test(tab.url || '')) {
    throw new Error(`只能收藏 http/https 网页内容，当前页面是：${tab.url || '(未知地址)'}。`);
  }
}

async function badgeFlash(tabId, text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    await chrome.action.setBadgeText({ tabId, text });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    }, BADGE_FLASH_MS);
  } catch {
    // 角标失败不再有下一级反馈，静默
  }
}

async function toast(tab, message, ok) {
  try {
    await runPageScript(tab, showToastScript, [message, ok === true], '提示');
  } catch {
    await badgeFlash(tab.id, ok ? '✓' : '✗', ok ? '#2e7d32' : '#b22c2c');
  }
}

// ---------- 图片下载（service worker，host_permissions 跨域 + 登录态） ----------

async function downloadImageAsBase64(src) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(src, { credentials: 'include', signal: controller.signal });
  } catch (error) {
    throw new Error(
      controller.signal.aborted
        ? `图片下载超时（${IMAGE_DOWNLOAD_TIMEOUT_MS / 1000}s）：${src.slice(0, 100)}`
        : `图片下载失败：${errorText(error)}`
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`图片下载失败（HTTP ${response.status}）：${src.slice(0, 100)}`);
  }
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const blob = await response.blob();
  // 只解码验证 + 取尺寸，不重编码——收藏保留原始字节以保住画质与格式。
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error(`下载到的内容不是可解码的图片（${contentType || '未知类型'}）：${src.slice(0, 100)}`);
  }
  const width = bitmap.width;
  const height = bitmap.height;
  bitmap.close();
  const format = SUPPORTED_IMAGE_FORMATS.find((name) => contentType.includes(name))
    || (contentType.includes('jpg') ? 'jpeg' : null);
  if (!format) {
    throw new Error(`不支持收藏的图片格式（${contentType || '未知类型'}），支持 jpeg/png/webp/gif。`);
  }
  const buffer = await blob.arrayBuffer();
  return { base64: arrayBufferToBase64(buffer), format, width, height };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ---------- 各收藏动作 ----------

async function saveLink(tab) {
  assertCollectableUrl(tab);
  let preview = null;
  try {
    preview = await captureSingleSlice(tab, LINK_PREVIEW_MAX_WIDTH);
  } catch {
    // 预览截图失败不阻断链接收藏（窗口最小化等场景），仅少一张预览图
  }
  const result = await sendClientRequest('collect.save', {
    kind: 'link',
    sourceUrl: tab.url,
    title: tab.title || '',
    ...(preview ? {
      base64: preview.base64,
      format: preview.format,
      width: preview.width,
      height: preview.height,
    } : {}),
  });
  await toast(tab, `已收藏链接到 ${result.targetLabel}\n${result.fileName}`, true);
}

async function captureVisibleAndSave(tab) {
  assertCollectableUrl(tab);
  const shot = await captureSingleSlice(tab, COLLECT_CAPTURE_MAX_WIDTH);
  const result = await sendClientRequest('collect.save', {
    kind: 'screenshot',
    variant: 'visible',
    sourceUrl: tab.url,
    title: tab.title || '',
    base64: shot.base64,
    format: shot.format,
    width: shot.width,
    height: shot.height,
  });
  await toast(tab, `已收藏可视范围截图到 ${result.targetLabel}\n${result.fileName}`, true);
}

async function captureFullPageAndSave(tab) {
  assertCollectableUrl(tab);
  const shot = await captureFullPage(tab, COLLECT_FULLPAGE_MAX_WIDTH, COLLECT_FULLPAGE_MAX_SLICES);
  const result = await sendClientRequest('collect.save', {
    kind: 'screenshot',
    variant: 'fullpage',
    sourceUrl: tab.url,
    title: tab.title || '',
    base64: shot.base64,
    format: shot.format,
    width: shot.width,
    height: shot.height,
  });
  const truncatedNote = shot.truncatedFullPage ? '（页面过长，超出部分未截取）' : '';
  await toast(tab, `已收藏整页截图到 ${result.targetLabel}${truncatedNote}\n${result.fileName}`, true);
}

async function captureRegionAndSave(tab) {
  assertCollectableUrl(tab);
  const selection = await runPageScript(tab, selectRegionScript, [120000], '框选');
  if (selection.cancelled) {
    return; // 用户取消不打扰
  }
  let dataUrl;
  try {
    // 区域截图用 png：截取的常是文字/界面细节，jpeg 压缩边缘发糊。
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (error) {
    throw new Error(`区域截图失败：${errorText(error)}。窗口最小化时无法截图，请先还原窗口。`);
  }
  const sourceBlob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(sourceBlob);
  try {
    // 用「截图实际宽 / 视口 CSS 宽」换算，覆盖设备像素比与页面缩放差异。
    // 视口宽有两个候选：innerWidth（含滚动条）与 clientWidth（不含）——
    // captureVisibleTab 是否把滚动条截进图里有平台差异，选换算后与截图宽更接近的那个。
    const dpr = selection.dpr > 0 ? selection.dpr : 1;
    const candidates = [selection.innerWidth, selection.clientWidth].filter((w) => w > 0);
    const viewportWidth = candidates.length > 0
      ? candidates.reduce((best, w) =>
          Math.abs(bitmap.width - w * dpr) < Math.abs(bitmap.width - best * dpr) ? w : best)
      : selection.innerWidth;
    const scale = bitmap.width / Math.max(1, viewportWidth);
    const cropX = Math.max(0, Math.round(selection.x * scale));
    const cropY = Math.max(0, Math.round(selection.y * scale));
    const cropWidth = Math.min(bitmap.width - cropX, Math.max(1, Math.round(selection.width * scale)));
    const cropHeight = Math.min(bitmap.height - cropY, Math.max(1, Math.round(selection.height * scale)));
    const canvas = new OffscreenCanvas(cropWidth, cropHeight);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const buffer = await blob.arrayBuffer();
    const result = await sendClientRequest('collect.save', {
      kind: 'screenshot',
      variant: 'region',
      sourceUrl: tab.url,
      title: tab.title || '',
      base64: arrayBufferToBase64(buffer),
      format: 'png',
      width: cropWidth,
      height: cropHeight,
    });
    await toast(tab, `已收藏区域截图（${cropWidth}×${cropHeight}）到 ${result.targetLabel}\n${result.fileName}`, true);
  } finally {
    bitmap.close();
  }
}

async function batchCollect(tab) {
  assertCollectableUrl(tab);
  const picked = await runPageScript(tab, pickImagesScript, [100, 60, 180000], '批量收藏');
  if (picked.cancelled || !Array.isArray(picked.selected) || picked.selected.length === 0) {
    return;
  }
  await toast(tab, `正在收藏 ${picked.selected.length} 张图片…`, true);
  let saved = 0;
  let targetLabel = '';
  const failures = [];
  for (const item of picked.selected) {
    try {
      const image = await downloadImageAsBase64(item.src);
      const result = await sendClientRequest('collect.save', {
        kind: 'image',
        sourceUrl: tab.url,
        title: tab.title || '',
        imageSrc: item.src,
        alt: item.alt || '',
        // eagle-attributes 协议字段（页面/用户脚本标注），进来源追踪记录
        ...(item.annotation ? { annotation: item.annotation } : {}),
        ...(Array.isArray(item.tags) && item.tags.length > 0 ? { tags: item.tags } : {}),
        ...(item.link ? { link: item.link } : {}),
        base64: image.base64,
        format: image.format,
        width: image.width,
        height: image.height,
      });
      targetLabel = result.targetLabel;
      saved += 1;
    } catch (error) {
      failures.push(errorText(error));
    }
  }
  if (saved === 0) {
    throw new Error(`批量收藏失败：${picked.selected.length} 张全部未能保存。首个原因：${failures[0] || '未知'}`);
  }
  const failNote = failures.length > 0 ? `，${failures.length} 张失败（${failures[0]}）` : '';
  await toast(tab, `已收藏 ${saved} 张图片到 ${targetLabel}${failNote}`, true);
}

async function collectSingleImage(tab, imageSrc) {
  assertCollectableUrl(tab);
  if (!/^https?:\/\//i.test(imageSrc || '')) {
    throw new Error(`只能收藏 http/https 图片地址，收到：${String(imageSrc || '').slice(0, 100)}。`);
  }
  // 找回对应 <img> 读 eagle-* 收藏属性（eagle-src 指向原图时按原图下载）；
  // 找不到元素/注入失败不阻断，按右键给的地址收藏。
  let attrs = {};
  try {
    attrs = await runPageScript(tab, findImageAttributesScript, [imageSrc], '读取图片属性');
  } catch {
    attrs = {};
  }
  const downloadSrc = attrs.eagleSrc || imageSrc;
  const image = await downloadImageAsBase64(downloadSrc);
  const result = await sendClientRequest('collect.save', {
    kind: 'image',
    sourceUrl: tab.url,
    title: tab.title || '',
    imageSrc: downloadSrc,
    ...(attrs.alt ? { alt: attrs.alt } : {}),
    ...(attrs.annotation ? { annotation: attrs.annotation } : {}),
    ...(Array.isArray(attrs.tags) && attrs.tags.length > 0 ? { tags: attrs.tags } : {}),
    ...(attrs.link ? { link: attrs.link } : {}),
    base64: image.base64,
    format: image.format,
    width: image.width,
    height: image.height,
  });
  await toast(tab, `已收藏图片（${image.width}×${image.height}）到 ${result.targetLabel}\n${result.fileName}`, true);
}

// ---------- 统一入口 ----------

const ACTION_RUNNERS = {
  'collect-save-link': saveLink,
  'collect-batch': batchCollect,
  'collect-region': captureRegionAndSave,
  'collect-visible': captureVisibleAndSave,
  'collect-fullpage': captureFullPageAndSave,
};

export const COLLECT_ACTIONS = Object.keys(ACTION_RUNNERS);

/**
 * 执行一个收藏动作。imageSrc 仅右键「收藏这张图片」使用。
 * 失败会在页面 toast 展示具体原因（哪一步、什么问题、怎么办），不静默。
 */
export async function runCollectAction(action, options = {}) {
  if (collectBusy) {
    const tab = await getActiveCollectTab().catch(() => null);
    if (tab) {
      await toast(tab, '上一个收藏动作还在进行中，请先完成或取消。', false);
    }
    return;
  }
  collectBusy = true;
  let tab = null;
  try {
    tab = options.tab || (await getActiveCollectTab());
    if (action === 'collect-image') {
      await collectSingleImage(tab, options.imageSrc);
      return;
    }
    const runner = ACTION_RUNNERS[action];
    if (!runner) {
      throw new Error(`未知的收藏动作：${String(action)}。`);
    }
    await runner(tab);
  } catch (error) {
    if (tab) {
      await toast(tab, `收藏失败：${errorText(error)}`, false);
    } else {
      // 连活动标签页都拿不到（如焦点在 DevTools 窗口）：用全局角标提示，不静默
      try {
        await chrome.action.setBadgeBackgroundColor({ color: '#b22c2c' });
        await chrome.action.setBadgeText({ text: '✗' });
        setTimeout(() => {
          chrome.action.setBadgeText({ text: '' }).catch(() => {});
        }, BADGE_FLASH_MS);
      } catch {
        // 角标也失败则无反馈出口，接受
      }
    }
  } finally {
    collectBusy = false;
  }
}
