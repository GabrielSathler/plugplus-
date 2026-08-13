import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './app/auth';
import { WorkspaceProvider } from './app/workspace';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Dado financeiro nao muda sozinho no meio de uma sessao de leitura;
      // refetch a cada foco de janela so gera piscada de tela.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      // Uma unica tentativa, e nunca em 401: o cliente HTTP ja renova o token
      // e repete sozinho. Insistir aqui multiplicaria chamadas na renovacao.
      retry: (failureCount, error) => {
        const status = (error as { status?: number })?.status;
        if (status === 401 || status === 403) return false;
        return failureCount < 1;
      },
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* AuthProvider por fora: o Workspace so faz sentido depois de existir
            sessao, e e o Auth que decide se ha uma. */}
        <AuthProvider>
          <WorkspaceProvider>
            <App />
          </WorkspaceProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
