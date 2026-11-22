import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts', auto: 'src/auto.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'es2020',
  },
  {
    entry: { 'api-pingpong': 'src/global.ts', 'api-pingpong.auto': 'src/global-auto.ts' },
    format: ['iife'],
    globalName: 'ApiPingPong',
    minify: true,
    target: 'es2018',
    outExtension: () => ({ js: '.global.js' }),
  },
]);
