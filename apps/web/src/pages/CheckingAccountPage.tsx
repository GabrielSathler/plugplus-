import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '../app/workspace';
import { IncomeExpenseBars } from '../components/charts';
import { Card, CardTitle, Dot, EmptyState, Skeleton, StatGridSkeleton } from '../components/ui';
import { api } from '../lib/api';
import { money, monthTitle } from '../lib/format';
import type { CheckingResponse } from '../lib/types';

export function CheckingAccountPage() {
  const { month } = useWorkspace();
  const { data, isLoading } = useQuery({
    queryKey: ['checking', month],
    queryFn: () => api.get<CheckingResponse>('/dashboard/checking-account', { month }),
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <StatGridSkeleton count={4} />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const { kpis } = data;
  const monthLabel = monthTitle(data.month).split(' ')[0].toLowerCase();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PlainStat label={`Entradas em ${monthLabel}`} value={money(kpis.income)} tone="positive" />
        <PlainStat label={`Saidas em ${monthLabel}`} value={money(kpis.expenses)} tone="negative" />
        <PlainStat
          label="Resultado do mes"
          value={`${kpis.net >= 0 ? '+' : ''}${money(kpis.net).replace('R$ ', '').replace('-', '−')}`}
          tone={kpis.net >= 0 ? 'positive' : 'negative'}
        />
        {/*
          O menor saldo do horizonte, e nao o saldo de hoje: o numero que
          antecipa aperto e o pior ponto do caminho, nao o ponto de partida.
        */}
        <PlainStat
          label="Menor saldo projetado"
          value={money(kpis.lowestProjectedBalance)}
          tone={kpis.lowestProjectedBalance < 0 ? 'negative' : 'warning'}
          hint={`em ${monthTitle(kpis.lowestProjectedMonth).toLowerCase()}`}
        />
      </div>

      <Card>
        <CardTitle
          title="Entradas e saidas na conta corrente"
          subtitle="Doze meses, projecao a partir do mes seguinte"
        />
        <IncomeExpenseBars data={data.series} />
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardTitle
            title="Recorrencias reconhecidas"
            subtitle="Base do que a projecao assume para os proximos meses"
          />
          {data.recurrences.length === 0 ? (
            <EmptyState
              title="Nenhuma recorrencia"
              description="Lancamentos que se repetem viram regras e alimentam a projecao."
            />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {data.recurrences.map((rule) => (
                <li key={rule.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {rule.description}
                  </span>
                  <span className="num w-16 shrink-0 text-xs text-[var(--color-muted)]">
                    dia {rule.dayOfMonth}
                  </span>
                  <span
                    className={
                      rule.type === 'INCOME'
                        ? 'w-36 shrink-0 text-xs text-[var(--color-teal)]'
                        : 'w-36 shrink-0 text-xs text-[var(--color-warning)]'
                    }
                  >
                    {rule.label}
                  </span>
                  <span className="num w-24 shrink-0 text-right text-[13px] font-medium">
                    {money(rule.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle title="Contas conectadas" subtitle="Saldos que compoem o consolidado" />
          <ul className="divide-y divide-[var(--color-line)]">
            {data.accounts.map((account) => (
              <li key={account.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <Dot color={account.color} />
                <span className="min-w-0 flex-1 truncate text-[13px]">{account.name}</span>
                <span className="num shrink-0 text-[13px] font-medium">
                  {money(account.currentBalance)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function PlainStat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'warning';
  hint?: string;
}) {
  const color =
    tone === 'positive'
      ? 'text-[var(--color-positive)]'
      : tone === 'negative'
        ? 'text-[var(--color-negative)]'
        : tone === 'warning'
          ? 'text-[var(--color-warning)]'
          : 'text-[var(--color-text)]';

  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-[var(--color-muted)]">{label}</p>
      <p className={`num mt-2 text-[24px] leading-none font-semibold ${color}`}>{value}</p>
      {hint && <p className="mt-2 text-[11px] text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}
