/**
 * 知识库 IPC 处理器
 * 
 * 暴露知识库服务给渲染进程
 */

import { ipcMain } from 'electron';
import { knowledgeService } from '../services/knowledge-service';
import type { IPCContext } from './types';

export function registerKnowledgeHandlers(_context: IPCContext): void {
    console.log('[IPC] 注册知识库处理器');

    // ===== 类目相关 =====

    // 获取主类目
    ipcMain.handle('knowledge:getMainCategories', async () => {
        return knowledgeService.getMainCategories();
    });

    // 获取所有类目
    ipcMain.handle('knowledge:getAllCategories', async () => {
        return knowledgeService.getAllCategories();
    });

    // 根据 ID 获取类目
    ipcMain.handle('knowledge:getCategoryById', async (_, id: string) => {
        return knowledgeService.getCategoryById(id);
    });

    // 搜索类目
    ipcMain.handle('knowledge:searchCategories', async (_, keyword: string) => {
        return knowledgeService.searchCategories(keyword);
    });

    // 获取材质列表
    ipcMain.handle('knowledge:getMaterials', async () => {
        return knowledgeService.getMaterials();
    });

    // 搜索材质
    ipcMain.handle('knowledge:searchMaterials', async (_, keyword: string) => {
        return knowledgeService.searchMaterials(keyword);
    });

    // 获取风格列表
    ipcMain.handle('knowledge:getStyles', async () => {
        return knowledgeService.getStyles();
    });

    // 搜索风格
    ipcMain.handle('knowledge:searchStyles', async (_, keyword: string) => {
        return knowledgeService.searchStyles(keyword);
    });

    // ===== 卖点相关 =====

    // 获取所有卖点
    ipcMain.handle('knowledge:getAllSellingPoints', async () => {
        return knowledgeService.getAllSellingPoints();
    });

    // 根据类目获取卖点
    ipcMain.handle('knowledge:getSellingPointsByCategory', async (_, categoryId: string) => {
        return knowledgeService.getSellingPointsByCategory(categoryId);
    });

    // 根据场景获取卖点
    ipcMain.handle('knowledge:getSellingPointsByScene', async (_, scene: string) => {
        return knowledgeService.getSellingPointsByScene(scene);
    });

    // 搜索卖点（支持关键词或参数对象）
    ipcMain.handle('knowledge:searchSellingPoints', async (_, params: string | { keyword?: string; category?: string; limit?: number }) => {
        if (typeof params === 'string') {
            return knowledgeService.searchSellingPoints(params);
        }
        const queryResult = knowledgeService.searchSellingPoints(params.keyword || '');
        let results = queryResult.data;
        if (params.category) {
            results = results.filter((sp: any) => sp.categories?.includes(params.category));
        }
        if (params.limit) {
            results = results.slice(0, params.limit);
        }
        return { ...queryResult, data: results, count: results.length };
    });

    // 获取推荐卖点
    ipcMain.handle('knowledge:getTopSellingPoints', async (_, categoryId: string, limit?: number) => {
        return knowledgeService.getTopSellingPoints(categoryId, limit);
    });

    // 获取随机卖点组合
    ipcMain.handle('knowledge:getRandomSellingPoints', async (_, categoryId: string, count?: number) => {
        return knowledgeService.getRandomSellingPoints(categoryId, count);
    });

    // ===== 痛点相关 =====

    // 获取所有痛点
    ipcMain.handle('knowledge:getAllPainPoints', async () => {
        return knowledgeService.getAllPainPoints();
    });

    // 根据类目获取痛点
    ipcMain.handle('knowledge:getPainPointsByCategory', async (_, categoryId: string) => {
        return knowledgeService.getPainPointsByCategory(categoryId);
    });

    // 搜索痛点（支持关键词或参数对象）
    ipcMain.handle('knowledge:searchPainPoints', async (_, params: string | { keyword?: string; category?: string; type?: string }) => {
        if (typeof params === 'string') {
            return knowledgeService.searchPainPoints(params);
        }
        const queryResult = knowledgeService.searchPainPoints(params.keyword || '');
        let results = queryResult.data;
        if (params.category) {
            results = results.filter((pp: any) => pp.categories?.includes(params.category));
        }
        if (params.type) {
            results = results.filter((pp: any) => pp.type === params.type);
        }
        return { ...queryResult, data: results, count: results.length };
    });

    // 获取痛点（按类目和类型）
    ipcMain.handle('knowledge:getPainPoints', async (_, params: { category?: string; type?: string }) => {
        let results = knowledgeService.getAllPainPoints();
        if (params.category) {
            results = results.filter((pp: any) => pp.categories?.includes(params.category));
        }
        if (params.type) {
            results = results.filter((pp: any) => pp.type === params.type);
        }
        return results;
    });

    // 获取严重程度最高的痛点
    ipcMain.handle('knowledge:getTopPainPoints', async (_, categoryId: string, limit?: number) => {
        return knowledgeService.getTopPainPoints(categoryId, limit);
    });

    // 获取痛点-解决方案配对
    ipcMain.handle('knowledge:getPainSolutionPairs', async (_, categoryId: string) => {
        return knowledgeService.getPainSolutionPairs(categoryId);
    });

    // ===== 配色相关 =====

    // 获取所有配色方案
    ipcMain.handle('knowledge:getAllColorSchemes', async () => {
        return knowledgeService.getAllColorSchemes();
    });

    // 根据 ID 获取配色方案
    ipcMain.handle('knowledge:getColorSchemeById', async (_, id: string) => {
        return knowledgeService.getColorSchemeById(id);
    });

    // 根据场景获取配色方案
    ipcMain.handle('knowledge:getColorSchemesByScene', async (_, scene: string) => {
        return knowledgeService.getColorSchemesByScene(scene);
    });

    // 根据类目获取配色方案
    ipcMain.handle('knowledge:getColorSchemesByCategory', async (_, categoryId: string) => {
        return knowledgeService.getColorSchemesByCategory(categoryId);
    });

    // 智能推荐配色（返回多个）
    ipcMain.handle('knowledge:recommendColorSchemes', async (_, options: {
        category?: string;
        season?: string;
        emotion?: string;
        scene?: string;
    }) => {
        return knowledgeService.recommendColorSchemes(options);
    });

    // 智能推荐配色（返回单个最佳匹配）
    ipcMain.handle('knowledge:recommendColorScheme', async (_, options: {
        category?: string;
        season?: string;
        emotion?: string;
        scene?: string;
    }) => {
        const schemes = knowledgeService.recommendColorSchemes(options);
        return schemes.length > 0 ? schemes[0] : null;
    });

    // 获取配色 CSS 变量
    ipcMain.handle('knowledge:getColorSchemeCSSVariables', async (_, schemeId: string) => {
        return knowledgeService.getColorSchemeCSSVariables(schemeId);
    });

    // ===== 综合查询 =====

    // 统一搜索
    ipcMain.handle('knowledge:unifiedSearch', async (_, keyword: string) => {
        return knowledgeService.unifiedSearch(keyword);
    });

    // 获取设计推荐
    ipcMain.handle('knowledge:getDesignRecommendation', async (_, categoryId: string, options?: {
        season?: string;
        scene?: string;
    }) => {
        return knowledgeService.getDesignRecommendation(categoryId, options);
    });

    // 获取知识库统计
    ipcMain.handle('knowledge:getStats', async () => {
        return knowledgeService.getStats();
    });

    // 生成设计提示词
    ipcMain.handle('knowledge:generateDesignPrompt', async (_, categoryId: string, options?: {
        season?: string;
        scene?: string;
        style?: string;
    }) => {
        return knowledgeService.generateDesignPrompt(categoryId, options);
    });

    console.log('[IPC] 知识库处理器注册完成');
}
