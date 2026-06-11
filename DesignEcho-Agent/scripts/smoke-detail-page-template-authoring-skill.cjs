const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  buildDetailPageTemplateBlueprint,
  buildDetailPageTemplateAuthoringSummary
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-skills', 'detail-page-template-authoring.skill.ts'));
const {
  fastDeterministicRoute
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));

const tmpDir = path.resolve(__dirname, '..', 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const cases = [];

function record(name, passed, details) {
  cases.push({ name, status: passed ? 'pass' : 'fail', details });
}

try {
  const input = '帮我新建一个详情页文档然后帮我制作一个详情页模板吧';
  const route = fastDeterministicRoute(input);
  record('route-template-authoring', route && route.skillId === 'detail-page-template-authoring', route);

  const blueprint = buildDetailPageTemplateBlueprint({
    userIntent: '帮我为桑蚕丝木耳边袜子新建一个详情页模板，做 6 屏',
    screenCount: 6
  });
  record(
    'blueprint-shape',
    blueprint.document.width === 790
      && blueprint.screens.length === 6
      && blueprint.screens.every((screen) => screen.copies.length > 0)
      && blueprint.screens.every((screen) => screen.images.length + screen.icons.length > 0),
    {
      document: blueprint.document,
      screens: blueprint.screens.map((screen) => ({
        name: screen.name,
        role: screen.screenRole,
        copies: screen.copies.length,
        images: screen.images.length,
        icons: screen.icons.length
      }))
    }
  );

  const summary = buildDetailPageTemplateAuthoringSummary(blueprint).join('\n');
  record('summary-content', summary.includes('详情页模板已创建') && summary.includes('屏数：6'), summary);
} catch (error) {
  record('unexpected-exception', false, {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : null
  });
}

const failed = cases.filter((item) => item.status !== 'pass');
const report = {
  generatedAt: new Date().toISOString(),
  success: failed.length === 0,
  cases
};

const jsonPath = path.join(tmpDir, 'detail-page-template-authoring-skill-smoke.json');
const mdPath = path.join(tmpDir, 'detail-page-template-authoring-skill-smoke.md');
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
fs.writeFileSync(
  mdPath,
  [
    '# Detail Page Template Authoring Skill Smoke',
    '',
    `success: ${report.success}`,
    '',
    ...cases.map((item) => `- ${item.name}: ${item.status}`)
  ].join('\n'),
  'utf8'
);

console.log(JSON.stringify({
  success: report.success,
  cases: cases.map(({ name, status }) => ({ name, status })),
  report: { json: jsonPath, md: mdPath }
}, null, 2));

process.exit(report.success ? 0 : 1);
