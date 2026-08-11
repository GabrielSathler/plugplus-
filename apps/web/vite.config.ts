import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // O front consome @finflow/shared pelo FONTE, nao pelo dist.
      //
      // O dist e CommonJS (o Nest precisa disso) e o Rollup nao enxerga os
      // named exports atraves do `__exportStar` que o tsc gera — o build quebra
      // em "X is not exported by dist/index.js". Alem de resolver isso, apontar
      // para o fonte da HMR quando o motor de dominio muda e elimina o passo
      // "esqueci de rebuildar o shared".
      '@finflow/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    // Porta exclusiva deste projeto. A 5173 padrao do Vite ja e disputada por
    // outros repositorios na mesma maquina, e quando ela esta ocupada o Vite
    // sobe em outra sem avisar direito — voce acaba olhando a aplicacao errada.
    port: 5273,
    strictPort: true,
    // O front chama `/api/...` em caminho relativo e o Vite encaminha para o
    // Nest. Evita CORS no desenvolvimento e faz o build de producao funcionar
    // atras de qualquer reverse proxy sem recompilar a URL da API.
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3333',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Recharts e React quase nunca mudam entre deploys; separa-los do
        // codigo da aplicacao faz o navegador reaproveitar o cache em vez de
        // rebaixar 700 kB a cada correcao de tela.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
        },
      },
    },
  },
});
