// 脚本：排列有效图层组，编组，调整边距和大小，居中对齐，垂直移动，并取消编组
function arrangeAndGroupLayerSets() {
    var doc = app.activeDocument;

    // 获取第一个有效图层组
    var representativeGroup = null;
    for (var i = 0; i < doc.layerSets.length; i++) {
        if (!isEmptyLayerSet(doc.layerSets[i])) {
            representativeGroup = doc.layerSets[i];
            break;
        }
    }

    if (representativeGroup === null) {
        alert("未找到有效的图层组。");
        return;
    }

    // 自动选中第一个有效的图层组
    selectLayerSetById(representativeGroup.id);

    // 在第一个图层组中找到名为“阴影”的智能对象
    var shadowLayer = null;
    for (var j = 0; j < representativeGroup.artLayers.length; j++) {
        var layer = representativeGroup.artLayers[j];
        if (layer.name === "阴影" && layer.kind === LayerKind.SMARTOBJECT) {
            shadowLayer = layer;
            break;
        }
    }

    // 如果未找到“阴影”图层，使用默认间距比例
    var spacingRatio = 1.05;
    if (shadowLayer !== null) {
        // 根据阴影智能对象的宽度决定间距比例
        var shadowWidth = shadowLayer.bounds[2] - shadowLayer.bounds[0];
        spacingRatio = shadowWidth > 1500 ? 0.55 : 0.55;
    }

    // 计算代表性图层组的宽度和间距
    var representativeWidth = representativeGroup.bounds[2] - representativeGroup.bounds[0];
    var spacing = representativeWidth * spacingRatio;

    // 计算第一个有效图层组的中心点
    var currentX = (representativeGroup.bounds[0] + representativeGroup.bounds[2]) / 2;

    for (var i = 0; i < doc.layerSets.length; i++) {
        var group = doc.layerSets[i];
        if (isEmptyLayerSet(group)) {
            continue; // 跳过空白图层组
        }

        var groupCenterX = currentX;
        var groupCenterY = doc.height / 2;

        // 计算当前图层组的中心点位置偏移量
        var deltaX = groupCenterX - (group.bounds[0] + group.bounds[2]) / 2;
        var deltaY = groupCenterY - (group.bounds[1] + group.bounds[3]) / 2;

        // 移动图层组到新位置，使其中心点对齐
        group.translate(deltaX, deltaY);

        // 更新 currentX 为下一个图层组的中心点位置
        currentX += spacing; // 使用根据“阴影”宽度计算出的间距来排列下一个图层组
    }

    // 选择所有图层组
    var layerSetCount = doc.layerSets.length;
    var allLayerIDs = [];
    
    for (var i = 0; i < layerSetCount; i++) {
        var layerSet = doc.layerSets[i];
        allLayerIDs.push(layerSet.id);
    }

    // 如果没有图层组，则退出
    if (allLayerIDs.length === 0) {
        alert("未找到有效的图层组。");
        return;
    }

    // 创建一个 ActionDescriptor 来选择所有图层组
    var selectDescriptor = new ActionDescriptor();
    var selectRef = new ActionReference();
    for (var j = 0; j < allLayerIDs.length; j++) {
        selectRef.putIdentifier(stringIDToTypeID("layer"), allLayerIDs[j]);
    }
    selectDescriptor.putReference(stringIDToTypeID("null"), selectRef);
    executeAction(stringIDToTypeID("select"), selectDescriptor, DialogModes.NO);

    // 编组选中的图层组
    var groupDescriptor = new ActionDescriptor();
    var groupRef = new ActionReference();
    groupRef.putClass(stringIDToTypeID("layerSection"));
    groupDescriptor.putReference(stringIDToTypeID("null"), groupRef);
    var fromRef = new ActionReference();
    fromRef.putEnumerated(stringIDToTypeID("layer"), stringIDToTypeID("ordinal"), stringIDToTypeID("targetEnum"));
    groupDescriptor.putReference(stringIDToTypeID("from"), fromRef);
    executeAction(stringIDToTypeID("make"), groupDescriptor, DialogModes.NO);

    // 获取新编组的参考
    var newGroup = doc.activeLayer;
    newGroup.name = "Grouped Layers";

    // 调整新编组的大小以适应画布的宽度
    var groupWidth = newGroup.bounds[2].as("px") - newGroup.bounds[0].as("px");
    var docWidth = doc.width.as("px");
    var scaleFactor = docWidth / groupWidth;

    newGroup.resize(scaleFactor * 100, scaleFactor * 100, AnchorPosition.MIDDLECENTER);

    // 居中编组
    var groupBounds = newGroup.bounds;
    var canvasCenterX = doc.width.as("px") / 2;
    var canvasCenterY = doc.height.as("px") / 2;
    var groupCenterX = (groupBounds[0].as("px") + groupBounds[2].as("px")) / 2;
    var groupCenterY = (groupBounds[1].as("px") + groupBounds[3].as("px")) / 2;
    var deltaX = canvasCenterX - groupCenterX;
    var deltaY = canvasCenterY - groupCenterY;

    newGroup.translate(deltaX, deltaY);

    // 改为百分比移动，按画布高度的百分比来移动
    var movePercentage = 5; // 10代表10%的画布高度
    var moveDistance = (movePercentage / 100) * doc.height.as("px");
    newGroup.translate(0, moveDistance);

    // 取消编组
    ungroupLayers();
}

// 选中指定ID的图层组
function selectLayerSetById(layerSetId) {
    var selectDescriptor = new ActionDescriptor();
    var selectRef = new ActionReference();
    selectRef.putIdentifier(stringIDToTypeID("layer"), layerSetId);
    selectDescriptor.putReference(stringIDToTypeID("null"), selectRef);
    executeAction(stringIDToTypeID("select"), selectDescriptor, DialogModes.NO);
}

// 检查图层组是否为空（无内容）
function isEmptyLayerSet(layerSet) {
    return layerSet.artLayers.length === 0 && layerSet.layerSets.length === 0;
}

// 取消编组的函数
function ungroupLayers() {
    try {
        var d = new ActionDescriptor();
        var r = new ActionReference();
        r.putEnumerated(stringIDToTypeID("layer"), stringIDToTypeID("ordinal"), stringIDToTypeID("targetEnum"));
        d.putReference(stringIDToTypeID("null"), r);
        executeAction(stringIDToTypeID("ungroupLayersEvent"), d, DialogModes.NO);
    } catch (e) {
        if (e.number != 8007) {
            alert("Line: " + e.line + "\n\n" + e, "Bug!", true);
            throw (e);
        }
    }
}

// 包裹在suspendHistory中执行
app.activeDocument.suspendHistory("颜色排列", "arrangeAndGroupLayerSets()");
