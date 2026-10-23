/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Served from a subpath: https://www.iambaangkok.dev/block-grid-editor/
// A Cloudflare Worker route does not strip the path prefix, so assets are emitted into
// dist/block-grid-editor/ and wrangler serves the whole of dist/.
const BASE = '/block-grid-editor/'

export default defineConfig({
  base: BASE,
  plugins: [tailwindcss(), react()],
  build: {
    outDir: 'dist/block-grid-editor',
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
    globals: true,
    // .scratch holds reference material (e.g. proposed source), not part of the suite.
    exclude: ['**/node_modules/**', '**/dist/**', '.scratch/**'],
  },
})
