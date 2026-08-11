import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarPlus,
  Check,
  CreditCard as CreditCardIcon,
  Landmark,
  Plus,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { today as todayIn } from '@finflow/shared';
import { useWorkspace } from '../app/workspace';
import { Badge, Button, Card, CardTitle, EmptyState, Skeleton, type Tone } from '../components/ui';
import { api } from '../lib/api';
import { fullDate, money, monthTitle } from '../lib/format';
import type { AccountRow, CreditCardRow, PlanRow, PlansResponse } from '../lib/types';

const STATUS_TONE: Record<string, Tone> = {
  PLANNED: 'accent',
  CLOSED: 'neutral',
  CANCELLED: 'neutral',
};
const STATUS_LABEL: Record<string, string> = {
  PLANNED: 'programado',
  CLOSED: 'encerrado',
  CANCELLED: 'cancelado',
};

/**
 * Planos de gasto.
 *
 * A tela responde uma pergunta que nenhuma outra responde: "se eu gastar isso,
 * sobra quanto?". Por isso o KPI central nao e o total programado — e a sobra
 * DEPOIS dos planos, com o antes ao lado para dar a medida do quanto a escolha
 * pesa.
 */
export function PlansPage() {
  const { month } = useWorkspace();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['plans', month],
    queryFn: () => api.get<PlansResponse>('/plans', { month }),
  });

  const invalidate = () => void queryClient.invalidateQueries();

  const closePlan = useMutation({
    mutationFn: (id: string) => api.post(`/plans/${id}/close`),
    onSuccess: invalidate,
  });
  const removePlan = useMutation({
    mutationFn: (id: string) => api.delete(`/plans/${id}`),
    onSuccess: () => {
      setSelectedId(null);
      invalidate();
    },
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const { totals } = data;
  const active = data.items.find((plan) => plan.id === selectedId) ?? data.items[0] ?? null;
  const cost = totals.surplusBeforePlans - totals.surplusAfterPlans;

  return (
    <div className="space-y-3">
      {/* --- KPIs --------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-medium text-[var(--color-muted)]">
            Disponivel depois dos planos
          </p>
          <p
            className={
              totals.surplusAfterPlans < 0
                ? 'num mt-2 text-[24px] leading-none font-semibold text-[var(--color-negative)]'
                : 'num mt-2 text-[24px] leading-none font-semibold'
            }
          >
            {money(totals.surplusAfterPlans)}
          </p>
          {/* O antes e depois lado a lado: sem o antes, o numero nao diz o quanto a escolha custou. */}
          <p className="num mt-2 text-[11px] text-[var(--color-muted)]">
            era {money(totals.surplusBeforePlans)}
            {cost !== 0 && (
              <span className="text-[var(--color-warning)]"> · −{money(cost)} neste mes</span>
            )}
          </p>
        </div>

        <div className="card p-4">
          <p className="text-xs font-medium text-[var(--color-muted)]">Programado no mes</p>
          <p className="num mt-2 text-[24px] leading-none font-semibold">
            {money(totals.plannedThisMonth)}
          </p>
          <p className="num mt-2 text-[11px] text-[var(--color-muted)]">
            {money(totals.plannedTotal)} somando todos os periodos
          </p>
        </div>

        <div className="card p-4">
          <p className="text-xs font-medium text-[var(--color-muted)]">Cai na fatura</p>
          <p className="num mt-2 text-[24px] leading-none font-semibold text-[var(--color-warning)]">
            {money(totals.toInvoice)}
          </p>
          <p className="mt-2 text-[11px] text-[var(--color-muted)]">Debita no vencimento, nao hoje</p>
        </div>

        <div className="card p-4">
          <p className="text-xs font-medium text-[var(--color-muted)]">Sai da conta</p>
          <p className="num mt-2 text-[24px] leading-none font-semibold">
            {money(totals.toAccount)}
          </p>
          <p className="mt-2 text-[11px] text-[var(--color-muted)]">Pix, debito e dinheiro</p>
        </div>
      </div>

      {data.awaitingReconciliation > 0 && (
        <div className="flex items-start gap-2.5 rounded-[var(--radius-card)] bg-[var(--color-warning-soft)] px-4 py-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]" />
          <p className="text-[13px] text-[var(--color-warning)]">
            <strong className="num">{data.awaitingReconciliation}</strong>{' '}
            {data.awaitingReconciliation === 1 ? 'item ja passou' : 'itens ja passaram'} da data e
            continuam pendentes. Eles pararam de contar na projecao — confirme o que de fato
            aconteceu.
          </p>
        </div>
      )}

      {/* --- Lista + detalhe ---------------------------------------------- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="space-y-3">
          <Button variant="primary" onClick={() => setCreating(true)} className="w-full">
            <CalendarPlus className="size-4" />
            Novo plano de gasto
          </Button>

          {data.items.length === 0 ? (
            <Card>
              <EmptyState
                icon={<CalendarPlus className="size-6" />}
                title="Nenhum plano ainda"
                description="Programe o que voce pretende gastar e veja o efeito no saldo antes de gastar."
              />
            </Card>
          ) : (
            data.items.map((plan) => (
              <button
                key={plan.id}
                type="button"
                onClick={() => setSelectedId(plan.id)}
                className={
                  plan.id === active?.id
                    ? 'card w-full border-[var(--color-teal)] p-4 text-left'
                    : 'card w-full p-4 text-left transition-colors hover:border-[var(--color-line-strong)]'
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-[13px] font-semibold">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: plan.color }}
                        aria-hidden="true"
                      />
                      {plan.name}
                    </p>
                    <p className="num mt-0.5 text-[11px] text-[var(--color-muted)]">
                      {plan.startDate === plan.endDate
                        ? fullDate(plan.startDate)
                        : `${fullDate(plan.startDate)} a ${fullDate(plan.endDate)}`}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[plan.status] ?? 'neutral'} mono={false}>
                    {STATUS_LABEL[plan.status] ?? plan.status}
                  </Badge>
                </div>

                <p className="num mt-3 text-[19px] leading-none font-semibold">
                  {money(plan.summary.total)}
                </p>
                <p className="num mt-1.5 text-[11px] text-[var(--color-muted)]">
                  {plan.summary.itemCount} itens ·{' '}
                  <span className="text-[var(--color-warning)]">
                    {money(plan.summary.toInvoice)} fatura
                  </span>{' '}
                  · {money(plan.summary.toAccount)} conta
                </p>
              </button>
            ))
          )}
        </div>

        {active && (
          <PlanDetail
            plan={active}
            onChanged={invalidate}
            onClose={() => closePlan.mutate(active.id)}
            onDelete={() => removePlan.mutate(active.id)}
          />
        )}
      </div>

      {creating && <NewPlanDialog onClose={() => setCreating(false)} onCreated={invalidate} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Detalhe do plano                                                          */
/* -------------------------------------------------------------------------- */

function PlanDetail({
  plan,
  onChanged,
  onClose,
  onDelete,
}: {
  plan: PlanRow;
  onChanged: () => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [adding, setAdding] = useState(false);

  const markItem = useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: string }) =>
      api.patch(`/plans/${plan.id}/items/${itemId}`, { status }),
    onSuccess: onChanged,
  });
  const removeItem = useMutation({
    mutationFn: (itemId: string) => api.delete(`/plans/${plan.id}/items/${itemId}`),
    onSuccess: onChanged,
  });

  const impact = Object.entries(plan.summary.cashImpactByMonth).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <Card>
      <CardTitle
        title={plan.name}
        subtitle={
          plan.startDate === plan.endDate
            ? fullDate(plan.startDate)
            : `${fullDate(plan.startDate)} a ${fullDate(plan.endDate)}`
        }
        action={
          <div className="flex gap-2">
            {plan.status === 'PLANNED' && (
              <Button size="sm" onClick={onClose}>
                Encerrar
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onDelete}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        }
      />

      {/* Quando o dinheiro sai — o que separa este produto de uma lista de compras. */}
      {impact.length > 0 && (
        <div className="mb-4 rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] p-3">
          <p className="mb-2 text-[11px] font-medium text-[var(--color-muted)]">
            Quando o dinheiro sai do caixa
          </p>
          <ul className="space-y-1.5">
            {impact.map(([ym, value]) => (
              <li key={ym} className="flex items-center justify-between text-[12px]">
                <span className="num text-[var(--color-text-secondary)]">{monthTitle(ym)}</span>
                <span className="num font-medium">{money(value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="divide-y divide-[var(--color-line)]">
        {plan.items.map((item) => {
          const done = item.status === 'DONE';
          const skipped = item.status === 'SKIPPED';
          return (
            <li key={item.id} className="flex items-center gap-3 py-2.5 first:pt-0">
              <button
                type="button"
                aria-label={done ? 'Reabrir item' : 'Marcar como gasto'}
                onClick={() =>
                  markItem.mutate({ itemId: item.id, status: done ? 'PENDING' : 'DONE' })
                }
                className={
                  done
                    ? 'grid size-5 shrink-0 place-items-center rounded-full bg-[var(--color-teal)] text-white'
                    : 'grid size-5 shrink-0 place-items-center rounded-full border border-[var(--color-line-strong)] text-transparent hover:border-[var(--color-teal)]'
                }
              >
                <Check className="size-3" strokeWidth={3} />
              </button>

              <div className="min-w-0 flex-1">
                <p
                  className={
                    done || skipped
                      ? 'truncate text-[13px] text-[var(--color-muted)] line-through'
                      : 'truncate text-[13px] font-medium'
                  }
                >
                  {item.description}
                </p>
                <p className="num text-[11px] text-[var(--color-muted)]">
                  {item.creditCard
                    ? `${item.creditCard.name} · ${item.creditCard.lastFour ?? ''}`
                    : item.account
                      ? item.account.name
                      : 'sem origem'}
                  {item.installments > 1 && ` · ${item.installments}x`}
                  {item.date && ` · ${fullDate(item.date)}`}
                </p>
              </div>

              {item.category && (
                <span className="hidden items-center gap-1.5 rounded-md bg-[var(--color-surface-sunken)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)] sm:inline-flex">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: item.category.color }}
                    aria-hidden="true"
                  />
                  {item.category.name}
                </span>
              )}

              <span className="num shrink-0 text-[13px] font-medium">{money(item.amount)}</span>

              <button
                type="button"
                aria-label="Remover item"
                onClick={() => removeItem.mutate(item.id)}
                className="text-[var(--color-faint)] hover:text-[var(--color-negative)]"
              >
                <X className="size-3.5" />
              </button>
            </li>
          );
        })}
      </ul>

      {adding ? (
        <NewItemForm
          planId={plan.id}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button size="sm" onClick={() => setAdding(true)} className="mt-3">
          <Plus className="size-3.5" />
          Adicionar gasto
        </Button>
      )}

      {plan.summary.realized > 0 && (
        <p className="num mt-4 border-t border-[var(--color-line)] pt-3 text-[11px] text-[var(--color-muted)]">
          Gasto real no periodo, nas mesmas origens:{' '}
          <strong className="text-[var(--color-text)]">{money(plan.summary.realized)}</strong>{' '}
          contra {money(plan.summary.total)} planejado.
        </p>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Formularios                                                               */
/* -------------------------------------------------------------------------- */

const inputClass =
  'w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-2 text-[13px] outline-none focus:border-[var(--color-teal)]';

function NewItemForm({
  planId,
  onDone,
  onCancel,
}: {
  planId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    description: '',
    amount: '',
    categoryId: '',
    source: '',
    installments: 1,
  });

  const { data: cards } = useQuery({
    queryKey: ['credit-cards'],
    queryFn: () => api.get<CreditCardRow[]>('/credit-cards'),
  });
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get<AccountRow[]>('/accounts'),
  });
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ id: string; name: string; kind: string }[]>('/categories'),
  });

  const create = useMutation({
    mutationFn: () => {
      const [kind, id] = form.source.split(':');
      return api.post(`/plans/${planId}/items`, {
        description: form.description,
        amount: Math.round(Number(form.amount.replace(/\./g, '').replace(',', '.')) * 100),
        categoryId: form.categoryId || undefined,
        creditCardId: kind === 'card' ? id : undefined,
        accountId: kind === 'account' ? id : undefined,
        paymentMethod: kind === 'card' ? 'CREDIT' : 'PIX',
        installments: kind === 'card' ? Number(form.installments) : 1,
      });
    },
    onSuccess: onDone,
  });

  const isCard = form.source.startsWith('card:');

  return (
    <form
      className="mt-3 space-y-2 rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] p-3"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <div className="grid grid-cols-[1fr_110px] gap-2">
        <input
          required
          autoFocus
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Restaurante, ingresso, combustivel..."
          className={inputClass}
        />
        <input
          required
          inputMode="decimal"
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          placeholder="0,00"
          className={`${inputClass} num`}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <select
          required
          value={form.source}
          onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
          className={inputClass}
        >
          <option value="">Onde vai pagar</option>
          {(cards ?? []).map((card) => (
            <option key={card.id} value={`card:${card.id}`}>
              {card.name} · {card.lastFour}
            </option>
          ))}
          {(accounts ?? [])
            .filter((account) => account.isActive)
            .map((account) => (
              <option key={account.id} value={`account:${account.id}`}>
                {account.name}
              </option>
            ))}
        </select>

        <select
          value={form.categoryId}
          onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
          className={inputClass}
        >
          <option value="">Categoria</option>
          {(categories ?? [])
            .filter((category) => category.kind === 'EXPENSE')
            .map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
        </select>

        {isCard && (
          <select
            value={form.installments}
            onChange={(e) => setForm((f) => ({ ...f, installments: Number(e.target.value) }))}
            className={`${inputClass} num`}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n === 1 ? 'A vista' : `${n}x`}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
          {isCard ? (
            <>
              <CreditCardIcon className="size-3" /> Vai para a fatura
            </>
          ) : form.source ? (
            <>
              <Landmark className="size-3" /> Sai da conta na data
            </>
          ) : null}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button size="sm" variant="primary" type="submit" disabled={create.isPending}>
            Adicionar
          </Button>
        </div>
      </div>
    </form>
  );
}

function NewPlanDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const today = todayIn();
  const [form, setForm] = useState({ name: '', startDate: today, endDate: today });

  const create = useMutation({
    mutationFn: () =>
      api.post('/plans', {
        name: form.name,
        startDate: form.startDate,
        endDate: form.endDate || form.startDate,
      }),
    onSuccess: () => {
      onCreated();
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 p-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="novo-plano"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-md p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="novo-plano" className="text-[15px] font-semibold">
            Novo plano de gasto
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
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--color-muted)]">
              Nome
            </span>
            <input
              required
              autoFocus
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Fim de semana, viagem, aniversario..."
              className={inputClass}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--color-muted)]">
                Inicio
              </span>
              <input
                required
                type="date"
                value={form.startDate}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    startDate: e.target.value,
                    // Um plano de um dia so nao deveria exigir preencher a
                    // mesma data duas vezes.
                    endDate: f.endDate < e.target.value ? e.target.value : f.endDate,
                  }))
                }
                className={`${inputClass} num`}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--color-muted)]">
                Fim
              </span>
              <input
                type="date"
                min={form.startDate}
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                className={`${inputClass} num`}
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={create.isPending}>
              Criar plano
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
