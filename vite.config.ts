import { defineConfig } from 'vite';

// GitHub Pages serves the project from https://<user>.github.io/zoo-game/, so asset URLs need that prefix.
export default defineConfig({
  base: '/zoo-game/',
});
