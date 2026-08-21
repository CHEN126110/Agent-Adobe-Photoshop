/**
 * 任务类型定义
 */

export type TaskType = 
    | 'layout-analysis'      // 排版分析
    | 'layout-fix'           // 排版修复
    | 'text-optimize'        // 文案优化
    | 'reference-analyze'    // 参考图分析
    | 'visual-compare'       // 视觉对比
    | 'image-generate';      // 图像生成
