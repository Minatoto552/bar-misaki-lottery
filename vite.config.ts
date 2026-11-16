import tailwindcss from '@tailwindcss/vite';
import { sites } from '@openai/sites-vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/bar-misaki-lottery/' : '/',
  plugins: [react(), tailwindcss(), sites()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) =>
          id.includes('node_modules/framer-motion') || id.includes('node_modules/motion-')
            ? 'motion'
            : id.includes('node_modules/react-router') || id.includes('node_modules/@remix-run')
              ? 'router'
              : undefined,
      },
    },
  },
});
