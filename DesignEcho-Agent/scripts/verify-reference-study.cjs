// 看参考纯逻辑测试：提示含目的与七问；解析好坏 / 做法 / 改进 / 起手式区域（越界与非法角色被丢）/ 沉淀；坏输出不伪造。
const path = require('path');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const { buildReferenceStudyPrompt, parseReferenceStudy, renderReferenceStudy } = require(path.join(root, 'src/shared/design-workshop/reference-study.ts'));

let failed = 0;
function check(name, condition, detail) { if (condition) { console.log(`✅ ${name}`); return; } failed += 1; console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); }

const prompt = buildReferenceStudyPrompt({ purpose: '找网感风格的点击图参考', deliverable: '点击图', productContext: '木耳边微压中筒袜' });
check('提示含目的 / 交付物 / 产品背景 / 七问', /网感/.test(prompt) && /点击图/.test(prompt) && /木耳边/.test(prompt) && /suggestedRegions/.test(prompt) && /takeaways/.test(prompt));

const parsed = parseReferenceStudy(JSON.stringify({
    summary: '大留白冷调网感海报',
    strengths: ['标题住左上只占 40% 宽', '主体右下占七成'],
    weaknesses: ['卖点行字距太松'],
    howItWasMade: { composition: '左上文右下图', palette: ['#F2F2F2', '#111111', 'bad'], typography: '细黑体大字距', background: '纯灰渐变', subjectTreatment: '抠图加软投影' },
    improvements: ['字体换圆黑体呼应木耳边'],
    suggestedRegions: [
        { role: 'title', content: '主标题', bounds: { x: 0.06, y: 0.08, width: 0.4, height: 0.2 }, hAlign: 'left' },
        { role: 'main-image', content: '主体', bounds: { x: 0.5, y: 0.2, width: 0.45, height: 0.7 } },
        { role: 'weird', content: 'x', bounds: { x: 0, y: 0, width: 0.1, height: 0.1 } },
        { role: 'tag', content: '标签', bounds: { x: 0.9, y: 0.9, width: 0.3, height: 0.3 } }
    ],
    takeaways: ['标题住留白只占四成宽', '主体大而清']
}), 'm');
check('解析好坏 / 做法 / 改进', parsed.strengths.length === 2 && parsed.weaknesses.length === 1 && parsed.improvements[0].includes('圆黑体'));
check('色板只保留合法 HEX', parsed.howItWasMade.palette.length === 2);
check('起手式区域丢弃非法角色与越界', parsed.suggestedRegions.length === 2 && parsed.suggestedRegions[1].role === 'main-image');
check('沉淀 takeaways', parsed.takeaways.length === 2);
check('渲染文本含四段', /好在：/.test(renderReferenceStudy(parsed)) && /怎么做的：/.test(renderReferenceStudy(parsed)) && /沉淀：/.test(renderReferenceStudy(parsed)));

const bad = parseReferenceStudy('看着还行');
check('无法解析时不伪造', bad.summary === '' && bad.suggestedRegions.length === 0 && /无法解析/.test(bad.improvements[0]));

if (failed > 0) { console.log(`\n${failed} 项失败`); process.exit(1); }
console.log('\n全部通过');
