var templateLibraryState = {
    success: false,
    detailReady: false,
    connected: false,
    error: '',
    settings: { localLibraryDirs: [], libraries: [] },
    libraries: [],
    activeLibraryId: '',
    relativePath: '',
    breadcrumbs: [],
    entries: [],
    assets: [],
    tags: [],
    templates: [],
    storageInfo: null
};
var templateLibraryView = 'list';
var templateLibraryQuery = '';
var templateLibraryAssetQuery = '';
var templateLibraryCardSize = 12;
// 首次布局前待换算的缩放语义：'default'=没有历史偏好，'legacy'=旧档位偏好，''=已是当前语义
var templateLibraryCardSizePendingModel = 'default';
var templateLibraryCreateModalVisible = false;
var templateLibraryDraftName = '';
var templateLibraryExternalDragDepth = 0;
var templateLibrarySelectedTags = [];
var templateLibrarySelectedAssetPath = '';
var templateLibraryTagModalVisible = false;
var templateLibraryDraftAssetTags = '';
var templateLibraryEditingAssetPath = '';
var templateLibraryRenameModalVisible = false;
var templateLibraryDraftAssetName = '';
var templateLibraryRenamingAssetPath = '';
var templateLibraryCardSizeResizeBound = false;
// 拖缩放期间复用上一帧的正文高度，避免每帧对每张卡片强制重排（松手后会精确重测）
var templateLibraryGridLayoutReuseBodyHeight = false;
var templateLibraryColumnShiftTimer = 0;
// 缩放控件的外观刷新入口（bind 时赋值），换算初始视图后用它把滑块拨到对应位置
var templateLibraryCardSizeRenderUI = null;
var templateLibraryStateHydrated = false;
var templateLibraryStateLoading = false;
var templateLibraryLastHydratedAt = 0;
var templateLibraryLastRefreshRequestAt = 0;
var TEMPLATE_LIBRARY_ENTER_REFRESH_INTERVAL_MS = 15000;
var TEMPLATE_LIBRARY_MIN_REFRESH_GAP_MS = 1200;
var TEMPLATE_LIBRARY_ASSET_PAGE_SIZE = 80;
var TEMPLATE_LIBRARY_DROP_MAX_BINARY_BYTES = 20 * 1024 * 1024;
var TEMPLATE_LIBRARY_DROP_SUPPORTED_EXTS = ['psd', 'psb', 'tif', 'tiff', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'txt'];
var templateLibraryContextMenuGuardBound = false;
var templateLibraryDelegatedEventsBound = false;
var templateLibraryVisibleAssetLimit = TEMPLATE_LIBRARY_ASSET_PAGE_SIZE;
var templateLibraryLastAssetViewSignature = '';
var templateLibraryLastFilterSignature = '';
var templateLibraryLoadMoreObserver = null;
var templateLibraryRenderedRegions = {
    selectedAssetPanel: '',
    meta: '',
    tagRail: '',
    libraryList: '',
    templateList: ''
};

// —— 瀑布流与浏览体验 ——
// 卡片按真实宽高比占位（消除图片解码后的跳动），卡片宽度由缩放值连续决定、列数是推导结果。
var TEMPLATE_LIBRARY_GRID_GAP = 8;
var TEMPLATE_LIBRARY_MIN_CARD_WIDTH = 92;
var TEMPLATE_LIBRARY_MAX_COLUMNS = 6;
// 加减按钮/方向键每步的卡片放大倍率：按比例而不是按滑块百分比走，
// 否则同样"点一下"在小卡片时只动 1px、在大卡片时动 30px
var TEMPLATE_LIBRARY_CARD_SIZE_STEP_RATIO = 1.08;
// 缩放值语义版本：写进本地偏好，用来区分旧的"列数档位"与现在的"卡片宽度"
var TEMPLATE_LIBRARY_CARD_SIZE_MODEL = 'width-v1';
// 缩放曲线指数：>1 把行程往小卡片一侧偏。纯等比映射下"单列大图"会占掉六成行程，
// 而日常在窄面板里调的是 2~3 列，行程要留给它们
var TEMPLATE_LIBRARY_CARD_SIZE_CURVE = 1.8;
// 无历史偏好时的初始视图：窄面板下正好是一行 3 张铺满
var TEMPLATE_LIBRARY_DEFAULT_COLUMNS = 3;
// 拖动经过"整数列铺满"时的吸附半径（卡片宽度像素）：整齐的落点值得给手一点磁性
var TEMPLATE_LIBRARY_CARD_SIZE_SNAP_PX = 5;
// 预览高度上限（相对列宽）：超长图（详情页整页）不允许把一张卡片撑成几屏
var TEMPLATE_LIBRARY_MAX_PREVIEW_RATIO = 1.9;
var TEMPLATE_LIBRARY_MIN_PREVIEW_RATIO = 0.42;
var TEMPLATE_LIBRARY_LONG_IMAGE_RATIO = 2.4;
var TEMPLATE_LIBRARY_DEFAULT_RATIO = 0.78;
// 正文高度以实测为准，这两个值只在元素还没上屏（offsetHeight 为 0）时兜底
var TEMPLATE_LIBRARY_CARD_FOOTER_HEIGHT = 46;
var TEMPLATE_LIBRARY_CARD_FOOTER_TAGS_HEIGHT = 64;
var TEMPLATE_LIBRARY_PREFS_KEY = 'designecho_design_library_prefs_v1';

// 多选：数组保序，templateLibrarySelectedAssetPath 始终是"主选"（Inspector 展示对象 / 范围选择锚点）
var templateLibrarySelectedAssetPaths = [];
var templateLibraryTagRailExpanded = false;
var templateLibraryUntaggedOnly = false;
// 用户主动退回列表页后，不再因为数据到达而自动跳进设计库详情
var templateLibraryUserLeftDetail = false;
var templateLibraryLayoutFrame = 0;
var templateLibraryPendingRelayout = false;
// 图片解码后回填的真实宽高比，补齐服务端读不出尺寸的素材
var templateLibraryNaturalRatioCache = {};
var templateLibraryInternalDragActive = false;
var templateLibraryPrefsLoaded = false;
var templateLibraryLastGridSignature = '';
var templateLibraryAssetSearchTimer = null;

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function loadTemplateLibraryPrefs() {
    if (templateLibraryPrefsLoaded) {
        return;
    }
    templateLibraryPrefsLoaded = true;

    var raw = '';
    try {
        raw = window.localStorage?.getItem(TEMPLATE_LIBRARY_PREFS_KEY) || '';
    } catch (error) {
        console.warn('[DesignLibrary] 读取本地偏好失败，使用默认视图设置:', error);
        return;
    }
    if (!raw) {
        return;
    }

    var parsed = null;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        console.warn('[DesignLibrary] 本地偏好格式损坏，已忽略:', error);
        return;
    }

    if (Number.isFinite(Number(parsed?.cardSize))) {
        templateLibraryCardSize = clampTemplateLibraryCardSize(Number(parsed.cardSize));
        // 旧偏好里的数值是"档位"（滑块 → 整数列数），和现在的"卡片宽度"不是一个量纲：
        // 直接沿用会让老用户打开时列数莫名变化，交给首次布局按原列数换算一次。
        templateLibraryCardSizePendingModel = parsed?.cardSizeModel === TEMPLATE_LIBRARY_CARD_SIZE_MODEL ? '' : 'legacy';
    }
    templateLibraryTagRailExpanded = !!parsed?.tagRailExpanded;
}

function saveTemplateLibraryPrefs() {
    try {
        window.localStorage?.setItem(TEMPLATE_LIBRARY_PREFS_KEY, JSON.stringify({
            cardSize: clampTemplateLibraryCardSize(templateLibraryCardSize),
            cardSizeModel: TEMPLATE_LIBRARY_CARD_SIZE_MODEL,
            tagRailExpanded: !!templateLibraryTagRailExpanded
        }));
    } catch (error) {
        console.warn('[DesignLibrary] 保存本地偏好失败（不影响当前会话）:', error);
    }
}

function getTemplateLibraryAssetRatio(item) {
    var relativePath = String(item?.relativePath || '').trim();
    var cachedRatio = Number(templateLibraryNaturalRatioCache[relativePath] || 0);
    if (cachedRatio > 0) {
        return cachedRatio;
    }

    var width = Number(item?.width || 0);
    var height = Number(item?.height || 0);
    if (width > 0 && height > 0) {
        return height / width;
    }
    return 0;
}

function getTemplateLibraryPreviewRatio(item) {
    var ratio = getTemplateLibraryAssetRatio(item);
    if (ratio <= 0) {
        // 文本素材没有画面尺寸，按能放下四行摘要的方块比例占位
        return String(item?.assetType || '') === 'text' ? 0.72 : TEMPLATE_LIBRARY_DEFAULT_RATIO;
    }
    return Math.max(TEMPLATE_LIBRARY_MIN_PREVIEW_RATIO, Math.min(TEMPLATE_LIBRARY_MAX_PREVIEW_RATIO, ratio));
}

function isTemplateLibraryLongAsset(item) {
    return getTemplateLibraryAssetRatio(item) >= TEMPLATE_LIBRARY_LONG_IMAGE_RATIO;
}

/**
 * 比卡片可用比例更扁的素材（卖点横条、通栏 banner）
 *
 * 这类图裁掉左右就丢信息，改成完整显示 + 上下留白；只有超长图才裁切。
 */
function isTemplateLibraryWideAsset(item) {
    var ratio = getTemplateLibraryAssetRatio(item);
    return ratio > 0 && ratio < TEMPLATE_LIBRARY_MIN_PREVIEW_RATIO;
}

function formatTemplateLibraryDimensionLabel(item) {
    var width = Math.round(Number(item?.width || 0));
    var height = Math.round(Number(item?.height || 0));
    if (width > 0 && height > 0) {
        return width + ' × ' + height;
    }
    return '';
}

function getTemplateLibraryAssetSortTime(item) {
    return Number(item?.updatedAt || 0) || 0;
}

/**
 * 素材墙排序：最近更新在前，同一时间按名称
 *
 * 顺序不可省——不排就跟着后端返回的顺序走，每次刷新素材位置都可能变。
 * 排序方式此前可切换（名称/尺寸/体积），控件已按需求移除，只留这一条规则。
 */
function sortTemplateLibraryAssets(assets) {
    var list = Array.isArray(assets) ? assets.slice() : [];
    return list.sort(function(a, b) {
        var timeA = getTemplateLibraryAssetSortTime(a);
        var timeB = getTemplateLibraryAssetSortTime(b);
        if (timeA !== timeB) {
            return timeB - timeA;
        }
        return String(a?.name || '').localeCompare(String(b?.name || ''), 'zh-CN');
    });
}

function getActiveTemplateLibrary() {
    var libraries = Array.isArray(templateLibraryState.libraries) ? templateLibraryState.libraries : [];
    return libraries.find(function(item) {
        return item.id === templateLibraryState.activeLibraryId;
    }) || libraries[0] || null;
}

function hasUsableTemplateLibrarySnapshot() {
    var libraries = Array.isArray(templateLibraryState.libraries) ? templateLibraryState.libraries : [];
    var assets = Array.isArray(templateLibraryState.assets) ? templateLibraryState.assets : [];
    var activeLibrary = getActiveTemplateLibrary();
    return libraries.length > 0 || assets.length > 0 || !!activeLibrary;
}

function requestTemplateLibraryRefresh(force, options) {
    if (templateLibraryState.connected === false) {
        // 断连时静默返回会让刷新按钮"点了没反应"，用户无从判断是卡住还是没连上
        if (options?.userInitiated && typeof showToast === 'function') {
            showToast('未连接到 DesignEcho 主程序，暂时无法刷新设计库', 'warning');
        }
        return;
    }

    var now = Date.now();
    if (!force && now - templateLibraryLastRefreshRequestAt < TEMPLATE_LIBRARY_MIN_REFRESH_GAP_MS) {
        return;
    }

    templateLibraryLastRefreshRequestAt = now;
    sendToUXP('templateLibraryRefresh');
}

function shouldRefreshTemplateLibraryOnEnter() {
    if (templateLibraryState.connected === false) {
        return false;
    }
    if (!templateLibraryStateHydrated) {
        return true;
    }
    if (!hasUsableTemplateLibrarySnapshot()) {
        return true;
    }
    return Date.now() - templateLibraryLastHydratedAt > TEMPLATE_LIBRARY_ENTER_REFRESH_INTERVAL_MS;
}

function normalizeTemplateLibraryTagList(tags) {
    var seen = {};
    return (Array.isArray(tags) ? tags : [])
        .map(function(tag) { return String(tag || '').trim(); })
        .filter(function(tag) {
            if (!tag || seen[tag]) return false;
            seen[tag] = true;
            return true;
        });
}

function parseTemplateLibraryTagInput(rawValue) {
    return normalizeTemplateLibraryTagList(String(rawValue || '').split(/[,\n\uFF0C]+/));
}

function getTemplateLibraryAssetGlyph(item) {
    var assetType = String(item?.assetType || '');
    var format = String(item?.fileFormat || '').toLowerCase();
    if (assetType === 'text' || format === 'txt') return 'TXT';
    if (assetType === 'vector' || format === 'svg') return 'SVG';
    if (format === 'psd') return 'PSD';
    if (format === 'psb') return 'PSB';
    if (format === 'tif' || format === 'tiff') return 'TIF';
    if (format === 'png') return 'PNG';
    if (format === 'jpg' || format === 'jpeg') return 'JPG';
    if (format === 'webp') return 'WEBP';
    return 'FILE';
}

function getTemplateLibraryAssetFormatClass(item) {
    var format = String(item?.fileFormat || '').toLowerCase();
    if (format === 'txt') return 'format-file';
    if (format === 'svg') return 'format-png';
    if (format === 'tiff') return 'format-tif';
    if (['psd', 'psb', 'tif', 'png', 'jpg', 'jpeg', 'webp'].includes(format)) {
        return 'format-' + format;
    }
    return 'format-file';
}

function matchesTemplateLibraryAssetQuery(item, query) {
    var normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) {
        return true;
    }

    var tags = Array.isArray(item?.tags) ? item.tags : [];
    var haystack = [
        item?.name,
        item?.relativePath,
        item?.fileFormat,
        item?.assetType,
        item?.textPreview,
        tags.join(' ')
    ].map(function(value) {
        return String(value || '').trim().toLowerCase();
    }).filter(Boolean);

    return haystack.some(function(value) {
        return value.includes(normalizedQuery);
    });
}

function getTemplateLibraryQueryMatchedAssets() {
    var assets = Array.isArray(templateLibraryState.assets) ? templateLibraryState.assets : [];
    return assets.filter(function(item) {
        return matchesTemplateLibraryAssetQuery(item, templateLibraryAssetQuery);
    });
}

function getTemplateLibraryVisibleAssets() {
    var selectedTags = normalizeTemplateLibraryTagList(templateLibrarySelectedTags);

    var filtered = getTemplateLibraryQueryMatchedAssets().filter(function(item) {
        var itemTags = normalizeTemplateLibraryTagList(item?.tags || []);

        if (templateLibraryUntaggedOnly) {
            return itemTags.length === 0;
        }

        if (selectedTags.length === 0) {
            return true;
        }

        if (itemTags.length === 0) {
            return false;
        }

        return selectedTags.some(function(tag) {
            return itemTags.includes(tag);
        });
    });

    return sortTemplateLibraryAssets(filtered);
}

function getTemplateLibrarySelectedAssetPaths() {
    var known = {};
    (Array.isArray(templateLibraryState.assets) ? templateLibraryState.assets : []).forEach(function(item) {
        known[String(item?.relativePath || '').trim()] = true;
    });
    return templateLibrarySelectedAssetPaths.filter(function(item) {
        return !!item && known[item];
    });
}

