// 收藏功能经 chrome.scripting.executeScript({ func }) 注入页面的纯函数。
// 与 page-scripts.js 同样的硬性约束：
//   1. 函数体必须自包含（不能引用模块作用域的变量/辅助函数）；
//   2. 参数只能经 args 传入（可 JSON 序列化）；
//   3. 失败用 { error: '中文原因' } 表达；
//   4. 允许返回 Promise（executeScript 会等待其 resolve）。

// 区域截图框选覆盖层：按下拖拽画框，松开即确认；Esc 取消。
// 确认后先移除覆盖层并等两帧重绘（避免遮罩被截进图里），再 resolve 选区
// （视口 CSS 像素坐标 + innerWidth，供 service worker 按截图实际宽度换算裁剪）。
export function selectRegionScript(timeoutMs) {
  const TIMEOUT = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 120000;
  const MIN_SIZE = 4;
  if (document.getElementById('designecho-region-overlay')) {
    return { error: '已有一个进行中的区域截图，请先完成或按 Esc 取消。' };
  }
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'designecho-region-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;' +
      'background:rgba(0,0,0,0.08);user-select:none;';
    const hint = document.createElement('div');
    hint.textContent = '拖拽框选要截取的区域，松开确认，Esc 取消';
    hint.style.cssText =
      'position:fixed;top:16px;left:50%;transform:translateX(-50%);' +
      'background:rgba(17,17,17,0.85);color:#fff;font:13px/1.6 system-ui,sans-serif;' +
      'padding:6px 14px;border-radius:6px;pointer-events:none;';
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;display:none;border:1px solid #4d8dff;' +
      'background:rgba(77,141,255,0.12);box-shadow:0 0 0 100000px rgba(0,0,0,0.3);' +
      'pointer-events:none;';
    // 实时尺寸标签（对齐 Eagle：拖拽时跟随选框显示 宽×高）
    const sizeLabel = document.createElement('div');
    sizeLabel.style.cssText =
      'position:fixed;display:none;background:rgba(17,17,17,0.85);color:#fff;' +
      'font:11px/1 system-ui,sans-serif;padding:4px 8px;border-radius:4px;pointer-events:none;';
    overlay.appendChild(hint);
    overlay.appendChild(box);
    overlay.appendChild(sizeLabel);
    document.documentElement.appendChild(overlay);

    let startX = 0;
    let startY = 0;
    let dragging = false;
    let done = false;

    function currentRect(event) {
      const x = Math.min(startX, event.clientX);
      const y = Math.min(startY, event.clientY);
      const width = Math.abs(event.clientX - startX);
      const height = Math.abs(event.clientY - startY);
      return { x, y, width, height };
    }

    function drawRect(rect) {
      box.style.left = rect.x + 'px';
      box.style.top = rect.y + 'px';
      box.style.width = rect.width + 'px';
      box.style.height = rect.height + 'px';
      sizeLabel.textContent = Math.round(rect.width) + ' × ' + Math.round(rect.height);
      sizeLabel.style.display = 'block';
      // 标签默认挂在选框右下角外侧；贴近视口下缘时翻到框内，避免看不见
      const labelY = rect.y + rect.height + 6;
      sizeLabel.style.left = Math.max(4, rect.x + rect.width - 70) + 'px';
      sizeLabel.style.top = (labelY + 24 > window.innerHeight ? rect.y + rect.height - 26 : labelY) + 'px';
    }

    function cleanup() {
      overlay.remove();
      window.removeEventListener('keydown', onKeyDown, true);
      clearTimeout(timer);
    }

    function finish(result) {
      if (done) return;
      done = true;
      cleanup();
      // 等两帧重绘确保遮罩已从画面消失，再让 service worker 截图。
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(() => resolve(result), 60);
        });
      });
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish({ cancelled: true });
      }
    }

    overlay.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      box.style.display = 'block';
      hint.style.display = 'none';
      drawRect(currentRect(event));
    });
    overlay.addEventListener('mousemove', (event) => {
      if (!dragging) return;
      drawRect(currentRect(event));
    });
    overlay.addEventListener('mouseup', (event) => {
      if (!dragging || event.button !== 0) return;
      dragging = false;
      const rect = currentRect(event);
      if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
        // 误点视为取消（与 Eagle 行为一致：单击不产生截图）
        finish({ cancelled: true });
        return;
      }
      finish({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        // clientWidth 不含滚动条：captureVisibleTab 是否把滚动条截进图里存在平台差异，
        // service worker 侧会选与截图实际宽度更吻合的基准换算，抵消这 ~17px 误差
        clientWidth: document.documentElement.clientWidth,
        dpr: window.devicePixelRatio || 1,
      });
    });
    window.addEventListener('keydown', onKeyDown, true);
    const timer = setTimeout(() => finish({ cancelled: true, timedOut: true }), TIMEOUT);
  });
}

