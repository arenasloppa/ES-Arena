/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build also works from a desktop wrapper or a sub-folder.
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
