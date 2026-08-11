import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard as CreditCardIcon, Landmark, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { today as todayIn } from '@finflow/shared';
import { api, ApiError } from '../lib/api';
import { fullDate, monthTitle } from '../lib/format';
import type { AccountRow, CreditCardRow } from '../lib/types';
import { Button } from './ui';

interface CyclePreview {
  referenceMonth: string;
  closingDate: string;
  dueDate: string;
}

/**
 * Lancamento rapido.
 *
 * O que torna este formulario diferente de um CRUD generico e o PREVIEW DE
 * CICLO: ao escolher cartao e data, ele mostra em qual fatura a compra vai
 * cair. Comprar dia 29 num cartao que fecha dia 28 joga a despesa quase dois
 * meses para frente — o usuario precisa ver isso ANTES de salvar, nao descobrir
 * na fatura.
 */
export function NewTransactionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    description: '',
    amount: '',
    type: 'EXPENSE',
    source: 'CARD' as 'CARD' | 'ACCOUNT',
    creditCardId: '',
    accountId: '',
    categoryId: '',
    date: todayIn(),
    installments: 1,
  });
  const [error, setError] = useState<string | null>(null);

  const { data: cards } = useQuery({
    queryKey: ['credit-cards'],
    queryFn: () => api.get<CreditCardRow[]>('/credit-cards'),
    enabled: open,
  });
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get<AccountRow[]>('/accounts'),
    enabled: open,
  });
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ id: string; name: string; kind: string; color: string }[]>('/categories'),
    enabled: open,
  });

  // Preenche a primeira opcao assim que as listas chegam, para o formulario
  // nunca abrir com um select vazio que o usuario precisa descobrir.
  useEffect(() => {
    if (cards?.length && !form.creditCardId) {
      setForm((f) => ({ ...f, creditCardId: cards[0].id }));
    }
    if (accounts?.length && !form.accountId) {
      setForm((f) => ({ ...f, accountId: accounts[0].id }));
    }
  }, [cards, accounts, form.creditCardId, form.accountId]);

  const { data: cyclePreview } = useQuery({
    queryKey: ['cycle-preview', form.creditCardId, form.date],
    queryFn: () =>
      api.get<CyclePreview>('/transactions/preview-cycle', {
        cardId: form.creditCardId,
        date: form.date,
      }),
    enabled: open && form.source === 'CARD' && Boolean(form.creditCardId) && Boolean(form.date),
  });

  const mutation = useMutation({
    mutationFn: () => {
      const cents = Math.round(Number(form.amount.replace(/\./g, '').replace(',', '.')) * 100);
      return api.post('/transactions', {
        description: form.description,
        amount: cents,
        type: form.type,
        paymentMethod: form.source === 'CARD' ? 'CREDIT' : 'PIX',
        date: form.date,
        creditCardId: form.source === 'CARD' ? form.creditCardId : undefined,
        accountId: form.source === 'ACCOUNT' ? form.accountId : undefined,
        categoryId: form.categoryId || undefined,
        installments: form.source === 'CARD' ? Number(form.installments) : undefined,
      });
    },
    onSuccess: () => {
      // Invalida tudo: um lancamento novo muda KPIs, projecao, orcamento e fatura.
      void queryClient.invalidateQueries();
      setForm((f) => ({ ...f, description: '', amount: '', installments: 1 }));
      setError(null);
      onClose();
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel salvar o lancamento.');
    },
  });

  if (!open) return null;

  const relevantCategories = (categories ?? []).filter((category) =>
    form.type === 'INCOME' ? category.kind === 'INCOME' : category.kind === 'EXPENSE',
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 p-4 pt-[8vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="novo-lancamento-titulo"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-lg p-5 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 id="novo-lancamento-titulo" className="text-[15px] font-semibold">
            Novo lancamento
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            <X className="size-4" />
          </button>
        </div>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: 'CARD', label: 'No cartao', icon: CreditCardIcon },
                { value: 'ACCOUNT', label: 'Na conta', icon: Landmark },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setForm((f) => ({ ...f, source: option.value }))}
                className={
                  form.source === option.value
                    ? 'flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-teal)] bg-[var(--color-teal-soft)] px-3 py-2.5 text-[13px] font-medium text-[var(--color-teal)]'
                    : 'flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2.5 text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-line-strong)]'
                }
              >
                <option.icon className="size-4" />
                {option.label}
              </button>
            ))}
          </div>

          <Field label="Descricao">
            <input
              required
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Supermercado, aluguel, salario..."
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor (R$)">
              <input
                required
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0,00"
                className={`${inputClass} num`}
              />
            </Field>
            <Field label="Data">
              <input
                required
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className={`${inputClass} num`}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo">
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value, categoryId: '' }))}
                className={inputClass}
              >
                <option value="EXPENSE">Despesa</option>
                <option value="INCOME">Receita</option>
              </select>
            </Field>
            <Field label="Categoria">
              <select
                value={form.categoryId}
                onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                className={inputClass}
              >
                <option value="">Sem categoria</option>
                {relevantCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {form.source === 'CARD' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cartao">
                <select
                  value={form.creditCardId}
                  onChange={(e) => setForm((f) => ({ ...f, creditCardId: e.target.value }))}
                  className={inputClass}
                >
                  {(cards ?? []).map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.name} · {card.lastFour}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Parcelas">
                <select
                  value={form.installments}
                  onChange={(e) => setForm((f) => ({ ...f, installments: Number(e.target.value) }))}
                  className={`${inputClass} num`}
                >
                  {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? 'A vista' : `${n}x`}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : (
            <Field label="Conta">
              <select
                value={form.accountId}
                onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                className={inputClass}
              >
                {(accounts ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {form.source === 'CARD' && cyclePreview && (
            <div className="rounded-[var(--radius-control)] border border-[var(--color-teal-line)] bg-[var(--color-teal-soft)] px-3 py-2.5">
              <p className="text-xs text-[var(--color-teal)]">
                {form.installments > 1 ? (
                  <>
                    Primeira parcela na fatura de{' '}
                    <strong className="num">{monthTitle(cyclePreview.referenceMonth)}</strong>; a
                    ultima em{' '}
                    <strong className="num">
                      {monthTitle(shiftMonth(cyclePreview.referenceMonth, form.installments - 1))}
                    </strong>
                    .
                  </>
                ) : (
                  <>
                    Cai na fatura de{' '}
                    <strong className="num">{monthTitle(cyclePreview.referenceMonth)}</strong> —
                    fecha <span className="num">{fullDate(cyclePreview.closingDate)}</span>, vence{' '}
                    <span className="num">{fullDate(cyclePreview.dueDate)}</span>.
                  </>
                )}
              </p>
            </div>
          )}

          {error && (
            <p className="rounded-[var(--radius-control)] bg-[var(--color-negative-soft)] px-3 py-2 text-xs text-[var(--color-negative)]">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Salvando...' : 'Salvar lancamento'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputClass =
  'w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-teal)]';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-[var(--color-muted)]">{label}</span>
      {children}
    </label>
  );
}

function shiftMonth(ym: string, delta: number): string {
  const [year, month] = ym.split('-').map(Number);
  const zero = year * 12 + (month - 1) + delta;
  return `${Math.floor(zero / 12)}-${String((zero % 12) + 1).padStart(2, '0')}`;
}
