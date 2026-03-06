/**
 * 文本块渲染组件
 * 
 * 性能优化：
 * - React.memo 避免不必要的重渲染
 * - useMemo 缓存 Markdown 解析结果
 */

import React, { useMemo } from 'react';
import type { TextBlock as TextBlockType } from '../types';

interface TextBlockProps {
    block: TextBlockType;
}

/**
 * 简单的 Markdown 解析器
 * 
 * 注意：此函数是纯函数，相同输入产生相同输出
 */
function parseMarkdown(content: string): string {
    let html = content;
    
    // 转义 HTML
    html = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // 标题
    html = html.replace(/^### (.*$)/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.*$)/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.*$)/gm, '<h2>$1</h2>');
    
    // 粗体和斜体
    html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // 链接
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    
    // 无序列表
    html = html.replace(/^- (.*$)/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    
    // 有序列表
    html = html.replace(/^\d+\. (.*$)/gm, '<li>$1</li>');
    
    // 分隔线
    html = html.replace(/^---$/gm, '<hr />');
    
    // 段落
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>(<h[234]>)/g, '$1');
    html = html.replace(/(<\/h[234]>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)<\/p>/g, '$1');
    html = html.replace(/<p>(<hr \/>)/g, '$1');
    html = html.replace(/(<hr \/>)<\/p>/g, '$1');
    
    // 换行
    html = html.replace(/\n/g, '<br />');
    
    return html;
}

/**
 * 文本块组件
 * 
 * 使用 React.memo 进行浅比较优化
 */
const TextBlockComponent: React.FC<TextBlockProps> = ({ block }) => {
    const isMarkdown = block.format !== 'plain';
    
    // 缓存 Markdown 解析结果，仅当 content 变化时重新计算
    const parsedHtml = useMemo(() => {
        if (!isMarkdown) return null;
        return parseMarkdown(block.content);
    }, [block.content, isMarkdown]);
    
    if (isMarkdown && parsedHtml) {
        return (
            <div 
                className="message-block text-block markdown-content"
                dangerouslySetInnerHTML={{ __html: parsedHtml }}
            />
        );
    }
    
    return (
        <div className="message-block text-block plain-text">
            {block.content}
        </div>
    );
};

// 使用 React.memo 包装，当 block 引用不变时跳过渲染
export const TextBlock = React.memo(TextBlockComponent, (prevProps, nextProps) => {
    // 自定义比较：仅比较关键属性
    return (
        prevProps.block.id === nextProps.block.id &&
        prevProps.block.content === nextProps.block.content &&
        prevProps.block.format === nextProps.block.format
    );
});

export default TextBlock;
