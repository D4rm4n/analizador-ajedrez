import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relativa para poder alojar el sitio en cualquier subcarpeta (GitHub Pages, Netlify...)
export default defineConfig({
  base: './',
  plugins: [react()],
  preview: { host: '0.0.0.0', port: 4173 },
});
