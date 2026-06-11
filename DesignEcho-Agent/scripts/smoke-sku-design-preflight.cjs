#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const skillExecutors = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));
const { DesignAgentEngine } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'sku-design-preflight-smoke.json');
  const mdPath = path.join(outDir, 'sku-design-preflight-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(
    mdPath,
    [
      '# SKU Design Preflight Smoke',
      '',
      `- success: ${payload.success}`,
      `- resultSuccess: ${payload.resultSuccess}`,
      `- resultError: ${payload.resultError || 'none'}`,
      `- executedSkill: ${payload.executedSkill || 'none'}`,
      `- preflightStatus: ${payload.preflightStatus || 'none'}`,
      `- modelPurposes: ${payload.modelPurposes.join(', ') || 'none'}`,
      ''
    ].join('\n'),
    'utf8'
  );
  return { json: jsonPath, md: mdPath };
}

function createContext(userInput) {
  return {
    userInput,
    conversationHistory: [],
    isPluginConnected: true,
    photoshopContext: {
      hasDocument: true,
      documentName: 'SKU.psb',
      documentPath: 'D:/A1 neveralone旗舰店/C-1163/PSD/SKU.psb',
      layerCount: 18
    },
    projectContext: {
      projectPath: 'D:/A1 neveralone旗舰店/C-1163',
      projectImageCount: 12,
      projectImageFolders: ['PSD', '模板文件', '配置文件', 'SKU'],
      sampleImagePaths: [
        'D:/A1 neveralone旗舰店/C-1163/PSD/SKU.psb',
        'D:/A1 neveralone旗舰店/C-1163/模板文件/2双装.tif',
        'D:/A1 neveralone旗舰店/C-1163/模板文件/2双自选备注.tif',
        'D:/A1 neveralone旗舰店/C-1163/配置文件/6色 2-3-4.csv'
      ],
      assetIndex: {
        summary: {
          totalImages: 12
        }
      }
    }
  };
}

async function run() {
  const engine = new DesignAgentEngine();
  const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
  const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;

  const executed = [];
  const steps = [];
  const modelPurposes = [];
  let result;

  skillExecutors.getSkillExecutor = (skillId) => ({
    id: skillId,
    execute: async () => ({ success: true, message: `executed:${skillId}` })
  });
  skillExecutors.executeSkillWithExecutor = async (skillId, payload) => {
    executed.push({
      skillId,
      params: payload?.params || {}
    });
    return {
      success: true,
      message: `executed:${skillId}`,
      data: {
        status: 'ok'
      }
    };
  };

  try {
    result = await engine.run(createContext('帮我做一下SKU'), {
      callModel: async (_messages, options = {}) => {
        modelPurposes.push(options.purpose || 'intent_router');
        if (options.purpose === 'visible_reasoning') {
          return {
            text: '我会把这条需求识别为当前项目的 SKU 批量生成，并先按 SKU 专用执行计划检查项目文档、模板和配置。'
          };
        }
        if (options.purpose === 'design_execution_preflight') {
          return {
            text: '{}'
          };
        }
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'sku-batch',
            mode: 'execute',
            intentSummary: '用户要求为当前项目生成 SKU。',
            skillParams: {
              generateNotes: true,
              skuFileKeyword: 'SKU'
            }
          })
        };
      },
      callbacks: {
        onStep: (step) => steps.push(step)
      }
    });
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }

  const preflight = result?.data?.agentDesignExecutionPreflight;
  const payload = {
    success:
      result?.success === true
      && executed.length === 1
      && executed[0]?.skillId === 'sku-batch'
      && executed[0]?.params?.generateNotes === true
      && preflight?.status !== 'needs_model_design_decision',
    resultSuccess: result?.success === true,
    resultError: result?.error || null,
    resultMessage: result?.message || '',
    executedSkill: executed[0]?.skillId || null,
    executedParams: executed[0]?.params || null,
    preflightStatus: preflight?.status || null,
    modelPurposes,
    steps
  };
  const report = writeReport(payload);

  if (!payload.success) {
    console.error(`SKU design preflight smoke failed. Report: ${report.json}`);
    console.error(JSON.stringify({
      resultSuccess: payload.resultSuccess,
      resultError: payload.resultError,
      executedSkill: payload.executedSkill,
      preflightStatus: payload.preflightStatus,
      modelPurposes: payload.modelPurposes
    }, null, 2));
    process.exit(1);
  }

  console.log(`SKU design preflight smoke passed. Report: ${report.json}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