function isTemplateLibraryAssetSelected(relativePath) {
    return templateLibrarySelectedAssetPaths.indexOf(String(relativePath || '').trim()) >= 0;
}

function setTemplateLibrarySelection(paths, primaryPath) {
    var seen = {};
    templateLibrarySelectedAssetPaths = (Array.isArray(paths) ? paths : [])
        .map(function(item) { return String(item || '').trim(); })
        .filter(function(item) {
            if (!item || seen[item]) return false;
            seen[item] = true;
            return true;
        });

    var primary = String(primaryPath || '').trim();
    templateLibrarySelectedAssetPath = templateLibrarySelectedAssetPaths.includes(primary)
        ? primary
        : (templateLibrarySelectedAssetPaths[templateLibrarySelectedAssetPaths.length - 1] || '');
}

function applyTemplateLibraryAssetClickSelection(relativePath, modifiers) {
    var targetPath = String(relativePath || '').trim();
    if (!targetPath) {
        return;
    }

    var visiblePaths = getTemplateLibraryVisibleAssets()
        .slice(0, templateLibraryVisibleAssetLimit)
        .map(function(item) { return String(item?.relativePath || '').trim(); });

    if (modifiers?.range && templateLibrarySelectedAssetPath) {
        var anchorIndex = visiblePaths.indexOf(templateLibrarySelectedAssetPath);
        var targetIndex = visiblePaths.indexOf(targetPath);
        if (anchorIndex >= 0 && targetIndex >= 0) {
            var start = Math.min(anchorIndex, targetIndex);
            var end = Math.max(anchorIndex, targetIndex);
            setTemplateLibrarySelection(visiblePaths.slice(start, end + 1), templateLibrarySelectedAssetPath);
            return;
        }
    }

    if (modifiers?.toggle) {
        if (isTemplateLibraryAssetSelected(targetPath)) {
            setTemplateLibrarySelection(
                templateLibrarySelectedAssetPaths.filter(function(item) { return item !== targetPath; }),
                ''
            );
        } else {
            setTemplateLibrarySelection(templateLibrarySelectedAssetPaths.concat(targetPath), targetPath);
        }
        return;
    }

    setTemplateLibrarySelection([targetPath], targetPath);
}

/**
 * 筛选签名：只包含"用户改变了看什么"的输入
 *
 * 与素材集合签名分开，这样后台刷新（数量变化）不会把已加载的分页收回第一页。
 */
function buildTemplateLibraryFilterSignature(activeLibrary) {
    return [
        String(activeLibrary?.id || ''),
        String(templateLibraryAssetQuery || '').trim().toLowerCase(),
        normalizeTemplateLibraryTagList(templateLibrarySelectedTags).join('|'),
        templateLibraryUntaggedOnly ? 'untagged' : ''
    ].join('::');
}

function buildTemplateLibraryAssetViewSignature(activeLibrary, assets) {
    var list = Array.isArray(assets) ? assets : [];
    var selectedTags = normalizeTemplateLibraryTagList(templateLibrarySelectedTags).join('|');
    var firstPath = String(list[0]?.relativePath || '');
    var lastPath = String(list[list.length - 1]?.relativePath || '');
    return [
        String(activeLibrary?.id || ''),
        String(templateLibraryAssetQuery || '').trim().toLowerCase(),
        selectedTags,
        templateLibraryUntaggedOnly ? 'untagged' : '',
        String(list.length),
        firstPath,
        lastPath
    ].join('::');
}

function disconnectTemplateLibraryLoadMoreObserver() {
    if (templateLibraryLoadMoreObserver) {
        templateLibraryLoadMoreObserver.disconnect();
        templateLibraryLoadMoreObserver = null;
    }
}

/**
 * 加载下一页素材
 *
 * 增量 append 而不是整墙重绘：全量重建会让已加载的缩略图重新解码、瀑布流重排，
 * 素材越多越卡，而"继续加载"恰恰是素材多时才会用到的路径。
 */
function requestNextTemplateLibraryAssetPage() {
    var filteredAssets = getTemplateLibraryVisibleAssets();
    if (templateLibraryVisibleAssetLimit >= filteredAssets.length) {
        return;
    }

    var previousLimit = templateLibraryVisibleAssetLimit;
    templateLibraryVisibleAssetLimit = Math.min(
        filteredAssets.length,
        templateLibraryVisibleAssetLimit + TEMPLATE_LIBRARY_ASSET_PAGE_SIZE
    );

    var gridEl = getTemplateLibraryGridElement();
    var loadMoreEl = document.getElementById('templateLibraryLoadMore');
    if (!gridEl) {
        renderTemplateLibraryStateV2(templateLibraryState);
        return;
    }

    var pagedAssets = filteredAssets.slice(0, templateLibraryVisibleAssetLimit);
    var appendedHtml = pagedAssets.slice(previousLimit).map(function(item, index) {
        return renderTemplateLibraryAssetItem(item, previousLimit + index);
    }).join('');
    gridEl.insertAdjacentHTML('beforeend', appendedHtml);

    var nextLoadMoreHtml = buildTemplateLibraryLoadMoreHtml(pagedAssets.length, filteredAssets.length);
    if (loadMoreEl) {
        loadMoreEl.outerHTML = nextLoadMoreHtml;
    } else if (nextLoadMoreHtml) {
        gridEl.insertAdjacentHTML('afterend', nextLoadMoreHtml);
    }

    // 让区域缓存与 DOM 保持一致，否则下一次状态刷新会误判成"内容变了"而整墙重建
    templateLibraryRenderedRegions.templateList = buildTemplateLibraryAssetListHtml(pagedAssets, filteredAssets.length);
    templateLibraryLastAssetViewSignature = buildTemplateLibraryAssetViewSignature(getActiveTemplateLibrary(), filteredAssets);

    bindTemplateLibraryThumbRatioBackfill();
    bindTemplateLibraryLoadMoreObserver();
    syncTemplateLibrarySelectedAssetState();
    scheduleTemplateLibraryGridLayout();
}

function bindTemplateLibraryLoadMoreObserver() {
    disconnectTemplateLibraryLoadMoreObserver();

    var sentinel = document.getElementById('templateLibraryLoadMoreSentinel');
    if (!sentinel || typeof window.IntersectionObserver !== 'function') {
        return;
    }

    var root = document.querySelector('#pageTemplateLibrary .morph-main');
    templateLibraryLoadMoreObserver = new IntersectionObserver(function(entries) {
        if (entries.some(function(entry) { return entry.isIntersecting; })) {
            requestNextTemplateLibraryAssetPage();
        }
    }, {
        root: root || null,
        rootMargin: '320px 0px 320px 0px'
    });
    templateLibraryLoadMoreObserver.observe(sentinel);
}

function renderTemplateLibraryMetaSummary(totalAssets, visibleAssets, totalTags) {
    var pills = [
        '<span class="template-library-meta-pill">' + escapeHtml(String(totalAssets)) + ' \u4e2a\u7d20\u6750</span>',
        '<span class="template-library-meta-pill">' + escapeHtml(String(totalTags)) + ' \u4e2a\u6807\u7b7e</span>'
    ];

    if (Number(visibleAssets) !== Number(totalAssets)) {
        pills.push('<span class="template-library-meta-pill">\u7b5b\u9009\u7ed3\u679c ' + escapeHtml(String(visibleAssets)) + '</span>');
    }

    return pills.join('');
}

function getTemplateLibraryAssetTypeLabel(item) {
    var assetType = String(item?.assetType || '').trim().toLowerCase();
    if (assetType === 'design-file') return '\u8bbe\u8ba1\u6587\u4ef6';
    if (assetType === 'image') return '\u56fe\u7247';
    if (assetType === 'text') return '\u6587\u672c';
    if (assetType === 'vector') return '\u77e2\u91cf';
    return '\u7d20\u6750';
}

/**
 * \u6807\u7b7e\u7b5b\u9009\u6761
 *
 * \u8ba1\u6570\u8ddf\u968f\u5f53\u524d\u641c\u7d22\u7ed3\u679c\uff08\u800c\u4e0d\u662f\u5168\u5e93\u56fa\u5b9a\u503c\uff09\uff0c\u5426\u5219\u641c\u7d22\u540e\u6807\u7b7e\u4e0a\u7684\u6570\u5b57\u4f1a\u8bef\u5bfc\uff1b
 * \u6807\u7b7e\u591a\u65f6\u9ed8\u8ba4\u6298\u53e0\u6210\u4e00\u884c\uff0c\u907f\u514d\u5728\u7a84\u9762\u677f\u91cc\u628a\u7d20\u6750\u5899\u6324\u5230\u5c4f\u5e55\u5916\u3002
 */
function renderTemplateLibraryTagFilterBar() {
    var availableTags = Array.isArray(templateLibraryState.tags) ? templateLibraryState.tags : [];
    var activeTags = normalizeTemplateLibraryTagList(templateLibrarySelectedTags);
    var scopedAssets = getTemplateLibraryQueryMatchedAssets();
    var scopedCounts = {};
    var untaggedCount = 0;

    scopedAssets.forEach(function(item) {
        var itemTags = normalizeTemplateLibraryTagList(item?.tags || []);
        if (itemTags.length === 0) {
            untaggedCount += 1;
            return;
        }
        itemTags.forEach(function(tag) {
            scopedCounts[tag] = (scopedCounts[tag] || 0) + 1;
        });
    });

    var isAllActive = activeTags.length === 0 && !templateLibraryUntaggedOnly;
    var chips = [
        '<button type="button" class="template-tag-filter' + (isAllActive ? ' is-active' : '') + '" data-tag="">',
        '<span class="template-tag-filter-name">\u5168\u90e8</span>',
        '<span class="template-tag-filter-count">' + escapeHtml(String(scopedAssets.length)) + '</span>',
        '</button>'
    ];

    if (untaggedCount > 0) {
        chips.push([
            '<button type="button" class="template-tag-filter' + (templateLibraryUntaggedOnly ? ' is-active' : '') + '" data-tag-untagged="1">',
            '<span class="template-tag-filter-name">\u672a\u6807\u7b7e</span>',
            '<span class="template-tag-filter-count">' + escapeHtml(String(untaggedCount)) + '</span>',
            '</button>'
        ].join(''));
    }

    availableTags.forEach(function(tagStat) {
        var name = String(tagStat?.name || '').trim();
        if (!name) {
            return;
        }
        var count = Number(scopedCounts[name] || 0);
        var isActive = activeTags.includes(name);
        if (count === 0 && !isActive) {
            return;
        }
        chips.push([
            '<button type="button" class="template-tag-filter' + (isActive ? ' is-active' : '') + '" data-tag="' + escapeHtml(name) + '">',
            '<span class="template-tag-filter-name">' + escapeHtml(name) + '</span>',
            '<span class="template-tag-filter-count">' + escapeHtml(String(count)) + '</span>',
            '</button>'
        ].join(''));
    });

    var needsToggle = chips.length > 4;
    var toggleHtml = needsToggle
        ? '<button type="button" class="template-tag-filter template-tag-rail-toggle" id="templateLibraryTagRailToggle">'
            + '<span class="template-tag-filter-name">' + (templateLibraryTagRailExpanded ? '\u6536\u8d77' : '\u5168\u90e8\u6807\u7b7e ' + (chips.length - 1)) + '</span>'
            + '</button>'
        : '';

    return [
        '<div class="template-tag-rail-chips' + (needsToggle && !templateLibraryTagRailExpanded ? ' is-collapsed' : '') + '">',
        chips.join(''),
        '</div>',
        toggleHtml
    ].join('');
}

function getSelectedTemplateLibraryAsset() {
    var selectedPath = String(templateLibrarySelectedAssetPath || '').trim();
    if (!selectedPath) {
        return null;
    }
    return findTemplateLibraryAssetByRelativePath(selectedPath);
}

function openTemplateLibraryAssetTagEditor(relativePath) {
    var asset = findTemplateLibraryAssetByRelativePath(relativePath);
    if (!asset) {
        return;
    }

    var target = String(asset.relativePath || '').trim();
    if (!isTemplateLibraryAssetSelected(target)) {
        setTemplateLibrarySelection([target], target);
    } else {
        templateLibrarySelectedAssetPath = target;
    }

    templateLibraryEditingAssetPath = target;
    // 多选时不预填任何一个素材的标签，避免把 A 的标签误写到 B 上
    templateLibraryDraftAssetTags = getTemplateLibrarySelectedAssetPaths().length > 1
        ? ''
        : normalizeTemplateLibraryTagList(asset.tags || []).join(', ');
    templateLibraryTagModalVisible = true;
    renderTemplateLibraryStateV2(templateLibraryState);
}

function openTemplateLibraryAssetRenameEditor(relativePath) {
    var asset = findTemplateLibraryAssetByRelativePath(relativePath);
    if (!asset) {
        return;
    }
    templateLibrarySelectedAssetPath = String(asset.relativePath || '').trim();
    templateLibraryRenamingAssetPath = templateLibrarySelectedAssetPath;
    templateLibraryDraftAssetName = String(asset.name || '').trim();
    templateLibraryRenameModalVisible = true;
    renderTemplateLibraryStateV2(templateLibraryState);
}

/**
 * \u5df2\u9009\u7d20\u6750\u4fe1\u606f\u6761\uff08\u5e95\u90e8 dock\uff09
 *
 * \u653e\u5728\u5e95\u90e8\u800c\u4e0d\u662f\u9876\u90e8\uff1a\u7a84\u9762\u677f\u91cc\u9876\u90e8\u4fe1\u606f\u5757\u4f1a\u628a\u7d20\u6750\u5899\u538b\u5230\u9996\u5c4f\u4e4b\u5916\uff0c
 * \u9009\u4e2d\u6001\u662f\u4e34\u65f6\u7684\uff0c\u4e0d\u8be5\u957f\u671f\u5360\u7528\u6d4f\u89c8\u7a7a\u95f4\u3002
 */
function renderTemplateLibrarySelectedAssetPanel(item) {
    var selectedPaths = getTemplateLibrarySelectedAssetPaths();
    if (selectedPaths.length === 0 || !item) {
        return '';
    }

    if (selectedPaths.length > 1) {
        return [
            '<div class="template-library-dock is-multi">',
            '<div class="template-library-dock-main">',
            '<div class="template-library-dock-title">\u5df2\u9009 ' + escapeHtml(String(selectedPaths.length)) + ' \u4e2a\u7d20\u6750</div>',
            '<div class="template-library-dock-sub">\u6279\u91cf\u6dfb\u52a0\u6807\u7b7e\u4f1a\u4f9d\u6b21\u5199\u5165\u6bcf\u4e2a\u7d20\u6750</div>',
            '</div>',
            '<div class="template-library-dock-actions">',
            '<button type="button" class="template-library-selection-action" id="btnTemplateLibraryEditSelectedTags">\u6279\u91cf\u6807\u7b7e</button>',
            '<button type="button" class="template-library-selection-action is-quiet" id="btnTemplateLibraryClearSelection">\u53d6\u6d88\u9009\u62e9</button>',
            '</div>',
            '</div>'
        ].join('');
    }

    var assetName = escapeHtml(item?.name || '\u672a\u547d\u540d\u7d20\u6750');
    var formatLabel = escapeHtml(String(item?.fileFormat || '').toUpperCase() || 'FILE');
    var dimensionLabel = formatTemplateLibraryDimensionLabel(item);
    var metaParts = [formatLabel];
    if (dimensionLabel) {
        metaParts.push(dimensionLabel);
    }
    if (item?.fileSize) {
        metaParts.push(String(item.fileSize));
    }
    if (item?.updatedLabel) {
        metaParts.push(String(item.updatedLabel));
    }

    var tags = normalizeTemplateLibraryTagList(item?.tags || []);
    var tagsHtml = tags.length > 0
        ? tags.map(function(tag) {
            return '<span class="template-library-selection-tag">' + escapeHtml(tag) + '</span>';
        }).join('')
        : '<span class="template-library-selection-tag is-empty">\u672a\u6dfb\u52a0\u6807\u7b7e</span>';

    var thumb = String(item?.thumbnailUrl || '').trim();
    var thumbHtml = thumb
        ? '<img class="template-library-dock-thumb" src="' + escapeHtml(thumb) + '" alt="" draggable="false" />'
        : '<div class="template-library-dock-thumb is-glyph">' + escapeHtml(getTemplateLibraryAssetGlyph(item)) + '</div>';

    return [
        '<div class="template-library-dock">',
        thumbHtml,
        '<div class="template-library-dock-main">',
        '<div class="template-library-dock-title" title="' + assetName + '">' + assetName + '</div>',
        '<div class="template-library-dock-sub">' + escapeHtml(metaParts.join(' \u00b7 ')) + '</div>',
        '<div class="template-library-selection-tags">' + tagsHtml + '</div>',
        '</div>',
        '<div class="template-library-dock-actions">',
        '<button type="button" class="template-library-selection-action" id="btnTemplateLibraryPlaceSelected">\u7f6e\u5165</button>',
        '<button type="button" class="template-library-selection-action" id="btnTemplateLibraryEditSelectedTags">\u6807\u7b7e</button>',
        '<button type="button" class="template-library-selection-action is-quiet" id="btnTemplateLibraryRenameSelected">\u91cd\u547d\u540d</button>',
        '</div>',
        '</div>'
    ].join('');
}

