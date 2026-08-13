import React, { useEffect, useState } from 'react';
import { BrainCircuit, CheckCircle2, ShieldCheck } from 'lucide-react';

import { getMemoryService } from '../services/memory.service';
import { DesignLearningReviewSettingsPanel } from './DesignLearningReviewSettingsPanel';

export function KnowledgeLearningCenter(): React.ReactElement {
    const [memoryRevision, setMemoryRevision] = useState(0);

    useEffect(() => getMemoryService().subscribe(() => {
        setMemoryRevision((revision) => revision + 1);
    }), []);

    function handleMemoryChanged(): void {
        setMemoryRevision((revision) => revision + 1);
    }

    return (
        <section className="knowledge-panel" data-testid="knowledge-learning-center">
            <div className="knowledge-panel__heading">
                <div>
                    <span className="knowledge-eyebrow">Human in the loop</span>
                    <h2>待我审核</h2>
                    <p>这里不是“AI 自动学习开关”，而是你的知识收件箱。先看清它学到了什么、来源是什么，再决定采用、稍后处理或拒绝。</p>
                </div>
                <span className="knowledge-boundary-badge"><ShieldCheck size={14} aria-hidden="true" />人工复核后生效</span>
            </div>
            <div className="knowledge-learning-callout">
                <BrainCircuit size={18} aria-hidden="true" />
                <div><strong>批准以后才会被复用</strong><span>Eagle 视觉理解、任务反馈和重复模式都只能生成候选；打开页面、搜索或 Agent 自评都不能绕过你。</span></div>
            </div>
            <ol className="knowledge-review-guide" aria-label="候选审核说明">
                <li><BrainCircuit size={16} aria-hidden="true" /><span><strong>先看主张</strong>这条候选到底建议以后怎么做</span></li>
                <li><ShieldCheck size={16} aria-hidden="true" /><span><strong>再看边界</strong>适用于什么，不适用于什么</span></li>
                <li><CheckCircle2 size={16} aria-hidden="true" /><span><strong>最后决定</strong>采用后才进入长期知识</span></li>
            </ol>
            <DesignLearningReviewSettingsPanel
                onMemoryChanged={handleMemoryChanged}
                refreshRevision={memoryRevision}
                showActiveItems={false}
                emptyHint="从“可用知识”搜索 Eagle 参考并点击“视觉理解”，或在任务结束后形成学习候选；候选会先进入这里，不会自动采用。"
            />
        </section>
    );
}
