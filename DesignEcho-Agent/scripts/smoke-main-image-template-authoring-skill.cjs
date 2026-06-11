const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  buildMainImageTemplateBlueprint,
  buildMainImageTemplateAuthoringSummary
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-skills', 'main-image-template-authoring.skill.ts'));
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
  const input = '帮我创建主图文档 并且建立主图模板';
  const route = fastDeterministicRoute(input);
  record('route-main-image-template-authoring', route && route.skillId === 'main-image-template-authoring', route);

  const blueprint = buildMainImageTemplateBlueprint({
    userIntent: '帮我创建一个桑蚕丝袜子的主图模板，做点击主图，800尺寸'
  });
  const blueprintText = JSON.stringify(blueprint);
  record(
    'blueprint-shape',
    blueprint.document.width === 800
      && blueprint.document.height === 800
      && blueprint.shapes.length >= 3
      && blueprint.copies.length >= 3,
    {
      document: blueprint.document,
      imageType: blueprint.imageType,
      density: blueprint.density,
      shapes: blueprint.shapes.map((shape) => ({ name: shape.name, role: shape.role })),
      copies: blueprint.copies.map((copy) => ({ name: copy.name, role: copy.role }))
    }
  );
  record(
    'blueprint-does-not-expose-ungrounded-confidence',
    !blueprintText.includes('confidence') && !blueprintText.includes('置信'),
    { textLength: blueprintText.length }
  );

  const summary = buildMainImageTemplateAuthoringSummary(blueprint).join('\n');
  record('summary-content', summary.includes('主图模板已创建') && summary.includes('文档尺寸'), summary);
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

const jsonPath = path.join(tmpDir, 'main-image-template-authoring-skill-smoke.json');
const mdPath = path.join(tmpDir, 'main-image-template-authoring-skill-smoke.md');
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
fs.writeFileSync(
  mdPath,
  [
    '# Main Image Template Authoring Skill Smoke',
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
