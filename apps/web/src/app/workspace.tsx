import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { addMonthsToYearMonth, today as todayIn, toYearMonth, type YearMonth } from '@finflow/shared';
import { useAuth } from './auth';
import type { Session } from '../lib/types';

/**
 * Estado do workspace: a COMPETÊNCIA selecionada no header.
 *
 * O mês vive aqui, e não em cada tela, porque o seletor é global: o usuário
 * escolhe "agosto" uma vez e navega entre Visão geral, Cartão e Projeções sem
 * reescolher. Guardar o mês por tela quebraria essa continuidade, que é o
 * principal gesto de navegação do produto.
 *
 * A SESSÃO vem do AuthProvider, não de uma busca própria: duas fontes para o
 * mesmo dado divergem no instante em que uma atualiza e a outra não.
 */

interface WorkspaceValue {
  session: Session | null;
  isLoading: boolean;
  month: YearMonth;
  setMonth: (month: YearMonth) => void;
  shiftMonth: (delta: number) => void;
  /** Mês real de hoje — o seletor não deve ir muito além dele. */
  currentMonth: YearMonth;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const currentMonth = useMemo(() => toYearMonth(todayIn()) as YearMonth, []);
  const [month, setMonth] = useState<YearMonth>(currentMonth);
  const { session, status } = useAuth();

  const value = useMemo<WorkspaceValue>(
    () => ({
      session,
      isLoading: status === 'checking',
      month,
      setMonth,
      shiftMonth: (delta: number) => setMonth((current) => addMonthsToYearMonth(current, delta)),
      currentMonth,
    }),
    [session, status, month, currentMonth],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace precisa estar dentro de WorkspaceProvider.');
  return context;
}
