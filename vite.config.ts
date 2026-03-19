import { wayfinder } from '@laravel/vite-plugin-wayfinder';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import laravel from 'laravel-vite-plugin';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
    plugins: [
        laravel({
            input: [
                'resources/css/app.css',
                'resources/js/app.tsx',
            ],
            ssr: 'resources/js/ssr.tsx',
            refresh: true,
        }),
        react({
            babel: {
                plugins: ['babel-plugin-react-compiler'],
            },
        }),
        tailwindcss(),
        wayfinder({
            formVariants: true,
        }),
    ],
    define: {
        '__APP_VERSION__': JSON.stringify(pkg.version),
    },
    esbuild: {
        jsx: 'automatic',
    },
    build: {
        chunkSizeWarningLimit: 3000,
        rollupOptions: {
            onwarn(warning, warn) {
                // Suppress pure comment warnings from ox library
                if (warning.message?.includes('contains an annotation that Rollup cannot interpret')) {
                    return;
                }
                warn(warning);
            },
        },
    },
});
