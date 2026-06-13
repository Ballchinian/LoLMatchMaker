import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The dev server proxies /api -> the Express backend so the browser sees a single origin.
export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        port: 5173,
        proxy: {
        '/api': {
            target: 'http://localhost:4000',
            changeOrigin: true,
        },
        },
    },
});
