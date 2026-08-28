const path = require('path');

const agentRoot = path.resolve(__dirname, '..');
require('ts-node').register({
    transpileOnly: true,
    project: path.join(agentRoot, 'tsconfig.main.json')
});

const {
    runSkuPoseAlignmentTests
} = require(path.join(agentRoot, 'scripts/tests/sku-pose-alignment.test.ts'));
const {
    runSkuPoseAlignmentProviderTests
} = require(path.join(agentRoot, 'scripts/tests/sku-pose-alignment-provider.test.ts'));

async function run() {
    await runSkuPoseAlignmentTests();
    await runSkuPoseAlignmentProviderTests();
    console.log('\n全部通过');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