function renderTemplateLibraryCard(item, isActive) {
    var subtitle = item?.dirPath
        ? '\u5df2\u8fde\u63a5\u672c\u5730\u76ee\u5f55'
        : '\u5c1a\u672a\u914d\u7f6e\u76ee\u5f55';
    return [
        '<button type="button" class="template-library-card template-select-library-btn' + (isActive ? ' is-active' : '') + '" data-library-id="' + escapeHtml(item?.id || '') + '">',
        '<div class="template-library-card-main">',
        '<div class="template-library-card-title-row">',
        '<div class="template-library-card-title">' + escapeHtml(item?.name || '\u672a\u547d\u540d\u8bbe\u8ba1\u5e93') + '</div>',
        isActive ? '<span class="template-library-badge">\u5f53\u524d</span>' : '',
        '</div>',
        '<div class="template-library-card-subtitle">' + escapeHtml(subtitle) + '</div>',
        '</div>',
        '<span class="template-library-enter">&#8250;</span>',
        '</button>'
    ].join('');
}

/**
 * 素材卡片
 *
 * 不把选中态写进 HTML：选中只切 class，否则任何一次后台刷新都会因为字符串差异
 * 重建整面素材墙，导致缩略图重解码、滚动错位。
 */
function renderTemplateLibraryAssetItem(item, index) {
    var glyph = getTemplateLibraryAssetGlyph(item);
    var formatClass = getTemplateLibraryAssetFormatClass(item);
    var thumb = String(item?.thumbnailUrl || '').trim();
    var textPreview = String(item?.textPreview || '').trim();
    var hasThumb = !!thumb;
    var hasTextPreview = !hasThumb && !!textPreview;
    var isLong = isTemplateLibraryLongAsset(item);
    var isWide = isTemplateLibraryWideAsset(item);
    var previewHtml = thumb
        ? '<img class="template-asset-thumb" src="' + escapeHtml(thumb) + '" alt="' + escapeHtml(item?.name || 'asset') + '" loading="lazy" decoding="async" draggable="false" />'
        : hasTextPreview
            ? '<div class="template-asset-text-preview">' + escapeHtml(textPreview) + '</div>'
            : '<span class="template-asset-glyph">' + escapeHtml(glyph) + '</span>';
    var previewClasses = [
        'template-asset-preview',
        formatClass,
        hasThumb ? 'has-thumb' : '',
        hasTextPreview ? 'has-text-preview' : '',
        isLong ? 'is-long' : '',
        isWide ? 'is-wide' : ''
    ].filter(Boolean).join(' ');
    var assetName = escapeHtml(item?.name || '未命名素材');
    var formatLabel = escapeHtml(String(item?.fileFormat || '').toUpperCase() || 'FILE');
    var tagList = normalizeTemplateLibraryTagList(item?.tags || []);
    var tags = tagList.join(', ');
    // 卡片正文第二行固定给"这张图有多大"；更细的信息（体积 / 时间）留给底部已选素材条，
    // 不在缩略图上叠浮层——那会盖住画面本身。
    var captionLabel = formatTemplateLibraryDimensionLabel(item)
        || String(item?.fileSize || '')
        || getTemplateLibraryAssetTypeLabel(item);
    var tagStripHtml = tagList.length > 0
        ? '<div class="template-item-tagstrip">'
            + tagList.slice(0, 3).map(function(tag) {
                return '<span class="template-item-tag">' + escapeHtml(tag) + '</span>';
            }).join('')
            + (tagList.length > 3 ? '<span class="template-item-tag is-more">+' + escapeHtml(String(tagList.length - 3)) + '</span>' : '')
            + '</div>'
        : '';

    return [
        '<div class="template-item-card template-item-card-waterfall template-library-asset-card"',
        ' data-index="' + escapeHtml(String(index)) + '"',
        ' data-relative-path="' + escapeHtml(item?.relativePath || '') + '"',
        ' data-asset-type="' + escapeHtml(item?.assetType || '') + '"',
        ' data-name="' + escapeHtml(item?.name || '') + '"',
        ' data-template-id="' + escapeHtml(item?.templateId || '') + '"',
        ' data-has-tags="' + (tagList.length > 0 ? '1' : '0') + '"',
        ' data-ratio="' + getTemplateLibraryPreviewRatio(item).toFixed(4) + '"',
        ' data-tags="' + escapeHtml(tags) + '">',
        '<div class="' + previewClasses + '">',
        '<div class="template-item-preview-meta">',
        '<div class="template-file-chip template-file-chip-overlay">' + formatLabel + '</div>',
        isLong ? '<div class="template-file-chip template-file-chip-overlay is-long-flag">长图</div>' : '',
        '</div>',
        previewHtml,
        '</div>',
        '<div class="template-item-body">',
        '<div class="template-item-title" title="' + assetName + '">' + assetName + '</div>',
        captionLabel ? '<div class="template-item-caption">' + escapeHtml(captionLabel) + '</div>' : '',
        tagStripHtml,
        '</div>',
        '</div>'
    ].join('');
}

function buildTemplateLibraryLoadMoreHtml(loadedCount, totalCount) {
    if (loadedCount >= totalCount) {
        return '';
    }
    return [
        '<div class="template-library-load-more" id="templateLibraryLoadMore">',
        '<button type="button" class="template-library-load-more-btn" id="templateLibraryLoadMoreButton">继续加载</button>',
        '<div class="template-library-load-more-meta">已显示 ' + escapeHtml(String(loadedCount)) + ' / ' + escapeHtml(String(totalCount)) + ' 个素材</div>',
        '<div class="template-library-load-more-sentinel" id="templateLibraryLoadMoreSentinel" aria-hidden="true"></div>',
        '</div>'
    ].join('');
}

function buildTemplateLibraryAssetListHtml(pagedAssets, totalCount) {
    return [
        renderTemplateLibraryDropzone(true),
        '<div class="template-asset-grid" id="templateLibraryGrid" tabindex="0" role="listbox" aria-label="素材墙">',
        pagedAssets.map(function(item, index) {
            return renderTemplateLibraryAssetItem(item, index);
        }).join(''),
        '</div>',
        buildTemplateLibraryLoadMoreHtml(pagedAssets.length, totalCount)
    ].join('');
}

function renderTemplateLibraryDropzone(isPersistent) {
    return [
        '<div class="design-library-drop-hint' + (isPersistent ? ' is-persistent' : '') + '" id="templateLibraryDropHint">',
        '<div class="design-library-drop-hint-card">',
        '<div class="design-library-drop-hint-icon">+</div>',
        '<div class="design-library-drop-hint-title">\u91ca\u653e\u4ee5\u5bfc\u5165\u5230\u8bbe\u8ba1\u5e93</div>',
        '<div class="design-library-drop-hint-desc">\u652f\u6301\u5916\u90e8\u6587\u4ef6\u62d6\u5165\uff0c\u4e5f\u652f\u6301\u628a Photoshop \u5f53\u524d\u9009\u4e2d\u62d6\u5165\u8fd9\u91cc</div>',
        '</div>',
        '</div>'
    ].join('');
}

function renderTemplateLibraryLoadingState(title, description) {
    return [
        '<div class="template-loading-state">',
        '<div class="template-loading-copy">',
        '<div class="template-loading-title">' + escapeHtml(title || '\u6b63\u5728\u52a0\u8f7d\u8bbe\u8ba1\u5e93...') + '</div>',
        '<div class="template-loading-desc">' + escapeHtml(description || '\u6b63\u5728\u540c\u6b65\u8bbe\u8ba1\u5e93\u72b6\u6001\uff0c\u8bf7\u7a0d\u7b49\u3002') + '</div>',
        '</div>',
        '<div class="template-loading-skeletons">',
        '<div class="template-loading-card"></div>',
        '<div class="template-loading-card is-short"></div>',
        '<div class="template-loading-card"></div>',
        '</div>',
        '</div>'
    ].join('');
}

function setTemplateLibraryRegionHtml(regionKey, element, html) {
    if (!element) {
        return false;
    }
    var nextHtml = String(html || '');
    if (templateLibraryRenderedRegions[regionKey] === nextHtml) {
        return false;
    }
    element.innerHTML = nextHtml;
    templateLibraryRenderedRegions[regionKey] = nextHtml;
    return true;
}

function closeTemplateLibraryContextMenu() {
    document.getElementById('templateLibraryContextMenu')?.remove();
    document.removeEventListener('click', closeTemplateLibraryContextMenu);
}

function closeTemplateLibraryActionsMenu() {
    document.getElementById('templateLibraryActionsMenu')?.remove();
    document.removeEventListener('click', closeTemplateLibraryActionsMenu);
}

function bindTemplateLibraryContextMenuGuard() {
    if (templateLibraryContextMenuGuardBound) {
        return;
    }

    templateLibraryContextMenuGuardBound = true;
    document.addEventListener('contextmenu', function(event) {
        var page = document.getElementById('pageTemplateLibrary');
        if (!page || !page.contains(event.target)) {
            return;
        }

        if (event.defaultPrevented) {
            return;
        }

        var target = event.target;
        if (target && target.closest && target.closest('input, textarea, [contenteditable="true"]')) {
            return;
        }

        if (target && target.closest && target.closest('.template-library-asset-card, .template-library-card, #templateLibraryContextMenu, #templateLibraryActionsMenu')) {
            return;
        }

        event.preventDefault();
        closeTemplateLibraryContextMenu();
        closeTemplateLibraryActionsMenu();
    });
}

function clampTemplateLibraryCardSize(value) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) return 12;
    return Math.max(0, Math.min(100, numeric));
}

/**
 * 缩放值 → 卡片宽度区间
 *
 * 0% 落在"最小可读卡片"，同时不允许突破最多列数；100% 是单列铺满。
 * 窄面板（340px）里 MAX_COLUMNS 那一路算出来会小于可读下限，取两者较大值即可，
 * 因此窄面板的 0% 就是 92px（约 3 列），宽面板的 0% 才真的顶到 6 列。
 */
function getTemplateLibraryCardWidthRange(availableWidth) {
    var gap = TEMPLATE_LIBRARY_GRID_GAP;
    var safeWidth = Math.max(120, Number(availableWidth) || 0);
    var maxWidth = safeWidth;
    var minWidth = Math.max(
        TEMPLATE_LIBRARY_MIN_CARD_WIDTH,
        (safeWidth - gap * (TEMPLATE_LIBRARY_MAX_COLUMNS - 1)) / TEMPLATE_LIBRARY_MAX_COLUMNS
    );
    return { min: Math.min(minWidth, maxWidth), max: maxWidth };
}

/**
 * 缩放值 → 卡片宽度（无级）
 *
 * 旧实现把缩放值映射成整数列数：340px 面板里全程只有 3/2/1 列三个状态，
 * 拖动时卡片宽度一次跳 60px 以上，看着就是"一格一格蹦"。
 * 现在缩放值直接决定像素宽度，列数退化成推导结果，滑块每一像素都有效。
 * 用指数插值而非线性：尺寸感知接近对数，线性会让小端过钝、大端过冲。
 */
function getTemplateLibraryCardWidth(percent, availableWidth) {
    var range = getTemplateLibraryCardWidthRange(availableWidth);
    if (!(range.max > range.min)) {
        return range.min;
    }
    var normalized = clampTemplateLibraryCardSize(percent) / 100;
    var eased = Math.pow(normalized, TEMPLATE_LIBRARY_CARD_SIZE_CURVE);
    return range.min * Math.pow(range.max / range.min, eased);
}

/**
 * 卡片宽度 → 整行几何
 *
 * 卡片宽度连续，行宽几乎永远凑不满整数列，余量必须有去处，而去处只有两个：
 * 摊进列间距，或者整体居中留白。这里选后者——列间距恒定 8px。
 *
 * 摊进间距看着更"铺满"，但缩放时间距会跟着一起呼吸（8px 到 30px+），
 * 而间距是眼睛判断"这是一整面墙"的基准线：基准线一动，观感就变成
 * 每张图各缩各的、缝隙乱变。宁可两侧留白，也要让缝隙钉死。
 */
function getTemplateLibraryGridMetrics(percent, availableWidth) {
    var baseGap = TEMPLATE_LIBRARY_GRID_GAP;
    var safeWidth = Math.max(120, Number(availableWidth) || 0);
    var targetWidth = getTemplateLibraryCardWidth(percent, safeWidth);
    // 亚像素容差：正好铺满的宽度经过指数换算会带出 1e-7 的误差，没有它就会在
    // "3 列刚好铺满"这种临界点上掉成 2 列（差 0.0000001px 判成放不下）
    var columns = Math.max(1, Math.min(
        TEMPLATE_LIBRARY_MAX_COLUMNS,
        Math.floor((safeWidth + baseGap + 0.05) / (targetWidth + baseGap))
    ));

    // 列数取整后卡片不允许再超出该列数的铺满宽度，否则最后一列会被挤出可视区
    var columnWidth = Math.min(targetWidth, (safeWidth - baseGap * (columns - 1)) / columns);
    var offsetX = Math.max(0, (safeWidth - (columns * columnWidth + baseGap * (columns - 1))) / 2);

    return {
        gap: baseGap,
        columns: columns,
        columnWidth: columnWidth,
        offsetX: offsetX,
        availableWidth: safeWidth
    };
}

function getTemplateLibraryColumnCount(percent, availableWidth) {
    return getTemplateLibraryGridMetrics(percent, availableWidth).columns;
}

/**
 * 卡片宽度 → 缩放值（getTemplateLibraryCardWidth 的反函数）
 */
function getTemplateLibraryCardSizeForWidth(cardWidth, availableWidth) {
    var range = getTemplateLibraryCardWidthRange(availableWidth);
    if (!(range.max > range.min)) {
        return 0;
    }
    var boundedWidth = Math.max(range.min, Math.min(range.max, Number(cardWidth) || 0));
    var eased = Math.log(boundedWidth / range.min) / Math.log(range.max / range.min);
    return clampTemplateLibraryCardSize(100 * Math.pow(Math.max(0, eased), 1 / TEMPLATE_LIBRARY_CARD_SIZE_CURVE));
}

/**
 * 目标列数 → 缩放值
 *
 * 取"该列数正好铺满"的卡片宽度再反解缩放值，落点是视觉上最整齐的位置。
 * 用在两处：没有历史偏好时的初始视图，以及旧偏好的一次性换算。
 */
