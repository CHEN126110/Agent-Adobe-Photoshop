#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sourceSection(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert(start >= 0, `Missing source section start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert(end >= 0, `Missing source section end: ${endNeedle}`);
  return source.slice(start, end);
}

function loadParserExports() {
  const filename = path.join(ROOT, 'src/renderer/components/message/parser.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React
    },
    fileName: filename
  });

  const parserModule = new Module(filename, module);
  parserModule.filename = filename;
  parserModule.paths = Module._nodeModulePaths(path.dirname(filename));

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../ThinkingProcess' || request === '../../services/tool-display-info') {
      return {
        getToolDisplayInfo: (toolName) => ({
          name: toolName,
          icon: 'T',
          description: toolName
        })
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    parserModule._compile(compiled.outputText, `${filename}.js`);
  } finally {
    Module._load = originalLoad;
  }

  return parserModule.exports;
}

function collectVisibleStrings(value, output = [], keyPath = '') {
  if (value === null || value === undefined) return output;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    output.push(String(value));
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectVisibleStrings(item, output, keyPath);
    return output;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (['result', 'toolResult', 'params', 'payload'].includes(key)) {
        continue;
      }
      collectVisibleStrings(child, output, keyPath ? `${keyPath}.${key}` : key);
    }
  }
  return output;
}

