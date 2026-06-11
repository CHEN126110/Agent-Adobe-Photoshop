const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const routing = require(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'agent-orchestration',
  'routing.ts'
));

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'detail-page-document-preflight-routing-smoke.json');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  return jsonPath;
}

function pass(condition, details) {
  return { status: condition ? 'pass' : 'fail', details };
}

function run() {
  const ambiguousText = '看看这个模板有没有问题';
  const noEvidenceRoute = routing.fastDeterministicRoute(ambiguousText);
  const currentDocumentTemplateRoute = routing.fastDeterministicRoute(ambiguousText, {
    detailPageTemplateDetected: true,
    detailPageTemplateScreenCount: 14,
    detailPageTemplateIssueCodes: ['detail_container_detected', 'screen_bounds_repaired']
  });

  const engineSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'),
    'utf8'
  );

  const cases = [
    {
      name: 'ambiguous-template-inspection-does-not-route-without-document-evidence',
      ...pass(noEvidenceRoute === null, { noEvidenceRoute })
    },
    {
      name: 'current-detail-template-evidence-routes-to-detail-page-inspect',
      ...pass(
        currentDocumentTemplateRoute?.skillId === 'detail-page-design'
          && currentDocumentTemplateRoute?.skillParams?.structureMode === 'inspect'
          && currentDocumentTemplateRoute?.skillParams?.inspectOnly === true
          && currentDocumentTemplateRoute?.skillParams?.inferredFromCurrentDocument === true
          && currentDocumentTemplateRoute?.skillParams?.detailPageTemplateScreenCount === 14,
        { currentDocumentTemplateRoute }
      )
    },
    {
      name: 'engine-builds-current-document-structure-preflight-before-routing',
      ...pass(
        engineSource.includes('buildCurrentDocumentStructureRouteOptions')
          && engineSource.includes('documentStructureRouteOptions')
          && engineSource.includes('...documentStructureRouteOptions'),
        {
          hasPreflightBuilder: engineSource.includes('buildCurrentDocumentStructureRouteOptions'),
          passesPreflightOptions: engineSource.includes('...documentStructureRouteOptions')
        }
      )
    }
  ];

  const success = cases.every((item) => item.status === 'pass');
  const report = writeReport({ success, cases });
  console.log(JSON.stringify({ success, cases, report }, null, 2));
  process.exit(success ? 0 : 1);
}

run();
