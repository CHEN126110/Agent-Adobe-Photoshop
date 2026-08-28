/**
 * 模型下载相关 IPC Handlers
 */

import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { ipcMain, app, dialog, shell, IpcMainInvokeEvent, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import type { IPCContext } from './types';

// GitHub 镜像列表
const GITHUB_MIRRORS = [
    'https://ghfast.top/',
    'https://gh-proxy.com/',
    'https://mirror.ghproxy.com/',
    'https://ghproxy.net/',
    'https://gh.ddlc.top/',
    'https://github.moeyy.xyz/',
    'https://hub.gitmirror.com/',
    'https://slink.ltd/',
    'https://cors.isteed.cc/',
    'https://kkgithub.com/',
    'https://dgithub.xyz/',
    '',
];

// Hugging Face 镜像列表
const HF_MIRRORS = [
    'hf-mirror.com',
    'huggingface.sukaka.top',
    'hf.xwall.us.kg',
    'huggingface-mirror.com',
    'modelscope.cn',
    '',
];

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function normalizeExpectedSha256(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const normalized = String(value).trim().toLowerCase();
    if (!SHA256_PATTERN.test(normalized)) {
        throw new Error('模型 SHA-256 必须是 64 位十六进制字符串。');
    }
    return normalized;
}

function resolveModelArtifactPath(modelsDir: string, folder: string, fileName: string): string {
    const normalizedFolder = String(folder || '').trim();
    const normalizedFileName = String(fileName || '').trim();
    if (!normalizedFolder || !normalizedFileName
        || path.basename(normalizedFileName) !== normalizedFileName
        || path.isAbsolute(normalizedFolder)
        || normalizedFolder.split(/[\\/]+/).some(part => !part || part === '.' || part === '..')) {
        throw new Error('模型目标路径无效。');
    }
    const resolvedRoot = path.resolve(modelsDir);
    const resolvedTarget = path.resolve(resolvedRoot, normalizedFolder, normalizedFileName);
    const relative = path.relative(resolvedRoot, resolvedTarget);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('模型目标路径越出模型目录。');
    }
    return resolvedTarget;
}

async function calculateFileSha256(filePath: string): Promise<string> {
    return await new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk: string | Buffer) => {
            hash.update(chunk);
        });
        stream.on('error', reject);
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

async function modelFileMatchesSha256(filePath: string, expectedSha256: string | undefined): Promise<boolean> {
    if (!fs.existsSync(filePath)) return false;
    if (!expectedSha256) return fs.statSync(filePath).size > 0;
    return await calculateFileSha256(filePath) === expectedSha256;
}

/**
 * 获取镜像 URL
 */
function getMirrorUrl(originalUrl: string, mirrorPrefix: string): string {
    if (!mirrorPrefix) return originalUrl;
    
    const domainReplaceMirrors = [
        { pattern: 'gitclone.com', replace: (url: string) => url.replace('https://github.com/', mirrorPrefix) },
        { pattern: 'kkgithub.com', replace: (url: string) => url.replace('github.com', 'kkgithub.com') },
        { pattern: 'dgithub.xyz', replace: (url: string) => url.replace('github.com', 'dgithub.xyz') },
    ];
    
    for (const mirror of domainReplaceMirrors) {
        if (mirrorPrefix.includes(mirror.pattern)) {
            return mirror.replace(originalUrl);
        }
    }
    
    if (originalUrl.includes('github.com') || originalUrl.includes('raw.githubusercontent.com')) {
        return mirrorPrefix + originalUrl;
    }
    
    return originalUrl;
}

/**
 * 获取 HuggingFace 镜像 URL
 */
function getHFMirrorUrl(originalUrl: string, mirrorHost: string): string {
    if (!mirrorHost) return originalUrl;
    return originalUrl.replace('huggingface.co', mirrorHost);
}

/**
 * 注册模型下载相关 IPC handlers
 */
