import clsx from 'clsx';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Plus,
  Settings,
  TrendingUp,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { monthLong } from '../lib/format';
import { useAuth } from '../app/auth';
import { useWorkspace } from '../app/workspace';
import { NewTransactionDialog } from './NewTransactionDialog';

/**
 * Navegacao por ABAS NO TOPO, nao por sidebar lateral.
 *
 * Foi a escolha certa para este produto: as secoes sao IRMAS (nenhuma contem a
 * outra), a largura toda fica para tabelas de doze colunas e graficos de doze
 * meses, e o contexto global — mes e workspace — mora na mesma faixa que a
 * navegacao, deixando claro que ele vale para todas as telas.
 *
 * A ordem agrupa por intencao: acompanhar o que passou, planejar o que vem,
 * configurar a base. "Planos" fica ao lado de "Projecoes" porque um alimenta o
 * outro — o que voce programa muda a projecao na hora.
 */

const TABS = [
  { to: '/visao-geral', label: 'Visao geral' },
  { to: '/cartao-de-credito', label: 'Cartao de credito' },
  { to: '/conta-corrente', label: 'Conta corrente' },
  { to: '/projecoes', label: 'Projecoes' },
  { to: '/planos', label: 'Planos' },
  { to: '/transacoes', label: 'Transacoes' },
  { to: '/orcamentos', label: 'Orcamentos' },
  { to: '/contas', label: 'Contas' },
  { to: '/cenarios', label: 'Cenarios' },
  { to: '/alertas', label: 'Alertas' },
  { to: '/ajustes', label: 'Ajustes' },
];

export function AppShell() {
  const { session, month, shiftMonth, setMonth, currentMonth } = useWorkspace();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--color-canvas)]">
      <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-6 pt-4 pb-3">
          <a href="/visao-geral" className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-lg bg-[var(--color-teal-bright)]">
              <TrendingUp className="size-4 text-white" strokeWidth={2.5} />
            </span>
            <span className="text-[15px] font-bold tracking-tight text-[var(--color-text)]">
              Cardinal
            </span>
          </a>
          {session && (
            <span className="num rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-[var(--color-teal)]">
              {session.organization.badge}
            </span>
          )}

          <div className="ml-auto flex items-center gap-2.5">
            <MonthPicker
              month={month}
              currentMonth={currentMonth}
              onShift={shiftMonth}
              onReset={() => setMonth(currentMonth)}
            />

            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-ink)] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#2a2a30]"
            >
              <Plus className="size-4" strokeWidth={2.5} />
              Novo lancamento
            </button>

            <UserMenu />
          </div>
        </div>

        <nav aria-label="Secoes" className="mx-auto max-w-[1400px] px-6">
          <ul className="-mb-px flex items-center gap-1 overflow-x-auto">
            {TABS.map((tab) => (
              <li key={tab.to}>
                <NavLink
                  to={tab.to}
                  className={({ isActive }) =>
                    clsx(
                      'inline-block border-b-2 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors',
                      isActive
                        ? 'border-[var(--color-teal)] text-[var(--color-teal)]'
                        : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
                    )
                  }
                >
                  {tab.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-6">
        <Outlet />
      </main>

      <NewTransactionDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}

/**
 * Seletor de mes com navegacao por setas.
 *
 * O rotulo tambem e botao: clicar volta para o mes corrente. Sem isso, quem
 * navegou seis meses para tras precisa clicar seis vezes para voltar ao hoje —
 * um beco sem saida classico em seletores de competencia.
 */
function MonthPicker({
  month,
  currentMonth,
  onShift,
  onReset,
}: {
  month: string;
  currentMonth: string;
  onShift: (delta: number) => void;
  onReset: () => void;
}) {
  const isCurrent = month === currentMonth;

  return (
    <div className="flex items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)]">
      <button
        type="button"
        onClick={() => onShift(-1)}
        aria-label="Mes anterior"
        className="grid size-8 place-items-center rounded-l-full text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
      >
        <ChevronLeft className="size-4" />
      </button>

      <button
        type="button"
        onClick={onReset}
        title={isCurrent ? 'Mes corrente' : 'Voltar para o mes corrente'}
        className="flex items-center gap-1.5 px-1 py-1.5 text-[13px] font-medium text-[var(--color-text)]"
      >
        <Calendar className="size-3.5 text-[var(--color-muted)]" />
        <span className="whitespace-nowrap">{monthLong(month)}</span>
        {!isCurrent && (
          <span className="size-1.5 rounded-full bg-[var(--color-warning)]" aria-hidden="true" />
        )}
      </button>

      <button
        type="button"
        onClick={() => onShift(1)}
        aria-label="Proximo mes"
        className="grid size-8 place-items-center rounded-r-full text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

/**
 * Avatar com menu de conta.
 *
 * O botao de sair precisa estar sempre a um clique: quem usa em maquina
 * compartilhada tem que conseguir encerrar a sessao sem procurar.
 */
function UserMenu() {
  const { session, logout } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={session?.user.name}
        className="grid size-8 place-items-center rounded-full bg-[var(--color-surface-sunken)] text-[11px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-line)]"
      >
        {session?.user.initials ?? '··'}
      </button>

      {open && (
        <>
          {/* Camada invisivel que fecha o menu ao clicar fora, sem listener global. */}
          <button
            type="button"
            aria-label="Fechar menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="card absolute right-0 z-50 mt-2 w-56 p-1.5 shadow-lg"
          >
            <div className="border-b border-[var(--color-line)] px-2.5 py-2">
              <p className="truncate text-[13px] font-medium">{session?.user.name}</p>
              <p className="truncate text-[11px] text-[var(--color-muted)]">
                {session?.user.email}
              </p>
            </div>
            <NavLink
              to="/ajustes"
              onClick={() => setOpen(false)}
              className="mt-1 flex items-center gap-2 rounded-[6px] px-2.5 py-2 text-[13px] hover:bg-[var(--color-surface-sunken)]"
            >
              <Settings className="size-3.5 text-[var(--color-muted)]" />
              Ajustes
            </NavLink>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-[13px] text-[var(--color-negative)] hover:bg-[var(--color-negative-soft)]"
            >
              <LogOut className="size-3.5" />
              Sair
            </button>
          </div>
        </>
      )}
    </div>
  );
}
