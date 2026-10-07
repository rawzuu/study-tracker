import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` musí odpovídat názvu repa, protože GitHub Pages servíruje stránku na /study-tracker/
export default defineConfig({
  base: '/study-tracker/',
  plugins: [react()],
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
