/**
 * 浮层容器：把内容 portal 到 body，并按锚点元素定位。
 *
 * 为什么不用 position:absolute —— 输入栏所在的 .chat-panel 是 overflow:hidden，
 * 工作台 Agent 面板外层还有多层 overflow:hidden。任何比锚点大的绝对定位浮层
 * （Thinking 提示、模型选择面板）都会被祖先裁掉一半，且窗口越窄裁得越狠。
 * portal + position:fixed 一次性跳出所有祖先裁剪与层叠上下文，是这类问题的根治写法。
 *
 * 定位规则：贴着锚点上方或下方展开，水平按 align 对齐锚点的一边，
 * 最后统一夹回视口内（留 8px 边距）——宁可贴边，也不要被切掉。
 */

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type FloatingLayerPlacement = 'up' | 'down';
export type FloatingLayerAlign = 'start' | 'center' | 'end';

export interface FloatingLayerProps {
    /** 锚点元素；浮层贴着它定位 */
    anchorRef: React.RefObject<HTMLElement | null>;
    open: boolean;
    placement?: FloatingLayerPlacement;
    align?: FloatingLayerAlign;
    /** 浮层与锚点之间的间距 */
    offset?: number;
    className?: string;
    role?: string;
    ariaLabel?: string;
    onKeyDown?: (event: React.KeyboardEvent) => void;
    children: React.ReactNode;
}

const VIEWPORT_MARGIN = 8;

interface FloatingCoords {
    left: number;
    top: number;
}

function clamp(value: number, min: number, max: number): number {
    if (max < min) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

function resolveLeft(anchor: DOMRect, layerWidth: number, align: FloatingLayerAlign): number {
    switch (align) {
        case 'end':
            return anchor.right - layerWidth;
        case 'center':
            return anchor.left + (anchor.width - layerWidth) / 2;
        default:
            return anchor.left;
    }
}

export function FloatingLayer({
    anchorRef,
    open,
    placement = 'up',
    align = 'end',
    offset = 8,
    className = '',
    role,
    ariaLabel,
    onKeyDown,
    children
}: FloatingLayerProps): React.ReactElement | null {
    const layerRef = useRef<HTMLDivElement>(null);
    const [coords, setCoords] = useState<FloatingCoords | null>(null);

    const updatePosition = useCallback(() => {
        const anchor = anchorRef.current;
        const layer = layerRef.current;
        if (!anchor || !layer) return;

        const anchorRect = anchor.getBoundingClientRect();
        const layerRect = layer.getBoundingClientRect();
        const rawTop = placement === 'up'
            ? anchorRect.top - layerRect.height - offset
            : anchorRect.bottom + offset;

        setCoords({
            left: clamp(
                resolveLeft(anchorRect, layerRect.width, align),
                VIEWPORT_MARGIN,
                window.innerWidth - layerRect.width - VIEWPORT_MARGIN
            ),
            top: clamp(
                rawTop,
                VIEWPORT_MARGIN,
                window.innerHeight - layerRect.height - VIEWPORT_MARGIN
            )
        });
    }, [align, anchorRef, offset, placement]);

    // 先渲染（拿到真实尺寸）再定位；定位完成前保持不可见，避免闪一下再跳位
    useLayoutEffect(() => {
        if (!open) {
            setCoords(null);
            return;
        }
        updatePosition();
    }, [open, updatePosition, children]);

    useLayoutEffect(() => {
        if (!open) return;
        function handleViewportChange(): void {
            updatePosition();
        }
        // 捕获阶段监听 scroll：任意可滚动祖先滚动都要跟随，不只是 window
        window.addEventListener('scroll', handleViewportChange, true);
        window.addEventListener('resize', handleViewportChange);
        return () => {
            window.removeEventListener('scroll', handleViewportChange, true);
            window.removeEventListener('resize', handleViewportChange);
        };
    }, [open, updatePosition]);

    if (!open) return null;

    return createPortal(
        <div
            ref={layerRef}
            className={className}
            role={role}
            aria-label={ariaLabel}
            onKeyDown={onKeyDown}
            style={{
                position: 'fixed',
                left: coords ? `${coords.left}px` : '0px',
                top: coords ? `${coords.top}px` : '0px',
                visibility: coords ? 'visible' : 'hidden'
            }}
        >
            {children}
        </div>,
        document.body
    );
}