function getTemplateLibraryCardSizeForColumns(columns, availableWidth) {
    var safeWidth = Math.max(120, Number(availableWidth) || 0);
    var safeColumns = Math.max(1, Math.min(TEMPLATE_LIBRARY_MAX_COLUMNS, Math.round(columns) || 1));
    var fitWidth = (safeWidth - TEMPLATE_LIBRARY_GRID_GAP * (safeColumns - 1)) / safeColumns;
    return getTemplateLibraryCardSizeForWidth(fitWidth, safeWidth);
}

/**
 * 拖动取值 → 吸附到最近的"整数列铺满"
 *
 * 卡片宽度连续意味着大多数位置都会剩下一条留白，而留白为 0 的位置只有那么几个。
 * 经过它们时吸住几像素，手不用瞄准也能停在整齐的地方；半径很小，不影响无级手感。
 * 只用于拖动：加减按钮和方向键要的是可预测的等比步进，不吸附。
 */
function snapTemplateLibraryCardSizeToFit(percent, availableWidth) {
    var safeWidth = Math.max(120, Number(availableWidth) || 0);
    var width = getTemplateLibraryCardWidth(percent, safeWidth);

    for (var columns = 1; columns <= TEMPLATE_LIBRARY_MAX_COLUMNS; columns += 1) {
        var fitWidth = (safeWidth - TEMPLATE_LIBRARY_GRID_GAP * (columns - 1)) / columns;
        if (fitWidth > 0 && Math.abs(width - fitWidth) <= TEMPLATE_LIBRARY_CARD_SIZE_SNAP_PX) {
            return getTemplateLibraryCardSizeForWidth(fitWidth, safeWidth);
        }
    }

    return clampTemplateLibraryCardSize(percent);
}

/**
 * 当前缩放值按倍率走一步
 *
 * 步进定义在"卡片宽度"上而不是滑块百分比上：缩放曲线两端疏密不同，
 * 按百分比走会出现小卡片点半天不动、大卡片一点就跳一大截。
 */
function getTemplateLibrarySteppedCardSize(percent, ratio, availableWidth) {
    var safeRatio = Number(ratio);
    if (!Number.isFinite(safeRatio) || safeRatio <= 0) {
        return clampTemplateLibraryCardSize(percent);
    }
    var currentWidth = getTemplateLibraryCardWidth(percent, availableWidth);
    return getTemplateLibraryCardSizeForWidth(currentWidth * safeRatio, availableWidth);
}

/**
 * 旧档位偏好 → 当时显示的列数
 *
 * 只为把历史 localStorage 值换算成等效卡片宽度而保留；换算成功后偏好里会写上
 * cardSizeModel，之后不再走这条路。
 */
function getLegacyTemplateLibraryColumnCount(percent, availableWidth) {
    var gap = TEMPLATE_LIBRARY_GRID_GAP;
    var safeWidth = Math.max(120, Number(availableWidth) || 0);
    var maxColumns = Math.max(1, Math.min(
        TEMPLATE_LIBRARY_MAX_COLUMNS,
        Math.floor((safeWidth + gap) / (TEMPLATE_LIBRARY_MIN_CARD_WIDTH + gap))
    ));
    var normalized = clampTemplateLibraryCardSize(percent) / 100;
    return Math.max(1, Math.min(maxColumns, Math.round(maxColumns - (maxColumns - 1) * normalized)));
}

function resolveTemplateLibraryPendingCardSize(availableWidth) {
    if (!templateLibraryCardSizePendingModel || !(availableWidth > 0)) {
        return false;
    }

    var columns = templateLibraryCardSizePendingModel === 'legacy'
        ? getLegacyTemplateLibraryColumnCount(templateLibraryCardSize, availableWidth)
        : TEMPLATE_LIBRARY_DEFAULT_COLUMNS;

    templateLibraryCardSizePendingModel = '';
    templateLibraryCardSize = getTemplateLibraryCardSizeForColumns(columns, availableWidth);
    saveTemplateLibraryPrefs();
    return true;
}

function getTemplateLibraryGridElement() {
    return document.getElementById('templateLibraryGrid');
}

function measureTemplateLibraryElementContentWidth(el) {
    if (!el) {
        return 0;
    }
    var width = el.clientWidth || 0;
    if (width <= 0) {
        return 0;
    }
    var style = window.getComputedStyle(el);
    return Math.max(0, width - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
}

/**
 * 素材墙可用宽度
 *
 * 必须回到"内容宽"而不是 clientWidth：素材墙还没渲染时要退到外层容器，
 * 而外层容器带左右内边距，直接用 clientWidth 会多算出十几像素——
 * 布局按网格真实宽度算、提示按容器宽度算，就会出现"提示 3 列、实际 2 列"。
 */
function measureTemplateLibraryGridWidth() {
    return measureTemplateLibraryElementContentWidth(getTemplateLibraryGridElement())
        || measureTemplateLibraryElementContentWidth(document.getElementById('templateList'))
        || measureTemplateLibraryElementContentWidth(document.querySelector('#pageTemplateLibrary .morph-main'));
}

/**
 * 按最短列放置卡片的瀑布流布局
 *
 * 用绝对定位而不是 CSS 多列：多列是"列优先"填充（先填满第一列再换列），
 * 素材的阅读顺序会变成竖向；而且改列数必须重建 DOM，缩略图会重新解码。
 */
function layoutTemplateLibraryGrid() {
    var gridEl = getTemplateLibraryGridElement();
    if (!gridEl) {
        return;
    }

    var cards = Array.prototype.slice.call(gridEl.querySelectorAll('.template-library-asset-card'));
    if (cards.length === 0) {
        gridEl.style.height = '0px';
        return;
    }

    var availableWidth = gridEl.clientWidth || measureTemplateLibraryGridWidth();

    // 初始视图（默认列数 / 旧偏好换算）必须等到素材墙真的量得出宽度才能定，
    // 早一步用外层容器的宽度算，会因为内边距差十几像素而少排一列。
    if (resolveTemplateLibraryPendingCardSize(availableWidth) && typeof templateLibraryCardSizeRenderUI === 'function') {
        templateLibraryCardSizeRenderUI(templateLibraryCardSize);
    }

    var metrics = getTemplateLibraryGridMetrics(templateLibraryCardSize, availableWidth);

    // 列数变了意味着卡片要换列，位置是整块跳的：只给这一次重排开位移补间，
    // 连续缩放的其余帧仍然是即时的（加补间会让拖动整体慢半拍）。
    var previousColumns = Number(gridEl.getAttribute('data-columns'));
    if (Number.isFinite(previousColumns) && previousColumns > 0 && previousColumns !== metrics.columns) {
        markTemplateLibraryColumnShift(gridEl);
    }

    var columnHeights = [];
    for (var i = 0; i < metrics.columns; i += 1) {
        columnHeights.push(0);
    }

    // 第一遍只写：列宽与预览高度。比例在渲染时已算好写进 data-ratio，
    // 布局阶段不再回查素材列表（避免每次重排 O(卡片×素材)）。
    var placements = cards.map(function(card) {
        var ratio = Number(card.getAttribute('data-ratio'));
        if (!Number.isFinite(ratio) || ratio <= 0) {
            ratio = TEMPLATE_LIBRARY_DEFAULT_RATIO;
        }
        var previewHeight = Math.round(metrics.columnWidth * ratio);

        card.style.width = metrics.columnWidth.toFixed(2) + 'px';
        var previewEl = card.querySelector('.template-asset-preview');
        if (previewEl) {
            previewEl.style.height = previewHeight + 'px';
        }

        return { card: card, previewHeight: previewHeight };
    });

    // 第二遍只读：正文行数不固定（名称 / 尺寸 / 标签），实测比按常量估算可靠，
    // 读写分离让整轮只触发一次强制重排。
    // 拖缩放时每帧都要重排，几百张卡片逐个读 offsetHeight 会掉帧：拖动期间复用上一帧
    // 测到的正文高度（正文只有一到两行文字，跟列宽几乎无关），松手后再精确重测一次。
    placements.forEach(function(placement) {
        var cachedBodyHeight = Number(placement.card.dataset.bodyHeight);
        var bodyHeight = 0;

        if (templateLibraryGridLayoutReuseBodyHeight && Number.isFinite(cachedBodyHeight) && cachedBodyHeight > 0) {
            bodyHeight = cachedBodyHeight;
        } else {
            var bodyEl = placement.card.querySelector('.template-item-body');
            bodyHeight = bodyEl ? bodyEl.offsetHeight : 0;
            if (bodyHeight > 0) {
                placement.card.dataset.bodyHeight = String(bodyHeight);
            }
        }

        if (bodyHeight <= 0) {
            bodyHeight = placement.card.getAttribute('data-has-tags') === '1'
                ? TEMPLATE_LIBRARY_CARD_FOOTER_TAGS_HEIGHT
                : TEMPLATE_LIBRARY_CARD_FOOTER_HEIGHT;
        }
        placement.cardHeight = placement.previewHeight + bodyHeight;
    });

    // 第三遍只写：按最短列落位
    placements.forEach(function(placement) {
        var shortestIndex = 0;
        for (var col = 1; col < columnHeights.length; col += 1) {
            if (columnHeights[col] < columnHeights[shortestIndex] - 0.5) {
                shortestIndex = col;
            }
        }

        placement.card.style.transform = 'translate3d('
            + (metrics.offsetX + shortestIndex * (metrics.columnWidth + metrics.gap)).toFixed(2) + 'px, '
            + columnHeights[shortestIndex].toFixed(2) + 'px, 0)';

        columnHeights[shortestIndex] += placement.cardHeight + metrics.gap;
    });

    gridEl.style.height = Math.max(0, Math.max.apply(null, columnHeights) - metrics.gap) + 'px';
    gridEl.setAttribute('data-columns', String(metrics.columns));
}

function markTemplateLibraryColumnShift(gridEl) {
    gridEl.classList.add('is-column-shift');
    if (templateLibraryColumnShiftTimer) {
        clearTimeout(templateLibraryColumnShiftTimer);
    }
    templateLibraryColumnShiftTimer = setTimeout(function() {
        templateLibraryColumnShiftTimer = 0;
        gridEl.classList.remove('is-column-shift');
    }, 220);
}

function scheduleTemplateLibraryGridLayout() {
    if (templateLibraryLayoutFrame) {
        templateLibraryPendingRelayout = true;
        return;
    }
    templateLibraryLayoutFrame = window.requestAnimationFrame(function() {
        templateLibraryLayoutFrame = 0;
        layoutTemplateLibraryGrid();
        if (templateLibraryPendingRelayout) {
            templateLibraryPendingRelayout = false;
            scheduleTemplateLibraryGridLayout();
        }
    });
}

/**
 * 缩略图解码后回填真实宽高比
 *
 * 服务端读不出尺寸的素材（例如旧库里没有 info.json 的文件）先按默认比例占位，
 * 解码后用 naturalWidth/Height 修正一次，避免长期用错误比例显示。
 */
function bindTemplateLibraryThumbRatioBackfill() {
    var gridEl = getTemplateLibraryGridElement();
    if (!gridEl) {
        return;
    }

    gridEl.querySelectorAll('img.template-asset-thumb').forEach(function(img) {
        if (img.dataset.ratioBound === '1') {
            return;
        }
        img.dataset.ratioBound = '1';

        var card = img.closest('.template-library-asset-card');
        var relativePath = String(card?.getAttribute('data-relative-path') || '').trim();
        if (!relativePath) {
            return;
        }

        var backfill = function() {
            var naturalWidth = Number(img.naturalWidth || 0);
            var naturalHeight = Number(img.naturalHeight || 0);
            if (naturalWidth <= 0 || naturalHeight <= 0) {
                return;
            }
            var asset = findTemplateLibraryAssetByRelativePath(relativePath);
            if (asset && Number(asset.width) > 0 && Number(asset.height) > 0) {
                return;
            }
            var ratio = naturalHeight / naturalWidth;
            if (Math.abs((templateLibraryNaturalRatioCache[relativePath] || 0) - ratio) < 0.01) {
                return;
            }
            templateLibraryNaturalRatioCache[relativePath] = ratio;
            if (card) {
                var probe = asset || { relativePath: relativePath };
                card.setAttribute('data-ratio', getTemplateLibraryPreviewRatio(probe).toFixed(4));
                var previewEl = card.querySelector('.template-asset-preview');
                previewEl?.classList.toggle('is-long', isTemplateLibraryLongAsset(probe));
                previewEl?.classList.toggle('is-wide', isTemplateLibraryWideAsset(probe));
            }
            scheduleTemplateLibraryGridLayout();
        };

        if (img.complete) {
            backfill();
            return;
        }
        img.addEventListener('load', backfill, { once: true });
        img.addEventListener('error', function() {
            card?.classList.add('is-thumb-failed');
        }, { once: true });
    });
}

function applyTemplateLibraryCardSize() {
    var page = document.getElementById('pageTemplateLibrary');
    var mainEl = page?.querySelector('.morph-main');
    if (!mainEl) return;

    var metrics = getTemplateLibraryGridMetrics(templateLibraryCardSize, measureTemplateLibraryGridWidth());
    mainEl.style.setProperty('--template-library-grid-column-width', metrics.columnWidth.toFixed(2) + 'px');
    mainEl.style.setProperty('--template-library-grid-gap', metrics.gap.toFixed(2) + 'px');
    scheduleTemplateLibraryGridLayout();
}

/**
 * 缩放控件：减号 — 无级滑块 — 加号
 *
 * 三个入口共用同一个 setValue：拖动连续给值，加减按钮按固定步进给值（长按连击），
 * 滑块聚焦后方向键也走同一条路，保证三者行为与持久化完全一致。
 */
function bindTemplateLibraryCardSizeControl() {
    var slider = document.getElementById('templateLibraryCardSizeSlider');
    if (!slider) return;

    var track = slider.querySelector('.custom-slider-track');
    var fill = slider.querySelector('.custom-slider-fill');
    var thumb = slider.querySelector('.custom-slider-thumb');
    if (!track || !fill || !thumb) return;

    var decreaseBtn = document.getElementById('btnTemplateLibraryCardSizeDown');
    var increaseBtn = document.getElementById('btnTemplateLibraryCardSizeUp');

    // 只画控件、不动布局：初始视图换算完要把滑块拨到对应位置，那时布局已经在算了，
    // 再走一遍 setValue 会多排一次版
    var renderUI = function(percent) {
        var value = clampTemplateLibraryCardSize(percent);
        fill.style.width = value.toFixed(2) + '%';
        thumb.style.left = value.toFixed(2) + '%';
        slider.dataset.value = value.toFixed(2);
        slider.setAttribute('aria-valuenow', String(Math.round(value)));

        var metrics = getTemplateLibraryGridMetrics(value, measureTemplateLibraryGridWidth());
        var hint = '卡片 ' + Math.round(metrics.columnWidth) + 'px · 每行 ' + metrics.columns + ' 列';
        slider.title = hint;
        slider.setAttribute('aria-valuetext', hint);

        if (decreaseBtn) decreaseBtn.disabled = value <= 0;
        if (increaseBtn) increaseBtn.disabled = value >= 100;
    };

    var setValue = function(nextValue, options) {
        var percent = Math.round(clampTemplateLibraryCardSize(nextValue) * 100) / 100;
        templateLibraryCardSize = percent;
        // 用户一旦自己调过，就不该再被"初始视图"覆盖
        templateLibraryCardSizePendingModel = '';
        renderUI(percent);
        applyTemplateLibraryCardSize();
        if (options?.persist !== false) {
            saveTemplateLibraryPrefs();
        }
    };

    templateLibraryCardSizeRenderUI = renderUI;
    renderUI(templateLibraryCardSize);
    applyTemplateLibraryCardSize();
    if (!templateLibraryCardSizeResizeBound) {
        window.addEventListener('resize', applyTemplateLibraryCardSize);
        templateLibraryCardSizeResizeBound = true;
    }

    var beginContinuousChange = function() {
        templateLibraryGridLayoutReuseBodyHeight = true;
    };

    // 连续调整结束：正文高度回到精确测量并立刻重排一次，再落盘偏好
    var endContinuousChange = function() {
        templateLibraryGridLayoutReuseBodyHeight = false;
        scheduleTemplateLibraryGridLayout();
        saveTemplateLibraryPrefs();
    };

    var isDragging = false;
    var updateFromClientX = function(clientX) {
        var rect = track.getBoundingClientRect();
        if (!rect.width) return;
        var percent = ((clientX - rect.left) / rect.width) * 100;
        setValue(snapTemplateLibraryCardSizeToFit(percent, measureTemplateLibraryGridWidth()), { persist: false });
    };

    // 拖动过程挂在 document 上而不是靠 setPointerCapture：指针捕获在 UXP 的 webview 里
    // 不保证可用，一旦失效，手指移出控件就收不到事件，滑块会中途"卡住"。
    var onDocumentPointerMove = function(event) {
        if (!isDragging) return;
        updateFromClientX(event.clientX);
    };

    var detachDragListeners = function() {
        document.removeEventListener('pointermove', onDocumentPointerMove, true);
        document.removeEventListener('pointerup', onDocumentPointerUp, true);
        document.removeEventListener('pointercancel', onDocumentPointerCancel, true);
    };

    var finishDrag = function(options) {
        if (!isDragging) return;
        isDragging = false;
        slider.classList.remove('dragging');
        detachDragListeners();
        if (options?.persist === false) {
            templateLibraryGridLayoutReuseBodyHeight = false;
            scheduleTemplateLibraryGridLayout();
            return;
        }
        endContinuousChange();
    };

    function onDocumentPointerUp() {
        finishDrag();
    }

    function onDocumentPointerCancel() {
        finishDrag({ persist: false });
    }

    slider.onpointerdown = function(event) {
        event.preventDefault();
        isDragging = true;
        slider.classList.add('dragging');
        beginContinuousChange();
        document.addEventListener('pointermove', onDocumentPointerMove, true);
        document.addEventListener('pointerup', onDocumentPointerUp, true);
        document.addEventListener('pointercancel', onDocumentPointerCancel, true);
        updateFromClientX(event.clientX);
    };

    slider.onkeydown = function(event) {
        var ratio = event.shiftKey
            ? TEMPLATE_LIBRARY_CARD_SIZE_STEP_RATIO * TEMPLATE_LIBRARY_CARD_SIZE_STEP_RATIO
            : TEMPLATE_LIBRARY_CARD_SIZE_STEP_RATIO;
        var next = null;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            next = getTemplateLibrarySteppedCardSize(templateLibraryCardSize, 1 / ratio, measureTemplateLibraryGridWidth());
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            next = getTemplateLibrarySteppedCardSize(templateLibraryCardSize, ratio, measureTemplateLibraryGridWidth());
        } else if (event.key === 'Home') {
            next = 0;
        } else if (event.key === 'End') {
            next = 100;
        }
        if (next === null) return;

        // 素材墙的方向键导航挂在 document 上，这里必须截住，否则一次按键既缩放又跳选中
        event.preventDefault();
        event.stopPropagation();
        setValue(next);
    };

    bindTemplateLibraryCardSizeStepButton(decreaseBtn, -1, setValue, beginContinuousChange, endContinuousChange);
    bindTemplateLibraryCardSizeStepButton(increaseBtn, 1, setValue, beginContinuousChange, endContinuousChange);
}