function assertChatPanelRoute() {
  const chatPanel = read('src/renderer/components/ChatPanel.tsx');
  const thinkingProcess = read('src/renderer/components/ThinkingProcess.tsx');
  const visibleFeedback = read('src/renderer/services/agent-visible-feedback.ts');
  const mainProcess = read('src/main/index.ts');
  const testBridge = read('src/renderer/testing/chat-panel-test-bridge.ts');
  const skillExecutors = read('src/renderer/services/skill-executors/index.ts');
  const skillStepEvents = read('src/renderer/services/skill-executors/skill-step-events.ts');
  const documentManagementExecutor = read('src/renderer/services/skill-executors/document-management.executor.ts');
  const textFontReplaceExecutor = read('src/renderer/services/skill-executors/text-font-replace.executor.ts');
  const layoutReplicationExecutor = read('src/renderer/services/skill-executors/layout-replication.executor.ts');
  const detailPageExecutor = read('src/renderer/services/skill-executors/detail-page.executor.ts');
  const skuBatchExecutor = read('src/renderer/services/skill-executors/sku-batch.executor.ts');
  const mainImageExecutor = read('src/renderer/services/skill-executors/main-image.executor.ts');
  const matteProductExecutor = read('src/renderer/services/skill-executors/matte-product.executor.ts');
  const templateSaveExecutor = read('src/renderer/services/skill-executors/template-save.executor.ts');
  const projectImageAnalysisExecutor = read('src/renderer/services/skill-executors/project-image-analysis.executor.ts');
  const designReferenceSearchExecutor = read('src/renderer/services/skill-executors/design-reference-search.executor.ts');
  const visualAnalysisExecutor = read('src/renderer/services/skill-executors/visual-analysis.executor.ts');
  const findEditElementExecutor = read('src/renderer/services/skill-executors/find-edit-element.executor.ts');
  const smartLayoutExecutor = read('src/renderer/services/skill-executors/smart-layout.executor.ts');
  const mainImageTemplateAuthoringExecutor = read('src/renderer/services/skill-executors/main-image-template-authoring.executor.ts');
  const detailPageTemplateAuthoringExecutor = read('src/renderer/services/skill-executors/detail-page-template-authoring.executor.ts');
  const conversational = read('src/renderer/services/agent-orchestration/conversational.ts');
  const streamingPolicy = read('src/renderer/services/agent-orchestration/streaming-policy.ts');
  const streamChatService = read('src/renderer/services/stream-chat.service.ts');
  const designAgentEngine = read('src/renderer/services/design-agent/engine.ts');
  const agentRuntime = read('src/renderer/services/agent-runtime/agent.ts');
  const autonomousAgentExecutor = read('src/renderer/services/skill-executors/autonomous-agent.executor.ts');
  const quickCommandSection = sourceSection(chatPanel, 'const tryQuickCommand', 'const handleUnifiedAgent');
  const unifiedAgentSection = sourceSection(chatPanel, 'const handleUnifiedAgent', 'type IntentType');

  assert(
    !chatPanel.includes("from './ExecutionStatus'") &&
      !chatPanel.includes('EXECUTION_TEMPLATES') &&
      !chatPanel.includes('showExecution') &&
      !chatPanel.includes('executionSteps') &&
      !fs.existsSync(path.join(ROOT, 'src/renderer/components/ExecutionStatus.tsx')) &&
      !fs.existsSync(path.join(ROOT, 'src/renderer/hooks/useExecution.ts')),
    'ChatPanel must not use legacy hard-coded execution templates or the old AI execution status panel'
  );
  assert(
    chatPanel.includes('const quickResult = await tryQuickCommand(userInput);') &&
      chatPanel.includes('await handleUnifiedAgent(userInput, imageToSend || undefined') &&
      chatPanel.includes('publicPlanConfirmationSourceMessageId'),
    'ChatPanel must route non-quick user input into handleUnifiedAgent'
  );
  assert(
    !/关闭|关掉|文档|字体|详情页|主图/.test(quickCommandSection),
    'tryQuickCommand must not hard-code normal design/document requests'
  );
  assert(
    unifiedAgentSection.includes('processWithUnifiedAgent(agentContext') &&
      unifiedAgentSection.includes('conversationHistory: messages.map') &&
      unifiedAgentSection.includes('photoshopContext') &&
      unifiedAgentSection.includes('attachedImages'),
    'handleUnifiedAgent must build the real Agent context before execution'
  );
  assert(
    unifiedAgentSection.includes('agentTaskPublicPlanExecutionRequest') &&
      unifiedAgentSection.includes('agentTaskPublicPlanApprovalRecord') &&
      unifiedAgentSection.includes('agentTaskPublicPlanControlledRun') &&
      unifiedAgentSection.includes('agentTaskPublicPlan: m.agentTaskPublicPlan') &&
      unifiedAgentSection.includes('agentTaskPublicPlanExecutionRequest: m.agentTaskPublicPlanExecutionRequest'),
    'ChatPanel must preserve public plan request, approval record, and controlled run through conversation history'
  );
  assert(
    unifiedAgentSection.includes('agentTaskPublicPlanControlledRun: m.agentTaskPublicPlanControlledRun') &&
      unifiedAgentSection.includes('agentTaskPublicPlanControlledRun: options?.agentTaskPublicPlanControlledRun') &&
      unifiedAgentSection.includes('data?.agentTaskPublicPlanControlledRun'),
    'ChatPanel must persist public plan controlled runner output into assistant messages'
  );
  assert(
    unifiedAgentSection.includes('executionSummary') &&
      unifiedAgentSection.includes('data?.executionSummary'),
    'ChatPanel must preserve Agent executionSummary into assistant messages'
  );
  assert(
    unifiedAgentSection.includes('onToolComplete') &&
      unifiedAgentSection.includes('toolResult: toolResult') &&
      unifiedAgentSection.includes('thinkingSteps: stepsToSave'),
    'ChatPanel must preserve completed tool results into message thinking steps'
  );
  assert(
    unifiedAgentSection.includes('hasVisibleProcessSteps') &&
      unifiedAgentSection.includes('普通聊天不保存固定系统日志') &&
      !unifiedAgentSection.includes('生成对话回复') &&
      !unifiedAgentSection.includes('hasToolExecution || hasThinkingContent'),
    'ChatPanel must not persist hard-coded ordinary-chat or skill telemetry as model thinking'
  );
  assert(
    !chatPanel.includes('mapAgentStepType') &&
      !chatPanel.includes("type: 'decision'") &&
      !chatPanel.includes("type: 'analyzing'"),
    'ChatPanel must not map deterministic Agent telemetry into visible thinking-like steps'
  );
  assert(
    !visibleFeedback.includes('LIVE_AGENT_WAITING_TITLE') &&
      !visibleFeedback.includes('LIVE_AGENT_WAITING_TEXT') &&
      !visibleFeedback.includes('\u7b49\u5f85\u54cd\u5e94') &&
      !visibleFeedback.includes('\u6b63\u5728\u51c6\u5907') &&
      !visibleFeedback.includes('\u8bf7\u6c42\u5df2\u53d1\u9001') &&
      visibleFeedback.includes('isVisibleAgentStepEvent') &&
      visibleFeedback.includes("'tool_started'") &&
      visibleFeedback.includes("'tool_completed'") &&
      visibleFeedback.includes('buildInitialVisibleAgentActivity') &&
      visibleFeedback.includes('buildVisibleAgentActivityFromStepEvent') &&
      visibleFeedback.includes('showAsThinking: false') &&
      visibleFeedback.includes('canClaimModelReasoning: false') &&
      !visibleFeedback.includes("'model_request'") &&
      !visibleFeedback.includes("'model_response'") &&
      !visibleFeedback.includes("'observation'"),
    'Visible feedback contract must expose tool events and agent identity without waiting placeholder or fake thinking'
  );
  assert(
    !thinkingProcess.includes('isActive?: boolean') &&
      !thinkingProcess.includes('LIVE_AGENT_WAITING_TITLE') &&
      !thinkingProcess.includes('LIVE_AGENT_WAITING_TEXT') &&
      !thinkingProcess.includes('thinking-waiting') &&
      !thinkingProcess.includes('pondering-waiting-text') &&
      !thinkingProcess.includes('\u7b49\u5f85\u54cd\u5e94') &&
      !thinkingProcess.includes('\u6b63\u5728\u51c6\u5907') &&
      !thinkingProcess.includes('\u8bf7\u6c42\u5df2\u53d1\u9001') &&
      thinkingProcess.includes("renderStepPanel('\u6b63\u5728\u601d\u8003', thinkingSteps)") &&
      thinkingProcess.includes("renderStepPanel('\u5de5\u5177\u8c03\u7528', toolSteps)") &&
      !thinkingProcess.includes("renderStepPanel('\u6267\u884c\u8fdb\u5ea6'"),
    'ThinkingProcess must render only real model thinking and tool calls, with no fake waiting/progress placeholder'
  );
  assert(
    chatPanel.includes("from '../services/agent-visible-feedback'") &&
      chatPanel.includes('formatAgentToolEventContent(event)') &&
      chatPanel.includes('isVisibleAgentStepEvent(event)') &&
      chatPanel.includes('buildInitialVisibleAgentActivity') &&
      chatPanel.includes('const [liveActivity, setLiveActivity]') &&
      chatPanel.includes('data-testid="live-agent-activity"') &&
      chatPanel.includes('setLiveActivity(buildInitialVisibleAgentActivity())') &&
      chatPanel.includes('buildVisibleAgentActivityFromStepEvent(event)') &&
      chatPanel.includes('agent-activity-label') &&
      !chatPanel.includes('LIVE_ACTIVITY_THINKING_TITLE') &&
      chatPanel.includes('thinkingSteps.some(isVisiblePonderingStep) || liveActivity') &&
      chatPanel.includes('isVisiblePonderingStep(newStep)') &&
      chatPanel.includes('<LiveActivityIndicator activity={liveActivity} />') &&
      !chatPanel.includes('isActive={isLoading}'),
    'ChatPanel must show an initial request activity before real model/tool evidence without fake thinking copy'
  );
  assert(
    agentRuntime.includes('requestInitialVisibleReasoningIfNeeded') &&
      agentRuntime.includes('公开判断') &&
      agentRuntime.includes("this.emitVisibleReasoning(response.content, { source: 'model_visible_reasoning' })") &&
      autonomousAgentExecutor.includes('user-visible Chinese plan') &&
      autonomousAgentExecutor.includes('not private chain-of-thought'),
    'Tool-calling Agent path must request model-authored visible reasoning before tools and surface assistant content beside tool calls'
  );
  assert(
    unifiedAgentSection.includes('mergeVisibleThinking') &&
      unifiedAgentSection.includes('mergeVisibleThinking(currentStep?.content') &&
      !unifiedAgentSection.includes('接收用户请求。纯文本请求'),
    'ChatPanel must merge real visible reasoning chunks without reintroducing hard-coded fake steps'
  );
  assert(
    unifiedAgentSection.includes('cleanResponseContent') &&
      unifiedAgentSection.includes('directResponse') &&
      unifiedAgentSection.includes('clarificationQuestion'),
    'ChatPanel must clean structured model wrapper JSON before showing assistant replies'
  );
  assert(
    chatPanel.includes("case 'confirmPublicPlan'") &&
      chatPanel.includes("text: '确认执行公开计划'") &&
      chatPanel.includes('publicPlanConfirmationSourceMessageId: sourceMessageId'),
    'ChatPanel must expose a one-click public plan confirmation action through the normal send path'
  );
  const confirmPublicPlanSection = sourceSection(chatPanel, "case 'confirmPublicPlan':", 'default:');
  assert(
    !confirmPublicPlanSection.includes('executeToolCall(') &&
      !confirmPublicPlanSection.includes('sendToPlugin(') &&
      !confirmPublicPlanSection.includes('window.designEcho'),
    'public plan confirmation action must not bypass the controlled runner with direct Photoshop/tool calls'
  );
  assert(
    !confirmPublicPlanSection.includes('allowPhotoshopWrites') &&
      !confirmPublicPlanSection.includes('live-photoshop') &&
      !confirmPublicPlanSection.includes('executionTarget') &&
      !confirmPublicPlanSection.includes('adapter:'),
    'public plan confirmation action must not grant live Photoshop execution; live handoff belongs to the controlled runner gate'
  );
  assert(
    read('src/renderer/components/message/parser.ts').includes('buildPublicPlanExecutionRequestCard') &&
      read('src/renderer/components/message/parser.ts').includes('buildPublicPlanControlledRunCard') &&
      read('src/renderer/components/message/parser.ts').includes("action: 'confirmPublicPlan'"),
    'message parser must render public plan execution request and controlled run as compact cards'
  );
  assert(
    testBridge.includes('hasPublicPlanControlledRun') &&
      testBridge.includes('publicPlanControlledRunStatus'),
    'ChatPanel test bridge must expose public plan controlled runner status for acceptance'
  );
  assert(
    chatPanel.includes("import { streamChatAsync } from '../services/stream-chat.service'") &&
      chatPanel.includes("import { canUsePlainTextProviderStream } from '../services/agent-orchestration/streaming-policy'") &&
      unifiedAgentSection.includes('canUsePlainTextProviderStream') &&
      unifiedAgentSection.includes('streamChatAsync(') &&
      unifiedAgentSection.includes('onThinkingProgress') &&
      unifiedAgentSection.includes('finalizeStreamedAssistantMessage') &&
      !unifiedAgentSection.includes('updateLastMessage('),
    'ChatPanel must use provider token streaming for streamable ordinary chat and must not fake streaming with local typing'
  );
  assert(
    designAgentEngine.includes('requestInitialVisibleIntentPreview') &&
      designAgentEngine.includes("purpose: 'visible_reasoning'") &&
      designAgentEngine.includes('不要暴露私有链式思维') &&
      unifiedAgentSection.includes("options?.purpose === 'visible_reasoning'") &&
      unifiedAgentSection.includes("isRouterCall || isVisibleReasoningCall") &&
      unifiedAgentSection.includes('hasAttachedImage && !isRouterCall && !isVisibleReasoningCall') &&
      unifiedAgentSection.includes('const streamHasAttachedImage = isVisibleReasoningCall ? false : hasAttachedImage;') &&
      unifiedAgentSection.includes('updateStreamedVisibleReasoning(fullContent)') &&
      unifiedAgentSection.includes('updateStreamedVisibleReasoning(fullThinking)'),
    'Actionable Agent requests must request a text-only model-authored visible reasoning preview and stream it into thinking UI without local placeholders'
  );
  assert(
    streamingPolicy.includes("options?.purpose !== 'direct_response' && options?.purpose !== 'visible_reasoning'") &&
      streamingPolicy.includes('context.hasAttachedImage') &&
      streamingPolicy.includes('context.hasToolCalling') &&
      streamingPolicy.includes("typeof message.content === 'string'"),
    'Provider stream policy must explicitly allow direct plain-text responses and visible reasoning, then block multimodal/tool-calling paths'
  );
  assert(
    conversational.includes('stream: true') &&
      conversational.includes("purpose: 'direct_response'"),
    'Conversational model replies must request the provider streaming path explicitly'
  );
  assert(
    streamChatService.includes('onThinkingProgress?:') &&
      streamChatService.includes('const { onProgress, onThinkingProgress, ...streamOptions } = options || {};') &&
      streamChatService.includes('streamOptions'),
    'streamChatAsync must strip renderer callback functions before sending provider options through IPC'
  );
  assert(
    skillStepEvents.includes('executeObservedSkillTool') &&
      skillStepEvents.includes("kind: 'tool_started'") &&
      skillStepEvents.includes("kind: 'tool_completed'") &&
      documentManagementExecutor.includes('executeObservedSkillTool(callbacks') &&
      documentManagementExecutor.includes('准备关闭文档') &&
      documentManagementExecutor.includes('保存结果已返回') &&
      textFontReplaceExecutor.includes('准备批量字体替换') &&
      textFontReplaceExecutor.includes('字体替换复核完成'),
    'document-management and text-font-replace must emit domain-specific observable skill steps without fake thinking'
  );
  assert(
    layoutReplicationExecutor.includes('准备参考图复刻') &&
      layoutReplicationExecutor.includes('调用视觉模型解析参考图') &&
      layoutReplicationExecutor.includes('模板蓝图已生成') &&
      layoutReplicationExecutor.includes('图层匹配计划已生成') &&
      layoutReplicationExecutor.includes('图层匹配结果已汇总') &&
      layoutReplicationExecutor.includes('emitSkillStep(callbacks'),
    'layout-replication must emit factual domain steps for parse, blueprint, apply/match, QA, and finalization phases'
  );
  assert(
    detailPageExecutor.includes("import { emitSkillStep, executeObservedSkillTool } from './skill-step-events'") &&
      detailPageExecutor.includes('准备执行详情页技能') &&
      detailPageExecutor.includes('详情页模板解析完成') &&
      detailPageExecutor.includes('详情页填充计划已生成') &&
      detailPageExecutor.includes('开始按屏执行详情页填充') &&
      detailPageExecutor.includes('详情页结果复核完成') &&
      detailPageExecutor.includes('详情页执行结果已汇总') &&
      detailPageExecutor.includes('executeObservedSkillTool(callbacks'),
    'detail-page executor must emit factual domain steps and observed Photoshop tool events without fake thinking'
  );
  assert(
    skuBatchExecutor.includes("import { emitSkillStep } from './skill-step-events'") &&
      skuBatchExecutor.includes('准备执行 SKU 批量生成') &&
      skuBatchExecutor.includes('SKU 项目与模板上下文读取完成') &&
      skuBatchExecutor.includes('SKU 颜色图层读取完成') &&
      skuBatchExecutor.includes('SKU 任务参数解析完成') &&
      skuBatchExecutor.includes('SKU 执行计划已确认') &&
      skuBatchExecutor.includes('SKU 批量生成结果已汇总'),
    'sku-batch executor must emit factual high-level domain steps without changing SKU business logic'
  );
  assert(
    mainImageExecutor.includes("import { emitSkillStep } from './skill-step-events'") &&
      mainImageExecutor.includes('准备执行主图设计') &&
      mainImageExecutor.includes('主图设计文档已读取') &&
      mainImageExecutor.includes('主图主体边界检测完成') &&
      mainImageExecutor.includes('准备处理主图尺寸') &&
      mainImageExecutor.includes('主图设计结果已汇总'),
    'main-image executor must emit factual domain steps for document, subject, size processing, and finalization phases'
  );
  assert(
    matteProductExecutor.includes("import { emitSkillStep, executeObservedSkillTool } from './skill-step-events'") &&
      matteProductExecutor.includes('准备抠图参数') &&
      matteProductExecutor.includes('正在调用 Photoshop 抠图工具') &&
      matteProductExecutor.includes('抠图结果已返回') &&
      matteProductExecutor.includes('抠图未完成') &&
      matteProductExecutor.includes('executeObservedSkillTool('),
    'matte-product executor must emit factual domain steps and observed Photoshop tool events without changing matting behavior'
  );
  assert(
    templateSaveExecutor.includes("import { emitSkillStep, executeObservedSkillTool } from './skill-step-events'") &&
      templateSaveExecutor.includes('确定模板保存上下文') &&
      templateSaveExecutor.includes('识别模板类型') &&
      templateSaveExecutor.includes('写入模板库') &&
      templateSaveExecutor.includes('模板已保存') &&
      templateSaveExecutor.includes('模板保存失败'),
    'template-save executor must emit factual domain steps for document lookup, type inference, library write, and failure diagnosis'
  );
  assert(
    projectImageAnalysisExecutor.includes("import { emitSkillStep } from './skill-step-events'") &&
      projectImageAnalysisExecutor.includes('读取项目图片上下文') &&
      projectImageAnalysisExecutor.includes('选择分析样本') &&
      projectImageAnalysisExecutor.includes('分析图片样本') &&
      projectImageAnalysisExecutor.includes('汇总图片分析结果') &&
      projectImageAnalysisExecutor.includes('项目图片分析完成') &&
      projectImageAnalysisExecutor.includes('项目图片分析未完成'),
    'project-image-analysis executor must emit factual domain steps for context, sample selection, image analysis, summary, and failure diagnosis'
  );
  assert(
    designReferenceSearchExecutor.includes("import { emitSkillStep, executeObservedSkillTool } from './skill-step-events'") &&
      designReferenceSearchExecutor.includes('准备设计参考检索') &&
      designReferenceSearchExecutor.includes('设计参考检索完成') &&
      designReferenceSearchExecutor.includes('网页设计内容已获取') &&
      designReferenceSearchExecutor.includes('设计参考检索模式不支持'),
    'design-reference-search executor must emit factual domain steps for search, URL fetch, and unsupported mode diagnosis'
  );
  assert(
    visualAnalysisExecutor.includes("import { emitSkillStep, executeObservedSkillTool } from './skill-step-events'") &&
      visualAnalysisExecutor.includes('准备视觉分析') &&
      visualAnalysisExecutor.includes('调用视觉模型分析画布') &&
      visualAnalysisExecutor.includes('画布视觉分析完成') &&
      visualAnalysisExecutor.includes('视觉分析报告已生成') &&
      visualAnalysisExecutor.includes('视觉分析执行异常'),
    'visual-analysis executor must emit factual domain steps for snapshot acquisition, vision model analysis, report generation, and exceptions'
  );
  assert(
    findEditElementExecutor.includes("import { emitSkillStep, executeObservedSkillTool } from './skill-step-events'") &&
      findEditElementExecutor.includes('准备定位画布元素') &&
      findEditElementExecutor.includes('候选图层已排序') &&
      findEditElementExecutor.includes('缺少目标元素描述') &&
      findEditElementExecutor.includes('元素定位与操作完成') &&
      findEditElementExecutor.includes('executeObservedSkillTool(callbacks'),
    'find-and-edit-element executor must emit factual domain steps for element mapping, candidate ranking, selection, action execution, and confirmation needs'
  );
  assert(
    smartLayoutExecutor.includes("import { emitSkillStep, executeObservedSkillTool } from './skill-step-events'") &&
      smartLayoutExecutor.includes('准备智能布局参数') &&
      smartLayoutExecutor.includes('调用 Photoshop 智能布局工具') &&
      smartLayoutExecutor.includes('智能布局结果已返回') &&
      smartLayoutExecutor.includes('智能布局未完成'),
    'smart-layout executor must emit factual domain steps for parameter preparation, smartLayout tool call, and result diagnosis'
  );
  assert(
    mainImageTemplateAuthoringExecutor.includes("import { emitSkillStep, executeObservedSkillTool } from './skill-step-events'") &&
      mainImageTemplateAuthoringExecutor.includes('主图模板蓝图已生成') &&
      mainImageTemplateAuthoringExecutor.includes('创建主图模板形状') &&
      mainImageTemplateAuthoringExecutor.includes('创建主图文案占位') &&
      mainImageTemplateAuthoringExecutor.includes('主图模板创建结果已汇总') &&
      mainImageTemplateAuthoringExecutor.includes('executeObservedSkillTool(callbacks'),
    'main-image-template-authoring executor must emit factual template blueprint, layer creation, and tool-call events'
  );
  assert(
    detailPageTemplateAuthoringExecutor.includes("import { emitSkillStep, executeObservedSkillTool } from './skill-step-events'") &&
      detailPageTemplateAuthoringExecutor.includes('详情页模板蓝图已生成') &&
      detailPageTemplateAuthoringExecutor.includes('创建详情页屏结构') &&
      detailPageTemplateAuthoringExecutor.includes('详情页屏结构已创建') &&
      detailPageTemplateAuthoringExecutor.includes('详情页模板创建结果已汇总') &&
      detailPageTemplateAuthoringExecutor.includes('executeObservedSkillTool(callbacks'),
    'detail-page-template-authoring executor must emit factual template blueprint, screen creation, and tool-call events'
  );
  assert(
    chatPanel.includes('data-testid="chat-input"') &&
      chatPanel.includes('data-testid="chat-send"') &&
      chatPanel.includes('data-testid="chat-messages"'),
    'ChatPanel must expose stable test selectors for controlled UI automation'
  );
  assert(
    skillExecutors.includes('开始能力：') &&
      skillExecutors.includes('能力完成') &&
      skillExecutors.includes('summarizeSkillResult') &&
      skillExecutors.includes('toolCallId: skillStepId'),
    'executeSkillWithExecutor must emit factual skill start/completion step events for deterministic skills'
  );
  assert(
    chatPanel.includes('installChatPanelTestBridge') &&
      chatPanel.includes('submit: async (text: string') &&
      chatPanel.includes('getSnapshot: buildChatTestSnapshot') &&
      chatPanel.includes('waitForIdle: waitForChatIdle'),
    'ChatPanel must install a minimal controlled test bridge when explicitly enabled'
  );
  assert(
    testBridge.includes('__DESIGNECHO_CHAT_TEST_BRIDGE__') &&
      testBridge.includes('designechoChatTestBridge') &&
      testBridge.includes('isChatPanelTestBridgeEnabled') &&
      testBridge.includes('installChatPanelTestBridge') &&
      testBridge.includes('delete (window as any)[CHAT_TEST_BRIDGE_KEY]'),
    'ChatPanel test bridge must live in a dedicated gated renderer testing module'
  );
  assert(
    mainProcess.includes('DESIGNECHO_CHAT_TEST_BRIDGE') &&
      mainProcess.includes("designechoChatTestBridge: '1'") &&
      mainProcess.includes('rendererQuery ? { query: rendererQuery } : undefined'),
    'ChatPanel test bridge must be gated by an explicit main-process environment flag'
  );
}

