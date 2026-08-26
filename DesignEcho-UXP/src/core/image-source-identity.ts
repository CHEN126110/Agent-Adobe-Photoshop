/**
 * 图片置入来源的同步字节身份校验。
 *
 * FNV-1a 只用于跨 Agent/UXP 的快速一致性读回，不承担安全签名；上游缓存仍用
 * SHA-256 保护持久化资产。这里同时核对字节长度，避免 UXP 只把调用方声明原样回显。
 */

export function calculateImageSourceChecksum(bytes: Uint8Array): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < bytes.length; index += 1) {
        hash ^= bytes[index];
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function assertImageSourceIdentity(input: {
    bytes: Uint8Array;
    expectedByteLength?: number;
    expectedChecksum?: string;
}): void {
    const expectedByteLength = input.expectedByteLength;
    if (expectedByteLength !== undefined) {
        if (!Number.isSafeInteger(expectedByteLength) || expectedByteLength <= 0) {
            throw new Error('源图字节长度声明无效。');
        }
        if (expectedByteLength !== input.bytes.length) {
            throw new Error(`源图字节长度不一致: expected=${expectedByteLength}, actual=${input.bytes.length}`);
        }
    }

    const expectedChecksum = String(input.expectedChecksum || '').trim().toLowerCase();
    if (!expectedChecksum) return;
    if (!/^fnv1a32:[a-f0-9]{8}$/.test(expectedChecksum)) {
        throw new Error(`源图校验和格式不受支持: ${expectedChecksum}`);
    }
    const actualChecksum = calculateImageSourceChecksum(input.bytes);
    if (actualChecksum !== expectedChecksum) {
        throw new Error(`源图校验失败: expected=${expectedChecksum}, actual=${actualChecksum}`);
    }
}
