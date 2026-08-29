/** Provider 真实上报的单次模型调用 token 用量；缺失字段保持 unknown，不做估算。 */
export interface ProviderReportedTokenUsage {
    inputTokens: number;
    outputTokens: number;
    /** DeepSeek 官方 usage.prompt_cache_hit_tokens；仅在 hit/miss 完整且与 inputTokens 守恒时存在。 */
    cacheHitInputTokens?: number;
    /** DeepSeek 官方 usage.prompt_cache_miss_tokens；仅在 hit/miss 完整且与 inputTokens 守恒时存在。 */
    cacheMissInputTokens?: number;
}
