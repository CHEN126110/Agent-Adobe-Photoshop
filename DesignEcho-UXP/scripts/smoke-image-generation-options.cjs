#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..');
const helperPath = path.join(projectRoot, 'src/core/image-generation-options.ts');
const indexPath = path.join(projectRoot, 'src/index.ts');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function loadHelperModule(filePath) {
    assert(fs.existsSync(filePath), `Missing helper module: ${path.relative(projectRoot, filePath)}`);
    const source = fs.readFileSync(filePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true
        }
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(transpiled, {
        module,
        exports: module.exports,
        require,
        console
    }, { filename: filePath });
    return module.exports;
}

function main() {
    const indexSource = fs.readFileSync(indexPath, 'utf8');
    assert(
        indexSource.includes("from './core/image-generation-options'"),
        'src/index.ts must import image generation options from src/core/image-generation-options.ts'
    );
    for (const localName of [
        'DEFAULT_IMAGE_TO_IMAGE_MODEL',
        'DEFAULT_IMAGE_TO_IMAGE_SIZE_PRESET',
        'JIMENG_IMAGE_TO_IMAGE_MODEL',
        'IMAGE_TO_IMAGE_MODEL_SIZE_CAPABILITIES',
        'normalizeImageToImageModel',
        'resolveImageToImageSizePreset',
        'resolveImageToImageSnapshotMaxEdge',
        'resolveInpaintingCaptureMaxSize'
    ]) {
        assert(!new RegExp(`(?:const|function)\\s+${localName}\\b`).test(indexSource), `${localName} must not remain local in src/index.ts`);
    }

    const options = loadHelperModule(helperPath);
    assert(options.DEFAULT_IMAGE_TO_IMAGE_MODEL === 'doubao-seedream-5-0-260128', 'default image-to-image model changed');
    assert(options.JIMENG_IMAGE_TO_IMAGE_MODEL === 'jimeng-seedream-4-6', 'jimeng model id changed');
    assert(options.normalizeImageToImageModel('') === options.DEFAULT_IMAGE_TO_IMAGE_MODEL, 'empty model should use default');
    assert(options.resolveImageToImageSizePreset(options.DEFAULT_IMAGE_TO_IMAGE_MODEL, '3k') === '3K', 'default model should support 3K');
    assert(options.resolveImageToImageSizePreset(options.JIMENG_IMAGE_TO_IMAGE_MODEL, '3K') === '2K', 'jimeng unsupported 3K should fall back to default 2K');
    assert(options.resolveImageToImageSnapshotMaxEdge(options.JIMENG_IMAGE_TO_IMAGE_MODEL, '1K') === 4096, 'jimeng capture max edge changed');
    assert(options.resolveImageToImageSnapshotMaxEdge(options.DEFAULT_IMAGE_TO_IMAGE_MODEL, '3K') === 3456, 'seedream 3K capture edge changed');
    assert(options.resolveInpaintingCaptureMaxSize('ultra') === 2048, 'inpainting ultra max size changed');
    assert(options.resolveInpaintingCaptureMaxSize(undefined, 'google/gemini-3-pro-image-preview') === 1536, 'gemini inpainting default capture size changed');

    console.log(JSON.stringify({
        success: true,
        checks: [
            'image generation option helpers live outside src/index.ts',
            'image-to-image model and size defaults remain stable',
            'inpainting capture size defaults remain stable'
        ]
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error.message || error);
    process.exit(1);
}