// 批量收藏图片选择器：列出页面里 ≥minSide 的图片，勾选后确认。
// resolve { selected: [{ src, alt, width, height }] } 或 { cancelled: true }。
// 像素下载在 service worker 完成（带扩展 host_permissions 跨域 + 登录态）。
export function pickImagesScript(minSide, maxCount, timeoutMs) {
  const MIN_SIDE = typeof minSide === 'number' && minSide > 0 ? minSide : 100;
  const MAX_COUNT = typeof maxCount === 'number' && maxCount > 0 ? Math.min(maxCount, 120) : 60;
  const TIMEOUT = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 180000;
  if (document.getElementById('designecho-pick-overlay')) {
    return { error: '已有一个进行中的批量收藏面板，请先完成或取消。' };
  }

  // 收集候选：<img>（currentSrc 覆盖 srcset/懒加载已加载的真实地址），按 src 去重。
  // 兼容 Eagle 收藏属性协议（github.com/eagle-app/eagle-attributes）：
  // 站点或用户脚本标注的 eagle-src（原图地址，替代缩略图）、eagle-title、
  // eagle-annotation、eagle-tags、eagle-link 一并读出——Eagle 的用户脚本生态直接可用。
  const seen = new Set();
  const candidates = [];
  const imgs = Array.from(document.images || []);
  for (const img of imgs) {
    const eagleSrc = img.getAttribute('eagle-src') || '';
    const src = /^https?:\/\//i.test(eagleSrc) ? eagleSrc : (img.currentSrc || img.src || '');
    if (!src || seen.has(src)) continue;
    if (!/^https?:\/\//i.test(src)) continue;
    const width = Math.max(img.naturalWidth || 0, Math.round(img.getBoundingClientRect().width));
    const height = Math.max(img.naturalHeight || 0, Math.round(img.getBoundingClientRect().height));
    if (Math.min(width, height) < MIN_SIDE) continue;
    seen.add(src);
    const candidate = {
      src,
      alt: ((img.getAttribute('eagle-title') || img.alt || '')).slice(0, 120),
      width,
      height,
    };
    const annotation = (img.getAttribute('eagle-annotation') || '').slice(0, 300);
    const tagsRaw = (img.getAttribute('eagle-tags') || '').slice(0, 300);
    const link = (img.getAttribute('eagle-link') || '').slice(0, 1024);
    if (annotation) candidate.annotation = annotation;
    if (tagsRaw) candidate.tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10);
    if (/^https?:\/\//i.test(link)) candidate.link = link;
    candidates.push(candidate);
    if (candidates.length >= MAX_COUNT) break;
  }
  if (candidates.length === 0) {
    return {
      error:
        `页面上没有找到短边 ≥${MIN_SIDE}px 的可收藏图片。` +
        '图片可能是懒加载或 CSS 背景图；先滚动页面让图片加载后再试。',
    };
  }

  return new Promise((resolve) => {
    let done = false;
    const selected = new Set();

    const overlay = document.createElement('div');
    overlay.id = 'designecho-pick-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.55);' +
      'display:flex;align-items:center;justify-content:center;font:13px/1.5 system-ui,sans-serif;';
    const panel = document.createElement('div');
    panel.style.cssText =
      'background:#fff;color:#111;border-radius:10px;width:min(860px,92vw);' +
      'max-height:86vh;display:flex;flex-direction:column;overflow:hidden;' +
      'box-shadow:0 12px 40px rgba(0,0,0,0.35);';
    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #eee;';
    const titleEl = document.createElement('strong');
    titleEl.textContent = '批量收藏到 DesignEcho';
    const countEl = document.createElement('span');
    countEl.style.cssText = 'color:#666;';
    const toggleAllBtn = document.createElement('button');
    toggleAllBtn.textContent = '全选';
    toggleAllBtn.style.cssText =
      'margin-left:auto;padding:4px 12px;border:1px solid #ccc;border-radius:6px;' +
      'background:#fff;cursor:pointer;font:inherit;';
    header.appendChild(titleEl);
    header.appendChild(countEl);
    header.appendChild(toggleAllBtn);

    const grid = document.createElement('div');
    grid.style.cssText =
      'flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));' +
      'gap:10px;padding:14px 16px;background:#fafafa;';

    const footer = document.createElement('div');
    footer.style.cssText =
      'display:flex;gap:10px;justify-content:flex-end;padding:12px 16px;border-top:1px solid #eee;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText =
      'padding:6px 18px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;font:inherit;';
    const confirmBtn = document.createElement('button');
    confirmBtn.style.cssText =
      'padding:6px 18px;border:none;border-radius:6px;background:#1a1a1a;color:#fff;cursor:pointer;font:inherit;';
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    panel.appendChild(header);
    panel.appendChild(grid);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    document.documentElement.appendChild(overlay);

    function refreshCount() {
      countEl.textContent = `已选 ${selected.size} / ${candidates.length} 张`;
      confirmBtn.textContent = selected.size > 0 ? `收藏 ${selected.size} 张` : '收藏';
      confirmBtn.disabled = selected.size === 0;
      confirmBtn.style.opacity = selected.size === 0 ? '0.45' : '1';
      toggleAllBtn.textContent = selected.size === candidates.length ? '全不选' : '全选';
    }

    const cardBySrc = new Map();
    for (const candidate of candidates) {
      const card = document.createElement('div');
      card.style.cssText =
        'position:relative;border:2px solid transparent;border-radius:8px;overflow:hidden;' +
        'cursor:pointer;background:#fff;aspect-ratio:1;display:flex;align-items:center;justify-content:center;';
      const thumb = document.createElement('img');
      thumb.src = candidate.src; // 同源缓存直出；跨域失败只影响预览，不影响收藏下载
      thumb.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;pointer-events:none;';
      const mark = document.createElement('div');
      mark.textContent = '✓';
      mark.style.cssText =
        'position:absolute;top:6px;right:6px;width:22px;height:22px;border-radius:50%;' +
        'background:#4d8dff;color:#fff;display:none;align-items:center;justify-content:center;font-size:14px;';
      const size = document.createElement('div');
      size.textContent = `${candidate.width}×${candidate.height}`;
      size.style.cssText =
        'position:absolute;left:0;right:0;bottom:0;padding:2px 6px;background:rgba(0,0,0,0.55);' +
        'color:#fff;font-size:11px;pointer-events:none;';
      card.appendChild(thumb);
      card.appendChild(mark);
      card.appendChild(size);
      card.addEventListener('click', () => {
        if (selected.has(candidate.src)) {
          selected.delete(candidate.src);
          card.style.borderColor = 'transparent';
          mark.style.display = 'none';
        } else {
          selected.add(candidate.src);
          card.style.borderColor = '#4d8dff';
          mark.style.display = 'flex';
        }
        refreshCount();
      });
      cardBySrc.set(candidate.src, { card, mark });
      grid.appendChild(card);
    }

    function setAll(on) {
      selected.clear();
      for (const candidate of candidates) {
        const entry = cardBySrc.get(candidate.src);
        if (on) selected.add(candidate.src);
        entry.card.style.borderColor = on ? '#4d8dff' : 'transparent';
        entry.mark.style.display = on ? 'flex' : 'none';
      }
      refreshCount();
    }
    toggleAllBtn.addEventListener('click', () => setAll(selected.size !== candidates.length));

    function cleanup() {
      overlay.remove();
      window.removeEventListener('keydown', onKeyDown, true);
      clearTimeout(timer);
    }
    function finish(result) {
      if (done) return;
      done = true;
      cleanup();
      resolve(result);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish({ cancelled: true });
      }
    }
    cancelBtn.addEventListener('click', () => finish({ cancelled: true }));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish({ cancelled: true });
    });
    confirmBtn.addEventListener('click', () => {
      if (selected.size === 0) return;
      finish({ selected: candidates.filter((candidate) => selected.has(candidate.src)) });
    });
    window.addEventListener('keydown', onKeyDown, true);
    const timer = setTimeout(() => finish({ cancelled: true, timedOut: true }), TIMEOUT);
    refreshCount();
  });
}