/**
 * 加减按钮：单击走一步，按住 400ms 后连击
 *
 * 连击用 pointer 事件而不是 click，是为了长按不松手也能继续加减；
 * 到达 0/100 时立即停表，避免空转定时器。
 */
function bindTemplateLibraryCardSizeStepButton(button, direction, setValue, onStart, onEnd) {
    if (!button) return;

    var holdTimer = 0;
    var repeatTimer = 0;
    var active = false;

    var clearTimers = function() {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
        if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = 0; }
    };

    var stepOnce = function() {
        var ratio = direction > 0
            ? TEMPLATE_LIBRARY_CARD_SIZE_STEP_RATIO
            : 1 / TEMPLATE_LIBRARY_CARD_SIZE_STEP_RATIO;
        var next = getTemplateLibrarySteppedCardSize(templateLibraryCardSize, ratio, measureTemplateLibraryGridWidth());
        if (next === templateLibraryCardSize) {
            clearTimers();
            return false;
        }
        setValue(next, { persist: false });
        return true;
    };

    button.onpointerdown = function(event) {
        if (button.disabled) return;
        event.preventDefault();
        active = true;
        onStart();
        stepOnce();
        clearTimers();
        holdTimer = setTimeout(function() {
            holdTimer = 0;
            repeatTimer = setInterval(function() {
                if (!stepOnce()) {
                    clearTimers();
                }
            }, 70);
        }, 400);
    };

    var stop = function() {
        clearTimers();
        if (!active) return;
        active = false;
        onEnd();
    };

    button.onpointerup = stop;
    button.onpointerleave = stop;
    button.onpointercancel = stop;
}

function getTemplateLibraryDroppedFileExtension(file) {
    var name = String(file?.name || '').trim();
    var dotIndex = name.lastIndexOf('.');
    return dotIndex >= 0 ? name.slice(dotIndex + 1).toLowerCase() : '';
}

function isTemplateLibrarySupportedDroppedFile(file) {
    var extension = getTemplateLibraryDroppedFileExtension(file);
    return TEMPLATE_LIBRARY_DROP_SUPPORTED_EXTS.indexOf(extension) >= 0;
}

function readTemplateLibraryDroppedFile(file) {
    return new Promise(function(resolve, reject) {
        var name = String(file?.name || '').trim();
        var extension = getTemplateLibraryDroppedFileExtension(file);
        if (!name || !extension || !isTemplateLibrarySupportedDroppedFile(file)) {
            resolve(null);
            return;
        }

        var size = Number(file?.size || 0);
        if (Number.isFinite(size) && size > TEMPLATE_LIBRARY_DROP_MAX_BINARY_BYTES) {
            reject(new Error('文件过大，无法通过拖拽直接导入：' + name));
            return;
        }

        var reader = new FileReader();
        reader.onerror = function() {
            reject(new Error('读取拖拽文件失败：' + name));
        };
        reader.onload = function(event) {
            var result = event?.target?.result;
            var item = {
                name: name,
                extension: extension,
                size: Number.isFinite(size) ? size : 0,
                mimeType: String(file?.type || '')
            };
            if (extension === 'txt') {
                item.textContent = typeof result === 'string' ? result : '';
            } else {
                item.dataUrl = typeof result === 'string' ? result : '';
            }
            resolve(item);
        };

        if (extension === 'txt') {
            reader.readAsText(file, 'utf-8');
        } else {
            reader.readAsDataURL(file);
        }
    });
}

async function readTemplateLibraryDroppedFiles(filesWithoutPath) {
    var droppedFiles = [];
    for (var i = 0; i < filesWithoutPath.length; i += 1) {
        var item = await readTemplateLibraryDroppedFile(filesWithoutPath[i]);
        if (item) {
            droppedFiles.push(item);
        }
    }
    return droppedFiles;
}

function bindTemplateLibraryDropzone(activeLibrary) {
    var dropSurface = document.getElementById('templateLibraryDropSurface') || document.getElementById('templateList');
    if (!dropSurface || !activeLibrary) return;

    dropSurface.classList.add('design-library-surface');
    document.getElementById('templateLibraryDropzone')?.remove();

    if (!document.getElementById('templateLibraryDropHint')) {
        dropSurface.insertAdjacentHTML('afterbegin', renderTemplateLibraryDropzone(true));
    }

    function sendImport(filePaths, droppedFiles) {
        var payload = {
            libraryId: activeLibrary.id,
            relativePath: templateLibraryState.relativePath || ''
        };
        if (Array.isArray(filePaths) && filePaths.length > 0) {
            payload.filePaths = filePaths;
        }
        if (Array.isArray(droppedFiles) && droppedFiles.length > 0) {
            payload.droppedFiles = droppedFiles;
        }
        sendToUXP('templateLibraryImportFiles', payload);
    }

    function clearDropState() {
        templateLibraryExternalDragDepth = 0;
        dropSurface.classList.remove('is-drop-active');
    }

    dropSurface.ondragenter = function(event) {
        if (templateLibraryInternalDragActive) {
            return;
        }
        event.preventDefault();
        templateLibraryExternalDragDepth += 1;
        dropSurface.classList.add('is-drop-active');
    };
    dropSurface.ondragover = function(event) {
        if (templateLibraryInternalDragActive) {
            return;
        }
        event.preventDefault();
        dropSurface.classList.add('is-drop-active');
    };
    dropSurface.ondragleave = function(event) {
        if (templateLibraryInternalDragActive) {
            return;
        }
        event.preventDefault();
        templateLibraryExternalDragDepth = Math.max(0, templateLibraryExternalDragDepth - 1);
        if (templateLibraryExternalDragDepth === 0) {
            dropSurface.classList.remove('is-drop-active');
        }
    };
    dropSurface.ondrop = async function(event) {
        // 库内素材被拖到自己身上时不做任何导入：这条路径的兜底分支是"导入 Photoshop 当前选中"，
        // 拖一下已有素材就会把画布里的选中图层写进设计库，属于纯误操作。
        if (templateLibraryInternalDragActive) {
            clearDropState();
            return;
        }

        event.preventDefault();
        clearDropState();

        var droppedFiles = Array.from(event.dataTransfer?.files || []);
        var filePaths = droppedFiles
            .map(function(file) { return String(file?.path || '').trim(); })
            .filter(Boolean);

        if (filePaths.length > 0) {
            var filesWithoutPath = droppedFiles.filter(function(file) {
                return !String(file?.path || '').trim();
            });
            var inMemoryDroppedFiles = [];
            if (filesWithoutPath.length > 0) {
                try {
                    inMemoryDroppedFiles = await readTemplateLibraryDroppedFiles(filesWithoutPath);
                } catch (error) {
                    console.error('[DesignLibrary] Failed to read dropped files:', error);
                    if (typeof showToast === 'function') {
                        showToast(error?.message || '读取拖拽文件失败', 'error');
                    }
                    return;
                }
            }
            sendImport(filePaths, inMemoryDroppedFiles);
            return;
        }

        if (droppedFiles.length > 0) {
            try {
                var inMemoryFiles = await readTemplateLibraryDroppedFiles(droppedFiles);
                if (inMemoryFiles.length === 0) {
                    if (typeof showToast === 'function') {
                        showToast('没有可导入的设计资产文件', 'warning');
                    }
                    return;
                }
                sendImport([], inMemoryFiles);
            } catch (error) {
                console.error('[DesignLibrary] Failed to read dropped files:', error);
                if (typeof showToast === 'function') {
                    showToast(error?.message || '读取拖拽文件失败', 'error');
                }
            }
            return;
        }

        sendToUXP('templateLibraryImportSelection', {
            libraryId: activeLibrary.id,
            relativePath: templateLibraryState.relativePath || ''
        });
    };
}

function openTemplateLibraryActionsMenu(event) {
    event.preventDefault();
    closeTemplateLibraryActionsMenu();

    var menu = document.createElement('div');
    menu.id = 'templateLibraryActionsMenu';
    menu.className = 'template-context-menu';
    menu.style.left = Math.min(event.clientX, window.innerWidth - 176) + 'px';
    menu.style.top = Math.min(event.clientY, window.innerHeight - 240) + 'px';
    menu.innerHTML = [
        '<button class="template-context-item" data-action="import-files">\u5bfc\u5165\u6587\u4ef6</button>',
        '<button class="template-context-item" data-action="import-selection">\u5bfc\u5165\u5f53\u524d\u9009\u4e2d</button>',
        '<button class="template-context-item" data-action="save-current">\u6dfb\u52a0\u5f53\u524d\u6587\u6863</button>',
        '<button class="template-context-item" data-action="set-dir">\u8bbe\u7f6e\u76ee\u5f55</button>',
        '<button class="template-context-item" data-action="remove-library">\u5220\u9664\u8bbe\u8ba1\u5e93</button>'
    ].join('');

    document.body.appendChild(menu);
    menu.querySelectorAll('.template-context-item').forEach(function(btn) {
        btn.addEventListener('click', function(clickEvent) {
            clickEvent.stopPropagation();
            var action = btn.getAttribute('data-action') || '';
            if (action === 'import-files') {
                sendToUXP('templateLibraryImportFiles', {
                    libraryId: templateLibraryState.activeLibraryId || '',
                    relativePath: templateLibraryState.relativePath || ''
                });
            } else if (action === 'import-selection') {
                sendToUXP('templateLibraryImportSelection', {
                    libraryId: templateLibraryState.activeLibraryId || '',
                    relativePath: templateLibraryState.relativePath || ''
                });
            } else if (action === 'save-current') {
                sendToUXP('templateLibrarySaveCurrentDoc', {
                    libraryId: templateLibraryState.activeLibraryId || '',
                    description: '',
                    tags: ''
                });
            } else if (action === 'set-dir') {
                sendToUXP('templateLibraryAddDir', {
                    libraryId: templateLibraryState.activeLibraryId || ''
                });
            } else if (action === 'remove-library') {
                sendToUXP('templateLibraryRemove', {
                    id: templateLibraryState.activeLibraryId || ''
                });
            }
            closeTemplateLibraryActionsMenu();
        });
    });

    setTimeout(function() {
        document.addEventListener('click', closeTemplateLibraryActionsMenu, { once: true });
    }, 0);
}

function openTemplateLibraryLibraryContextMenu(event, library) {
    if (!library) return;
    event.preventDefault();
    closeTemplateLibraryContextMenu();

    var menu = document.createElement('div');
    menu.id = 'templateLibraryContextMenu';
    menu.className = 'template-context-menu';
    menu.style.left = Math.min(event.clientX, window.innerWidth - 176) + 'px';
    menu.style.top = Math.min(event.clientY, window.innerHeight - 190) + 'px';
    menu.innerHTML = [
        '<button class="template-context-item" data-action="open">\u6253\u5f00\u8bbe\u8ba1\u5e93</button>',
        '<button class="template-context-item" data-action="set-dir">\u8bbe\u7f6e\u76ee\u5f55</button>',
        '<button class="template-context-item" data-action="remove">\u5220\u9664\u8bbe\u8ba1\u5e93</button>'
    ].join('');

    document.body.appendChild(menu);
    menu.querySelectorAll('.template-context-item').forEach(function(btn) {
        btn.addEventListener('click', function(clickEvent) {
            clickEvent.stopPropagation();
            var action = btn.getAttribute('data-action') || '';
            if (action === 'open') {
                setTemplateLibrarySelection([], '');
                templateLibraryUserLeftDetail = false;
                templateLibraryView = 'detail';
                renderTemplateLibraryStateV2(templateLibraryState);
                sendToUXP('templateLibrarySelect', { id: library.id });
            } else if (action === 'set-dir') {
                sendToUXP('templateLibraryAddDir', { libraryId: library.id });
            } else if (action === 'remove') {
                sendToUXP('templateLibraryRemove', { id: library.id });
            }
            closeTemplateLibraryContextMenu();
        });
    });

    setTimeout(function() {
        document.addEventListener('click', closeTemplateLibraryContextMenu, { once: true });
    }, 0);
}