function assertMessageParserRendering() {
  const { convertLegacyMessage } = loadParserExports();
  assert(typeof convertLegacyMessage === 'function', 'convertLegacyMessage export is unavailable');

  const acceptanceSummary = '验收证据：检测到文本内容变化，任务断言通过。';
  const debugOnlyText = 'DEBUG_ONLY_SHOULD_NOT_RENDER';
  const rawMarker = 'SECRET_RAW_DIFF_SHOULD_NOT_RENDER';
  const executionSummaryText = '执行状态：需复核。工具调用 1 次，成功 1 次，失败 0 次，需复核验收 1 项。';
  const executionBlockerText = '达到最大迭代次数，任务未能确认完成。';
  const executionWarningText = '工具返回成功但未检测到文档变化，需要复核。';
  const legacyMessage = {
    id: 'msg-chat-ui-smoke',
    role: 'assistant',
    content: '已完成文字修改。',
    timestamp: 1777259000000,
    executionSummary: {
      status: 'needs_review',
      stopReason: 'final_response',
      iterations: 2,
      toolCallCount: 1,
      successfulToolCalls: 1,
      failedToolCalls: 0,
      acceptanceVerified: 0,
      acceptanceFailed: 0,
      acceptanceNeedsReview: 1,
      noDocumentChangeRisks: 1,
      lastToolName: 'setTextContent',
      blockers: [executionBlockerText],
      warnings: [executionWarningText],
      summaryText: executionSummaryText
    },
    thinkingSteps: [
      {
        id: 'thinking-1',
        type: 'thinking',
        content: '根据用户请求，先确认当前文档和目标文本图层，再执行修改。',
        status: 'success',
        timestamp: 1777259000001,
        duration: 10
      },
      {
        id: 'tool-1',
        type: 'tool_call',
        content: '执行 setTextContent',
        toolName: 'setTextContent',
        status: 'success',
        timestamp: 1777259000002,
        duration: 25,
        toolResult: {
          success: true,
          layerId: 2,
          previousContent: '旧文案',
          newContent: '新文案',
          acceptance: {
            summaryText: acceptanceSummary,
            debugText: debugOnlyText,
            diff: {
              changedLayers: [{ id: 2, marker: rawMarker }]
            }
          }
        }
      },
      {
        id: 'tool-result-1',
        type: 'tool_result',
        content: '工具完成',
        toolName: 'setTextContent',
        status: 'success',
        timestamp: 1777259000003,
        duration: 25,
        toolResult: {
          success: true,
          layerId: 2,
          acceptance: {
            summaryText: acceptanceSummary,
            debugText: debugOnlyText,
            diff: {
              raw: rawMarker
            }
          }
        }
      }
    ]
  };

  const converted = convertLegacyMessage(legacyMessage);
  const visibleText = collectVisibleStrings(converted).join('\n');
  const thinkingBlock = converted.blocks.find((block) => block.type === 'thinking');
  const toolResultBlock = converted.blocks.find((block) => block.type === 'tool_result');
  const executionSummaryBlock = converted.blocks.find((block) =>
    block.type === 'card' && block.title === '任务报告：需复核'
  );

  assert(thinkingBlock, 'Converted message should include thinking block');
  assert(toolResultBlock, 'Converted message should include tool result block for legacy tool_result steps');
  assert(executionSummaryBlock, 'Converted message should include execution summary report card');
  assert(
    visibleText.includes(executionSummaryText),
    'Visible message representation should include execution summary text'
  );
  assert(
    visibleText.includes(executionBlockerText),
    'Visible message representation should include execution summary blocker text'
  );
  assert(
    visibleText.includes(executionWarningText),
    'Visible message representation should include execution summary warning text'
  );
  assert(
    executionSummaryBlock.content.includes(executionBlockerText) &&
      executionSummaryBlock.content.includes(executionWarningText),
    'Execution summary card content must expose blockers and warnings, not only counts'
  );
  assert(
    visibleText.includes(acceptanceSummary),
    'Visible message representation should include acceptance summary text'
  );
  assert(
    !visibleText.includes(rawMarker),
    'Visible message representation must not expose raw acceptance diff payload'
  );
  assert(
    !visibleText.includes(debugOnlyText),
    'Visible message representation must not expose acceptance debugText'
  );
  assert(
    Array.isArray(toolResultBlock.details) &&
      toolResultBlock.details.some((detail) => detail.label === '验收' && detail.value === acceptanceSummary),
    'Tool result details should show acceptance summary as a readable detail'
  );
  assert(
    !toolResultBlock.details.some((detail) => String(detail.value).includes(rawMarker)),
    'Tool result details must skip raw acceptance payload'
  );

  const noThinkingMessage = {
    id: 'msg-no-fake-thinking',
    role: 'assistant',
    content: '工具已经执行。',
    timestamp: 1777259000100,
    thinkingSteps: [
      {
        id: 'empty-thinking',
        type: 'thinking',
        content: '',
        status: 'success',
        timestamp: 1777259000101
      },
      {
        id: 'tool-only',
        type: 'tool_call',
        content: '执行 getDocumentInfo',
        toolName: 'getDocumentInfo',
        status: 'success',
        timestamp: 1777259000102,
        toolResult: {
          success: true,
          documentName: 'test.psd'
        }
      }
    ]
  };
  const noThinkingConverted = convertLegacyMessage(noThinkingMessage);
  const noThinkingBlock = noThinkingConverted.blocks.find((block) => block.type === 'thinking');
  assert(noThinkingBlock, 'Tool-only progress should render as a tool-call block');
  assert(noThinkingBlock.title === '工具调用', 'Tool-only progress must be titled as tool calls, not execution logs or model thinking');
  assert(
    !noThinkingBlock.steps.some((step) => !String(step.label || '').trim()),
    'Empty thinking placeholders must not be rendered as visible steps'
  );

  const executionLogMessage = {
    id: 'msg-execution-log-process',
    role: 'assistant',
    content: '这是执行记录。',
    timestamp: 1777259000200,
    thinkingSteps: [
      {
        id: 'route-1',
        type: 'decision',
        content: '路由决策：需要执行 Photoshop 工具。',
        status: 'success',
        timestamp: 1777259000201
      },
      {
        id: 'reply-1',
        type: 'status',
        content: '整理工具结果并生成回复。',
        status: 'success',
        timestamp: 1777259000202
      }
    ]
  };
  const executionLogConverted = convertLegacyMessage(executionLogMessage);
  const executionLogBlock = executionLogConverted.blocks.find((block) => block.type === 'thinking');
  assert(
    !executionLogBlock,
    'Decision/status telemetry must not render as thinking or a thinking-like progress block'
  );

  const realThinkingMessage = {
    id: 'msg-real-thinking',
    role: 'assistant',
    content: '这是带真实 provider thinking 的回复。',
    timestamp: 1777259000300,
    thinkingSteps: [
      {
        id: 'thinking-1',
        type: 'thinking',
        content: 'provider 返回的 reasoning_content 摘要',
        status: 'success',
        timestamp: 1777259000301
      }
    ]
  };
  const realThinkingConverted = convertLegacyMessage(realThinkingMessage);
  const realThinkingBlock = realThinkingConverted.blocks.find((block) => block.type === 'thinking');
  assert(
    realThinkingBlock && realThinkingBlock.title === '正在思考',
    'Only provider thinking/reasoning steps should render as 正在思考'
  );
}

