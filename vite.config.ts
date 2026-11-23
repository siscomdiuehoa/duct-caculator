import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative base so the build works under any path (siscom.vn/duct, GitHub Pages, Capacitor).
export default defineConfig({ base: './', plugins: [react()] });
