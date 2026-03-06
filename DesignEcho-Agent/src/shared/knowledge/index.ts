/**
 * 知识库索引
 * 
 * 统一导出所有知识库模块
 */

// 类目分类
export * from './socks-categories';
export { default as SocksCategories } from './socks-categories';

// 卖点库
export * from './selling-points';
export { default as SellingPoints } from './selling-points';

// 痛点库
export * from './pain-points';
export { default as PainPoints } from './pain-points';

// 配色方案
export * from './color-schemes';
export { default as ColorSchemes } from './color-schemes';

// 用户自定义知识
export * from './user-knowledge';

// 知识库统计
export const KNOWLEDGE_BASE_STATS = {
    categories: {
        total: 8,           // 主类目数量
        subcategories: 12,  // 子类目数量
    },
    sellingPoints: {
        total: 42,          // 卖点总数
        byType: {
            material: 8,
            function: 10,
            comfort: 6,
            design: 7,
            quality: 6,
            health: 5
        }
    },
    painPoints: {
        total: 30,          // 痛点总数
        byType: {
            comfort: 6,
            durability: 4,
            hygiene: 3,
            function: 4,
            appearance: 3,
            health: 4
        }
    },
    colorSchemes: {
        total: 12           // 配色方案数量
    }
};
