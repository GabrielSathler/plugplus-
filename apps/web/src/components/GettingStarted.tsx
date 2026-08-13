import { useQuery } from '@tanstack/react-query';
import { Check, CreditCard, Landmark, Repeat, Upload } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../lib/api';
import type { AccountRow, CreditCardRow } from '../lib/types';
import { ImportStatementDialog } from './ImportStatementDialog';
import { AccountForm } from './forms/AccountForm';
import { CreditCardForm } from './forms/CreditCardForm';
import { RecurrenceForm } from './forms/RecurrenceForm';

/**
 * Primeiros passos.
 *
 * Um workspace novo abre com tudo zerado — e zero não é informação, é um beco
 * sem saída. Pior: o formulário de lançamento exige uma conta ou cartão, e sem
 * tela para criar nenhum dos dois a pessoa fica presa olhando "R$ 0".
 *
 * A ORDEM DOS PASSOS não é arbitrária, ela segue a dependência real: sem conta
 * não há onde lançar; sem cartão não há fatura para projetar; sem recorrência a
 * projeção não tem o que projetar e o gráfico fica reto. Cada passo destrava o
 * seguinte.
 */
export function GettingStarted() {
  const [dialog, setDialog] = useState<'account' | 'card' | 'recurrence' | 'import' | null>(null);

  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get<AccountRow[]>('/accounts'),
  });
  const cards = useQuery({
    queryKey: ['credit-cards'],
    queryFn: () => api.get<CreditCardRow[]>('/credit-cards'),
  });
  const recurrences = useQuery({
    queryKey: ['recurrences'],
    queryFn: () => api.get<{ id: string }[]>('/recurrences'),
  });

  const hasAccount = (accounts.data ?? []).length > 0;
  const hasCard = (cards.data ?? []).length > 0;
  const hasRecurrence = (recurrences.data ?? []).length > 0;

  const steps = [
    {
      key: 'account' as const,
      icon: <Landmark className="size-4" />,
      title: 'Cadastre uma conta',
      body: 'Onde o dinheiro entra e sai. É o mínimo para lançar qualquer coisa.',
      done: hasAccount,
      cta: 'Nova conta',
    },
    {
      key: 'card' as const,
      icon: <CreditCard className="size-4" />,
      title: 'Adicione um cartao',
      body: 'Com fechamento e vencimento, o Cardinal projeta a fatura sozinho.',
      done: hasCard,
      cta: 'Novo cartao',
      // Cartão precisa de conta para debitar a fatura; sem ela o cadastro fica
      // incompleto e a projeção não sabe de onde tirar o dinheiro.
      blocked: !hasAccount,
    },
    {
      key: 'recurrence' as const,
      icon: <Repeat className="size-4" />,
      title: 'Informe o que se repete',
      body: 'Salario, aluguel, escola. Sem isso a projeção não tem o que projetar.',
      done: hasRecurrence,
      cta: 'Nova recorrencia',
      blocked: !hasAccount,
    },
    {
      key: 'import' as const,
      icon: <Upload className="size-4" />,
      title: 'Traga seu extrato',
      body: 'PDF, OFX ou CSV do banco. Você revisa antes de qualquer coisa entrar.',
      done: false,
      cta: 'Importar extrato',
      blocked: !hasAccount,
      optional: true,
    },
  ];

  const completed = steps.filter((step) => step.done).length;

  return (
    <>
      <div className="card p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight">Vamos comecar</h2>
            <p className="mt-1 text-[13px] text-[var(--color-muted)]">
              Tres passos e o painel para de mostrar zeros.
            </p>
          </div>
          <span className="num text-[12px] text-[var(--color-muted)]">
            {completed} de 3 concluidos
          </span>
        </div>

        <div className="mb-5 h-1 overflow-hidden rounded-full bg-[var(--color-line)]">
          <div
            className="h-full rounded-full bg-[var(--color-teal)] transition-[width] duration-500"
            style={{ width: `${(completed / 3) * 100}%` }}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {steps.map(({ key, ...step }) => (
            <StepCard key={key} {...step} onStart={() => setDialog(key)} />
          ))}
        </div>
      </div>

      <AccountForm open={dialog === 'account'} onClose={() => setDialog(null)} />
      <CreditCardForm open={dialog === 'card'} onClose={() => setDialog(null)} />
      <RecurrenceForm open={dialog === 'recurrence'} onClose={() => setDialog(null)} />
      <ImportStatementDialog
        open={dialog === 'import'}
        onClose={() => setDialog(null)}
        accounts={accounts.data ?? []}
      />
    </>
  );
}

function StepCard({
  icon,
  title,
  body,
  done,
  cta,
  blocked,
  optional,
  onStart,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  done: boolean;
  cta: string;
  blocked?: boolean;
  optional?: boolean;
  onStart: () => void;
}) {
  return (
    <div
      className={
        done
          ? 'rounded-[var(--radius-control)] border border-[var(--color-teal-line)] bg-[var(--color-teal-soft)] p-4'
          : 'rounded-[var(--radius-control)] border border-[var(--color-line)] p-4'
      }
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className={
            done
              ? 'grid size-7 place-items-center rounded-lg bg-[var(--color-teal)] text-white'
              : 'grid size-7 place-items-center rounded-lg bg-[var(--color-surface-sunken)] text-[var(--color-muted)]'
          }
        >
          {done ? <Check className="size-4" strokeWidth={3} /> : icon}
        </span>
        <span className="text-[13px] font-semibold">{title}</span>
        {optional && !done && (
          <span className="num rounded bg-[var(--color-surface-sunken)] px-1.5 py-0.5 text-[9px] tracking-wider text-[var(--color-muted)] uppercase">
            opcional
          </span>
        )}
      </div>

      <p className="mb-3 text-[12px] leading-relaxed text-[var(--color-text-secondary)]">{body}</p>

      {done ? (
        <span className="text-[12px] font-medium text-[var(--color-teal)]">Pronto</span>
      ) : (
        <button
          type="button"
          onClick={onStart}
          disabled={blocked}
          title={blocked ? 'Cadastre uma conta primeiro' : undefined}
          className="rounded-full bg-[var(--color-ink)] px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#2a2a30] disabled:cursor-not-allowed disabled:bg-[var(--color-line-strong)]"
        >
          {cta}
        </button>
      )}
    </div>
  );
}
