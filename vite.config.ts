/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import {readFile} from 'node:fs/promises';

export default defineConfig({
  // Relative asset paths so the build also works from a desktop wrapper or a sub-folder.
  base: './',
  plugins:[{
    name:'arena-weapon-motion',
    enforce:'pre',
    async load(id){
      if(!id.endsWith('.awm'))return;
      const bytes=await readFile(id);
      return `export default Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}), c => c.charCodeAt(0));`;
    },
  }],
  build: {
    rollupOptions: {
      input: { game: 'index.html' },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
