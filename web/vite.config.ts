import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
    {
      name: 'html-transform',
      transformIndexHtml(html) {
        html = html.replace(
          '<link rel="icon" type="image/svg+xml" href="/vite.svg" />',
          '<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%233B82F6%22 stroke-width=%222%22><polygon points=%225 3 19 12 5 21 5 3%22/></svg>" />'
        );
        html = html.replace('</head>', '<meta name="referrer" content="no-referrer" /></head>');
        return html;
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
});
