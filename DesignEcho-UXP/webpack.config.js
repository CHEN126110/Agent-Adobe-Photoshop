const path = require('path');
const webpack = require('webpack');
const {
    createRuntimeBuildIdentity,
    createRuntimeBuildManifest
} = require('./scripts/runtime-build-identity.cjs');

class LegacyIndexProxyPlugin {
    apply(compiler) {
        compiler.hooks.thisCompilation.tap('LegacyIndexProxyPlugin', (compilation) => {
            compilation.hooks.processAssets.tap(
                {
                    name: 'LegacyIndexProxyPlugin',
                    stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL
                },
                () => {
                    const { RawSource } = compiler.webpack.sources;
                    compilation.emitAsset(
                        'index.js',
                        new RawSource([
                            '\'use strict\';',
                            '// Compatibility shim for Photoshop sessions that still load dist/index.js.',
                            'module.exports = require(\'./runtime.js\');',
                            ''
                        ].join('\n'))
                    );
                }
            );
        });
    }
}

class RuntimeBuildManifestPlugin {
    constructor(runtimeBuildIdentity) {
        this.runtimeBuildIdentity = runtimeBuildIdentity;
    }

    apply(compiler) {
        compiler.hooks.thisCompilation.tap('RuntimeBuildManifestPlugin', (compilation) => {
            compilation.hooks.processAssets.tap(
                {
                    name: 'RuntimeBuildManifestPlugin',
                    stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT
                },
                () => {
                    const runtimeAsset = compilation.getAsset('runtime.js');
                    if (!runtimeAsset) {
                        throw new Error('UXP Runtime 构建缺少 runtime.js，无法生成可验证清单。');
                    }
                    const runtimeBuffer = Buffer.from(runtimeAsset.source.buffer());
                    const manifest = createRuntimeBuildManifest(
                        this.runtimeBuildIdentity,
                        runtimeBuffer
                    );
                    const { RawSource } = compiler.webpack.sources;
                    compilation.emitAsset(
                        'runtime-build-manifest.json',
                        new RawSource(`${JSON.stringify(manifest, null, 2)}\n`)
                    );
                }
            );
        });
    }
}

module.exports = (_env, argv = {}) => {
    const mode = argv.mode === 'production' ? 'production' : 'development';
    const uxpRoot = __dirname;
    const runtimeBuildIdentity = createRuntimeBuildIdentity({
        repoRoot: path.resolve(uxpRoot, '..'),
        uxpRoot,
        buildMode: mode
    });

    return {
        mode,
        entry: {
            runtime: './src/index.ts'
        },
        target: ['web', 'es2020'],
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: '[name].js',
            clean: true,
            library: {
                type: 'commonjs2'
            }
        },
        optimization: {
            splitChunks: false,
            runtimeChunk: false
        },
        resolve: {
            extensions: ['.ts', '.js'],
            alias: {
                '@': path.resolve(__dirname, 'src')
            }
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    use: {
                        loader: 'ts-loader',
                        options: {
                            transpileOnly: true,
                            compilerOptions: {
                                declaration: false,
                                declarationMap: false
                            }
                        }
                    },
                    exclude: /node_modules/
                },
                {
                    test: /\.css$/,
                    use: ['style-loader', 'css-loader']
                }
            ]
        },
        externals: {
            photoshop: 'commonjs2 photoshop',
            uxp: 'commonjs2 uxp'
        },
        plugins: [
            new webpack.DefinePlugin({
                __DESIGNECHO_UXP_RUNTIME_BUILD__: JSON.stringify(runtimeBuildIdentity)
            }),
            new LegacyIndexProxyPlugin(),
            new RuntimeBuildManifestPlugin(runtimeBuildIdentity)
        ],
        // UXP loads one plugin runtime bundle. Keep an explicit budget so growth
        // is visible without duplicating the runtime for the legacy index entry.
        performance: {
            hints: false,
            maxAssetSize: 700 * 1024,
            maxEntrypointSize: 700 * 1024
        },
        devtool: 'source-map'
    };
};
