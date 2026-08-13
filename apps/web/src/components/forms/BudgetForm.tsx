import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { Button } from '../ui';
import { Dialog, Field, MoneyInput, formInputClass, parseMoney } from './shared';

interface Category {
  id: string;
  name: string;
  kind: string;
  color: string;
}

export function BudgetForm({
  open,
  onClose,
  month,
}: {
  open: boolean;
  onClose: () => void;
  month: string;
}) {
  const queryClient = useQueryClient();

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<Category[]>('/categories'),
    enabled: open,
  });

  const [form, setForm] = useState({
    categoryId: '',
    limitAmount: '',
    alertThreshold: 80,
    // Recorrente por padrão: quem define um teto para "Mercado" quer que ele
    // valha todo mês, não só neste. Orçamento pontual é a exceção.
    recurring: true,
  });
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.post('/budgets', {
        categoryId: form.categoryId,
        month: form.recurring ? undefined : month,
        limitAmount: parseMoney(form.limitAmount),
        alertThreshold: form.alertThreshold,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (err: unknown) =>
      setError(
        err instanceof ApiError && err.status === 409
          ? 'Esta categoria ja tem um orcamento neste periodo.'
          : err instanceof ApiError
            ? err.message
            : 'Nao foi possivel salvar.',
      ),
  });

  if (!open) return null;

  const expenseCategories = (categories ?? []).filter((category) => category.kind === 'EXPENSE');

  return (
    <Dialog
      title="Novo orcamento"
      subtitle="Um teto por categoria, com aviso antes de estourar."
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <Field label="Categoria">
          <select
            required
            autoFocus
            value={form.categoryId}
            onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
            className={formInputClass}
          >
            <option value="">Escolha uma categoria</option>
            {expenseCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Limite mensal">
          <MoneyInput
            value={form.limitAmount}
            onChange={(limitAmount) => setForm((f) => ({ ...f, limitAmount }))}
          />
        </Field>

        <Field
          label="Avisar ao atingir"
          hint="Acima disso a categoria entra em Atencao; passando de 100%, Estourado."
        >
          <select
            value={form.alertThreshold}
            onChange={(e) => setForm((f) => ({ ...f, alertThreshold: Number(e.target.value) }))}
            className={`${formInputClass} num`}
          >
            {[50, 60, 70, 80, 90, 100].map((value) => (
              <option key={value} value={value}>
                {value}% do limite
              </option>
            ))}
          </select>
        </Field>

        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={form.recurring}
            onChange={(e) => setForm((f) => ({ ...f, recurring: e.target.checked }))}
            className="mt-0.5 size-4 shrink-0 accent-[var(--color-teal)]"
          />
          <span className="text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
            Valer para todos os meses.{' '}
            <span className="text-[var(--color-muted)]">
              Desmarque para um teto so deste mes.
            </span>
          </span>
        </label>

        {error && (
          <p className="rounded-[var(--radius-control)] bg-[var(--color-negative-soft)] px-3 py-2 text-[13px] text-[var(--color-negative)]">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={save.isPending || !form.categoryId}
          >
            {save.isPending ? 'Salvando...' : 'Criar orcamento'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
