import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { useAppStore } from '../../stores/app.store';
import { getPrimaryModelForPreferenceBucket } from '../../../shared/model-selection';
import { emitSkillStep } from './skill-step-events';

type ImageCandidate = {
    path: string;
    relativePath: string;
    name: string;
    folderType?: string;
    imageType?: string;
};

type AssetAnalysis = {
    description?: string;
    category?: string;
    mainSubject?: string;
    colors?: string[];
    style?: string;
    suggestedPlacement?: string;
    suggestedEffects?: string[];
};

type ProjectInventoryFolder = {
    name?: string;
    type?: string;
    imageCount: number;
    sampleImages: string[];
};

function getSummaryModelId(): string {
    const prefs = useAppStore.getState().modelPreferences as any;
    return getPrimaryModelForPreferenceBucket(prefs, 'textOptimize', {
        mode: prefs?.mode,
        includeFallback: prefs?.autoFallback,
        includeCrossTaskBackups: false
    }) || 'google-gemini-3-flash';
}

function normalizeTextList(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function flattenProjectImages(structure: any): ImageCandidate[] {
    const folders = Array.isArray(structure?.folders) ? structure.folders : [];
    const all: ImageCandidate[] = [];
    const walk = (folder: any) => {
        const images = Array.isArray(folder?.images) ? folder.images : [];
        for (const image of images) {
            const path = String(image?.path || '').trim();
            if (!path) continue;
            all.push({
                path,
                relativePath: String(image?.relativePath || '').trim() || path,
                name: String(image?.name || '').trim() || path.split(/[\\/]/).pop() || path,
                folderType: String(image?.folderType || folder?.type || '').trim() || undefined,
                imageType: String(image?.type || '').trim() || undefined
            });
        }
        const children = Array.isArray(folder?.children) ? folder.children : [];
        for (const child of children) walk(child);
    };
    for (const folder of folders) walk(folder);
    return all;
}

function dedupeImages(images: ImageCandidate[]): ImageCandidate[] {
    const seen = new Set<string>();
    const result: ImageCandidate[] = [];
    for (const image of images) {
        const key = image.path.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(image);
    }
    return result;
}

function buildPreferredImages(input: {
    allImages: ImageCandidate[];
    projectContext: any;
    sampleSize: number;
    directories?: string[];
}): ImageCandidate[] {
    const { allImages, projectContext, sampleSize, directories } = input;
    const selected = String(projectContext?.selectedProjectImagePath || '').trim();
    const samplePaths = normalizeTextList(projectContext?.sampleImagePaths);
    const directoryFilters = normalizeTextList(directories).map((value) => value.toLowerCase());

    const preferred = new Map<string, ImageCandidate>();
    const take = (image?: ImageCandidate) => {
        if (!image) return;
        const key = image.path.toLowerCase();
        if (!preferred.has(key)) preferred.set(key, image);
    };

    if (selected) {
        take(allImages.find((image) => image.path.toLowerCase() === selected.toLowerCase()));
    }

    for (const samplePath of samplePaths) {
        take(allImages.find((image) => image.path.toLowerCase() === samplePath.toLowerCase()));
    }

    const scored = allImages
        .map((image) => {
            let score = 0;
            const folderType = String(image.folderType || '').toLowerCase();
            const imageType = String(image.imageType || '').toLowerCase();
            const relativePath = image.relativePath.toLowerCase();

            if (folderType === 'source') score += 20;
            if (imageType === 'product' || imageType === 'model' || imageType === 'detail' || imageType === 'material') score += 12;
            if (directoryFilters.length && directoryFilters.some((dir) => relativePath.includes(dir))) score += 18;
            if (/原图|拍摄图|素材|source|raw/.test(relativePath)) score += 10;

            return { image, score };
        })
        .sort((a, b) => b.score - a.score || a.image.relativePath.localeCompare(b.image.relativePath));

    for (const item of scored) {
        take(item.image);
        if (preferred.size >= sampleSize) break;
    }

    return Array.from(preferred.values()).slice(0, sampleSize);
}

function buildDeterministicSummary(analyses: Array<{ image: ImageCandidate; analysis: AssetAnalysis }>): string {
    const subjects = new Map<string, number>();
    const styles = new Map<string, number>();
    const placements = new Map<string, number>();
    const colors = new Map<string, number>();

    for (const item of analyses) {
        const subject = String(item.analysis.mainSubject || '').trim();
        const style = String(item.analysis.style || '').trim();
        const placement = String(item.analysis.suggestedPlacement || '').trim();
        if (subject) subjects.set(subject, (subjects.get(subject) || 0) + 1);
        if (style) styles.set(style, (styles.get(style) || 0) + 1);
        if (placement) placements.set(placement, (placements.get(placement) || 0) + 1);
        for (const color of normalizeTextList(item.analysis.colors)) {
            colors.set(color, (colors.get(color) || 0) + 1);
        }
    }

    const top = (map: Map<string, number>, count = 3) =>
        Array.from(map.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, count)
            .map(([value]) => value);

    const subjectText = top(subjects).join('、') || '需要人工确认';
    const styleText = top(styles).join('、') || '需要人工确认';
    const placementText = top(placements).join('、') || '需要人工确认';
    const colorText = top(colors).join('、') || '待补充';

    return [
        `已分析 ${analyses.length} 张项目图片。`,
        `主体判断：${subjectText}。`,
        `视觉风格：${styleText}。`,
        `常见配色：${colorText}。`,
        `设计中可优先强调：${placementText}。`
    ].join('\n');
}

function buildProjectInventoryOverview(input: {
    projectPath?: string;
    totalProjectImages: number;
    structure: any;
    allImages: ImageCandidate[];
}): {
    message: string;
    folderSummaries: ProjectInventoryFolder[];
    typeCounts: Record<string, number>;
    sampleImages: string[];
} {
    const folders = Array.isArray(input.structure?.folders) ? input.structure.folders : [];
    const folderSummaries: ProjectInventoryFolder[] = [];
    const typeCounts = new Map<string, number>();

    const walk = (folder: any, prefix = '') => {
        const folderName = String(folder?.name || folder?.label || folder?.type || '未命名文件夹').trim();
        const displayName = prefix ? `${prefix}/${folderName}` : folderName;
        const images = Array.isArray(folder?.images) ? folder.images : [];
        const sampleImages = images
            .map((image: any) => String(image?.relativePath || image?.name || image?.path || '').trim())
            .filter(Boolean)
            .slice(0, 4);

        if (images.length || folder?.type || folder?.name || folder?.label) {
            folderSummaries.push({
                name: displayName,
                type: String(folder?.type || '').trim() || undefined,
                imageCount: images.length,
                sampleImages
            });
        }

        for (const image of images) {
            const type = String(image?.type || folder?.type || 'unknown').trim() || 'unknown';
            typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
        }

        for (const child of Array.isArray(folder?.children) ? folder.children : []) {
            walk(child, displayName);
        }
    };

    for (const folder of folders) walk(folder);

    const typeCountRecord = Object.fromEntries(
        Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    );
    const folderLines = folderSummaries.length
        ? folderSummaries.slice(0, 8).map((folder) => {
            const typeText = folder.type ? `，类型 ${folder.type}` : '';
            const sampleText = folder.sampleImages.length ? `，样例：${folder.sampleImages.join('、')}` : '';
            return `- ${folder.name || '未命名文件夹'}：${folder.imageCount} 个资源${typeText}${sampleText}`;
        })
        : ['- 当前项目结构里还没有可展示的文件夹索引。'];
    const typeLines = Object.keys(typeCountRecord).length
        ? Object.entries(typeCountRecord).map(([type, count]) => `- ${type}: ${count}`)
        : ['- 暂无可统计的资源类型。'];
    const sampleImages = input.allImages
        .slice(0, 8)
        .map((image) => image.relativePath || image.name)
        .filter(Boolean);

    const message = [
        '项目资源概览：',
        `- 项目路径：${input.projectPath || '未解析'}`,
        `- 已索引图片/素材数：${input.totalProjectImages}`,
        '',
        '主要文件夹：',
        ...folderLines,
        '',
        '资源类型统计：',
        ...typeLines,
        '',
        '下一步建议：如果你要我判断款式、卖点或详情页方向，我再抽样调用视觉分析；如果只是看项目内容，当前资源索引已经足够。'
    ].join('\n');

    return {
        message,
        folderSummaries,
        typeCounts: typeCountRecord,
        sampleImages
    };
}

async function summarizeAnalyses(params: {
    analyses: Array<{ image: ImageCandidate; analysis: AssetAnalysis }>;
    focus: string;
    userIntent: string;
}): Promise<string | null> {
    if (!(window as any)?.designEcho?.chat) return null;
    const modelId = getSummaryModelId();
    const prompt = [
        'You are summarizing project images for a general Photoshop design agent working on the current design task.',
        'Use only the analyzed image metadata provided below.',
        'Do not pretend to have seen more images than were analyzed.',
        'Answer in concise Chinese.',
        'Output plain text only.',
        '',
        `User intent: ${params.userIntent || 'Analyze project images for design use'}`,
        `Focus: ${params.focus}`,
        '',
        'Return with these sections:',
        '1. 款式判断',
        '2. 主要特征',
        '3. 设计使用建议',
        '4. 还缺什么信息',
        '',
        `Analyzed samples (${params.analyses.length}):`,
        JSON.stringify(
            params.analyses.map((item) => ({
                image: item.image.relativePath,
                folderType: item.image.folderType,
                imageType: item.image.imageType,
                analysis: item.analysis
            })),
            null,
            2
        )
    ].join('\n');

    try {
        const response = await (window as any).designEcho.chat(
            modelId,
            [
                {
                    role: 'system',
                    content: 'You are a careful image analyst for Photoshop design workflows. Use only provided evidence. Reply in Chinese.'
                },
                { role: 'user', content: prompt }
            ],
            { temperature: 0.2, maxTokens: 900 }
        );
        const text = String(response?.text || '').trim();
        return text || null;
    } catch {
        return null;
    }
}

export const projectImageAnalysisExecutor: SkillExecutor = {
    skillId: 'project-image-analysis',

    async execute({ params, callbacks, context }: SkillExecuteParams): Promise<AgentResult> {
        const projectContext = context?.projectContext;
        const structure = (useAppStore.getState() as any).ecommerceStructure;
        const allImages = dedupeImages(flattenProjectImages(structure));
        const totalProjectImages = Number(projectContext?.projectImageCount || allImages.length || 0);
        const analysisMode = String(params?.analysisMode || 'content').trim() === 'inventory' ? 'inventory' : 'content';
        const sampleSize = analysisMode === 'inventory' ? 0 : Math.max(1, Math.min(12, Number(params?.sampleSize || 6)));
        const directories = Array.isArray(params?.directories) ? params.directories : [];
        const focus = String(params?.focus || 'style-and-detail-page').trim();
        const userIntent = String(params?.userIntent || context?.userInput || '').trim();

        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '读取项目图片上下文',
            detail: `项目路径: ${projectContext?.projectPath || '未解析'}；项目图片数: ${totalProjectImages}；请求样本数: ${sampleSize}`,
            status: 'running',
            percent: 8
        });

        if (!projectContext?.projectPath) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '项目图片分析未开始',
                detail: '当前没有项目上下文，无法直接分析项目图片。',
                status: 'error',
                issue: 'Missing project context'
            });
            return {
                success: false,
                message: '当前没有项目上下文，无法直接分析项目图片。',
                error: 'Missing project context'
            };
        }

        if (!allImages.length) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '项目图片分析未开始',
                detail: '当前项目里没有可分析的图片资源。',
                status: 'error',
                issue: 'No project images available'
            });
            return {
                success: false,
                message: '当前项目里没有可分析的图片资源。',
                error: 'No project images available'
            };
        }

        if (analysisMode === 'inventory') {
            emitSkillStep(callbacks, {
                kind: 'observation',
                title: '读取项目资源索引',
                detail: `项目路径: ${projectContext?.projectPath || '未解析'}；资源数: ${totalProjectImages}`,
                status: 'running',
                percent: 30
            });
            const overview = buildProjectInventoryOverview({
                projectPath: projectContext?.projectPath,
                totalProjectImages,
                structure,
                allImages
            });
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '项目资源概览完成',
                detail: `文件夹: ${overview.folderSummaries.length}；资源类型: ${Object.keys(overview.typeCounts).length}；未调用视觉分析。`,
                status: 'success',
                percent: 100
            });

            return {
                success: true,
                message: overview.message,
                data: {
                    analysisMode,
                    focus,
                    userIntent,
                    totalProjectImages,
                    analyzedSampleCount: 0,
                    folderSummaries: overview.folderSummaries,
                    typeCounts: overview.typeCounts,
                    sampleImages: overview.sampleImages,
                    summarySource: 'project-index'
                }
            };
        }

        const selectedImages = buildPreferredImages({
            allImages,
            projectContext,
            sampleSize,
            directories
        });

        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '选择分析样本',
            detail: `已从 ${totalProjectImages} 张图片中选择 ${selectedImages.length} 张样本；目录过滤: ${directories.length ? directories.join('、') : '未指定'}；分析焦点: ${focus}`,
            status: selectedImages.length ? 'success' : 'error',
            percent: 18,
            issue: selectedImages.length ? undefined : 'No image sample selected'
        });

        if (!selectedImages.length) {
            return {
                success: false,
                message: '项目图片已扫描，但没有选出可分析的样本。',
                error: 'No image sample selected'
            };
        }

        callbacks?.onMessage?.(`开始分析项目图片：从 ${totalProjectImages} 张里抽取 ${selectedImages.length} 张样本。`);

        const analyses: Array<{ image: ImageCandidate; analysis: AssetAnalysis }> = [];
        const failures: Array<{ image: ImageCandidate; error: string }> = [];

        for (let index = 0; index < selectedImages.length; index += 1) {
            const image = selectedImages[index];
            callbacks?.onProgress?.(`分析项目图片 ${index + 1}/${selectedImages.length}`, Math.round(((index + 1) / selectedImages.length) * 70));
            callbacks?.onMessage?.(`读取样本 ${index + 1}/${selectedImages.length}: ${image.relativePath}`);
            emitSkillStep(callbacks, {
                kind: 'tool_started',
                title: `分析图片样本 ${index + 1}/${selectedImages.length}`,
                detail: image.relativePath,
                status: 'running',
                toolName: 'analyzeAssetContent',
                percent: Math.min(74, 22 + Math.round((index / selectedImages.length) * 52))
            });

            try {
                const result = await (window as any).designEcho.analyzeAssetContent(image.path);
                if (result?.success && result.analysis) {
                    analyses.push({ image, analysis: result.analysis as AssetAnalysis });
                    emitSkillStep(callbacks, {
                        kind: 'tool_completed',
                        title: `图片样本已分析 ${index + 1}/${selectedImages.length}`,
                        detail: image.relativePath,
                        status: 'success',
                        toolName: 'analyzeAssetContent',
                        percent: Math.min(78, 26 + Math.round(((index + 1) / selectedImages.length) * 52))
                    });
                } else {
                    const error = String(result?.error || 'Unknown analysis failure');
                    failures.push({
                        image,
                        error
                    });
                    emitSkillStep(callbacks, {
                        kind: 'tool_completed',
                        title: `图片样本分析失败 ${index + 1}/${selectedImages.length}`,
                        detail: `${image.relativePath}: ${error}`,
                        status: 'error',
                        toolName: 'analyzeAssetContent',
                        issue: error
                    });
                }
            } catch (error: any) {
                const errorMessage = String(error?.message || error || 'Unknown analysis failure');
                failures.push({
                    image,
                    error: errorMessage
                });
                emitSkillStep(callbacks, {
                    kind: 'tool_completed',
                    title: `图片样本分析异常 ${index + 1}/${selectedImages.length}`,
                    detail: `${image.relativePath}: ${errorMessage}`,
                    status: 'error',
                    toolName: 'analyzeAssetContent',
                    issue: errorMessage
                });
            }
        }

        if (!analyses.length) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '项目图片分析未完成',
                detail: '已选中的图片样本没有成功返回视觉分析结果。',
                status: 'error',
                issue: failures.map((item) => `${item.image.relativePath}: ${item.error}`).join('; ')
            });
            return {
                success: false,
                message: '项目图片样本读取到了，但视觉分析没有成功返回结果。',
                error: failures.map((item) => `${item.image.relativePath}: ${item.error}`).join('; ')
            };
        }

        callbacks?.onProgress?.('汇总图片分析结果', 82);
        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '汇总图片分析结果',
            detail: `成功样本: ${analyses.length}；失败样本: ${failures.length}；汇总模型: ${getSummaryModelId()}`,
            status: 'running',
            percent: 82
        });
        const modelSummary = await summarizeAnalyses({ analyses, focus, userIntent });
        const summarySource = modelSummary ? 'model' : 'sample-derived';
        const summary = modelSummary || buildDeterministicSummary(analyses);
        emitSkillStep(callbacks, {
            kind: 'verification',
            title: '项目图片分析完成',
            detail: `成功样本: ${analyses.length}；失败样本: ${failures.length}；汇总来源: ${summarySource === 'model' ? '模型汇总' : '样本统计'}`,
            status: 'success',
            percent: 100
        });

        const analyzedPaths = analyses.map((item) => `- ${item.image.relativePath}`);
        const failureLines = failures.length
            ? ['','未成功分析的样本：', ...failures.map((item) => `- ${item.image.relativePath}: ${item.error}`)]
            : [];

        return {
            success: true,
            message: [
                `已基于项目中的 ${analyses.length} 张图片样本完成分析（项目共 ${totalProjectImages} 张）。`,
                '',
                summarySource === 'model'
                    ? '以下结论来自模型对已分析样本的汇总：'
                    : '模型汇总暂时不可用，以下结论直接由已分析样本统计得到：',
                '',
                summary,
                '',
                '已分析样本：',
                ...analyzedPaths,
                ...failureLines
            ].join('\n'),
            data: {
                focus,
                userIntent,
                totalProjectImages,
                analyzedSampleCount: analyses.length,
                analyzedSamples: analyses.map((item) => ({
                    path: item.image.path,
                    relativePath: item.image.relativePath,
                    name: item.image.name,
                    folderType: item.image.folderType,
                    imageType: item.image.imageType,
                    analysis: item.analysis
                })),
                failedSamples: failures,
                summary,
                summarySource
            }
        };
    }
};
