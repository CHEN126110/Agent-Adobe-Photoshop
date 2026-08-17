#target photoshop

function getTopLevelLayerSets(doc) {
    var layerSets = [];
    var excludeKeyword = "参考"; // 设置要排除的关键字

    for (var i = 0; i < doc.layerSets.length; i++) {
        var layerSetName = doc.layerSets[i].name;
        if (layerSetName.indexOf(excludeKeyword) === -1) { // 如果图层组名称不包含排除的关键字
            layerSets.push(layerSetName);
        }
    }
    return layerSets;
}

function readExistingCSV(filePath) {
    var file = new File(filePath);
    var existingData = [];
    if (file.open("r")) {
        file.readln(); // 跳过表头
        while (!file.eof) {
            var line = file.readln();
            var columns = line.split(",");
            if (columns.length >= 2) {
                existingData.push(columns[1]); // 假设第二列是我们需要保留的数据
            } else {
                existingData.push(""); // 空数据占位
            }
        }
        file.close();
    }
    return existingData;
}

function writeToCSV(filePath, data, existingSecondColumnData) {
    var file = new File(filePath);
    if (!file.open("w")) {
        alert("无法写入文件: " + filePath);
        return;
    }

    file.writeln("颜色,exValue,编号");
    for (var i = 0; i < data.length; i++) {
        var secondColumnData = i < existingSecondColumnData.length ? existingSecondColumnData[i] : "";
        file.writeln(data[i] + "," + secondColumnData + "," + (i + 1));
    }
    file.close();
}

function main() {
    if (app.documents.length === 0) {
        alert("没有打开的文档。");
        return;
    }

    var doc = app.activeDocument;
    var layerSets = getTopLevelLayerSets(doc);

    if (layerSets.length === 0) {
        alert("文档中没有图层组。");
        return;
    }

    var filePath = "D:\\颜色配置.csv";  // 指定CSV文件的保存路径
    var existingData = readExistingCSV(filePath);
    writeToCSV(filePath, layerSets, existingData);
    
    alert("导出完成"); // 显示导出完成的提示
}

main();
