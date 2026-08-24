/**
 * DesignEcho CEP 版的 Photoshop 执行手（ExtendScript，PS 2019 / 20.x 起可用）。
 *
 * 入口：DE_dispatch(toolName, encodedJsonArgs) → 返回 encodeURIComponent(JSON 字符串)。
 * 约束：
 *  - app.displayDialogs 全程 NO，绝不弹窗；
 *  - 每个工具失败都带中文原因（哪一步、为什么、下一步给谁）；
 *  - 截图只导出临时 JPEG 并返回 tempPath，Base64 由面板 JS 读（ExtendScript 拼 Base64 太慢）。
 */

/* eslint-disable */

// ---------- 迷你 JSON（老 ExtendScript 没有内置 JSON） ----------
if (typeof DE_JSON === 'undefined') {
    var DE_JSON = {
        stringify: function (v) {
            var t = typeof v;
            if (v === null || t === 'undefined') return 'null';
            if (t === 'number') return isFinite(v) ? String(v) : 'null';
            if (t === 'boolean') return v ? 'true' : 'false';
            if (t === 'string') {
                return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
                    .replace(/\r/g, '\\r').replace(/\t/g, '\\t')
                    .replace(/[\u0000-\u001f]/g, function (c) { var h = c.charCodeAt(0).toString(16); while (h.length < 4) h = '0' + h; return '\\u' + h; }) + '"';
            }
            if (v instanceof Array) {
                var parts = [];
                for (var i = 0; i < v.length; i++) parts.push(DE_JSON.stringify(v[i]));
                return '[' + parts.join(',') + ']';
            }
            var props = [];
            for (var k in v) {
                if (!v.hasOwnProperty(k)) continue;
                if (typeof v[k] === 'function') continue;
                props.push(DE_JSON.stringify(k) + ':' + DE_JSON.stringify(v[k]));
            }
            return '{' + props.join(',') + '}';
        },
        // 输入只来自本插件面板 JS（可信），用 eval 解析即可
        parse: function (s) { return eval('(' + s + ')'); }
    };
}

// ---------- 小工具 ----------
function DE_px(v) { return (v && v.as) ? v.as('px') : Number(v); }

function DE_findLayerById(container, id) {
    for (var i = 0; i < container.layers.length; i++) {
        var layer = container.layers[i];
        if (layer.id === id) return layer;
        if (layer.typename === 'LayerSet') {
            var found = DE_findLayerById(layer, id);
            if (found) return found;
        }
    }
    return null;
}

function DE_layerBounds(layer) {
    try {
        var b = layer.bounds;
        var left = DE_px(b[0]), top = DE_px(b[1]), right = DE_px(b[2]), bottom = DE_px(b[3]);
        return { left: left, top: top, right: right, bottom: bottom, width: right - left, height: bottom - top };
    } catch (e) { return null; }
}

function DE_walkLayers(container, includeHidden, depth, out) {
    for (var i = 0; i < container.layers.length; i++) {
        var layer = container.layers[i];
        if (!includeHidden && !layer.visible) continue;
        var node = {
            id: layer.id,
            name: String(layer.name),
            kind: layer.typename === 'LayerSet' ? 'group' : (layer.kind === LayerKind.TEXT ? 'text' : (layer.kind === LayerKind.SMARTOBJECT ? 'smartObject' : 'pixel')),
            visible: layer.visible,
            depth: depth,
            bounds: DE_layerBounds(layer)
        };
        out.push(node);
        if (layer.typename === 'LayerSet') DE_walkLayers(layer, includeHidden, depth + 1, out);
    }
}

function DE_hexToSolidColor(hex) {
    var c = new SolidColor();
    var clean = String(hex || '#222222').replace('#', '');
    c.rgb.red = parseInt(clean.substring(0, 2), 16);
    c.rgb.green = parseInt(clean.substring(2, 4), 16);
    c.rgb.blue = parseInt(clean.substring(4, 6), 16);
    return c;
}

