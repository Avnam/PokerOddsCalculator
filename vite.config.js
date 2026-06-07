import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import obfuscator from 'vite-plugin-obfuscator';

export default defineConfig({
  plugins: [
    react(),
    obfuscator({
      include: ['src/**/*.jsx', 'src/**/*.js'],
      options: {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.5,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.2,
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals: false,
        stringArray: true,
        stringArrayThreshold: 0.5,
        stringArrayEncoding: ['base64'],
        splitStrings: true,
        splitStringsChunkLength: 5,
        transformObjectKeys: true,
        unicodeEscapeSequence: false,
      },
    }),
  ],
  base: './',
  build: {
    outDir: 'dist',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
      mangle: {
        toplevel: true,
      },
    },
  },
});