export function registerModelDownloadHandlers(context: IPCContext): void {
    const { mainWindow, logService, mattingService } = context;
    const CURL_PATH = 'C:\\Windows\\System32\\curl.exe';

    // 下载模型
    ipcMain.handle('model:download', async (
        _event: IpcMainInvokeEvent, 
        modelId: string, 
        downloadUrl: string, 
        targetPath: string, 
        fallbackUrls?: string[]
    ) => {
        const modelsDir = path.join(app.getPath('userData'), 'models');
        const fullTargetPath = path.join(modelsDir, targetPath);
        const targetDir = path.dirname(fullTargetPath);
        
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        
        // 检查是否已存在
        if (fs.existsSync(fullTargetPath)) {
            const existingStats = fs.statSync(fullTargetPath);
            if (existingStats.size > 1000000) {
                logService?.logAgent('info', `[Download] 模型已存在: ${modelId}`);
                mainWindow?.webContents.send('model:download-progress', { modelId, percent: 100 });
                return { success: true, modelId, path: fullTargetPath, size: existingStats.size, skipped: true };
            }
            fs.unlinkSync(fullTargetPath);
        }
        
        logService?.logAgent('info', `[Download] 开始下载模型: ${modelId}`);
        mainWindow?.webContents.send('model:download-progress', { modelId, percent: 0, status: 'starting' });
        
        const isHuggingFace = downloadUrl.includes('huggingface.co');
        const mirrors = isHuggingFace ? HF_MIRRORS : GITHUB_MIRRORS;
        
        const tryDownloadWithMirror = async (mirrorIndex: number): Promise<any> => {
            if (mirrorIndex >= mirrors.length) {
                return { 
                    success: false, 
                    error: '所有下载源均失败',
                    suggestion: '您可以手动下载模型文件到：' + fullTargetPath
                };
            }
            
            const mirror = mirrors[mirrorIndex];
            const actualUrl = isHuggingFace 
                ? getHFMirrorUrl(downloadUrl, mirror)
                : getMirrorUrl(downloadUrl, mirror);
            const mirrorName = mirror ? `镜像 ${mirrorIndex}` : '直连';
            
            logService?.logAgent('info', `[Download] 尝试 ${mirrorName}: ${actualUrl}`);
            mainWindow?.webContents.send('model:download-progress', {
                modelId,
                percent: 0,
                status: mirror ? `尝试镜像 ${mirrorIndex}...` : '尝试直连...'
            });
            
            return new Promise((resolve) => {
                const curlArgs = [
                    '-L', '-o', fullTargetPath,
                    '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    '--progress-bar', '--fail',
                    '--connect-timeout', '15',
                    '--max-time', '1800',
                    '--retry', '2',
                    '--retry-delay', '3',
                    actualUrl
                ];
                
                const curlProcess = spawn(CURL_PATH, curlArgs);
                let stderrData = '';
                let lastPercent = 0;
                let downloadStarted = false;
                
                const connectTimeout = setTimeout(() => {
                    if (!downloadStarted) {
                        logService?.logAgent('warn', `[Download] ${mirrorName} 连接超时`);
                        curlProcess.kill();
                    }
                }, 20000);
                
                curlProcess.stderr.on('data', (data: Buffer) => {
                    const output = data.toString();
                    stderrData += output;
                    
                    const percentMatch = output.match(/(\d+(?:\.\d+)?)\s*%/);
                    if (percentMatch) {
                        downloadStarted = true;
                        clearTimeout(connectTimeout);
                        
                        const percent = Math.floor(parseFloat(percentMatch[1]));
                        if (percent !== lastPercent && percent % 5 === 0) {
                            lastPercent = percent;
                            mainWindow?.webContents.send('model:download-progress', { modelId, percent });
                        }
                    }
                });
                
                curlProcess.on('close', async (code: number | null) => {
                    clearTimeout(connectTimeout);
                    
                    if (code === 0) {
                        try {
                            const stats = fs.statSync(fullTargetPath);
                            if (stats.size < 100000) {
                                const content = fs.readFileSync(fullTargetPath, 'utf8').slice(0, 500);
                                if (content.includes('<!DOCTYPE') || content.includes('<html')) {
                                    fs.unlinkSync(fullTargetPath);
                                    resolve(await tryDownloadWithMirror(mirrorIndex + 1));
                                    return;
                                }
                            }
                            
                            logService?.logAgent('info', `[Download] ✓ 下载完成: ${modelId}`);
                            mainWindow?.webContents.send('model:download-progress', { modelId, percent: 100 });
                            resolve({ success: true, modelId, path: fullTargetPath, size: stats.size, source: mirrorName });
                        } catch {
                            resolve(await tryDownloadWithMirror(mirrorIndex + 1));
                        }
                    } else {
                        try { fs.unlinkSync(fullTargetPath); } catch {}
                        
                        const isNetworkError = stderrData.includes('Could not resolve') || 
                                               stderrData.includes('Connection refused') ||
                                               stderrData.includes('timeout') ||
                                               code === 6 || code === 7 || code === 28;
                        
                        if (isNetworkError && mirrorIndex < mirrors.length - 1) {
                            resolve(await tryDownloadWithMirror(mirrorIndex + 1));
                        } else {
                            resolve({ success: false, error: `下载失败 (code: ${code})`, triedMirrors: mirrorIndex + 1 });
                        }
                    }
                });
                
                curlProcess.on('error', async () => {
                    clearTimeout(connectTimeout);
                    try { fs.unlinkSync(fullTargetPath); } catch {}
                    resolve(await tryDownloadWithMirror(mirrorIndex + 1));
                });
            });
        };
        
        let result = await tryDownloadWithMirror(0);
        
        // 尝试备用链接
        if (!result.success && fallbackUrls && fallbackUrls.length > 0) {
            for (let i = 0; i < fallbackUrls.length; i++) {
                logService?.logAgent('info', `[Download] 尝试备用链接 ${i + 1}`);
                result = await tryDownloadWithMirror(0);
                if (result.success) break;
            }
        }
        
        return result;
    });
    
    // 检查模型是否存在
    ipcMain.handle('model:checkExists', async (_event: IpcMainInvokeEvent, modelPath: string) => {
        const modelsDir = path.join(app.getPath('userData'), 'models');
        const fullPath = path.join(modelsDir, modelPath);
        
        return {
            exists: fs.existsSync(fullPath),
            path: fullPath
        };
    });

    // 手动导入模型
    ipcMain.handle('model:import', async (_event: IpcMainInvokeEvent, modelId: string, targetPath: string) => {
        const targetFileName = path.basename(targetPath);
        
        try {
            const result = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
                title: `导入模型：${modelId} → ${targetFileName}`,
                message: `请选择 ONNX 模型文件\n文件将被保存为：${targetPath}`,
                filters: [
                    { name: 'ONNX 模型', extensions: ['onnx'] },
                    { name: '所有文件', extensions: ['*'] }
                ],
                properties: ['openFile']
            });
            
            if (result.canceled || result.filePaths.length === 0) {
                return { success: false, canceled: true };
            }
            
            const sourcePath = result.filePaths[0];
            const modelsDir = path.join(app.getPath('userData'), 'models');
            const fullTargetPath = path.join(modelsDir, targetPath);
            const targetDir = path.dirname(fullTargetPath);
            
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
            
            logService?.logAgent('info', `[Import] 复制模型: ${sourcePath} → ${fullTargetPath}`);
            fs.copyFileSync(sourcePath, fullTargetPath);
            
            const stats = fs.statSync(fullTargetPath);
            logService?.logAgent('info', `[Import] ✓ 导入成功: ${modelId}`);
            
            return { success: true, modelId, path: fullTargetPath, size: stats.size, sourcePath };
        } catch (error: any) {
            logService?.logAgent('error', `[Import] 导入失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    // 检查模型文件
    ipcMain.handle('model:checkModelFile', async (
        _event: IpcMainInvokeEvent,
        folder: string,
        fileName: string,
        expectedSha256?: string
    ) => {
        const projectModelsDir = path.join(__dirname, '../../../models');
        const userModelsDir = path.join(app.getPath('userData'), 'models');
        const normalizedSha256 = normalizeExpectedSha256(expectedSha256);
        
        const projectPath = resolveModelArtifactPath(projectModelsDir, folder, fileName);
        const userPath = resolveModelArtifactPath(userModelsDir, folder, fileName);
        
        const exists = await modelFileMatchesSha256(projectPath, normalizedSha256)
            || await modelFileMatchesSha256(userPath, normalizedSha256);
        console.log(`[Model Check] ${folder}/${fileName}: ${exists ? '✅' : '❌'}`);
        return exists;
    });

    // 下载模型到 models 目录
    // 说明失败原因时带上「哪一步、为什么、能怎么办」，不要只回一个状态码。
    function buildDownloadFailureMessage(statusCode: number | undefined, requestUrl: string): string {
        const host = (() => {
            try { return new URL(requestUrl).host; } catch { return '下载源'; }
        })();
        if (statusCode === 401 || statusCode === 403) {
            return `${host} 拒绝了匿名下载（HTTP ${statusCode}）。`
                + '常见原因是该模型仓库已被删除、改名或转为私有——HuggingFace 对这几种情况都返回 401。'
                + '可以先点「镜像」换源重试，或手动下载模型文件后用「打开模型目录」放进去。';
        }
        if (statusCode === 404) {
            return `${host} 上找不到这个模型文件（HTTP 404），下载地址可能已经失效。`
                + '可以先点「镜像」换源重试，或手动下载后放进模型目录。';
        }
        return `${host} 返回 HTTP ${statusCode}，下载未开始。可稍后重试或改用「镜像」源。`;
    }

    ipcMain.handle('model:downloadToModels', async (
        event: IpcMainInvokeEvent, 
        url: string, 
        folder: string, 
        fileName: string, 
        progressChannel: string,
        expectedSha256?: string
    ) => {
        // 下到 userData，与本文件其它 handler（导入/删除/扫描）和推理服务的加载路径一致。
        // 这里原先用的是 __dirname/../../../models（安装目录）：打包后往往只读，
        // 即使写成功了推理服务也不去那里找，等于下了个永远用不上的文件。
        const modelsDir = path.join(app.getPath('userData'), 'models');
        const targetPath = resolveModelArtifactPath(modelsDir, folder, fileName);
        const targetDir = path.dirname(targetPath);
        const normalizedSha256 = normalizeExpectedSha256(expectedSha256);
        const stagingPath = `${targetPath}.${process.pid}.${Date.now()}.part`;
        
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        if (await modelFileMatchesSha256(targetPath, normalizedSha256)) {
            event.sender.send(progressChannel, 100);
            return true;
        }
        
        console.log(`[Model Download] 开始下载: ${url}`);
        
        return new Promise((resolve, reject) => {
            const makeRequest = (requestUrl: string, redirectCount = 0) => {
                if (redirectCount > 5) {
                    reject(new Error('重定向次数过多'));
                    return;
                }
                
                const requestModule = requestUrl.startsWith('https') ? https : http;
                requestModule.get(requestUrl, (response) => {
                    if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
                        const redirectUrl = response.headers.location;
                        if (redirectUrl) {
                            response.resume();
                            makeRequest(new URL(redirectUrl, requestUrl).toString(), redirectCount + 1);
                            return;
                        }
                    }
                    
                    if (response.statusCode !== 200) {
                        // 裸 HTTP 码对用户没有意义。HuggingFace 对「仓库不存在」与「需要登录」
                        // 都返回 401，所以这两种要一起说，并指出可自行处理的动作。
                        reject(new Error(buildDownloadFailureMessage(response.statusCode, requestUrl)));
                        return;
                    }
                    
                    const totalSize = parseInt(response.headers['content-length'] || '0', 10);
                    let downloadedSize = 0;
                    
                    const hash = createHash('sha256');
                    const file = fs.createWriteStream(stagingPath, { flags: 'wx' });
                    const rejectIncompleteDownload = (error: Error): void => {
                        file.destroy();
                        fs.rmSync(stagingPath, { force: true });
                        reject(error);
                    };
                    
                    response.on('data', (chunk: Buffer) => {
                        hash.update(chunk);
                        downloadedSize += chunk.length;
                        if (totalSize > 0) {
                            const progress = Math.round((downloadedSize / totalSize) * 100);
                            event.sender.send(progressChannel, progress);
                        }
                    });
                    
                    response.pipe(file);

                    response.on('aborted', () => {
                        rejectIncompleteDownload(new Error(`模型下载中断：${fileName}`));
                    });

                    response.on('error', (error: Error) => {
                        rejectIncompleteDownload(error);
                    });
                    
                    file.on('finish', () => {
                        file.close(() => {
                            if (totalSize > 0 && downloadedSize !== totalSize) {
                                fs.rmSync(stagingPath, { force: true });
                                reject(new Error(
                                    `模型下载不完整：${fileName} 预期 ${totalSize} 字节，实际 ${downloadedSize} 字节。`
                                ));
                                return;
                            }
                            const actualSha256 = hash.digest('hex');
                            if (normalizedSha256 && actualSha256 !== normalizedSha256) {
                                fs.rmSync(stagingPath, { force: true });
                                reject(new Error(
                                    `模型完整性校验失败：${fileName} 的 SHA-256 与固定清单不一致，旧模型未被覆盖。`
                                ));
                                return;
                            }
                            if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true });
                            fs.renameSync(stagingPath, targetPath);
                            event.sender.send(progressChannel, 100);
                            console.log(`[Model Download] ✅ 下载并校验完成: ${fileName}`);
                            resolve(true);
                        });
                    });
                    
                    file.on('error', (err) => {
                        fs.rmSync(stagingPath, { force: true });
                        reject(err);
                    });
                }).on('error', (err) => {
                    fs.rmSync(stagingPath, { force: true });
                    reject(err);
                });
            };
            
            makeRequest(url);
        });
    });

    // 打开模型目录
    ipcMain.handle('model:openModelsFolder', async () => {
        const modelsDir = path.join(app.getPath('userData'), 'models');
        if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });
        console.log(`[Model] 打开模型目录: ${modelsDir}`);
        await shell.openPath(modelsDir);
    });
}