// ---------- 工具实现 ----------
var DE_TOOLS = {

    getDocumentInfo: function () {
        if (app.documents.length === 0) return { success: false, error: '当前没有打开的文档' };
        var d = app.activeDocument;
        return { success: true, document: { id: d.id, name: String(d.name), width: DE_px(d.width), height: DE_px(d.height), resolution: d.resolution }, hostTier: 'cep' };
    },

    listDocuments: function () {
        var docs = [];
        for (var i = 0; i < app.documents.length; i++) {
            var d = app.documents[i];
            docs.push({ id: d.id, name: String(d.name), isActive: app.activeDocument === d, width: DE_px(d.width), height: DE_px(d.height) });
        }
        return { success: true, documents: docs, count: docs.length, activeDocumentId: app.documents.length ? app.activeDocument.id : null };
    },

    switchDocument: function (args) {
        for (var i = 0; i < app.documents.length; i++) {
            var d = app.documents[i];
            if ((args.documentId && d.id === args.documentId) || (args.documentName && String(d.name) === String(args.documentName))) {
                app.activeDocument = d;
                return { success: true, documentId: d.id, documentName: String(d.name) };
            }
        }
        return { success: false, error: '没有找到目标文档：' + (args.documentName || args.documentId) + '。先 listDocuments 看有哪些。' };
    },

    createDocument: function (args) {
        var w = Number(args.width) || 800, h = Number(args.height) || 800;
        var doc = app.documents.add(UnitValue(w, 'px'), UnitValue(h, 'px'), Number(args.resolution) || 72, String(args.name || '未命名'), NewDocumentMode.RGB, DocumentFill.WHITE);
        return { success: true, documentId: doc.id, name: String(doc.name), width: w, height: h };
    },

    getLayerHierarchy: function (args) {
        if (app.documents.length === 0) return { success: false, error: '当前没有打开的文档' };
        var out = [];
        DE_walkLayers(app.activeDocument, args.includeHidden === true, 0, out);
        return { success: true, documentName: String(app.activeDocument.name), totalLayers: out.length, flatList: out };
    },

    createTextLayer: function (args) {
        if (app.documents.length === 0) return { success: false, error: '当前没有打开的文档；先 createDocument' };
        var doc = app.activeDocument;
        var layer = doc.artLayers.add();
        layer.kind = LayerKind.TEXT;
        layer.name = String(args.name || args.content).substring(0, 60);
        var t = layer.textItem;
        t.contents = String(args.content);
        t.size = UnitValue(Number(args.fontSize) || 24, 'px');
        if (args.fontName) { try { t.font = String(args.fontName); } catch (eFont) { /* 字体不存在保持默认，结果里报告 */ } }
        t.color = DE_hexToSolidColor(args.colorHex);
        t.position = [UnitValue(Number(args.x) || 40, 'px'), UnitValue((Number(args.y) || 40) + (Number(args.fontSize) || 24), 'px')];
        var bounds = DE_layerBounds(layer);
        return { success: true, layerId: layer.id, layerName: String(layer.name), bounds: bounds, fontApplied: args.fontName ? String(t.font) : undefined };
    },

    setTextContent: function (args) {
        var doc = app.activeDocument;
        var layer = args.layerId ? DE_findLayerById(doc, Number(args.layerId)) : doc.activeLayer;
        if (!layer) return { success: false, error: '没有找到图层 id=' + args.layerId + '；先 getLayerHierarchy' };
        if (layer.kind !== LayerKind.TEXT) return { success: false, error: '图层「' + layer.name + '」不是文字图层' };
        layer.textItem.contents = String(args.content);
        return { success: true, layerId: layer.id, content: String(args.content), bounds: DE_layerBounds(layer) };
    },

    moveLayer: function (args) {
        var doc = app.activeDocument;
        var layer = args.layerId ? DE_findLayerById(doc, Number(args.layerId)) : doc.activeLayer;
        if (!layer) return { success: false, error: '没有找到图层 id=' + args.layerId };
        var b = DE_layerBounds(layer);
        if (!b) return { success: false, error: '图层「' + layer.name + '」没有可用边界（可能是空图层）' };
        layer.translate(UnitValue(Number(args.x) - b.left, 'px'), UnitValue(Number(args.y) - b.top, 'px'));
        var after = DE_layerBounds(layer);
        var ok = Math.abs(after.left - Number(args.x)) <= 1 && Math.abs(after.top - Number(args.y)) <= 1;
        return { success: ok, layerId: layer.id, newPosition: { x: after.left, y: after.top }, error: ok ? undefined : '写后读回位置 (' + after.left + ',' + after.top + ') 与目标 (' + args.x + ',' + args.y + ') 不符；图层可能被锁定' };
    },

    transformLayer: function (args) {
        var doc = app.activeDocument;
        var layer = args.layerId ? DE_findLayerById(doc, Number(args.layerId)) : doc.activeLayer;
        if (!layer) return { success: false, error: '没有找到图层 id=' + args.layerId };
        var pct = Number(args.scaleUniform);
        if (!pct || pct <= 0) return { success: false, error: 'CEP 版 transformLayer 只支持 scaleUniform（百分比）' };
        layer.resize(pct, pct, AnchorPosition.MIDDLECENTER);
        return { success: true, layerId: layer.id, bounds: DE_layerBounds(layer) };
    },

    placeImage: function (args) {
        if (app.documents.length === 0) return { success: false, error: '当前没有打开的文档；先 createDocument' };
        var file = new File(String(args.filePath));
        if (!file.exists) return { success: false, error: '文件不存在：' + args.filePath };
        var desc = new ActionDescriptor();
        desc.putPath(charIDToTypeID('null'), file);
        desc.putEnumerated(charIDToTypeID('FTcs'), charIDToTypeID('QCSt'), charIDToTypeID('Qcsa'));
        executeAction(charIDToTypeID('Plc '), desc, DialogModes.NO);
        var layer = app.activeDocument.activeLayer;
        if (args.name) layer.name = String(args.name);
        return { success: true, layerId: layer.id, layerName: String(layer.name), bounds: DE_layerBounds(layer) };
    },

    saveDocument: function (args) {
        if (app.documents.length === 0) return { success: false, error: '当前没有打开的文档' };
        var doc = app.activeDocument;
        var path = String(args.path || '');
        if (!path) return { success: false, error: '缺少保存路径 path' };
        var folder = new Folder(path.replace(/[\\\/][^\\\/]*$/, ''));
        if (!folder.exists && !folder.create()) return { success: false, error: '保存目录不存在且创建失败：' + folder.fsName };
        var format = String(args.format || (path.match(/\.(\w+)$/) || [])[1] || 'psd').toLowerCase();
        var file = new File(path);
        if (format === 'jpg' || format === 'jpeg') {
            var jpg = new JPEGSaveOptions(); jpg.quality = Math.max(1, Math.min(12, Math.round((Number(args.quality) || 80) / 100 * 12)));
            doc.saveAs(file, jpg, true, Extension.LOWERCASE);
        } else if (format === 'png') {
            var png = new PNGSaveOptions();
            doc.saveAs(file, png, true, Extension.LOWERCASE);
        } else {
            var psd = new PhotoshopSaveOptions(); psd.maximizeCompatibility = true;
            doc.saveAs(file, psd, true, Extension.LOWERCASE);
        }
        return { success: true, savedPath: file.fsName, format: format };
    },

    // 截图：复制文档 → 拼合 → 缩到 maxSize → 存临时 JPEG → 返回 tempPath（面板 JS 读 Base64）。
    // 这是 CEP 版没有像素接口下的诚实做法：慢（秒级）、会占临时目录，但眼见为实。
    getDocumentSnapshot: function (args) {
        if (app.documents.length === 0) return { success: false, error: '当前没有打开的文档' };
        var maxSize = Number(args.maxSize) || 800;
        var src = app.activeDocument;
        var dup = src.duplicate('DE_snapshot_tmp', true);
        try {
            var w = DE_px(dup.width), h = DE_px(dup.height);
            var scale = Math.min(maxSize / w, maxSize / h, 1);
            if (scale < 1) dup.resizeImage(UnitValue(Math.round(w * scale), 'px'), null, null, ResampleMethod.BICUBIC);
            var file = new File(Folder.temp.fsName + '/designecho-snapshot-' + (new Date().getTime()) + '.jpg');
            var jpg = new JPEGSaveOptions(); jpg.quality = 9;
            dup.saveAs(file, jpg, true, Extension.LOWERCASE);
            return { success: true, tempPath: file.fsName, width: Math.round(w * scale), height: Math.round(h * scale), documentInfo: { id: src.id, name: String(src.name), width: w, height: h } };
        } finally {
            dup.close(SaveOptions.DONOTSAVECHANGES);
        }
    },

    closeDocument: function (args) {
        for (var i = 0; i < app.documents.length; i++) {
            var d = app.documents[i];
            if (!args.documentName || String(d.name) === String(args.documentName)) {
                var name = String(d.name);
                d.close(args.save === true ? SaveOptions.SAVECHANGES : SaveOptions.DONOTSAVECHANGES);
                return { success: true, closedDocument: name };
            }
        }
        return { success: false, error: '没有找到要关闭的文档：' + args.documentName };
    }
};

// ---------- 入口 ----------
function DE_dispatch(name, encodedArgs) {
    var prevDialogs = app.displayDialogs;
    app.displayDialogs = DialogModes.NO;
    var result;
    try {
        var args = {};
        try { args = DE_JSON.parse(decodeURIComponent(encodedArgs || '%7B%7D')); } catch (eParse) { args = {}; }
        var tool = DE_TOOLS[name];
        result = tool
            ? tool(args)
            : { success: false, error: '工具 ' + name + ' 在 CEP 执行手里没有实现' };
    } catch (e) {
        result = { success: false, error: '工具 ' + name + ' 执行异常：' + String(e && e.message ? e.message : e) };
    } finally {
        try { app.displayDialogs = prevDialogs; } catch (eRestore) { /* noop */ }
    }
    return encodeURIComponent(DE_JSON.stringify(result));
}
