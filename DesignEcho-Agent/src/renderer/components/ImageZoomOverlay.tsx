/**
 * 图片大图预览浮层。
 *
 * 聊天里能点开看大图的地方不止一处（消息附图、Agent 看过的画面快照），
 * 用户对这些图的预期是同一件事，所以只留一个实现，避免各处交互慢慢长歪。
 *
 * portal 到 body：预览要盖满整个窗口，而聊天区外层有多层 overflow:hidden 与层叠上下文，
 * 留在原地渲染迟早会被祖先裁掉或被别的层压住（与 FloatingLayer 同一个理由）。
 */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import './ImageZoomOverlay.css';

export interface ImageZoomOverlayProps {
    src: string;
    alt?: string;
    caption?: string;
    onClose: () => void;
}

export function ImageZoomOverlay({
    src,
    alt,
    caption,
    onClose
}: ImageZoomOverlayProps): React.ReactElement {
    // Esc 关闭：这是一层盖满窗口的遮罩，只留鼠标点击的话键盘用户没有退路
    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent): void {
            if (event.key === 'Escape') {
                onClose();
            }
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return createPortal(
        <div
            className="image-zoom-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={alt || '图片大图预览'}
            onClick={onClose}
        >
            <div className="zoom-container">
                <img src={src} alt={alt || '图片'} />
                {caption && <div className="zoom-caption">{caption}</div>}
            </div>
            <button
                type="button"
                className="zoom-close"
                aria-label="关闭大图预览"
                onClick={onClose}
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>,
        document.body
    );
}

export default ImageZoomOverlay;