function openTemplateLibraryContextMenu(event, item, activeLibrary) {
    event.preventDefault();
    closeTemplateLibraryContextMenu();

    var menu = document.createElement('div');
    var isTextAsset = String(item?.assetType || '') === 'text';

    menu.id = 'templateLibraryContextMenu';
    menu.className = 'template-context-menu';
    menu.style.left = Math.min(event.clientX, window.innerWidth - 176) + 'px';
    menu.style.top = Math.min(event.clientY, window.innerHeight - 190) + 'px';
    menu.innerHTML = [
        '<button class="template-context-item" data-action="place">\u7f6e\u5165\u5230\u6587\u6863</button>',
        isTextAsset ? '' : '<button class="template-context-item" data-action="open">\u6253\u5f00\u6e90\u6587\u4ef6</button>',
        '<button class="template-context-item" data-action="rename">\u91cd\u547d\u540d</button>',
        '<button class="template-context-item" data-action="edit-tags">\u7f16\u8f91\u6807\u7b7e</button>',
        '<button class="template-context-item" data-action="delete">\u5220\u9664</button>'
    ].join('');

    document.body.appendChild(menu);
    menu.querySelectorAll('.template-context-item').forEach(function(btn) {
        btn.addEventListener('click', function(clickEvent) {
            clickEvent.stopPropagation();
            var action = btn.getAttribute('data-action') || '';
            if (action === 'place') {
                sendToUXP('templateLibraryPlaceAsset', {
                    relativePath: item.relativePath || '',
                    name: item.name || '',
                    assetType: item.assetType || '',
                    libraryId: templateLibraryState.activeLibraryId || '',
                    dirToken: activeLibrary?.dirToken || '',
                    dirPath: activeLibrary?.dirPath || ''
                });
            } else if (action === 'open') {
                sendToUXP('templateLibraryOpenTemplate', {
                    relativePath: item.relativePath || '',
                    assetType: item.assetType || '',
                    libraryId: templateLibraryState.activeLibraryId || '',
                    dirToken: activeLibrary?.dirToken || '',
                    dirPath: activeLibrary?.dirPath || ''
                });
            } else if (action === 'edit-tags') {
                openTemplateLibraryAssetTagEditor(String(item?.relativePath || '').trim());
            } else if (action === 'rename') {
                openTemplateLibraryAssetRenameEditor(String(item?.relativePath || '').trim());
            } else if (action === 'delete') {
                sendToUXP('templateLibraryDeleteTemplate', {
                    id: item.templateId || '',
                    relativePath: item.relativePath || '',
                    currentRelativePath: '',
                    libraryId: templateLibraryState.activeLibraryId || ''
                });
            }
            closeTemplateLibraryContextMenu();
        });
    });

    setTimeout(function() {
        document.addEventListener('click', closeTemplateLibraryContextMenu, { once: true });
    }, 0);
}
function findTemplateLibraryAssetByRelativePath(relativePath) {
    var target = String(relativePath || '').trim();
    return (Array.isArray(templateLibraryState.assets) ? templateLibraryState.assets : []).find(function(item) {
        return String(item?.relativePath || '').trim() === target;
    }) || null;
}

function renderTemplateLibraryTagEditorModal() {
    if (!templateLibraryTagModalVisible) {
        return '<div class="template-modal-overlay" id="templateLibraryTagModal" style="display:none;"></div>';
    }

    var activeAsset = findTemplateLibraryAssetByRelativePath(templateLibraryEditingAssetPath);
    var assetName = escapeHtml(activeAsset?.name || '\u5f53\u524d\u7d20\u6750');
    var selectedPaths = getTemplateLibrarySelectedAssetPaths();
    var isBatch = selectedPaths.length > 1;
    var note = isBatch
        ? '\u5c06\u4e3a\u5df2\u9009\u7684 ' + escapeHtml(String(selectedPaths.length)) + ' \u4e2a\u7d20\u6750\u7edf\u4e00\u8bbe\u7f6e\u6807\u7b7e\uff0c\u539f\u6709\u6807\u7b7e\u4f1a\u88ab\u8986\u76d6\u3002'
        : '\u4e3a ' + assetName + ' \u8bbe\u7f6e\u6807\u7b7e\uff0c\u4f7f\u7528\u9017\u53f7\u5206\u9694\u3002';
    var suggestions = (Array.isArray(templateLibraryState.tags) ? templateLibraryState.tags : [])
        .slice(0, 12)
        .map(function(tagStat) {
            var name = String(tagStat?.name || '').trim();
            if (!name) {
                return '';
            }
            return '<button type="button" class="template-tag-suggestion" data-tag-suggestion="' + escapeHtml(name) + '">'
                + escapeHtml(name) + '</button>';
        })
        .join('');

    return [
        '<div class="template-modal-overlay" id="templateLibraryTagModal">',
        '<div class="template-modal-card">',
        '<div class="template-modal-title">' + (isBatch ? '\u6279\u91cf\u7f16\u8f91\u6807\u7b7e' : '\u7f16\u8f91\u6807\u7b7e') + '</div>',
        '<div class="template-modal-note">' + note + '</div>',
        '<div class="template-modal-field">',
        '<div class="template-form-label">\u6807\u7b7e</div>',
        '<input id="templateLibraryAssetTagsInput" class="glass-input" type="text" placeholder="\u4f8b\u5982\uff1a\u4e3b\u56fe, \u889c\u5b50, \u8be6\u60c5\u9875" value="' + escapeHtml(templateLibraryDraftAssetTags) + '" />',
        suggestions ? '<div class="template-tag-suggestions">' + suggestions + '</div>' : '',
        '</div>',
        '<div class="template-modal-actions">',
        '<button class="btn-small" id="btnTemplateLibraryAssetTagsCancel">\u53d6\u6d88</button>',
        '<button class="btn-small" id="btnTemplateLibraryAssetTagsSave">\u4fdd\u5b58</button>',
        '</div>',
        '</div>',
        '</div>'
    ].join('');
}

function renderTemplateLibraryRenameEditorModal() {
    if (!templateLibraryRenameModalVisible) {
        return '<div class="template-modal-overlay" id="templateLibraryRenameModal" style="display:none;"></div>';
    }

    var activeAsset = findTemplateLibraryAssetByRelativePath(templateLibraryRenamingAssetPath);
    var assetName = escapeHtml(activeAsset?.name || '\u5f53\u524d\u7d20\u6750');
    return [
        '<div class="template-modal-overlay" id="templateLibraryRenameModal">',
        '<div class="template-modal-card">',
        '<div class="template-modal-title">\u91cd\u547d\u540d\u7d20\u6750</div>',
        '<div class="template-modal-note">\u4fee\u6539 ' + assetName + ' \u7684\u663e\u793a\u540d\u548c\u5305\u5185\u6e90\u6587\u4ef6\u540d\u3002</div>',
        '<div class="template-modal-field">',
        '<div class="template-form-label">\u7d20\u6750\u540d\u79f0</div>',
        '<input id="templateLibraryAssetNameInput" class="glass-input" type="text" placeholder="\u4f8b\u5982\uff1a2\u53cc\u88c5" value="' + escapeHtml(templateLibraryDraftAssetName) + '" />',
        '</div>',
        '<div class="template-modal-actions">',
        '<button class="btn-small" id="btnTemplateLibraryAssetRenameCancel">\u53d6\u6d88</button>',
        '<button class="btn-small" id="btnTemplateLibraryAssetRenameSave">\u4fdd\u5b58</button>',
        '</div>',
        '</div>',
        '</div>'
    ].join('');
}

function getTemplateLibrarySummaryText(activeLibrary, selectedAsset, hasRenderableCachedAssets) {
    if (templateLibraryState?.success === false && templateLibraryState?.error) {
        return templateLibraryState.error;
    }
    if (!activeLibrary) {
        return '\u8bf7\u5148\u521b\u5efa\u6216\u9009\u62e9\u8bbe\u8ba1\u5e93';
    }
    if (!activeLibrary.dirPath) {
        return '\u8bf7\u5148\u8bbe\u7f6e\u8bbe\u8ba1\u5e93\u76ee\u5f55';
    }
    if (!templateLibraryState.detailReady && hasRenderableCachedAssets) {
        return '\u6b63\u5728\u540c\u6b65\u6700\u65b0\u7d20\u6750\u4fe1\u606f\uff0c\u5f53\u524d\u5148\u5c55\u793a\u5df2\u7f13\u5b58\u7684\u5185\u5bb9\u3002';
    }
    if (selectedAsset) {
        return '\u5355\u51fb\u53ef\u67e5\u770b\u7d20\u6750\u4fe1\u606f\uff0c\u53cc\u51fb\u76f4\u63a5\u7f6e\u5165\uff0c\u53ef\u4ece\u9876\u90e8\u6dfb\u52a0\u6807\u7b7e\u3002';
    }
    return '\u5df2\u8fde\u63a5\u672c\u5730\u8bbe\u8ba1\u5e93\u3002\u5355\u51fb\u7d20\u6750\u53ef\u67e5\u770b\u4fe1\u606f\u5e76\u6dfb\u52a0\u6807\u7b7e\u3002';
}

function syncTemplateLibraryViewSections() {
    var listSection = document.getElementById('templateLibraryListSection');
    var detailSection = document.getElementById('templateLibraryDetailSection');
    if (listSection) {
        listSection.style.display = templateLibraryView === 'detail' ? 'none' : '';
    }
    if (detailSection) {
        detailSection.style.display = templateLibraryView === 'detail' ? '' : 'none';
    }
}

function syncTemplateLibrarySearchInputs() {
    var librarySearchInput = document.getElementById('templateLibrarySearch');
    var assetSearchInput = document.getElementById('templateAssetSearch');
    var createNameInput = document.getElementById('templateLibraryName');

    if (librarySearchInput && librarySearchInput.value !== templateLibraryQuery) {
        librarySearchInput.value = templateLibraryQuery;
    }
    if (assetSearchInput && assetSearchInput.value !== templateLibraryAssetQuery) {
        assetSearchInput.value = templateLibraryAssetQuery;
    }
    if (createNameInput && createNameInput.value !== templateLibraryDraftName) {
        createNameInput.value = templateLibraryDraftName;
    }
}

function syncTemplateLibraryCreateModal() {
    var createModal = document.getElementById('templateLibraryCreateModal');
    if (createModal) {
        createModal.style.display = templateLibraryCreateModalVisible ? '' : 'none';
    }
}

function syncTemplateLibraryTagModal() {
    var host = document.getElementById('templateLibraryTagModalHost');
    if (!host) {
        return;
    }
    host.innerHTML = renderTemplateLibraryTagEditorModal();
    bindTemplateLibraryTagModal();
}

function syncTemplateLibraryRenameModal() {
    var host = document.getElementById('templateLibraryRenameModalHost');
    if (!host) {
        return;
    }
    host.innerHTML = renderTemplateLibraryRenameEditorModal();
    bindTemplateLibraryRenameModal();
}

function syncTemplateLibraryShellState() {
    syncTemplateLibraryViewSections();
    syncTemplateLibrarySearchInputs();
    syncTemplateLibraryCreateModal();
    syncTemplateLibraryTagModal();
    syncTemplateLibraryRenameModal();
}

function syncTemplateLibrarySelectedAssetState() {
    var allAssets = Array.isArray(templateLibraryState.assets) ? templateLibraryState.assets : [];
    var hasRenderableCachedAssets = allAssets.length > 0;
    var activeLibrary = getActiveTemplateLibrary();

    setTemplateLibrarySelection(getTemplateLibrarySelectedAssetPaths(), templateLibrarySelectedAssetPath);
    var selectedAsset = getSelectedTemplateLibraryAsset();

    var summaryEl = document.getElementById('templateLibrarySummary');
    var selectedAssetPanelEl = document.getElementById('templateLibrarySelectedAssetPanel');
    if (summaryEl) {
        summaryEl.textContent = getTemplateLibrarySummaryText(activeLibrary, selectedAsset, hasRenderableCachedAssets);
    }
    setTemplateLibraryRegionHtml('selectedAssetPanel', selectedAssetPanelEl, renderTemplateLibrarySelectedAssetPanel(selectedAsset));

    var hasSelection = templateLibrarySelectedAssetPaths.length > 0;
    document.getElementById('pageTemplateLibrary')?.classList.toggle('has-library-dock', hasSelection && templateLibraryView === 'detail');

    document.querySelectorAll('.template-library-asset-card').forEach(function(card) {
        var cardPath = String(card.getAttribute('data-relative-path') || '').trim();
        card.classList.toggle('is-selected', isTemplateLibraryAssetSelected(cardPath));
        card.classList.toggle('is-primary-selected', cardPath === String(templateLibrarySelectedAssetPath || '').trim());
    });
}

function placeTemplateLibraryAsset(item) {
    if (!item) {
        if (typeof showToast === 'function') {
            showToast('没有可置入的素材，请先在素材墙里选中一个', 'warning');
        }
        return;
    }

    var activeLibrary = getActiveTemplateLibrary();
    sendToUXP('templateLibraryPlaceAsset', {
        relativePath: item.relativePath || '',
        name: item.name || '',
        assetType: item.assetType || '',
        libraryId: templateLibraryState.activeLibraryId || '',
        dirToken: activeLibrary?.dirToken || '',
        dirPath: activeLibrary?.dirPath || ''
    });
}

function focusTemplateLibraryGrid() {
    var gridEl = getTemplateLibraryGridElement();
    if (gridEl && document.activeElement !== gridEl && !gridEl.contains(document.activeElement)) {
        gridEl.focus({ preventScroll: true });
    }
}