function main() {
  assertChatPanelRoute();
  assertMessageParserRendering();

  console.log(JSON.stringify({
    success: true,
    checks: [
      'ChatPanel sends non-quick user input through the unified Agent path',
      'quick commands remain limited to exact undo/redo/save style commands',
      'ChatPanel preserves tool completion results in thinking steps',
      'ChatPanel exposes gated test selectors and a minimal test bridge only through an explicit env/query gate',
      'message parser renders acceptance summary without raw acceptance diff/debug payload',
      'message parser renders executionSummary as a task report card',
      'message parser keeps executionSummary blockers and warnings visible in the task report card',
      'message parser filters empty thinking placeholders so tool-only progress is shown as 工具调用, not fake thinking',
      'message parser labels real provider thinking as 正在思考 and filters route/status telemetry from Pondering',
      'legacy hard-coded execution templates and AI execution status panel are removed from ChatPanel',
      'initial request activity prevents the waiting interval from rendering as blank without claiming provider thinking',
      'skill executor registry emits factual start/completion step events for deterministic skills',
      'ordinary chat requests use provider token streaming without local fake typing',
      'provider stream policy blocks multimodal and tool-calling paths until they are separately designed',
      'streamChatAsync keeps renderer callbacks out of IPC provider options',
      'document-management and text-font-replace emit domain-specific observable skill steps',
      'layout-replication emits factual domain steps across parse blueprint apply match QA and finalization phases',
      'detail-page emits factual domain steps across parse plan fill audit and finalization phases',
      'sku-batch emits factual high-level domain steps without changing SKU business logic',
      'main-image emits factual domain steps across document subject size processing and finalization phases',
      'matte-product emits factual domain steps for parameter preparation, removeBackground tool call, and result diagnosis',
      'template-save emits factual domain steps for document lookup, template type inference, library write, and save diagnosis',
      'project-image-analysis emits factual domain steps for context, sample selection, per-image analysis, summary, and diagnosis',
      'design-reference-search emits factual domain steps for search and URL-fetch reference gathering',
      'visual-analysis emits factual domain steps for snapshot acquisition, vision model analysis, and report generation',
      'find-and-edit-element emits factual domain steps for element mapping, candidate ranking, selection, and edit execution',
      'smart-layout emits factual domain steps for parameter preparation, Photoshop tool call, and layout result diagnosis',
      'main-image-template-authoring emits factual blueprint, layer creation, and Photoshop tool-call events',
      'detail-page-template-authoring emits factual blueprint, screen creation, and Photoshop tool-call events'
    ],
    caveat: 'This smoke validates the renderer message chain and the gated ChatPanel test bridge in code. It does not click the already-running Electron window yet.'
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
