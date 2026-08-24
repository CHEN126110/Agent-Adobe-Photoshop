/**
 * 轻量 Markdown 渲染器（设计知识笔记专用）
 *
 * 不引入第三方 markdown 依赖，也不使用 dangerouslySetInnerHTML——
 * 笔记正文是用户/Agent 共写内容，按不可信输入处理，全部输出为 React 元素。
 * 支持子集：标题、段落、无序/有序列表、引用、围栏代码、行内代码、粗斜体、
 * 普通链接、[[wiki 链接]]（回调交给宿主决定跳转）、分隔线。
 */

import React from 'react';

export interface MarkdownLiteProps {
    content: string;
    /** 点击 [[wiki 链接]] 时回调（参数是链接目标原文，如「主图排版心得」） */
    onWikiLinkClick?: (target: string) => void;
    /** 点击普通 http(s) 链接时回调；缺省时不响应（不直接 window.open） */
    onExternalLinkClick?: (url: string) => void;
}

export function MarkdownLite({ content, onWikiLinkClick, onExternalLinkClick }: MarkdownLiteProps): React.ReactElement {
    const blocks = parseBlocks(String(content || ''));
    return (
        <div className="markdown-lite">
            {blocks.map((block, index) => renderBlock(block, index, { onWikiLinkClick, onExternalLinkClick }))}
        </div>
    );
}

type Block =
    | { kind: 'heading'; level: number; text: string }
    | { kind: 'paragraph'; text: string }
    | { kind: 'quote'; lines: string[] }
    | { kind: 'ul'; items: string[] }
    | { kind: 'ol'; items: string[] }
    | { kind: 'code'; language: string; code: string }
    | { kind: 'hr' };

function parseBlocks(content: string): Block[] {
    const lines = content.split(/\r?\n/);
    const blocks: Block[] = [];
    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) {
            index += 1;
            continue;
        }
        const fence = line.match(/^```\s*(\S*)\s*$/);
        if (fence) {
            const codeLines: string[] = [];
            index += 1;
            while (index < lines.length && !/^```\s*$/.test(lines[index])) {
                codeLines.push(lines[index]);
                index += 1;
            }
            index += 1;
            blocks.push({ kind: 'code', language: fence[1] || '', code: codeLines.join('\n') });
            continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() });
            index += 1;
            continue;
        }
        if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
            blocks.push({ kind: 'hr' });
            index += 1;
            continue;
        }
        if (/^>\s?/.test(line)) {
            const quoteLines: string[] = [];
            while (index < lines.length && /^>\s?/.test(lines[index])) {
                quoteLines.push(lines[index].replace(/^>\s?/, ''));
                index += 1;
            }
            blocks.push({ kind: 'quote', lines: quoteLines });
            continue;
        }
        if (/^\s*[-*+]\s+/.test(line)) {
            const items: string[] = [];
            while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
                items.push(lines[index].replace(/^\s*[-*+]\s+/, ''));
                index += 1;
            }
            blocks.push({ kind: 'ul', items });
            continue;
        }
        if (/^\s*\d+\.\s+/.test(line)) {
            const items: string[] = [];
            while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
                items.push(lines[index].replace(/^\s*\d+\.\s+/, ''));
                index += 1;
            }
            blocks.push({ kind: 'ol', items });
            continue;
        }
        const paragraphLines: string[] = [];
        while (index < lines.length && lines[index].trim()
            && !/^(#{1,6}\s|>|```|\s*[-*+]\s+|\s*\d+\.\s+)/.test(lines[index])) {
            paragraphLines.push(lines[index]);
            index += 1;
        }
        blocks.push({ kind: 'paragraph', text: paragraphLines.join('\n') });
    }
    return blocks;
}

interface InlineHandlers {
    onWikiLinkClick?: (target: string) => void;
    onExternalLinkClick?: (url: string) => void;
}

function renderBlock(block: Block, key: number, handlers: InlineHandlers): React.ReactElement {
    switch (block.kind) {
        case 'heading': {
            const Tag = (`h${Math.min(block.level + 1, 6)}`) as keyof JSX.IntrinsicElements;
            return <Tag key={key} className={`md-heading md-heading--${block.level}`}>{renderInline(block.text, handlers)}</Tag>;
        }
        case 'code':
            return (
                <pre key={key} className="md-code" data-language={block.language || undefined}>
                    <code>{block.code}</code>
                </pre>
            );
        case 'quote':
            return <blockquote key={key} className="md-quote">{block.lines.map((line, i) => <p key={i}>{renderInline(line, handlers)}</p>)}</blockquote>;
        case 'ul':
            return <ul key={key} className="md-list">{block.items.map((item, i) => <li key={i}>{renderInline(item, handlers)}</li>)}</ul>;
        case 'ol':
            return <ol key={key} className="md-list">{block.items.map((item, i) => <li key={i}>{renderInline(item, handlers)}</li>)}</ol>;
        case 'hr':
            return <hr key={key} className="md-hr" />;
        default:
            return <p key={key} className="md-paragraph">{renderInline(block.text, handlers)}</p>;
    }
}

/** 行内元素：按优先级切分——行内代码 > wiki 链接 > markdown 链接 > 粗体 > 斜体 */
const INLINE_PATTERN = /(`[^`]+`)|(\[\[[^\[\]]+\]\])|(\[[^\]]+\]\((?:https?:\/\/)[^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)/g;

function renderInline(text: string, handlers: InlineHandlers): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;
    let tokenKey = 0;
    for (const match of text.matchAll(INLINE_PATTERN)) {
        const start = match.index ?? 0;
        if (start > lastIndex) nodes.push(text.slice(lastIndex, start));
        const token = match[0];
        tokenKey += 1;
        if (match[1]) {
            nodes.push(<code key={tokenKey} className="md-inline-code">{token.slice(1, -1)}</code>);
        } else if (match[2]) {
            const inner = token.slice(2, -2);
            const [targetPart, alias] = inner.split('|');
            const target = targetPart.split('#')[0].trim();
            nodes.push(
                <button
                    key={tokenKey}
                    type="button"
                    className="md-wiki-link"
                    onClick={() => handlers.onWikiLinkClick?.(target)}
                    title={`打开笔记：${target}`}
                >{(alias || targetPart).trim()}</button>
            );
        } else if (match[3]) {
            const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
            const label = linkMatch?.[1] || token;
            const url = linkMatch?.[2] || '';
            nodes.push(
                <button
                    key={tokenKey}
                    type="button"
                    className="md-external-link"
                    onClick={() => handlers.onExternalLinkClick?.(url)}
                    title={url}
                >{label}</button>
            );
        } else if (match[4]) {
            nodes.push(<strong key={tokenKey}>{token.slice(2, -2)}</strong>);
        } else if (match[5]) {
            nodes.push(<em key={tokenKey}>{token.slice(1, -1)}</em>);
        }
        lastIndex = start + token.length;
    }
    if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
    return nodes;
}