// 按右键菜单给的图片地址在页面里找回对应 <img>，读取 Eagle 收藏属性
// （eagle-src/eagle-title/eagle-annotation/eagle-tags/eagle-link）。
// 找不到元素不算错误（图片可能在 shadow DOM / canvas 里），返回空对象按原地址收藏。
export function findImageAttributesScript(srcUrl) {
  const target = String(srcUrl || '');
  if (!target) return {};
  for (const img of Array.from(document.images || [])) {
    if (img.currentSrc !== target && img.src !== target) continue;
    const out = {};
    const eagleSrc = img.getAttribute('eagle-src') || '';
    const title = (img.getAttribute('eagle-title') || img.alt || '').slice(0, 120);
    const annotation = (img.getAttribute('eagle-annotation') || '').slice(0, 300);
    const tagsRaw = (img.getAttribute('eagle-tags') || '').slice(0, 300);
    const link = (img.getAttribute('eagle-link') || '').slice(0, 1024);
    if (/^https?:\/\//i.test(eagleSrc)) out.eagleSrc = eagleSrc;
    if (title) out.alt = title;
    if (annotation) out.annotation = annotation;
    if (tagsRaw) out.tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10);
    if (/^https?:\/\//i.test(link)) out.link = link;
    return out;
  }
  return {};
}

// 页面右下角轻提示（收藏成功/失败反馈）。同 id 复用节点，连续操作不堆叠。
export function showToastScript(message, ok) {
  const ID = 'designecho-collect-toast';
  const existing = document.getElementById(ID);
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = ID;
  toast.textContent = String(message || '');
  toast.style.cssText =
    'position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:340px;' +
    'padding:10px 16px;border-radius:8px;font:13px/1.6 system-ui,sans-serif;color:#fff;' +
    'box-shadow:0 6px 24px rgba(0,0,0,0.25);white-space:pre-line;' +
    `background:${ok ? 'rgba(22,22,22,0.92)' : 'rgba(178,44,44,0.95)'};`;
  document.documentElement.appendChild(toast);
  setTimeout(() => toast.remove(), ok ? 3200 : 6000);
  return { done: true };
}
