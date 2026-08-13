import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { api, refreshSession, SESSION_EXPIRED } from '../lib/api';
import type { Session } from '../lib/types';

/**
 * Estado de autenticação.
 *
 * `status` tem TRÊS valores, e a distinção importa: `checking` é o intervalo
 * entre abrir o app e saber se o cookie de refresh ainda vale. Tratar isso como
 * "deslogado" jogaria quem tem sessão válida para a tela de login por um
 * instante a cada F5 — o piscar clássico de app mal feito.
 */
type Status = 'checking' | 'authenticated' | 'anonymous';

interface AuthValue {
  status: Status;
  session: Session | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    name: string;
    email: string;
    password: string;
    workspaceName?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking');
  const [session, setSession] = useState<Session | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const loadSession = useCallback(async () => {
    const me = await api.get<Session>('/auth/me');
    setSession(me);
    setStatus('authenticated');
  }, []);

  // Ao abrir o app não existe access token em memória — ele nunca é persistido.
  // A sessão é reconstruída a partir do cookie httpOnly de refresh.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const renewed = await refreshSession();
      if (cancelled) return;
      if (!renewed) {
        setStatus('anonymous');
        return;
      }
      try {
        await loadSession();
      } catch {
        if (!cancelled) setStatus('anonymous');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadSession]);

  // O cliente HTTP avisa quando a renovação falhou de vez — inclusive no caso
  // de reuso de token detectado, em que o servidor derruba a sessão inteira.
  useEffect(() => {
    const onExpired = () => {
      setSession(null);
      setStatus('anonymous');
      queryClient.clear();
      navigate('/entrar', { replace: true });
    };
    window.addEventListener(SESSION_EXPIRED, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED, onExpired);
  }, [navigate, queryClient]);

  /** Depois de autenticar os cookies já vieram na resposta; falta ler a sessão. */
  const adopt = useCallback(async () => {
    // Cache do usuário anterior não pode sobreviver a uma troca de conta.
    queryClient.clear();
    await loadSession();
  }, [loadSession, queryClient]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      session,
      login: async (email, password) => {
        await api.post('/auth/login', { email, password });
        await adopt();
      },
      register: async (input) => {
        await api.post('/auth/register', input);
        await adopt();
      },
      logout: async () => {
        /*
         * A ORDEM AQUI É O QUE FAZ O LOGOUT SER INSTANTÂNEO.
         *
         * A versão anterior limpava o cache ANTES de navegar, com as telas do
         * app ainda montadas. Limpar o cache faz cada consulta ativa refazer a
         * busca na hora; sem sessão, todas tomavam 401, cada uma tentava
         * renovar, e o usuário ficava olhando uma tela travada enquanto uma
         * dúzia de requisições condenadas ia e voltava do banco.
         *
         * Agora: cancela o que está em voo, desmonta o app trocando o status,
         * navega — e só então limpa o cache, quando não há mais ninguém
         * observando para disparar refetch. A chamada de logout no servidor
         * não é esperada: ela revoga o token, mas a saída do usuário não
         * depende dela terminar.
         */
        void queryClient.cancelQueries();

        setSession(null);
        setStatus('anonymous');
        navigate('/entrar', { replace: true });

        // Sem `await`: o usuário já saiu da tela. Falhar aqui só significa que
        // o refresh continua válido no servidor até expirar — e o cookie já
        // foi embora do navegador de qualquer forma.
        void api.post('/auth/logout').catch(() => undefined);

        queryClient.clear();
      },
    }),
    [status, session, adopt, navigate, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth precisa estar dentro de AuthProvider.');
  return context;
}
