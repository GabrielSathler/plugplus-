import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useWorkspace } from '../app/workspace';
import { InvoiceBars } from '../components/charts';
import { Card, CardTitle, Progress, Segmented, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { fullDate, invoiceLineLabel, money, percentWhole } from '../lib/format';
import type { CreditCardResponse } from '../lib/types';

export function CreditCardPage() {
  const { month } = useWorkspace();
  const [cardId, setCardId] = useState<string | undefined>();

  const { data, isLoading } = useQuery({
    queryKey: ['credit-card', month, cardId],
    queryFn: () => api.get<CreditCardResponse>('/dashboard/credit-card', { month, cardId }),
  });

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Skeleton className="h-48" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  if (!data.card) {
    return (
      <Card>
        <CardTitle title="Nenhum cartao cadastrado" subtitle="Cadastre um cartao para acompanhar faturas." />
      </Card>
    );
  }

  const { card, openInvoice: invoice, stats } = data;
  const composition = Object.entries(invoice.composition).filter(([, value]) => value > 0);
  const compositionMax = Math.max(...composition.map(([, value]) => value), 1);

  return (
    <div className="space-y-3">
      {data.cards.length > 1 && (
        <div className="flex justify-end">
          <Segmented
            ariaLabel="Cartao"
            value={card.id}
            onChange={setCardId}
            options={data.cards.map((option) => ({
              value: option.id,
              label: `${option.name}${option.lastFour ? ` · ${option.lastFour}` : ''}`,
            }))}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="space-y-3">
          {/*
            O card da fatura aberta e o unico elemento ESCURO do produto. Ele
            carrega o numero que motiva a visita — quanto ja se gastou no ciclo
            que ainda esta correndo — e a inversao de superficie o destaca sem
            gastar mais uma cor.
          */}
          <div className="rounded-[var(--radius-card)] bg-[var(--color-ink)] p-5 text-white">
            <div className="mb-3 flex items-start justify-between gap-3">
              <p className="text-xs text-white/60">
                Fatura aberta · {card.name}
                {card.lastFour && ` · ${card.lastFour}`}
              </p>
              <span className="num rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">
                {card.brand}
              </span>
            </div>

            <p className="num text-[32px] leading-none font-semibold">{money(invoice.posted)}</p>

            <p className="mt-3 text-xs text-white/60">
              Fecha em <span className="num">{fullDate(invoice.closingDate).slice(0, 5)}</span> ·
              vence <span className="num">{fullDate(invoice.dueDate).slice(0, 5)}</span>
            </p>

            <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-[var(--color-teal-bright)] transition-[width] duration-500"
                style={{ width: `${Math.min(invoice.percent, 100)}%` }}
              />
            </div>

            <div className="mt-2.5 flex items-baseline justify-between gap-3 text-[11px] text-white/55">
              <span className="num">
                {invoice.elapsedDays} de {invoice.totalDays} dias do ciclo
              </span>
              <span>
                Projetado no fechamento{' '}
                <span className="num text-white/80">{money(invoice.projectedAtClosing)}</span>
              </span>
            </div>
          </div>

          <Card>
            <CardTitle title="Composicao da fatura" subtitle="O que forma o total projetado" />
            {composition.length === 0 ? (
              <p className="py-6 text-center text-xs text-[var(--color-faint)]">
                Nenhum lancamento neste ciclo.
              </p>
            ) : (
              <ul className="space-y-3">
                {composition
                  .sort(([, a], [, b]) => b - a)
                  .map(([kind, value]) => (
                    <li key={kind}>
                      <div className="mb-1.5 flex items-baseline justify-between gap-3">
                        <span className="text-[13px]">{invoiceLineLabel(kind)}</span>
                        <span className="num shrink-0 text-[13px] text-[var(--color-text-secondary)]">
                          {money(value)}
                        </span>
                      </div>
                      <Progress value={(value / compositionMax) * 100} color="var(--color-teal)" />
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          <CardTitle
            title="Faturas por mes"
            subtitle="Barras cheias realizadas, contornadas projetadas"
          />
          <InvoiceBars data={data.series} />

          <div className="mt-5 grid grid-cols-3 gap-4 border-t border-[var(--color-line)] pt-4">
            <Stat label="Media 6 meses" value={money(stats.averageSixMonths)} />
            <Stat label="Maior fatura" value={money(stats.highestInvoice)} />
            <Stat
              label="Limite usado"
              value={percentWhole(stats.limitUsedPercent)}
              hint={`de ${money(stats.limitAmount)}`}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--color-muted)]">{label}</p>
      <p className="num mt-1 text-[17px] font-semibold">{value}</p>
      {hint && <p className="num mt-0.5 text-[10px] text-[var(--color-faint)]">{hint}</p>}
    </div>
  );
}
