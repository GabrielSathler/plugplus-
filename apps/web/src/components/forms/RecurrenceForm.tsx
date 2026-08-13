import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { today as todayIn } from '@finflow/shared';
import { ApiError, api } from '../../lib/api';
import type { AccountRow, CreditCardRow } from '../../lib/types';
import { Button } from '../ui';
import { Dialog, Field, MoneyInput, formInputClass, parseMoney } from './shared';

interface Category {
  id: string;
  name: string;
  kind: string;
}

/**
 * Recorrência: a base da projeção.
 *
 * É o que faz o produto responder "quanto vou ter em novembro" — sem salário e
 * aluguel cadastrados, a projeção só conhece o que já aconteceu e o gráfico
 * vira uma linha reta. Por isso o atalho de modelos: cadastrar as três ou
 * quatro fixas é o passo que liga o produto.
 */
const TEMPLATES = [
  { label: 'Salario', type: 'INCOME', day: 5, method: 'TRANSFER', tag: 'Entrada fixa' },
  { label: 'Aluguel', type: 'EXPENSE', day: 10, method: 'AUTO_DEBIT', tag: 'Debito automatico' },
  { label: 'Assinatura', type: 'EXPENSE', day: 15, method: 'CREDIT', tag: 'Assinatura no cartao' },
];

export function RecurrenceForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get<AccountRow[]>('/accounts'),
    enabled: open,
  });
  const { data: cards } = useQuery({
    queryKey: ['credit-cards'],
    queryFn: () => api.get<CreditCardRow[]>('/credit-cards'),
    enabled: open,
  });
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<Category[]>('/categories'),
    enabled: open,
  });

  const [form, setForm] = useState({
    description: '',
    amount: '',
    type: 'EXPENSE',
    dayOfMonth: 10,
    categoryId: '',
    source: '',
    label: '',
  });
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const [kind, id] = form.source.split(':');
      return api.post('/recurrences', {
        description: form.description.trim(),
        amount: parseMoney(form.amount),
        type: form.type,
        frequency: 'MONTHLY',
        dayOfMonth: Number(form.dayOfMonth),
        // Começa no mês corrente: a projeção precisa dela já a partir de agora.
        startDate: todayIn().slice(0, 8) + '01',
        categoryId: form.categoryId || undefined,
        accountId: kind === 'account' ? id : undefined,
        creditCardId: kind === 'card' ? id : undefined,
        paymentMethod: kind === 'card' ? 'CREDIT' : form.type === 'INCOME' ? 'TRANSFER' : 'AUTO_DEBIT',
        label: form.label || undefined,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel salvar.'),
  });

  if (!open) return null;

  const relevantCategories = (categories ?? []).filter((category) =>
    form.type === 'INCOME' ? category.kind === 'INCOME' : category.kind === 'EXPENSE',
  );

  return (
    <Dialog
      title="Nova recorrencia"
      subtitle="Salario, aluguel, escola, assinatura — o que se repete todo mes."
      onClose={onClose}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {TEMPLATES.map((template) => (
          <button
            key={template.label}
            type="button"
            onClick={() =>
              setForm((f) => ({
                ...f,
                description: template.label,
                type: template.type,
                dayOfMonth: template.day,
                label: template.tag,
                categoryId: '',
              }))
            }
            className="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-teal)] hover:text-[var(--color-teal)]"
          >
            {template.label}
          </button>
        ))}
      </div>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <Field label="Descricao">
          <input
            required
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Salario, aluguel, plano de saude..."
            className={formInputClass}
          />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Tipo">
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value, categoryId: '' }))}
              className={formInputClass}
            >
              <option value="EXPENSE">Saida</option>
              <option value="INCOME">Entrada</option>
            </select>
          </Field>
          <Field label="Valor">
            <MoneyInput
              value={form.amount}
              onChange={(amount) => setForm((f) => ({ ...f, amount }))}
            />
          </Field>
          <Field label="Dia do mes">
            <input
              required
              type="number"
              min={1}
              max={31}
              value={form.dayOfMonth}
              onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: Number(e.target.value) }))}
              className={`${formInputClass} num`}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Onde acontece"
            hint={
              form.source.startsWith('card:')
                ? 'Entra na fatura, nao sai da conta na data.'
                : undefined
            }
          >
            <select
              required
              value={form.source}
              onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
              className={formInputClass}
            >
              <option value="">Escolha</option>
              {(accounts ?? [])
                .filter((account) => account.isActive)
                .map((account) => (
                  <option key={account.id} value={`account:${account.id}`}>
                    {account.name}
                  </option>
                ))}
              {(cards ?? []).map((card) => (
                <option key={card.id} value={`card:${card.id}`}>
                  {card.name} · cartao
                </option>
              ))}
            </select>
          </Field>

          <Field label="Categoria">
            <select
              value={form.categoryId}
              onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
              className={formInputClass}
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

        {error && (
          <p className="rounded-[var(--radius-control)] bg-[var(--color-negative-soft)] px-3 py-2 text-[13px] text-[var(--color-negative)]">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={save.isPending || !form.source}>
            {save.isPending ? 'Salvando...' : 'Criar recorrencia'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