function scrollTemplateLibraryCardIntoView(relativePath) {
    var gridEl = getTemplateLibraryGridElement();
    var card = gridEl?.querySelector('.template-library-asset-card[data-relative-path="' + String(relativePath || '').replace(/"/g, '\\"') + '"]');
    card?.scrollIntoView({ block: 'nearest' });
}

/**
 * 素材墙键盘导航
 *
 * 方向键按当前列数移动，Enter 置入，Esc 清空选择——鼠标要在窄面板里精确点小卡片很累。
 */
function handleTemplateLibraryGridKeydown(event) {
    if (templateLibraryView !== 'detail') {
        return;
    }
    // 缩放控件自己处理方向键（调大小），不能让同一次按键顺带移动素材墙选中项
    if (event.target?.closest?.('input, textarea, [contenteditable="true"], .template-size-control')) {
        return;
    }

    var navigationKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'Escape'];
    if (navigationKeys.indexOf(event.key) < 0) {
        return;
    }

    if (event.key === 'Escape') {
        if (templateLibrarySelectedAssetPaths.length === 0) {
            return;
        }
        event.preventDefault();
        setTemplateLibrarySelection([], '');
        syncTemplateLibrarySelectedAssetState();
        return;
    }

    var visibleAssets = getTemplateLibraryVisibleAssets().slice(0, templateLibraryVisibleAssetLimit);
    if (visibleAssets.length === 0) {
        return;
    }

    if (event.key === 'Enter') {
        var current = findTemplateLibraryAssetByRelativePath(templateLibrarySelectedAssetPath);
        if (!current) {
            return;
        }
        event.preventDefault();
        placeTemplateLibraryAsset(current);
        return;
    }

    var paths = visibleAssets.map(function(item) { return String(item?.relativePath || '').trim(); });
    var currentIndex = paths.indexOf(String(templateLibrarySelectedAssetPath || '').trim());
    var columns = getTemplateLibraryColumnCount(templateLibraryCardSize, measureTemplateLibraryGridWidth());
    var nextIndex = currentIndex;

    switch (event.key) {
        case 'ArrowLeft': nextIndex = currentIndex < 0 ? 0 : currentIndex - 1; break;
        case 'ArrowRight': nextIndex = currentIndex < 0 ? 0 : currentIndex + 1; break;
        case 'ArrowUp': nextIndex = currentIndex < 0 ? 0 : currentIndex - columns; break;
        case 'ArrowDown': nextIndex = currentIndex < 0 ? 0 : currentIndex + columns; break;
        case 'Home': nextIndex = 0; break;
        case 'End': nextIndex = paths.length - 1; break;
        default: break;
    }

    nextIndex = Math.max(0, Math.min(paths.length - 1, nextIndex));
    if (nextIndex === currentIndex) {
        return;
    }

    event.preventDefault();
    setTemplateLibrarySelection([paths[nextIndex]], paths[nextIndex]);
    syncTemplateLibrarySelectedAssetState();
    scrollTemplateLibraryCardIntoView(paths[nextIndex]);
}

function bindTemplateLibraryDelegatedInteractions() {
    if (templateLibraryDelegatedEventsBound) {
        return;
    }

    var page = document.getElementById('pageTemplateLibrary');
    if (!page) {
        return;
    }

    templateLibraryDelegatedEventsBound = true;

    page.addEventListener('click', function(event) {
        var target = event.target;
        var libraryButton = target?.closest?.('.template-select-library-btn');
        if (libraryButton) {
            var libraryId = libraryButton.getAttribute('data-library-id') || '';
            setTemplateLibrarySelection([], '');
            templateLibraryUserLeftDetail = false;
            templateLibraryView = 'detail';
            renderTemplateLibraryStateV2(templateLibraryState);
            sendToUXP('templateLibrarySelect', { id: libraryId });
            return;
        }

        var editTagsButton = target?.closest?.('#btnTemplateLibraryEditSelectedTags');
        if (editTagsButton) {
            openTemplateLibraryAssetTagEditor(String(templateLibrarySelectedAssetPath || '').trim());
            return;
        }

        var renameButton = target?.closest?.('#btnTemplateLibraryRenameSelected');
        if (renameButton) {
            openTemplateLibraryAssetRenameEditor(String(templateLibrarySelectedAssetPath || '').trim());
            return;
        }

        var placeSelectedButton = target?.closest?.('#btnTemplateLibraryPlaceSelected');
        if (placeSelectedButton) {
            placeTemplateLibraryAsset(findTemplateLibraryAssetByRelativePath(templateLibrarySelectedAssetPath));
            return;
        }

        var clearSelectionButton = target?.closest?.('#btnTemplateLibraryClearSelection');
        if (clearSelectionButton) {
            setTemplateLibrarySelection([], '');
            syncTemplateLibrarySelectedAssetState();
            return;
        }

        var tagRailToggle = target?.closest?.('#templateLibraryTagRailToggle');
        if (tagRailToggle) {
            templateLibraryTagRailExpanded = !templateLibraryTagRailExpanded;
            saveTemplateLibraryPrefs();
            renderTemplateLibraryStateV2(templateLibraryState);
            return;
        }

        var tagFilterButton = target?.closest?.('.template-tag-filter');
        if (tagFilterButton) {
            if (tagFilterButton.getAttribute('data-tag-untagged') === '1') {
                templateLibraryUntaggedOnly = !templateLibraryUntaggedOnly;
                if (templateLibraryUntaggedOnly) {
                    templateLibrarySelectedTags = [];
                }
                renderTemplateLibraryStateV2(templateLibraryState);
                return;
            }

            var tag = String(tagFilterButton.getAttribute('data-tag') || '').trim();
            templateLibraryUntaggedOnly = false;
            if (!tag) {
                templateLibrarySelectedTags = [];
            } else if (templateLibrarySelectedTags.includes(tag)) {
                templateLibrarySelectedTags = templateLibrarySelectedTags.filter(function(item) { return item !== tag; });
            } else {
                templateLibrarySelectedTags = normalizeTemplateLibraryTagList(templateLibrarySelectedTags.concat(tag));
            }
            renderTemplateLibraryStateV2(templateLibraryState);
            return;
        }

        var emptyAction = target?.closest?.('#templateLibraryEmptyAction');
        if (emptyAction) {
            sendToUXP('templateLibraryImportSelection', {
                libraryId: templateLibraryState.activeLibraryId || '',
                relativePath: ''
            });
            return;
        }

        var loadMoreButton = target?.closest?.('#templateLibraryLoadMoreButton');
        if (loadMoreButton) {
            requestNextTemplateLibraryAssetPage();
            return;
        }

        var assetCard = target?.closest?.('.template-library-asset-card');
        if (assetCard) {
            var relativePath = String(assetCard.getAttribute('data-relative-path') || '').trim();
            if (relativePath) {
                applyTemplateLibraryAssetClickSelection(relativePath, {
                    toggle: !!(event.ctrlKey || event.metaKey),
                    range: !!event.shiftKey
                });
                syncTemplateLibrarySelectedAssetState();
                focusTemplateLibraryGrid();
            }
            return;
        }

        // 点击素材墙空白处清空选择（与 Eagle 一致，避免"选中态一直挂着"）
        if (target?.closest?.('#templateLibraryGrid') && templateLibrarySelectedAssetPaths.length > 0) {
            setTemplateLibrarySelection([], '');
            syncTemplateLibrarySelectedAssetState();
        }
    });

    page.addEventListener('dblclick', function(event) {
        var assetCard = event.target?.closest?.('.template-library-asset-card');
        if (!assetCard) {
            return;
        }
        placeTemplateLibraryAsset(findTemplateLibraryAssetByRelativePath(assetCard.getAttribute('data-relative-path') || ''));
    });

    // 库内拖拽标记：让 dropzone 知道这次拖拽来自面板自身，而不是外部文件
    page.addEventListener('dragstart', function(event) {
        var assetCard = event.target?.closest?.('.template-library-asset-card');
        if (!assetCard) {
            return;
        }
        templateLibraryInternalDragActive = true;
        try {
            event.dataTransfer?.setData('text/plain', String(assetCard.getAttribute('data-name') || ''));
        } catch (error) {
            console.warn('[DesignLibrary] 拖拽数据写入失败（不影响面板内操作）:', error);
        }
    });

    page.addEventListener('dragend', function() {
        templateLibraryInternalDragActive = false;
        document.getElementById('templateLibraryDropSurface')?.classList.remove('is-drop-active');
        document.getElementById('templateList')?.classList.remove('is-drop-active');
    });

    page.addEventListener('keydown', handleTemplateLibraryGridKeydown);

    page.addEventListener('contextmenu', function(event) {
        var libraryButton = event.target?.closest?.('.template-select-library-btn');
        if (libraryButton) {
            var libraryId = libraryButton.getAttribute('data-library-id') || '';
            var library = (Array.isArray(templateLibraryState.libraries) ? templateLibraryState.libraries : []).find(function(item) {
                return item.id === libraryId;
            }) || null;
            if (library) {
                openTemplateLibraryLibraryContextMenu(event, library);
            }
            return;
        }

        var assetCard = event.target?.closest?.('.template-library-asset-card');
        if (!assetCard) {
            return;
        }

        var relativePath = assetCard.getAttribute('data-relative-path') || '';
        var activeLibrary = getActiveTemplateLibrary();
        var asset = findTemplateLibraryAssetByRelativePath(relativePath) || {
            relativePath: relativePath,
            assetType: assetCard.getAttribute('data-asset-type') || '',
            name: assetCard.getAttribute('data-name') || '',
            templateId: assetCard.getAttribute('data-template-id') || '',
            tags: parseTemplateLibraryTagInput(assetCard.getAttribute('data-tags') || '')
        };
        openTemplateLibraryContextMenu(event, asset, activeLibrary);
    });
}

function bindTemplateLibraryTagModal() {
    document.getElementById('btnTemplateLibraryAssetTagsCancel')?.addEventListener('click', function() {
        templateLibraryTagModalVisible = false;
        templateLibraryEditingAssetPath = '';
        templateLibraryDraftAssetTags = '';
        renderTemplateLibraryStateV2(templateLibraryState);
    });
    document.getElementById('templateLibraryAssetTagsInput')?.addEventListener('input', function(event) {
        templateLibraryDraftAssetTags = event.target?.value || '';
    });
    document.querySelectorAll('[data-tag-suggestion]').forEach(function(button) {
        button.addEventListener('click', function() {
            var tag = String(button.getAttribute('data-tag-suggestion') || '').trim();
            if (!tag) {
                return;
            }
            var current = parseTemplateLibraryTagInput(templateLibraryDraftAssetTags);
            if (current.includes(tag)) {
                return;
            }
            templateLibraryDraftAssetTags = current.concat(tag).join(', ');
            var input = document.getElementById('templateLibraryAssetTagsInput');
            if (input) {
                input.value = templateLibraryDraftAssetTags;
                input.focus();
            }
        });
    });
    document.getElementById('btnTemplateLibraryAssetTagsSave')?.addEventListener('click', function() {
        var tags = parseTemplateLibraryTagInput(templateLibraryDraftAssetTags);
        var targets = getTemplateLibrarySelectedAssetPaths();
        if (targets.length === 0 && templateLibraryEditingAssetPath) {
            targets = [templateLibraryEditingAssetPath];
        }
        if (targets.length === 0) {
            if (typeof showToast === 'function') {
                showToast('没有选中的素材，标签未写入', 'warning');
            }
            return;
        }

        targets.forEach(function(relativePath) {
            sendToUXP('templateLibraryUpdateAssetTags', {
                libraryId: templateLibraryState.activeLibraryId || '',
                relativePath: relativePath,
                tags: tags
            });
        });

        if (targets.length > 1 && typeof showToast === 'function') {
            showToast('已为 ' + targets.length + ' 个素材写入标签', 'success');
        }

        templateLibraryTagModalVisible = false;
        templateLibraryEditingAssetPath = '';
        templateLibraryDraftAssetTags = '';
    });
}

function bindTemplateLibraryRenameModal() {
    document.getElementById('btnTemplateLibraryAssetRenameCancel')?.addEventListener('click', function() {
        templateLibraryRenameModalVisible = false;
        templateLibraryRenamingAssetPath = '';
        templateLibraryDraftAssetName = '';
        renderTemplateLibraryStateV2(templateLibraryState);
    });
    document.getElementById('templateLibraryAssetNameInput')?.addEventListener('input', function(event) {
        templateLibraryDraftAssetName = event.target?.value || '';
    });
    document.getElementById('btnTemplateLibraryAssetRenameSave')?.addEventListener('click', function() {
        var name = String(templateLibraryDraftAssetName || '').trim();
        if (!name) {
            if (typeof showToast === 'function') {
                showToast('\u8bf7\u8f93\u5165\u65b0\u7684\u7d20\u6750\u540d\u79f0', 'warning');
            }
            return;
        }
        sendToUXP('templateLibraryRenameAsset', {
            libraryId: templateLibraryState.activeLibraryId || '',
            relativePath: templateLibraryRenamingAssetPath || '',
            name: name
        });
        templateLibraryRenameModalVisible = false;
        templateLibraryRenamingAssetPath = '';
        templateLibraryDraftAssetName = '';
    });
}
function ensureTemplateLibraryLayout() {
    loadTemplateLibraryPrefs();

    var page = document.getElementById('pageTemplateLibrary');
    var titleEl = page?.querySelector('.morph-title');
    var mainEl = page?.querySelector('.morph-main');
    if (!mainEl) return;

    if (titleEl) {
        titleEl.textContent = '\u8bbe\u8ba1\u5e93';
    }

    mainEl.innerHTML = [
        '<section class="morph-section" id="templateLibraryListSection" ' + (templateLibraryView === 'detail' ? 'style="display:none;"' : '') + '>',
        '<div class="template-topbar"><div class="template-search-shell"><span class="template-search-icon">&#9906;</span>',
        '<input id="templateLibrarySearch" class="template-search-input" type="text" placeholder="\u641c\u7d22\u8bbe\u8ba1\u5e93" value="' + escapeHtml(templateLibraryQuery) + '" />',
        '</div></div>',
        '<div class="template-section-action"><button class="template-create-trigger" id="btnTemplateLibraryOpenCreate">+ \u65b0\u5efa\u8bbe\u8ba1\u5e93</button></div>',
        '<div id="templateLibraryList" class="template-dir-list"></div>',
        '</section>',
        '<section class="morph-section" id="templateLibraryDetailSection" ' + (templateLibraryView === 'detail' ? '' : 'style="display:none;"') + '>',
        '<div class="template-library-toolbar">',
        '<div class="template-library-toolbar-main">',
        '<div class="template-library-name" id="templateLibraryActiveName">\u672a\u9009\u62e9</div>',
        '<div class="template-library-summary" id="templateLibrarySummary">\u8bf7\u5148\u521b\u5efa\u6216\u9009\u62e9\u8bbe\u8ba1\u5e93</div>',
        '<div class="template-library-meta-line" id="templateLibraryMeta"></div>',
        '<div class="template-library-tag-rail" id="templateLibraryTagRail"></div>',
        '</div>',
        '<button class="template-icon-btn template-actions-trigger" id="btnTemplateLibraryActionsMenu" title="\u8bbe\u8ba1\u5e93\u64cd\u4f5c">&#8942;</button>',
        '</div>',
        '<div class="template-topbar">',
        '<div class="template-search-shell"><span class="template-search-icon">&#9906;</span>',
        '<input id="templateAssetSearch" class="template-search-input" type="text" placeholder="\u641c\u7d22\u5f53\u524d\u8bbe\u8ba1\u5e93" value="' + escapeHtml(templateLibraryAssetQuery) + '" />',
        '</div>',
        '</div>',
        '<div class="template-view-bar">',
        '<div class="template-size-control" role="group" aria-label="\u7d20\u6750\u7f29\u653e">',
        '<button type="button" class="template-size-step" id="btnTemplateLibraryCardSizeDown" aria-label="\u7f29\u5c0f\u7d20\u6750\u5361\u7247" title="\u7f29\u5c0f\uff08\u53ef\u957f\u6309\uff09">\u2212</button>',
        '<div class="custom-slider template-size-slider" id="templateLibraryCardSizeSlider" tabindex="0" role="slider" aria-label="\u7d20\u6750\u5361\u7247\u5927\u5c0f" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(clampTemplateLibraryCardSize(templateLibraryCardSize)) + '" data-value="' + clampTemplateLibraryCardSize(templateLibraryCardSize) + '" data-min="0" data-max="100">',
        '<div class="custom-slider-track">',
        '<div class="custom-slider-fill" style="width: ' + clampTemplateLibraryCardSize(templateLibraryCardSize) + '%;"></div>',
        '<div class="custom-slider-thumb" style="left: ' + clampTemplateLibraryCardSize(templateLibraryCardSize) + '%;"></div>',
        '</div>',
        '</div>',
        '<button type="button" class="template-size-step" id="btnTemplateLibraryCardSizeUp" aria-label="\u653e\u5927\u7d20\u6750\u5361\u7247" title="\u653e\u5927\uff08\u53ef\u957f\u6309\uff09">+</button>',
        '</div>',
        '</div>',
        '<div id="templateList" class="template-list"></div>',
        '<div id="templateLibrarySelectedAssetPanel" class="template-library-dock-host"></div>',
        '</section>',
        '<div class="template-modal-overlay" id="templateLibraryCreateModal" ' + (templateLibraryCreateModalVisible ? '' : 'style="display:none;"') + '>',
        '<div class="template-modal-card"><div class="template-modal-title">\u65b0\u5efa\u8bbe\u8ba1\u5e93</div>',
        '<div class="template-modal-field"><div class="template-form-label">\u8bbe\u8ba1\u5e93\u540d\u79f0</div>',
        '<input id="templateLibraryName" class="glass-input" type="text" placeholder="\u4f8b\u5982\uff1a\u889c\u5b50\u7d20\u6750\u5e93" value="' + escapeHtml(templateLibraryDraftName) + '" /></div>',
        '<div class="template-modal-note">\u521b\u5efa\u65f6\u4f1a\u8ba9\u4f60\u9009\u62e9\u4e00\u4e2a\u672c\u5730\u76ee\u5f55\uff0c\u540e\u7eed\u8bbe\u8ba1\u6587\u4ef6\u3001\u56fe\u7247\u548c\u6587\u6848\u90fd\u4f1a\u4fdd\u5b58\u5728\u8fd9\u91cc\u3002</div>',
        '<div class="template-modal-actions"><button class="btn-small" id="btnTemplateLibraryCreateCancel">\u53d6\u6d88</button><button class="btn-small" id="btnTemplateLibraryCreate">\u521b\u5efa</button></div>',
        '</div></div>',
        '<div id="templateLibraryTagModalHost"></div>',
        '<div id="templateLibraryRenameModalHost"></div>'
    ].join('');
    templateLibraryRenderedRegions.selectedAssetPanel = '';
    templateLibraryRenderedRegions.meta = '';
    templateLibraryRenderedRegions.tagRail = '';
    templateLibraryRenderedRegions.libraryList = '';
    templateLibraryRenderedRegions.templateList = '';

    document.getElementById('templateLibrarySearch')?.addEventListener('input', function(e) {
        templateLibraryQuery = e.target?.value || '';
        renderTemplateLibraryStateV2(templateLibraryState);
    });
    // 搜索防抖：每敲一个字符就整墙重渲染，在几百素材的库里会明显掉帧
    document.getElementById('templateAssetSearch')?.addEventListener('input', function(e) {
        templateLibraryAssetQuery = e.target?.value || '';
        if (templateLibraryAssetSearchTimer) {
            clearTimeout(templateLibraryAssetSearchTimer);
        }
        templateLibraryAssetSearchTimer = setTimeout(function() {
            templateLibraryAssetSearchTimer = null;
            renderTemplateLibraryStateV2(templateLibraryState);
        }, 180);
    });
    document.getElementById('btnTemplateLibraryOpenCreate')?.addEventListener('click', function() {
        templateLibraryCreateModalVisible = true;
        renderTemplateLibraryStateV2(templateLibraryState);
    });
    document.getElementById('btnTemplateLibraryCreateCancel')?.addEventListener('click', function() {
        templateLibraryCreateModalVisible = false;
        renderTemplateLibraryStateV2(templateLibraryState);
    });
    document.getElementById('templateLibraryName')?.addEventListener('input', function(e) {
        templateLibraryDraftName = e.target?.value || '';
    });
    document.getElementById('btnTemplateLibraryCreate')?.addEventListener('click', function() {
        var name = templateLibraryDraftName || document.getElementById('templateLibraryName')?.value || '';
        templateLibraryCreateModalVisible = false;
        templateLibraryDraftName = '';
        sendToUXP('templateLibraryCreate', { name: name });
    });
    document.getElementById('btnTemplateLibraryActionsMenu')?.addEventListener('click', function(event) {
        openTemplateLibraryActionsMenu(event);
    });
    // 已选素材条要浮在整页底部：morph-section 带毛玻璃滤镜，会成为定位祖先把它困在区块内
    var dockHost = document.getElementById('templateLibrarySelectedAssetPanel');
    if (dockHost && page && dockHost.parentElement !== page) {
        page.appendChild(dockHost);
    }

    bindTemplateLibraryContextMenuGuard();
    bindTemplateLibraryDelegatedInteractions();
    bindTemplateLibraryCardSizeControl();
    syncTemplateLibraryShellState();
    applyTemplateLibraryCardSize();
}
function renderTemplateLibraryStateV2(data, options) {
    var markHydrated = !!(options && options.markHydrated);
    if (markHydrated) {
        templateLibraryStateHydrated = true;
        templateLibraryStateLoading = false;
        templateLibraryLastHydratedAt = Date.now();
    }
    templateLibraryState = {
        success: !!data?.success,
        detailReady: !!data?.detailReady,
        connected: data?.connected !== false,
        error: String(data?.error || ''),
        settings: data?.settings || { localLibraryDirs: [], libraries: [] },
        libraries: Array.isArray(data?.libraries) ? data.libraries : [],
        activeLibraryId: String(data?.activeLibraryId || data?.settings?.activeLibraryId || ''),
        relativePath: String(data?.relativePath || ''),
        breadcrumbs: [],
        entries: [],
        assets: Array.isArray(data?.assets) ? data.assets : (Array.isArray(data?.rootAssets) ? data.rootAssets : []),
        tags: Array.isArray(data?.tags) ? data.tags : [],
        templates: Array.isArray(data?.templates) ? data.templates : [],
        storageInfo: data?.storageInfo || null
    };

    var hasLayout = !!document.getElementById('templateLibraryListSection') && !!document.getElementById('templateLibraryDetailSection');
    var availableTagNames = (Array.isArray(templateLibraryState.tags) ? templateLibraryState.tags : []).map(function(tag) {
        return String(tag?.name || '').trim();
    }).filter(Boolean);
    templateLibrarySelectedTags = normalizeTemplateLibraryTagList(templateLibrarySelectedTags).filter(function(tag) {
        return availableTagNames.includes(tag);
    });

    if (!hasLayout) {
        ensureTemplateLibraryLayout();
    }
    syncTemplateLibraryShellState();
    applyTemplateLibraryCardSize();

    var libraries = Array.isArray(templateLibraryState.libraries) ? templateLibraryState.libraries : [];
    var activeLibrary = libraries.find(function(item) {
        return item.id === templateLibraryState.activeLibraryId;
    }) || libraries[0] || null;
    var filteredLibraries = libraries.filter(function(item) {
        return !templateLibraryQuery || String(item.name || '').toLowerCase().includes(templateLibraryQuery.toLowerCase());
    });
    var filteredAssets = getTemplateLibraryVisibleAssets();
    var allAssets = Array.isArray(templateLibraryState.assets) ? templateLibraryState.assets : [];
    var assetViewSignature = buildTemplateLibraryAssetViewSignature(activeLibrary, filteredAssets);
    var hasRenderableCachedAssets = allAssets.length > 0;
    setTemplateLibrarySelection(getTemplateLibrarySelectedAssetPaths(), templateLibrarySelectedAssetPath);
    var selectedAsset = getSelectedTemplateLibraryAsset();
    if (assetViewSignature !== templateLibraryLastAssetViewSignature) {
        var previousLimit = templateLibraryVisibleAssetLimit;
        var filterSignatureChanged = buildTemplateLibraryFilterSignature(activeLibrary) !== templateLibraryLastFilterSignature;
        templateLibraryLastAssetViewSignature = assetViewSignature;
        templateLibraryLastFilterSignature = buildTemplateLibraryFilterSignature(activeLibrary);
        // 只有筛选条件本身变了才回到第一页；素材增删（后台刷新）不该把已滚动加载的内容收回去
        templateLibraryVisibleAssetLimit = filterSignatureChanged
            ? Math.min(TEMPLATE_LIBRARY_ASSET_PAGE_SIZE, filteredAssets.length || TEMPLATE_LIBRARY_ASSET_PAGE_SIZE)
            : Math.min(Math.max(previousLimit, TEMPLATE_LIBRARY_ASSET_PAGE_SIZE), filteredAssets.length || TEMPLATE_LIBRARY_ASSET_PAGE_SIZE);
    }
    var selectedAssetIndex = selectedAsset
        ? filteredAssets.findIndex(function(item) {
            return String(item?.relativePath || '').trim() === String(templateLibrarySelectedAssetPath || '').trim();
        })
        : -1;
    if (selectedAssetIndex >= templateLibraryVisibleAssetLimit) {
        templateLibraryVisibleAssetLimit = Math.min(
            filteredAssets.length,
            Math.ceil((selectedAssetIndex + 1) / TEMPLATE_LIBRARY_ASSET_PAGE_SIZE) * TEMPLATE_LIBRARY_ASSET_PAGE_SIZE
        );
    }
    var pagedAssets = filteredAssets.slice(0, templateLibraryVisibleAssetLimit);
    var hasMoreAssets = filteredAssets.length > pagedAssets.length;
    var activeNameEl = document.getElementById('templateLibraryActiveName');
    var summaryEl = document.getElementById('templateLibrarySummary');
    var selectedAssetPanelEl = document.getElementById('templateLibrarySelectedAssetPanel');
    var metaEl = document.getElementById('templateLibraryMeta');
    var tagRailEl = document.getElementById('templateLibraryTagRail');
    var libraryListEl = document.getElementById('templateLibraryList');
    var templateListEl = document.getElementById('templateList');

    if (activeNameEl) activeNameEl.textContent = activeLibrary ? activeLibrary.name : '\u672a\u9009\u62e9';
    if (summaryEl) {
        summaryEl.textContent = getTemplateLibrarySummaryText(activeLibrary, selectedAsset, hasRenderableCachedAssets);
    }
    setTemplateLibraryRegionHtml('selectedAssetPanel', selectedAssetPanelEl, renderTemplateLibrarySelectedAssetPanel(selectedAsset));
    if (metaEl) {
        setTemplateLibraryRegionHtml(
            'meta',
            metaEl,
            activeLibrary ? renderTemplateLibraryMetaSummary(allAssets.length, filteredAssets.length, availableTagNames.length) : ''
        );
    }
    if (tagRailEl) {
        setTemplateLibraryRegionHtml(
            'tagRail',
            tagRailEl,
            activeLibrary && availableTagNames.length
                ? renderTemplateLibraryTagFilterBar()
                : (activeLibrary ? '<div class="template-library-tag-empty">\u8fd8\u6ca1\u6709\u6807\u7b7e\uff0c\u53f3\u952e\u7d20\u6750\u53ef\u6dfb\u52a0\u3002</div>' : '')
        );
    }

    if (libraryListEl) {
        if (!templateLibraryStateHydrated && templateLibraryStateLoading) {
            setTemplateLibraryRegionHtml('libraryList', libraryListEl, renderTemplateLibraryLoadingState(
                '\u6b63\u5728\u52a0\u8f7d\u8bbe\u8ba1\u5e93...',
                '\u5148\u540c\u6b65\u8bbe\u8ba1\u5e93\u5217\u8868\uff0c\u518d\u6e32\u67d3\u5185\u5bb9\u3002'
            ));
        } else if (filteredLibraries.length === 0) {
            setTemplateLibraryRegionHtml('libraryList', libraryListEl, '<div class="layer-empty">\u8fd8\u6ca1\u6709\u8bbe\u8ba1\u5e93\uff0c\u5148\u521b\u5efa\u4e00\u4e2a\u3002</div>');
        } else {
            setTemplateLibraryRegionHtml('libraryList', libraryListEl, filteredLibraries.map(function(item) {
                return renderTemplateLibraryCard(item, item.id === templateLibraryState.activeLibraryId);
            }).join(''));
        }
    }

    if (templateListEl && templateLibraryView === 'detail') {
        if (!activeLibrary) {
            setTemplateLibraryRegionHtml('templateList', templateListEl, '<div class="layer-empty">\u8bf7\u5148\u9009\u62e9\u8bbe\u8ba1\u5e93</div>');
            disconnectTemplateLibraryLoadMoreObserver();
        } else if (!templateLibraryState.detailReady && !hasRenderableCachedAssets) {
            setTemplateLibraryRegionHtml('templateList', templateListEl, renderTemplateLibraryLoadingState(
                '\u6b63\u5728\u52a0\u8f7d\u8bbe\u8ba1\u5e93\u5185\u5bb9...',
                '\u5148\u6062\u590d\u7d20\u6750\u7d22\u5f15\uff0c\u518d\u8865\u5168\u7d20\u6750\u4e0e\u6807\u7b7e\u4fe1\u606f\u3002'
            ));
            disconnectTemplateLibraryLoadMoreObserver();
        } else if (allAssets.length === 0) {
            setTemplateLibraryRegionHtml('templateList', templateListEl, [
                '<button type="button" class="design-library-dropzone" id="templateLibraryDropzone">',
                '<span class="design-library-dropzone-title">\u62d6\u62fd\u6587\u4ef6\u5230\u8fd9\u91cc\uff0c\u6216\u70b9\u51fb\u5bfc\u5165</span>',
                '<span class="design-library-dropzone-desc">\u62d6\u5165\u5916\u90e8\u6587\u4ef6\uff0c\u6216\u628a Photoshop \u5f53\u524d\u9009\u4e2d\u62d6\u5230\u8fd9\u91cc\u5bfc\u5165</span>',
                '</button>',
                '<div class="template-empty-state" id="templateLibraryEmptyAction">',
                '<div class="template-empty-icon">+</div>',
                '<div class="template-empty-title">\u5bfc\u5165 Photoshop \u5f53\u524d\u9009\u4e2d</div>',
                '<div class="template-empty-desc">\u70b9\u8fd9\u91cc\u628a\u5f53\u524d\u9009\u4e2d\u7684\u56fe\u5c42\u5b58\u8fdb\u8bbe\u8ba1\u5e93\uff1b\u5bfc\u5165\u6587\u4ef6\u3001\u6dfb\u52a0\u5f53\u524d\u6587\u6863\u5728\u53f3\u4e0a\u89d2\u83dc\u5355\u91cc\u3002</div>',
                '</div>'
            ].join(''));
            bindTemplateLibraryDropzone(activeLibrary);
            disconnectTemplateLibraryLoadMoreObserver();
        } else if (filteredAssets.length === 0) {
            setTemplateLibraryRegionHtml('templateList', templateListEl, [
                renderTemplateLibraryDropzone(true),
                '<div class="template-empty-state template-empty-state-compact">',
                '<div class="template-empty-title">\u6ca1\u6709\u5339\u914d\u7684\u7d20\u6750</div>',
                '<div class="template-empty-desc">\u8bd5\u8bd5\u6e05\u7a7a\u641c\u7d22\u8bcd\u6216\u53d6\u6d88\u6807\u7b7e\u7b5b\u9009\u3002</div>',
                '</div>'
            ].join(''));
            bindTemplateLibraryDropzone(activeLibrary);
            disconnectTemplateLibraryLoadMoreObserver();
        } else {
            setTemplateLibraryRegionHtml(
                'templateList',
                templateListEl,
                buildTemplateLibraryAssetListHtml(pagedAssets, filteredAssets.length)
            );
            bindTemplateLibraryDropzone(activeLibrary);
            bindTemplateLibraryLoadMoreObserver();
            bindTemplateLibraryThumbRatioBackfill();
            scheduleTemplateLibraryGridLayout();
        }
    } else {
        disconnectTemplateLibraryLoadMoreObserver();
    }

    syncTemplateLibrarySelectedAssetState();
}
function renderTemplateLibraryState(data) {
    renderTemplateLibraryStateV2(data, { markHydrated: true });
    // 首次打开面板时状态还是空的，进入时只能停在库列表；数据到达后落到活动库，
    // 省掉"每次都要再点一次库名"的多余一步。用户主动返回列表时不再自动跳转。
    if (templateLibraryView !== 'detail' && !templateLibraryUserLeftDetail && getActiveTemplateLibrary()) {
        templateLibraryView = 'detail';
        renderTemplateLibraryStateV2(templateLibraryState);
    }
}

window.designLibraryRuntime = {
    renderState: renderTemplateLibraryState,
    refresh: function(force) {
        requestTemplateLibraryRefresh(force !== false, { userInitiated: true });
    },
    enter: function() {
        loadTemplateLibraryPrefs();
        var shouldRefresh = shouldRefreshTemplateLibraryOnEnter();
        if (!templateLibraryStateHydrated) {
            templateLibraryStateLoading = true;
        }
        templateLibraryUserLeftDetail = false;
        templateLibraryView = getActiveTemplateLibrary() ? 'detail' : 'list';
        renderTemplateLibraryStateV2(templateLibraryState);
        if (shouldRefresh) {
            requestTemplateLibraryRefresh(false);
        }
    },
    handleBack: function() {
        if (templateLibraryView !== 'detail') {
            return false;
        }
        templateLibraryUserLeftDetail = true;
        templateLibraryView = 'list';
        setTemplateLibrarySelection([], '');
        renderTemplateLibraryStateV2(templateLibraryState);
        return true;
    }
};

renderTemplateLibraryStateV2(templateLibraryState);

