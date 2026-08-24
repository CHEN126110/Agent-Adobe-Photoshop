/**
 * learnTasteFromEagle：从用户指定的 Eagle 参考文件夹提取经验候选。
 * 文件夹归属是参考来源证据；模型对「好在哪」的解释仍是推断，只进入长期知识人工审核队列，
 * 不自动发布为正式经验或评审校准。
 */

import { executeStudyReference, type StudyReferenceDeps } from './study-reference.executor';

export async function executeLearnTasteFromEagle(params: any, deps: StudyReferenceDeps): Promise<any> {
    const startedAt = Date.now();
    const folderId = String(params?.folderId || '').trim();
    const folderName = String(params?.folderName || params?.folder || '').trim();
    const limit = Math.min(12, Math.max(1, Number(params?.limit) || 4));
    if (!folderId && !folderName) {
        return { success: false, error: 'learnTasteFromEagle：给 folderName（如「点击图-参考」）或 folderId' };
    }
    if (!deps.projectPath) return { success: false, error: 'learnTasteFromEagle：当前没有打开的项目，学到的东西没地方放' };
    const listed = await deps.invokeMain('designWorkshop:listEagleFolderItems', { folderId, folderName, limit });
    if (!listed?.success) return { success: false, error: listed?.error || '列 Eagle 文件夹失败' };
    const items: any[] = Array.isArray(listed.items) ? listed.items : [];
    if (items.length === 0) return { success: false, error: `Eagle 文件夹「${listed.folderPath || folderName || folderId}」里没有可读的图` };

    const purpose = String(params?.purpose || '').trim() || `分析用户指定的参考集合（${listed.folderPath || folderName}）：提取可复核的设计方法候选`;
    const studies: any[] = [];
    let learned = 0;
    for (const item of items) {
        const result = await executeStudyReference({
            filePath: item.filePath,
            purpose,
            deliverable: params?.deliverable ? String(params.deliverable) : undefined,
            productContext: params?.productContext ? String(params.productContext) : undefined,
            approvedReference: true
        }, deps);
        studies.push({
            name: item.name,
            ok: result?.success === true,
            summary: result?.study?.summary,
            strengths: result?.study?.strengths,
            learning: result?.learning,
            error: result?.error
        });
        if (result?.success) learned += 1;
    }
    const highlights = studies.filter((s) => s.ok).flatMap((s) => (s.strengths || []).slice(0, 1)).slice(0, 6);
    return {
        success: learned > 0,
        ...(learned === 0 ? { error: studies[0]?.error || '一张都没学到' } : {}),
        folder: listed.folderPath || folderName || folderId,
        studied: studies.length,
        learned,
        studies,
        elapsedMs: Date.now() - startedAt,
        message: learned > 0
            ? `从 Eagle「${listed.folderPath || folderName}」分析了 ${learned}/${studies.length} 张：${highlights.map((h, i) => `${i + 1}.${h}`).join(' ')}。模型提炼已进入长期知识人工审核队列；批准前不会用于后续设计或评审。`
            : `没有学到：${studies[0]?.error || ''}`
    };
}
