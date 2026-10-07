import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content Security Policy (jen v produkčním buildu – dev server potřebuje HMR přes WebSocket).
 * Stránka smí načítat jen vlastní skripty a komunikovat jen s GitHub API a s Anki na tomto počítači.
 * I kdyby se do stránky dostal cizí kód, token k GitHubu nemá kam odeslat.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.github.com http://127.0.0.1:8765 http://localhost:8765",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function csp(): Plugin {
  return {
    name: 'csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="referrer" content="no-referrer" />`),
  };
}

// `base` musí odpovídat názvu repa, protože GitHub Pages servíruje stránku na /study-tracker/
export default defineConfig({
  base: '/study-tracker/',
  plugins: [react(), csp()],
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Grafy zvlášť – mění se zřídka, prohlížeč je tak drží v cache i po updatu aplikace.
        manualChunks: { charts: ['echarts'] },
      },
    },
  },
});
