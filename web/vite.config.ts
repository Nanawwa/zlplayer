import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'html-transform',
      transformIndexHtml(html) {
        // 替换 favicon 为内联 SVG，避免 404
        // 移除 crossorigin 属性，解决 file:// 协议下模块脚本被浏览器拦截的问题
        return html
          .replace(
            '<link rel="icon" type="image/svg+xml" href="/vite.svg" />',
            '<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎬</text></svg>" />'
          )
          .replace(/crossorigin/g, '');
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
});
