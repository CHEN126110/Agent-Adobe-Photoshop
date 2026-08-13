#target photoshop

// 获取图层组的边界尺寸
function getLayerGroupBounds(layerSet) {
    var bounds = layerSet.bounds;
    var x = bounds[0].value;
    var y = bounds[1].value;
    var w = bounds[2].value - x;
    var h = bounds[3].value - y;
    return { x: x, y: y, w: w, h: h };
}

// 创建带圆角的矩形图层的函数
function make_03857421875(x, y, w, h, radius, layerName) {
    try {
        var d = new ActionDescriptor();
        var r = new ActionReference();
        r.putClass(stringIDToTypeID("contentLayer"));
        d.putReference(stringIDToTypeID("null"), r);
        var d1 = new ActionDescriptor();
        var d2 = new ActionDescriptor();
        var d3 = new ActionDescriptor();
        d3.putDouble(stringIDToTypeID("red"), 0);
        d3.putDouble(stringIDToTypeID("green"), 0);
        d3.putDouble(stringIDToTypeID("blue"), 0);
        d2.putObject(stringIDToTypeID("color"), stringIDToTypeID("RGBColor"), d3);
        d1.putObject(stringIDToTypeID("type"), stringIDToTypeID("solidColorLayer"), d2);
        var d4 = new ActionDescriptor();
        d4.putInteger(stringIDToTypeID("unitValueQuadVersion"), 1);
        d4.putUnitDouble(stringIDToTypeID("top"), stringIDToTypeID("pixelsUnit"), y);
        d4.putUnitDouble(stringIDToTypeID("left"), stringIDToTypeID("pixelsUnit"), x);
        d4.putUnitDouble(stringIDToTypeID("bottom"), stringIDToTypeID("pixelsUnit"), y + h);
        d4.putUnitDouble(stringIDToTypeID("right"), stringIDToTypeID("pixelsUnit"), x + w);
        d4.putUnitDouble(stringIDToTypeID("topRight"), stringIDToTypeID("pixelsUnit"), radius);
        d4.putUnitDouble(stringIDToTypeID("topLeft"), stringIDToTypeID("pixelsUnit"), radius);
        d4.putUnitDouble(stringIDToTypeID("bottomLeft"), stringIDToTypeID("pixelsUnit"), radius);
        d4.putUnitDouble(stringIDToTypeID("bottomRight"), stringIDToTypeID("pixelsUnit"), radius);
        d1.putObject(stringIDToTypeID("shape"), stringIDToTypeID("rectangle"), d4);
        d.putObject(stringIDToTypeID("using"), stringIDToTypeID("contentLayer"), d1);
        executeAction(stringIDToTypeID("make"), d, DialogModes.NO);

        // 获取新创建的图层并设置其名称
        var newLayer = app.activeDocument.activeLayer;
        newLayer.name = layerName;
    } catch (e) {
        alert("创建圆角矩形图层时出错: " + e.message);
    }
}

// 创建矩形图层基于图层组的尺寸
function createRectangleFromGroupBounds() {
    var doc = app.activeDocument;
    // 确保有图层组被选中
    if (doc.activeLayer.typename !== 'LayerSet') {
        alert('请先选中一个图层组');
        return;
    }

    var group = doc.activeLayer;
    var bounds = getLayerGroupBounds(group);

    // 使用图层组的边界尺寸来创建矩形图层
    make_03857421875(bounds.x, bounds.y, bounds.w, bounds.h, 10, "形状参考");
}

// 执行函数
createRectangleFromGroupBounds();
