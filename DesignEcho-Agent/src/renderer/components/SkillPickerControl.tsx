/**
 * 输入框 Skill 选择器（codex 式）：用户可显式指定本次任务用哪个业务技能，
 * 也可保持「自动」交给模型自主判断。选择只作为权威路线提示进入循环
 * （selection-only handoff），不执行技能、不授予工具权限、不裁剪模型工具面。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Blocks } from 'lucide-react';

import { FloatingLayer } from './FloatingLayer';
import { SKILL_REGISTRY } from '../../shared/skills/skill-declarations';

import './ThinkingModeControl.css';
import './SkillPickerControl.css';

interface SkillPickerControlProps {
    selectedSkillId: string | null;
    onSelect: (skillId: string | null) => void;
    direction?: 'up' | 'down';
    className?: string;
}

interface SkillPickerOption {
    id: string;
    label: string;
    hint: string;
}

function listUserFacingWorkflowSkills(): SkillPickerOption[] {
    return SKILL_REGISTRY
        .filter((skill) => skill.visibility === 'user-facing' && skill.routeClass === 'business-workflow')
        .map((skill) => ({
            id: skill.id,
            label: skill.displayName || skill.name || skill.id,
            // 用户可见简介优先用 userFacingSummary；description 是给模型的工具描述，只作兜底截取。
            hint: skill.userFacingSummary || String(skill.description || '').split(/[。（(]/, 1)[0].slice(0, 42)
        }));
}

export const SkillPickerControl: React.FC<SkillPickerControlProps> = ({
    selectedSkillId,
    onSelect,
    direction = 'up',
    className = ''
}) => {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const rootRef = useRef<HTMLSpanElement>(null);
    const [open, setOpen] = useState(false);
    const options = useMemo(listUserFacingWorkflowSkills, []);

    useEffect(() => {
        if (!open) return undefined;
        function closeOnOutsideClick(event: MouseEvent): void {
            if (rootRef.current && event.target instanceof Node && rootRef.current.contains(event.target)) return;
            setOpen(false);
        }
        document.addEventListener('mousedown', closeOnOutsideClick);
        return () => document.removeEventListener('mousedown', closeOnOutsideClick);
    }, [open]);
    const selected = options.find((option) => option.id === selectedSkillId) || null;

    const choose = (skillId: string | null): void => {
        onSelect(skillId);
        setOpen(false);
    };

    return (
        <span ref={rootRef} className={`thinking-mode-control skill-picker-control ${className}`.trim()}>
            <button
                ref={buttonRef}
                type="button"
                className={`thinking-mode-control-button skill-picker-button ${selected ? 'active' : ''}`}
                data-testid="chat-skill-picker-toggle"
                aria-label={selected ? `已指定技能：${selected.label}（点击更换或改回自动）` : '指定本次任务使用的技能（默认自动）'}
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
            >
                <Blocks size={16} strokeWidth={1.8} aria-hidden="true" />
                {selected && <span className="skill-picker-current">{selected.label}</span>}
            </button>
            <FloatingLayer
                anchorRef={buttonRef}
                open={open}
                placement={direction}
                align="start"
                className="skill-picker-popover"
                role="listbox"
            >
                <div className="skill-picker-list">
                    <button
                        type="button"
                        className={`skill-picker-item ${selected ? '' : 'selected'}`}
                        role="option"
                        aria-selected={!selected}
                        onClick={() => choose(null)}
                    >
                        <span className="skill-picker-item-label">自动</span>
                        <span className="skill-picker-item-hint">不指定技能，交给 Agent 自主判断</span>
                    </button>
                    {options.map((option) => (
                        <button
                            key={option.id}
                            type="button"
                            className={`skill-picker-item ${option.id === selectedSkillId ? 'selected' : ''}`}
                            role="option"
                            aria-selected={option.id === selectedSkillId}
                            onClick={() => choose(option.id)}
                        >
                            <span className="skill-picker-item-label">{option.label}</span>
                            <span className="skill-picker-item-hint">{option.hint}</span>
                        </button>
                    ))}
                </div>
            </FloatingLayer>
        </span>
    );
};
