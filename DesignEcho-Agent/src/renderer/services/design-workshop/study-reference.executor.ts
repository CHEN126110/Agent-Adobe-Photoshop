/**
 * studyReference 工具：带目的看一张参考——说得出好坏、推演做法、给出可执行起手式、沉淀 takeaways。
 * 图片来源：filePath（项目 / Eagle 导入后的本地文件）或 imageData。看图走 visual:askAboutImage。
 */

import { buildReferenceStudyPrompt, parseReferenceStudy, renderReferenceStudy } from '../../../shared/design-workshop/reference-study';
import { buildWorkshopReferenceLearningCandidate } from '../../../shared/design-learning-experience';
import { getMemoryService } from '../memory.service';

export interface StudyReferenceDeps {
    invokeMain: (channel: string, ...args: any[]) => Promise<any>;
    readImageBase64?: (filePath: string) => Promise<any>;
    projectPath?: string;
}

export async function executeStudyReference(params: any, deps: StudyReferenceDeps): Promise<any> {
    const startedAt = Date.now();
    let base64 = '';
    let mediaType = 'image/jpeg';
    let source = '';
    if (typeof params?.imageData === 'string' && params.imageData.trim()) {
        base64 = params.imageData.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
        mediaType = /^data:image\/png/.test(params.imageData) ? 'image/png' : 'image/jpeg';
        source = 'imageData';
    } else if (typeof params?.filePath === 'string' && params.filePath.trim() && deps.readImageBase64) {
        const filePath = params.filePath.trim();
        try {
            const raw = await deps.readImageBase64(filePath);
            const data = typeof raw === 'string' ? raw : (raw?.data || raw?.base64 || raw?.imageData);
            if (typeof data === 'string' && data) {
                base64 = data.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
                mediaType = /\.png$/i.test(filePath) ? 'image/png' : /\.webp$/i.test(filePath) ? 'image/webp' : 'image/jpeg';
        source = 'project-file';
            }
        } catch {
            base64 = '';
        }
    }
    if (!base64) {
        return { success: false, error: 'studyReference 需要参考图：给 filePath（项目内 / Eagle 导入后的本地文件；Eagle 里的先 importEagleAssetToProject）或 imageData' };
    }

    const prompt = buildReferenceStudyPrompt({
        purpose: params?.purpose ? String(params.purpose) : undefined,
        deliverable: params?.deliverable ? String(params.deliverable) : undefined,
        productContext: params?.productContext ? String(params.productContext) : undefined
    });
    let text = '';
    let modelId = '';
    try {
        const response = await deps.invokeMain('visual:askAboutImage', { base64, prompt, mediaType, maxTokens: 2400 });
        if (!response?.success) return { success: false, error: `studyReference 视觉模型未返回：${response?.error || '未知错误'}` };
        text = String(response.text || '');
        modelId = String(response.modelId || '');
    } catch (error: any) {
        return { success: false, error: `studyReference 视觉模型调用失败：${error?.message || String(error)}` };
    }
    const study = parseReferenceStudy(text, modelId);
    const ok = Boolean(study.summary) || study.strengths.length > 0 || study.suggestedRegions.length > 0;

    // 沉淀：参考分析进入现有 Memory 人工审核队列。候选、复核、持久化与生产检索只保留这一条 owner 链；
    // 即使参考来自用户收藏夹，模型总结的「好在哪」仍是推断，不能直接发布。
    let learning: { queued: boolean; candidateId?: string; error?: string } | undefined;
    if (ok) {
        try {
            const projectScopeId = deps.projectPath
                ? `project-${stableHash(deps.projectPath)}`
                : undefined;
            const composition = String(study.howItWasMade.composition || '').trim();
            const candidate = buildWorkshopReferenceLearningCandidate({
                title: params?.deliverable
                    ? `${String(params.deliverable)}参考学习`
                    : '参考设计学习候选',
                summary: study.summary,
                whatLooksGood: study.strengths,
                whyItWorks: study.takeaways,
                reusableHeuristics: [
                    ...study.takeaways,
                    ...(composition ? [`构图：${composition}`] : [])
                ],
                suitableScenarios: [
                    params?.deliverable ? String(params.deliverable) : '',
                    params?.purpose ? String(params.purpose) : ''
                ],
                limitations: study.improvements,
                scope: projectScopeId ? { type: 'project', id: projectScopeId } : { type: 'user' },
                analysisSource: modelId || 'visual-model',
                userCuratedReference: params?.approvedReference === true
            });
            if (!candidate) throw new Error('参考分析缺少可复核的摘要或方法结论');
            getMemoryService().recordDesignLearningMemoryReview({
                candidate,
                decision: 'needs_review',
                reviewer: 'design-workshop-reference-study',
                notes: ['模型参考分析已进入长期知识审核队列；批准前不会用于生产提示。']
            });
            learning = { queued: true, candidateId: candidate.id };
        } catch (error: any) {
            const message = error?.message || String(error);
            console.warn('[ReferenceStudy] 参考学习候选写入失败：', message);
            learning = { queued: false, error: message };
        }
    }

    return {
        success: ok,
        ...(ok ? {} : { error: study.improvements[0] || 'studyReference 未得到可用结果' }),
        study,
        studyText: renderReferenceStudy(study),
        source,
        learning,
        elapsedMs: Date.now() - startedAt,
        message: ok
            ? `${renderReferenceStudy(study)}\n用法：好的处理照着做（suggestedRegions 可直接作 composeDesign 的 layout.regions 起手式），差的按 improvements 改；不要照抄表面风格。`
            : `看参考未得到可用结果：${study.improvements[0] || ''}`
    };
}

function stableHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}
