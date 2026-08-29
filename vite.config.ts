import tailwindcss from '@tailwindcss/vite';
import { sites } from '@openai/sites-vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/bar-misaki-lottery/' : '/',
  plugins: [react(), tailwindcss(), sites()],
});
