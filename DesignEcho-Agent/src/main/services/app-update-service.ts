/**
 * 应用自更新服务（electron-updater 泛化静态源）。
 *
 * 职责边界：
 * - 只做「检查 → 后台差量下载 → 等用户显式点击 → 退出安装」；绝不静默重启应用
 *   （设计任务可能正在进行，重启时机只属于用户）。
 * - 开发态（未打包）与更新源未配置时诚实降级为对应状态，不发网络请求、不报伪错误。
 * - autoInstallOnAppQuit 开启：即使用户没点更新，下次正常退出时也会完成安装。
 * - 状态变化实时推送 Renderer（appUpdate:state），Renderer 只读投影，不拥有第二状态源。
 */

import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import {
    isConfiguredAppUpdateFeedUrl,
    type AppUpdatePhase,
    type AppUpdateState
} from '../../shared/app-update-contract';
import { resolveAppUpdateFeedUrl } from '../config/app-update-source';

/** 启动后延迟首查，避免与应用启动期的模型目录拉取、WS 建连抢占资源。 */
const STARTUP_CHECK_DELAY_MS = 30_000;
/** 常驻轮询间隔。静态源轮询成本只是一次 latest.yml GET。 */
const PERIODIC_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export class AppUpdateService {
    private readonly getWindow: () => BrowserWindow | null;
    private state: AppUpdateState;
    private wired = false;
    private startupTimer: NodeJS.Timeout | null = null;
    private periodicTimer: NodeJS.Timeout | null = null;

    constructor(getWindow: () => BrowserWindow | null) {
        this.getWindow = getWindow;
        this.state = {
            version: 'app-update-state/v1',
            phase: this.resolveInitialPhase(),
            currentVersion: app.getVersion()
        };
    }

    /** 按打包与配置现实决定初始状态；两类不可用状态都不接线 updater。 */
    private resolveInitialPhase(): AppUpdatePhase {
        if (!app.isPackaged) return 'unsupported_dev';
        if (!isConfiguredAppUpdateFeedUrl(resolveAppUpdateFeedUrl())) return 'unconfigured';
        return 'idle';
    }

    /** 应用启动时调用一次：可用时安排首查与周期轮询。 */
    start(): void {
        if (this.state.phase === 'unsupported_dev' || this.state.phase === 'unconfigured') {
            console.log(`[AppUpdate] 更新检查未启用：${this.state.phase === 'unsupported_dev' ? '开发态（未打包安装）' : '更新源未配置（占位地址）'}`);
            return;
        }
        this.wireUpdater();
        this.startupTimer = setTimeout(() => { void this.checkNow(); }, STARTUP_CHECK_DELAY_MS);
        this.periodicTimer = setInterval(() => { void this.checkNow(); }, PERIODIC_CHECK_INTERVAL_MS);
    }

    stop(): void {
        if (this.startupTimer) clearTimeout(this.startupTimer);
        if (this.periodicTimer) clearInterval(this.periodicTimer);
        this.startupTimer = null;
        this.periodicTimer = null;
    }

    getState(): AppUpdateState {
        return { ...this.state };
    }

    /** 手动 / 定时检查。不可用状态如实返回当前状态，不发请求。 */
    async checkNow(): Promise<AppUpdateState> {
        if (this.state.phase === 'unsupported_dev' || this.state.phase === 'unconfigured') {
            return this.getState();
        }
        // 下载中 / 已就绪时不重入检查，避免打断进行中的差量下载。
        if (this.state.phase === 'downloading' || this.state.phase === 'downloaded') {
            return this.getState();
        }
        this.wireUpdater();
        this.setState({ phase: 'checking', error: undefined });
        await autoUpdater.checkForUpdates().catch((error: unknown) => {
            this.setState({
                phase: 'error',
                checkedAt: new Date().toISOString(),
                error: `检查更新失败：${error instanceof Error ? error.message : String(error)}。请确认网络可达更新源。`
            });
        });
        return this.getState();
    }

    /** 用户显式点击后安装并重启；只有下载完成态可执行。 */
    installNow(): { success: boolean; error?: string } {
        if (this.state.phase !== 'downloaded') {
            return { success: false, error: '新版本还没有下载完成，暂时不能安装。' };
        }
        // 让 IPC 应答先回到 Renderer，再退出安装，避免界面停留在无响应的点击态。
        setImmediate(() => {
            autoUpdater.quitAndInstall(false, true);
        });
        return { success: true };
    }

    private wireUpdater(): void {
        if (this.wired) return;
        this.wired = true;
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.setFeedURL({ provider: 'generic', url: resolveAppUpdateFeedUrl() });

        autoUpdater.on('update-available', (info) => {
            // autoDownload 开启后 available 即进入下载；直接投影 downloading 少一个瞬态。
            this.setState({ phase: 'downloading', latestVersion: String(info?.version || ''), progressPercent: 0 });
        });
        autoUpdater.on('update-not-available', () => {
            this.setState({
                phase: 'idle',
                checkedAt: new Date().toISOString(),
                latestVersion: undefined,
                progressPercent: undefined,
                error: undefined
            });
        });
        autoUpdater.on('download-progress', (progress) => {
            this.setState({ phase: 'downloading', progressPercent: Math.round(Number(progress?.percent) || 0) });
        });
        autoUpdater.on('update-downloaded', (info) => {
            this.setState({
                phase: 'downloaded',
                latestVersion: String(info?.version || this.state.latestVersion || ''),
                progressPercent: 100,
                error: undefined
            });
            console.log(`[AppUpdate] 新版本 ${info?.version} 已下载完成，等待用户确认安装。`);
        });
        autoUpdater.on('error', (error) => {
            this.setState({
                phase: 'error',
                checkedAt: new Date().toISOString(),
                error: `更新失败：${error instanceof Error ? error.message : String(error)}`
            });
        });
    }

    private setState(patch: Partial<AppUpdateState>): void {
        this.state = { ...this.state, ...patch };
        const window = this.getWindow();
        if (window && !window.isDestroyed()) {
            window.webContents.send('appUpdate:state', this.getState());
        }
    }
}
