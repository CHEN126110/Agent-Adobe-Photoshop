import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM 模式下获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    plugins: [react()],
    base: './',
    root: 'src/renderer',
    build: {
        outDir: '../../dist/renderer',
        emptyOutDir: true,
        chunkSizeWarningLimit: 900,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules')) return;
                    if (
                        id.includes('react') ||
                        id.includes('react-dom') ||
                        id.includes('scheduler') ||
                        id.includes('use-sync-external-store')
                    ) return 'react-vendor';
                    if (id.includes('zustand')) return 'state-vendor';
                    return 'vendor';
                }
            }
        }
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src/renderer'),
            '@shared': path.resolve(__dirname, 'src/shared')
        }
    }
});
