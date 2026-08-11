import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { WorkspaceProvider } from './app/workspace';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Dado financeiro nao muda sozinho no meio de uma sessao de leitura;
      // refetch a cada foco de janela so gera piscada de tela.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <WorkspaceProvider>
          <App />
        </WorkspaceProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
