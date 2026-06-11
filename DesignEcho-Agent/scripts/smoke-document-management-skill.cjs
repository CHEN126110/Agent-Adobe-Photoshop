const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  fastDeterministicRoute
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));
const {
  getSkillById
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skills', 'skill-declarations.ts'));

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
    const outDir = path.join(__dirname, '..', 'tmp');
    ensureDir(outDir);
    const jsonPath = path.join(outDir, 'document-management-skill-smoke.json');
    const mdPath = path.join(outDir, 'document-management-skill-smoke.md');
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

    const lines = [
        '# Document Management Skill Smoke',
        '',
        `- success: ${payload.success}`,
        ''
    ];

    for (const testCase of payload.cases) {
        lines.push(`## ${testCase.name}`);
        lines.push(`- status: ${testCase.status}`);
        if (testCase.details) {
            lines.push(`- details: ${testCase.details}`);
        }
        lines.push('');
    }

    fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
    return { json: jsonPath, md: mdPath };
}

const commonMojibakeFragments = [
    0xfffd,
    0x95ab,
    0x9359,
    0x6d93,
    0x9428,
    0x7ecb,
    0x93b6,
    0x9352,
    0x9365,
    0x20ac
].map((codePoint) => String.fromCodePoint(codePoint));

function hasCommonMojibake(text) {
    return commonMojibakeFragments.some((fragment) => text.includes(fragment));
}

function run() {
    const cases = [];

    const input = '帮我关闭文档不保存';
    const route = fastDeterministicRoute(input);
    cases.push({
        name: 'route-document-close',
        status:
            route
            && route.skillId === 'document-management'
            && route.skillParams
            && route.skillParams.action === 'close'
            && route.skillParams.save === false
                ? 'pass'
                : 'fail',
        details: route ? JSON.stringify(route.skillParams) : 'no route'
    });

    const skill = getSkillById('document-management');
    cases.push({
        name: 'skill-declaration',
        status:
            skill
            && Array.isArray(skill.requiredTools)
            && skill.requiredTools.includes('closeDocument')
            && skill.requiredTools.includes('listDocuments')
                ? 'pass'
                : 'fail',
        details: skill ? JSON.stringify(skill.requiredTools) : 'missing skill'
    });

    const executorSource = fs.readFileSync(
        path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'document-management.executor.ts'),
        'utf8'
    );
    cases.push({
        name: 'document-executor-copy-is-readable',
        status:
            executorSource.includes('正在保存当前 Photoshop 文档。')
            && executorSource.includes('已关闭文档')
            && executorSource.includes('未知错误')
            && !hasCommonMojibake(executorSource)
                ? 'pass'
                : 'fail',
        details: JSON.stringify({
            hasSaveStatus: executorSource.includes('正在保存当前 Photoshop 文档。'),
            hasCloseMessage: executorSource.includes('已关闭文档'),
            hasUnknownError: executorSource.includes('未知错误'),
            hasCommonMojibake: hasCommonMojibake(executorSource)
        })
    });

    const success = cases.every((item) => item.status === 'pass');
    const payload = { success, cases };
    const report = writeReport(payload);
    console.log(JSON.stringify({ ...payload, report }, null, 2));
    process.exit(success ? 0 : 1);
}

run();
