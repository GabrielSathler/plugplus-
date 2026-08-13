import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useWorkspace } from '../app/workspace';
import { BudgetForm } from '../components/forms/BudgetForm';
import { Badge, Button, Card, EmptyState, Progress, Skeleton, type Tone } from '../components/ui';
import { api } from '../lib/api';
import { money, percentWhole } from '../lib/format';
import type { BudgetsResponse, CategorySpend } from '../lib/types';

const STATUS_LABEL: Record<string, string> = {
  ON_TRACK: 'No trilho',
  WARNING: 'Atencao',
  EXCEEDED: 'Estourado',
};

const STATUS_TONE: Record<string, Tone> = {
  ON_TRACK: 'positive',
  WARNING: 'warning',
  EXCEEDED: 'negative',
};

export function BudgetsPage() {
  const { month } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['budgets', month],
    queryFn: () => api.get<BudgetsResponse>('/budgets', { month }),
  });

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <>
        <Card>
          <EmptyState
            title="Nenhum orcamento definido"
            description="Defina um limite por categoria e o Cardinal avisa antes de estourar, nao depois."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="size-3.5" />
                Criar orcamento
              </Button>
            }
          />
        </Card>
        <BudgetForm open={creating} onClose={() => setCreating(false)} month={month} />
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="num text-[12px] text-[var(--color-muted)]">
          {money(data.totals.spent)} de {money(data.totals.limit)} usados no mes
        </p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" />
          Novo orcamento
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.items.map((row) => (
          <BudgetCard key={row.categoryId} row={row} />
        ))}
      </div>

      <BudgetForm open={creating} onClose={() => setCreating(false)} month={month} />

      {data.unbudgeted.length > 0 && (
        <Card>
          <p className="mb-3 text-[13px] font-medium">Categorias com gasto e sem orcamento</p>
          <ul className="flex flex-wrap gap-2">
            {data.unbudgeted.map((row) => (
              <li
                key={row.categoryId}
                className="inline-flex items-center gap-2 rounded-md bg-[var(--color-surface-sunken)] px-2.5 py-1.5 text-xs"
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: row.color }}
                  aria-hidden="true"
                />
                {row.categoryName}
                <span className="num text-[var(--color-muted)]">{money(row.spent)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function BudgetCard({ row }: { row: CategorySpend }) {
  const status = row.status ?? 'ON_TRACK';
  const usage = row.usage ?? 0;
  const remaining = (row.budget ?? 0) - row.spent;

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{row.categoryName}</p>
          <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
            {status === 'EXCEEDED'
              ? 'Excedeu o limite do mes'
              : `${percentWhole(Math.max(100 - usage, 0))} disponivel`}
          </p>
        </div>
        {/* Estado com rotulo + cor, nunca so cor. */}
        <Badge tone={STATUS_TONE[status]} mono={false}>
          {STATUS_LABEL[status]}
        </Badge>
      </div>

      <p className="num text-[22px] leading-none font-semibold">
        {money(row.spent)}
        <span className="ml-1.5 text-[13px] font-normal text-[var(--color-muted)]">
          / {money(row.budget ?? 0)}
        </span>
      </p>

      <Progress value={usage} status={status} className="mt-3" height={5} />

      <p className="num mt-2 text-[11px] text-[var(--color-muted)]">
        {remaining >= 0 ? `Restam ${money(remaining)}` : `${money(-remaining)} acima do limite`}
      </p>
    </div>
  );
}
