/**
 * 应用更新源（唯一权威配置点）。
 *
 * 分发模式：私下分发 + 对象存储静态托管（2026-09-01 用户拍板）。任何能以 HTTPS
 * 提供静态文件的桶都可用（阿里云 OSS / 腾讯 COS / 火山 TOS / 自有服务器 + CDN）。
 *
 * 启用步骤（建好桶后只改本文件一处）：
 *   1. 建一个可公读的桶目录，例如 https://<bucket>.<region>.aliyuncs.com/designecho/stable/
 *   2. 把下方 APP_UPDATE_FEED_URL 改成该目录（必须 HTTPS，以 / 结尾）
 *   3. 发布：`npm run dist` 后把 release/ 下的 latest.yml、DesignEcho-*.exe 与
 *      对应 .blockmap 原样上传到该目录（或配置 electron-builder publish 直传）
 *   4. 客户端老版本轮询 latest.yml → 差量下载 → 用户点击「更新」完成安装
 *
 * 占位地址使用 RFC 2606 保留域 `.invalid`（永不可解析）：在真实桶配置之前，运行时
 * 会将状态诚实标注为「更新源未配置」，绝不向任何可能被他人注册的域名发起更新请求。
 * 运行时以本常量为准（每次启动显式 setFeedURL），package.json 的 build.publish 仅用于
 * 让 electron-builder 生成 app-update.yml 与产物命名，不是第二真相源。
 */

export const APP_UPDATE_FEED_URL = 'https://updates.designecho.invalid/agent/stable/';

/**
 * 解析本次运行实际使用的更新源。环境变量 DESIGNECHO_UPDATE_FEED_URL 仅供发布前的
 * 灰度自测（指向测试桶验证真实更新链），不改变常量真相源。
 */
export function resolveAppUpdateFeedUrl(): string {
    const override = String(process.env.DESIGNECHO_UPDATE_FEED_URL || '').trim();
    return override || APP_UPDATE_FEED_URL;
}
