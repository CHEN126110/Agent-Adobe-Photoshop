/**
 * 应用自更新的共享契约（Main 服务与 Renderer UI 共用）。
 *
 * 更新协议是 electron-updater 的泛化静态源：更新目录里只有 latest.yml、安装包与
 * blockmap 三类静态文件，客户端轮询 latest.yml 比对 semver，差量下载后由用户
 * 显式点击完成安装。本文件只承载状态投影与更新源合法性判定，不发起任何网络请求。
 */

export type AppUpdatePhase =
    /** 开发态（未打包安装）：electron-updater 不适用，诚实标注而不是报错。 */
    | 'unsupported_dev'
    /** 更新源仍是占位地址：功能已接线但发布桶尚未配置。 */
    | 'unconfigured'
    | 'idle'
    | 'checking'
    | 'downloading'
    | 'downloaded'
    | 'error';

export interface AppUpdateState {
    version: 'app-update-state/v1';
    phase: AppUpdatePhase;
    /** 当前运行版本（package.json version）。 */
    currentVersion: string;
    /** 已发现的最新版本号；仅 downloading / downloaded / error(下载中断) 阶段存在。 */
    latestVersion?: string;
    /** 下载进度 0~100；仅 downloading 阶段存在。 */
    progressPercent?: number;
    /** 最近一次检查完成时间（ISO）。 */
    checkedAt?: string;
    /** 最近一次失败的用户可读说明；仅 error 阶段存在。 */
    error?: string;
}

/**
 * 更新源 URL 合法性判定：必须是 HTTPS（明文源等于把安装包交给中间人），且不能是
 * `.invalid` 保留域占位地址。占位域按 RFC 2606 永不可解析——故意不用「未注册的真实
 * 域名」做占位：那种占位一旦被他人注册，已分发的旧客户端就会从陌生人手里拉更新。
 */
export function isConfiguredAppUpdateFeedUrl(url: string | null | undefined): boolean {
    const text = String(url || '').trim();
    if (!text) return false;
    try {
        const parsed = new URL(text);
        if (parsed.protocol !== 'https:') return false;
        return !parsed.hostname.toLowerCase().endsWith('.invalid');
    } catch {
        return false;
    }
}
