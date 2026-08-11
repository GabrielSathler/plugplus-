import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { addMonthsToYearMonth, today as todayIn, toYearMonth, type YearMonth } from '@finflow/shared';
import { api } from '../lib/api';
import type { Session } from '../lib/types';

/**
 * Estado global do workspace: sessao e a COMPETENCIA selecionada.
 *
 * O mes vive aqui, e nao em cada tela, porque o seletor do header e global: o
 * usuario escolhe "Agosto" uma vez e navega entre Visao geral, Cartao e
 * Projecoes sem reescolher. Guardar o mes por tela quebraria essa continuidade,
 * que e o principal gesto de navegacao do produto.
 */

interface WorkspaceValue {
  session: Session | undefined;
  isLoading: boolean;
  month: YearMonth;
  setMonth: (month: YearMonth) => void;
  shiftMonth: (delta: number) => void;
  /** Mes real de hoje — o seletor nao deve ir muito alem dele. */
  currentMonth: YearMonth;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const currentMonth = useMemo(() => toYearMonth(todayIn()) as YearMonth, []);
  const [month, setMonth] = useState<YearMonth>(currentMonth);

  const { data: session, isLoading } = useQuery({
    queryKey: ['session'],
    queryFn: () => api.get<Session>('/auth/me'),
    staleTime: 5 * 60 * 1000,
  });

  const value = useMemo<WorkspaceValue>(
    () => ({
      session,
      isLoading,
      month,
      setMonth,
      shiftMonth: (delta: number) => setMonth((current) => addMonthsToYearMonth(current, delta)),
      currentMonth,
    }),
    [session, isLoading, month, currentMonth],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace precisa estar dentro de WorkspaceProvider.');
  return context;
}
