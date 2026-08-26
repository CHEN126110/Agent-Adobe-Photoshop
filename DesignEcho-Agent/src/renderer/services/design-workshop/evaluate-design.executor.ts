/**
 * evaluateDesign 工具：独立 advisory 评审当前画面（或给定图片）——好不好看 + 对不对的硬伤汇总。
 *
 * 流程：取画面（参数 imageData / 文件路径 / 当前文档快照）→ 组评审提示（设计说明 + 硬项 + 用户校准样本）
 * → 视觉模型 → 解析为分数与批评 → 记进任务卡「验」栏 → 返回。
 * 主 Agent 据此判断局部修订、替换关系或换方向；本工具不写 Photoshop，
 * 也不宣布正式质量通过或可交付。
 */

import {
    buildDesignEvaluationPrompt,
    parseDesignEvaluation,
    summarizeDesignEvaluation,
    type DesignEvaluationCalibrationSample,
    type DesignEvaluationResult
} from '../../../shared/design-workshop/design-evaluator';
import {
    listProvisionalExperienceNotes,
    listPublishedEvaluationCalibrationSamples,
    normalizeDesignLearningLedger
} from '../../../shared/design-learning-candidates';
import {
    readPhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../../shared/photoshop-history-state-ref';
import { recordDesignTaskEvaluation } from './design-task-card.store';

export interface EvaluateDesignDeps {
    executeToolCall: (toolName: string, params: any, options?: any) => Promise<any>;
    invokeMain: (channel: string, ...args: any[]) => Promise<any>;
    readImageBase64?: (filePath: string) => Promise<any>;
    /** 当前项目路径：评审批评蒸馏为学习候选写进项目 .designecho */
    projectPath?: string;
    taskCardScope?: string;
    options?: any;
}

function pickSnapshotBase64(result: any): { data: string; mediaType: string } | null {
    const candidates = [result?.imageData, result?.snapshot?.base64, result?.snapshot?.imageData, result?.base64];
    for (const value of candidates) {
        if (typeof value === 'string' && value.length > 0) {
            const clean = value.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
            const mediaType = /^data:image\/png/.test(value) ? 'image/png' : 'image/jpeg';
            return { data: clean, mediaType };
        }
    }
    return null;
}

function formatReferenceGapLabel(gap: 'large' | 'medium' | 'small'): string {
    if (gap === 'large') return '大';
    if (gap === 'small') return '小';
    return '中';
}

function loadImageElement(url: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

/** 当前稿缩到搜索列表尺寸（宽 240px）：多尺度复核用；原图不够大或环境无 DOM 时如实返回 null。 */
async function buildThumbnailBase64(imageData: string, mediaType: string): Promise<{ data: string; mediaType: string } | null> {
    if (typeof document === 'undefined') return null;
    const img = await loadImageElement(`data:${mediaType};base64,${imageData}`);
    if (!img || !img.width) return null;
    const targetWidth = 240;
    if (img.width <= targetWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = Math.max(1, Math.round((img.height * targetWidth) / img.width));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    return { data: dataUrl.replace(/^data:image\/jpeg;base64,/, ''), mediaType: 'image/jpeg' };
}

/** 用户校准样本：先从参数读；没有就空（评审器仍可跑，只是没有你的口味）。 */
function readCalibration(params: any): DesignEvaluationCalibrationSample[] {
    const raw = Array.isArray(params?.calibration) ? params.calibration : [];
    return raw
        .map((item: any) => ({
            kind: item?.kind === 'bad' ? 'bad' as const : 'good' as const,
            why: String(item?.why || '').trim(),
            ref: item?.ref ? String(item.ref) : undefined
        }))
        .filter((item: DesignEvaluationCalibrationSample) => item.why.length > 0)
        .slice(0, 10);
}

export async function executeEvaluateDesign(params: any, deps: EvaluateDesignDeps): Promise<any> {
    const startedAt = Date.now();
    let image: { data: string; mediaType: string } | null = null;
    let historyStateRef: PhotoshopHistoryStateRef | undefined;
    let source = '';
    if (typeof params?.imageData === 'string' && params.imageData.trim()) {
        image = pickSnapshotBase64({ imageData: params.imageData });
        source = 'imageData';
    } else if (typeof params?.filePath === 'string' && params.filePath.trim() && deps.readImageBase64) {
        try {
            const raw = await deps.readImageBase64(params.filePath.trim());
            const data = typeof raw === 'string' ? raw : (raw?.data || raw?.base64 || raw?.imageData);
            if (typeof data === 'string' && data) {
                image = pickSnapshotBase64({ imageData: data.startsWith('data:') ? data : `data:image/jpeg;base64,${data}` });
                source = `file:${params.filePath.trim()}`;
            }
        } catch {
            image = null;
        }
    }
    if (!image) {
        const snapshot = await deps.executeToolCall('getDocumentSnapshot', { maxSize: 1024 }, deps.options);
        if (snapshot?.success === false) {
            return { success: false, error: `evaluateDesign 取不到画面：${snapshot?.error || 'getDocumentSnapshot 失败'}；可传 imageData 或 filePath` };
        }
        image = pickSnapshotBase64(snapshot);
        historyStateRef = readPhotoshopHistoryStateRef(snapshot);
        source = 'activeDocumentSnapshot';
    }
    if (!image) {
        return { success: false, error: 'evaluateDesign 取不到画面：快照没有图像数据' };
    }

    const hardFindings: string[] = Array.isArray(params?.hardFindings)
        ? params.hardFindings.map((item: unknown) => String(item || '').trim()).filter(Boolean).slice(0, 10)
        : [];
    const rationale = typeof params?.rationale === 'string'
        ? params.rationale
        : params?.rationale && typeof params.rationale === 'object'
            ? Object.entries(params.rationale).map(([key, value]) => `${key}：${String(value)}`).join('\n')
            : undefined;
    // 校准样本：参数没给时，只读取正式发布到 evaluation_calibration 的结构化样本。
    // candidate / 旧版 promoted / 参考学习的自动结论都不能反过来教评审器。
    let calibration = readCalibration(params);
    // 自主沉淀 P2：行为验证晋升的试用经验进评审上下文（独立段落、标注非用户拍板、上限 3 条，
    // 不与用户校准样本混淆——它是观察线索不是口味权威）。
    let provisionalNotes: string[] = [];
    if (deps.projectPath) {
        try {
            const read = await deps.invokeMain('designWorkshop:readLearningLedger', { projectPath: deps.projectPath });
            if (read?.success && read.ledger) {
                const ledger = normalizeDesignLearningLedger(read.ledger);
                if (calibration.length === 0) {
                    calibration = listPublishedEvaluationCalibrationSamples(ledger, 10);
                }
                provisionalNotes = listProvisionalExperienceNotes(ledger, 3);
            }
        } catch (error: any) {
            console.warn('[DesignEvaluation] 读取学习候选区失败：', error?.message || String(error));
            calibration = calibration.length > 0 ? calibration : [];
        }
    }
    const sameness: string[] = Array.isArray(params?.sameness)
        ? params.sameness.map((item: unknown) => String(item || '').trim()).filter(Boolean).slice(0, 6)
        : [];
    // 对照评审（主模式，2026-08-23 盲评实验裁决：成对比较 4/4 判对，单图打分分辨力塌缩）：
    // 参考图可以是用户参考 / Eagle 参考 / 上一版导出；读不到时如实降级为单图评审，不静默吞。
    let referenceImage: { data: string; mediaType: string } | null = null;
    let referenceLoadWarning = '';
    if (typeof params?.referenceImageData === 'string' && params.referenceImageData.trim()) {
        referenceImage = pickSnapshotBase64({ imageData: params.referenceImageData });
    } else if (typeof params?.referenceFilePath === 'string' && params.referenceFilePath.trim() && deps.readImageBase64) {
        try {
            const raw = await deps.readImageBase64(params.referenceFilePath.trim());
            const data = typeof raw === 'string' ? raw : (raw?.data || raw?.base64 || raw?.imageData);
            if (typeof data === 'string' && data) {
                referenceImage = pickSnapshotBase64({ imageData: data.startsWith('data:') ? data : `data:image/jpeg;base64,${data}` });
            }
        } catch (error: any) {
            referenceLoadWarning = `参考图读取失败（${params.referenceFilePath.trim()}）：${error?.message || String(error)}；本次降级为单图评审。`;
        }
        if (!referenceImage && !referenceLoadWarning) {
            referenceLoadWarning = `参考图没有图像数据（${params.referenceFilePath.trim()}）；本次降级为单图评审。`;
        }
    }
    // Agent 自选 Eagle 参照（2026-08-23 用户裁决：审美归 Agent 自治，选参照本身就是审美判断）：
    // 模型传 Eagle item id，主进程内部解析预览图——本地路径不经过模型，R0 防照抄边界保持。
    let autoReferenceNote = '';
    if (!referenceImage && typeof params?.referenceEagleItemId === 'string' && params.referenceEagleItemId.trim()) {
        const eagleResult = await deps.invokeMain('designKnowledge:getEagleReferenceImageForEvaluation', {
            itemId: params.referenceEagleItemId.trim()
        });
        if (eagleResult?.success && eagleResult.imageData) {
            referenceImage = pickSnapshotBase64({ imageData: eagleResult.imageData });
            if (referenceImage) {
                autoReferenceNote = `你选的 Eagle 参考「${String(eagleResult.item?.title || params.referenceEagleItemId).slice(0, 40)}」`;
            }
        }
        if (!referenceImage) {
            referenceLoadWarning = `Eagle 参考图取用失败（${params.referenceEagleItemId.trim()}）：${eagleResult?.error || '无图像数据'}；本次降级为无此参照。`;
        }
    }
    if (!referenceImage && deps.readImageBase64) {
        const goodSamplesWithImage = calibration.filter((sample) =>
            sample.kind === 'good' && sample.ref && /\.(png|jpe?g|webp)$/i.test(sample.ref));
        for (const sample of goodSamplesWithImage.slice(0, 3)) {
            try {
                const raw = await deps.readImageBase64(String(sample.ref));
                const data = typeof raw === 'string' ? raw : (raw?.data || raw?.base64 || raw?.imageData);
                if (typeof data === 'string' && data) {
                    referenceImage = pickSnapshotBase64({ imageData: data.startsWith('data:') ? data : `data:image/jpeg;base64,${data}` });
                }
            } catch {
                referenceImage = null;
            }
            if (referenceImage) {
                autoReferenceNote = `用户发布的校准样本：${sample.why.slice(0, 40)}`;
                break;
            }
        }
    }
    const referenceKind: 'user_reference' | 'previous_version' = params?.referenceKind === 'previous_version'
        ? 'previous_version'
        : 'user_reference';
    // 多尺度复核：当前稿缩到列表尺寸作为最后一张图（主图的真实使用场景就是搜索列表缩略）。
    const thumbnail = await buildThumbnailBase64(image.data, image.mediaType);
    const prompt = buildDesignEvaluationPrompt({
        rationale,
        deliverable: params?.deliverable ? String(params.deliverable) : undefined,
        hardFindings,
        sameness,
        calibration,
        provisionalNotes,
        ...(referenceImage
            ? {
                reference: {
                    kind: referenceKind,
                    note: params?.referenceNote ? String(params.referenceNote) : (autoReferenceNote || undefined)
                }
            }
            : {}),
        thumbnail: Boolean(thumbnail)
    });

    let modelText = '';
    let modelId = '';
    try {
        const response = await deps.invokeMain('visual:askAboutImage', {
            base64: image.data,
            prompt,
            mediaType: image.mediaType,
            maxTokens: 1600,
            ...(referenceImage
                ? { referenceBase64: referenceImage.data, referenceMediaType: referenceImage.mediaType }
                : {}),
            ...(thumbnail
                ? { thumbnailBase64: thumbnail.data, thumbnailMediaType: thumbnail.mediaType }
                : {})
        });
        if (!response?.success) {
            return { success: false, error: `evaluateDesign 视觉模型未返回：${response?.error || '未知错误'}` };
        }
        modelText = String(response.text || '');
        modelId = String(response.modelId || '');
    } catch (error: any) {
        return { success: false, error: `evaluateDesign 视觉模型调用失败：${error?.message || String(error)}` };
    }

    const result: DesignEvaluationResult = parseDesignEvaluation(modelText, modelId);
    result.comparisonMode = referenceImage ? 'reference' : 'single';
    const summary = summarizeDesignEvaluation(result);
    // 原地打转的判据（真机 run 499：评审两次都说「纸屑杂物必须清除」，模型两次都只缩放 + 加投影，35 轮烧完预算）：
    // 只有同一 TaskRun、同一 Photoshop 文档、不同历史修订下首要问题仍相同，才能说明
    // “改动没有解决它”。外部图片或缺失任务/文档/修订身份时保持未知，不跨任务猜。不拦工具，只提醒。
    const topCritique = String(result.critiques[0] || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const { repeatedTopCritique } = recordDesignTaskEvaluation(
        deps.taskCardScope || '',
        summary,
        { historyStateRef, topCritique, verdict: result.verdict }
    );
    // 学习闭环：评审批评只作为观察候选落盘，不自动变成原则，也不回灌本次或下次评审。
    // 对照差距观察同样入池（2026-08-23 自主沉淀 P0）：每条「与参考差在哪」都是一条
    // 「好稿长什么样」的知识候选；晋升仍由候选区治理管辖，这里只负责不让观察流失。
    let learning: { added: number; merged: number; error?: string } | undefined;
    const learnableObservations = [
        ...result.critiques,
        ...(result.referenceGap?.points || []).map((point) => `与参考差距：${point}`)
    ];
    if (learnableObservations.length > 0 && deps.projectPath) {
        const { recordEvaluationLearnings } = await import('./design-learning.store');
        learning = await recordEvaluationLearnings(deps.invokeMain, deps.projectPath, {
            critiques: learnableObservations,
            runId: deps.taskCardScope || undefined,
            deliverable: params?.deliverable ? String(params.deliverable) : undefined
        });
    }
    return {
        success: result.criteria.length > 0,
        ...(result.criteria.length === 0 ? { error: result.critiques[0] } : {}),
        evaluation: result,
        evaluationAuthority: result.authority,
        provesProfessionalQuality: false,
        provesDeliverability: false,
        ...(historyStateRef ? { historyStateRef } : {}),
        summary,
        learning,
        source,
        elapsedMs: Date.now() - startedAt,
        repeatedTopCritique,
        message: result.criteria.length > 0
            ? `${summary}${result.referenceGap ? `\n与参考差距（${formatReferenceGapLabel(result.referenceGap.gap)}）：${result.referenceGap.points.join('；')}` : ''}\n${result.critiques.map((item, index) => `${index + 1}. ${item}`).join('\n')}${result.nextMoves.length ? `\n下一步：${result.nextMoves.join('；')}` : ''}${result.verdict === 'pass' ? '' : '\n请根据问题之间的因果关系，选择能解决最高目标影响根因的修订；“最小”指副作用最少，不是改动数量最少。如果问题来自素材、构图机制或方向，只移动、缩放或叠加局部元素不算解决；修订后重新查看真实结果。'}${repeatedTopCritique ? '\n注意：上一次评审的首要问题和这次一样——你刚才的改动没有解决它。别再微调尺寸 / 位置 / 投影：要么换方法（换一张素材、去掉杂物、换角度重出），要么如实告诉用户这一点做不到、问他怎么办。' : ''}${result.comparisonMode === 'single' ? '\n提示：本次是单图评审，分数分辨力有限。下次先自己选一张参照（searchEagleReferences 检索同品类参考 / 项目里已交付上架的成品图 / 本稿上一版导出）传 referenceFilePath——选参照就是你的审美判断，对照评审比单图打分准得多。' : ''}${autoReferenceNote ? `\n本次对照参考来自${autoReferenceNote}。` : ''}${referenceLoadWarning ? `\n${referenceLoadWarning}` : ''}`
            : `评审未得到分数：${result.critiques[0]}`
    };
}
