import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { useWorkspace } from '../app/workspace';
import { Badge, Button, Card, CardTitle, EmptyState, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { fullDate, money, monthTitle } from '../lib/format';
import type { Scenario } from '../lib/types';

interface ImpactResponse {
  scenarioId: string;
  from: string;
  months: { month: string; baselineBalance: number; scenarioBalance: number; delta: number }[];
  totalImpact: number;
  lowestBalance: number;
  lowestBalanceMonth: string;
}

const KIND_LABEL: Record<string, string> = {
  ONE_OFF: 'Uma vez',
  RECURRING: 'Recorrente',
  INSTALLMENT: 'Parcelado',
};

/**
 * Cenarios "e se".
 *
 * A simulacao vive FORA dos lancamentos reais: um cenario nunca cria transacao,
 * ele e sobreposto a projecao no momento do calculo. Assim da para testar
 * "trocar o carro" sem sujar o historico e sem precisar desfazer nada depois.
 */
export function ScenariosPage() {
  const queryClient = useQueryClient();
  const { month } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: scenarios, isLoading } = useQuery({
    queryKey: ['scenarios'],
    queryFn: () => api.get<Scenario[]>('/scenarios'),
  });

  const activeId = selectedId ?? scenarios?.[0]?.id ?? null;

  const { data: impact } = useQuery({
    queryKey: ['scenario-impact', activeId, month],
    queryFn: () => api.get<ImpactResponse>(`/scenarios/${activeId}/impact`, { from: month, months: 12 }),
    enabled: Boolean(activeId),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/scenarios/${id}`, { isActive }),
    onSuccess: () => void queryClient.invalidateQueries(),
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!scenarios || scenarios.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<FlaskConical className="size-7" />}
          title="Nenhum cenario criado"
          description="Simule uma compra grande, um aumento ou uma despesa nova e veja o efeito no saldo dos proximos meses."
        />
      </Card>
    );
  }

  const selected = scenarios.find((scenario) => scenario.id === activeId);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="space-y-3">
        {scenarios.map((scenario) => (
          <button
            key={scenario.id}
            type="button"
            onClick={() => setSelectedId(scenario.id)}
            className={
              scenario.id === activeId
                ? 'card w-full border-[var(--color-teal)] p-4 text-left'
                : 'card w-full p-4 text-left transition-colors hover:border-[var(--color-line-strong)]'
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[13px] font-semibold">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: scenario.color }}
                    aria-hidden="true"
                  />
                  {scenario.name}
                </p>
                {scenario.description && (
                  <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-muted)]">
                    {scenario.description}
                  </p>
                )}
              </div>
              <Badge tone={scenario.isActive ? 'accent' : 'neutral'} mono={false}>
                {scenario.isActive ? 'aplicado' : 'inativo'}
              </Badge>
            </div>

            <p className="num mt-2 text-[11px] text-[var(--color-faint)]">
              {scenario.items.length} {scenario.items.length === 1 ? 'item' : 'itens'}
            </p>
          </button>
        ))}
      </div>

      {selected && (
        <Card>
          <CardTitle
            title={selected.name}
            subtitle="Diferenca que este cenario provoca no saldo, isolado dos demais"
            action={
              <Button
                variant={selected.isActive ? 'secondary' : 'primary'}
                size="sm"
                onClick={() => toggle.mutate({ id: selected.id, isActive: !selected.isActive })}
                disabled={toggle.isPending}
              >
                {selected.isActive ? 'Remover da projecao' : 'Aplicar na projecao'}
              </Button>
            }
          />

          <ul className="mb-4 divide-y divide-[var(--color-line)]">
            {selected.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-2.5 first:pt-0">
                <Badge tone="neutral" mono={false}>
                  {KIND_LABEL[item.kind] ?? item.kind}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px]">{item.description}</p>
                  <p className="num text-[11px] text-[var(--color-muted)]">
                    a partir de {fullDate(item.startDate)}
                    {item.months && ` · ${item.months}x`}
                  </p>
                </div>
                <span
                  className={
                    item.type === 'INCOME'
                      ? 'num shrink-0 text-[13px] font-medium text-[var(--color-teal)]'
                      : 'num shrink-0 text-[13px] font-medium'
                  }
                >
                  {item.type === 'INCOME' ? '+' : '−'} {money(item.amount)}
                </span>
              </li>
            ))}
          </ul>

          {impact && (
            <div className="rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] p-4">
              <div className="mb-3 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] text-[var(--color-muted)]">Impacto em 12 meses</p>
                  <p
                    className={
                      impact.totalImpact >= 0
                        ? 'num mt-1 text-[19px] font-semibold text-[var(--color-teal)]'
                        : 'num mt-1 text-[19px] font-semibold text-[var(--color-negative)]'
                    }
                  >
                    {impact.totalImpact >= 0 ? '+' : '−'} {money(Math.abs(impact.totalImpact))}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--color-muted)]">Menor saldo com o cenario</p>
                  <p
                    className={
                      impact.lowestBalance < 0
                        ? 'num mt-1 text-[19px] font-semibold text-[var(--color-negative)]'
                        : 'num mt-1 text-[19px] font-semibold'
                    }
                  >
                    {money(impact.lowestBalance)}
                  </p>
                  <p className="num text-[10px] text-[var(--color-faint)]">
                    em {monthTitle(impact.lowestBalanceMonth).toLowerCase()}
                  </p>
                </div>
              </div>

              <ul className="space-y-1">
                {impact.months
                  .filter((row) => row.delta !== 0)
                  .slice(0, 6)
                  .map((row) => (
                    <li
                      key={row.month}
                      className="flex items-center justify-between text-[11px]"
                    >
                      <span className="num text-[var(--color-muted)]">
                        {monthTitle(row.month)}
                      </span>
                      <span
                        className={
                          row.delta >= 0
                            ? 'num text-[var(--color-teal)]'
                            : 'num text-[var(--color-negative)]'
                        }
                      >
                        {row.delta >= 0 ? '+' : '−'} {money(Math.abs(row.delta))}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
