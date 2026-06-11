const path = require('path');

module.exports = (_env, argv = {}) => {
    const mode = argv.mode === 'production' ? 'production' : 'development';

    return {
        mode,
        entry: {
            runtime: './src/index.ts',
            index: './src/index.ts'
        },
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: '[name].js',
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
        // Keep both historical and manifest entry bundles current. Some loaded
        // Photoshop sessions have been observed to execute dist/index.js.
        performance: {
            hints: false
        },
        devtool: 'source-map'
    };
};
