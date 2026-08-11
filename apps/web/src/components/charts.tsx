import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { YearMonth } from '@finflow/shared';
import { compactAmount, money, monthShort } from '../lib/format';

/*
 * REGRAS DE COR DESTES GRAFICOS (validadas com scripts/validate_palette.js):
 *
 * - Saldo: UMA entidade em dois ESTADOS. Mesma cor (teal), estilo de traco
 *   diferente. Duas cores aqui diriam "duas coisas distintas", e nao sao.
 * - Entradas x saidas: POLARIDADE, nao identidade — teal e tijolo, o par
 *   quente/frio. Projetado usa o mesmo par com opacidade reduzida, porque
 *   continua sendo a mesma grandeza, so que estimada.
 * - Faturas: uma serie so; realizado preenchido, projetado contornado. O
 *   contorno vazado carrega "ainda nao aconteceu" sem gastar uma cor.
 *
 * Nenhum grafico tem dois eixos Y. Nenhum rotula todos os pontos.
 */

/* -------------------------------------------------------------------------- */
/*  Saldo consolidado e projecao                                              */
/* -------------------------------------------------------------------------- */

interface BalancePoint {
  month: YearMonth;
  balance: number;
  isProjected: boolean;
}

export function BalanceChart({ data, height = 260 }: { data: BalancePoint[]; height?: number }) {
  /**
   * O ponto de fronteira entra nas DUAS series de proposito. Sem ele, a linha
   * tracejada comeca solta e aparece um vao entre o ultimo ponto realizado e o
   * primeiro projetado.
   */
  const series = useMemo(() => {
    const firstProjectedIndex = data.findIndex((point) => point.isProjected);
    return data.map((point, index) => ({
      month: point.month,
      label: monthShort(point.month),
      realizado: point.isProjected ? null : point.balance,
      projetado:
        point.isProjected || (firstProjectedIndex > 0 && index === firstProjectedIndex - 1)
          ? point.balance
          : null,
    }));
  }, [data]);

  if (data.length === 0) return <ChartEmpty height={height} />;

  return (
    <div>
      <div className="mb-2 flex items-center justify-end gap-4 text-[11px] text-[var(--color-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="2" aria-hidden="true">
            <line x1="0" y1="1" x2="18" y2="1" stroke="var(--color-teal)" strokeWidth="2" />
          </svg>
          Realizado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="2" aria-hidden="true">
            <line
              x1="0"
              y1="1"
              x2="18"
              y2="1"
              stroke="var(--color-teal)"
              strokeWidth="2"
              strokeDasharray="4 3"
            />
          </svg>
          Projetado
        </span>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="fillSaldo" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-teal)" stopOpacity={0.14} />
              <stop offset="100%" stopColor="var(--color-teal)" stopOpacity={0.01} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="var(--color-line)" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
            dy={6}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={54}
            tick={{ fontSize: 11, fill: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}
            tickFormatter={(value: number) => compactAmount(value)}
          />
          <Tooltip
            cursor={{ stroke: 'var(--color-line-strong)', strokeWidth: 1 }}
            content={<BalanceTooltip />}
          />

          <Area
            type="monotone"
            dataKey="realizado"
            stroke="none"
            fill="url(#fillSaldo)"
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="realizado"
            stroke="var(--color-teal)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: 'var(--color-teal)', stroke: 'white', strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="projetado"
            stroke="var(--color-teal)"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={{ r: 3.5, fill: 'white', stroke: 'var(--color-teal)', strokeWidth: 2 }}
            activeDot={{ r: 4.5, fill: 'white', stroke: 'var(--color-teal)', strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function BalanceTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number | null }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload.find((entry) => entry.value !== null);
  if (!point) return null;

  return (
    <div className="card px-3 py-2 shadow-md">
      <p className="text-[11px] text-[var(--color-muted)]">{label}</p>
      <p className="num text-[13px] font-semibold">{money(point.value ?? 0)}</p>
      <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">
        {point.dataKey === 'projetado' ? 'Projetado' : 'Realizado'}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Entradas e saidas (barras agrupadas)                                      */
/* -------------------------------------------------------------------------- */

interface IncomeExpensePoint {
  month: YearMonth;
  income: number;
  expenses: number;
  isProjected: boolean;
}

/**
 * Barras em CSS, nao em Recharts.
 *
 * O desenho pedido nao tem eixo Y nem grade: sao pares de barras com o rotulo
 * do mes embaixo. Um flexbox faz exatamente isso em 40 linhas e da controle
 * pixel a pixel sobre o par realizado/projetado; a mesma coisa em Recharts
 * exigiria desligar metade dos componentes e escrever uma forma customizada.
 */
export function IncomeExpenseBars({ data, height = 240 }: { data: IncomeExpensePoint[]; height?: number }) {
  const max = Math.max(...data.flatMap((point) => [point.income, point.expenses]), 1);
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) return <ChartEmpty height={height} />;

  return (
    <div>
      <div className="mb-3 flex items-center justify-end gap-4 text-[11px] text-[var(--color-muted)]">
        <LegendSwatch color="var(--color-positive)" label="Entradas" />
        <LegendSwatch color="var(--color-negative)" label="Saidas" />
        <span className="text-[10px]">· tom claro = projetado</span>
      </div>

      <div className="relative flex items-end gap-2" style={{ height }}>
        {data.map((point, index) => {
          const isHovered = hover === index;
          return (
            <div
              key={point.month}
              className="flex flex-1 flex-col items-center gap-1"
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
            >
              {isHovered && (
                <div className="card absolute top-0 z-10 px-3 py-2 shadow-md">
                  <p className="text-[11px] text-[var(--color-muted)]">
                    {monthShort(point.month)}
                    {point.isProjected && ' · projetado'}
                  </p>
                  <p className="num text-[12px] text-[var(--color-positive)]">
                    + {money(point.income)}
                  </p>
                  <p className="num text-[12px] text-[var(--color-negative)]">
                    − {money(point.expenses)}
                  </p>
                </div>
              )}

              {/* 2px de respiro entre as barras do par para elas nao se fundirem. */}
              <div className="flex w-full items-end justify-center gap-[3px]" style={{ height }}>
                <Bar
                  heightRatio={point.income / max}
                  color="var(--color-positive)"
                  faded={point.isProjected}
                />
                <Bar
                  heightRatio={point.expenses / max}
                  color="var(--color-negative)"
                  faded={point.isProjected}
                />
              </div>
              <span className="text-[10px] whitespace-nowrap text-[var(--color-muted)]">
                {monthShort(point.month).split('/')[0]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Bar({
  heightRatio,
  color,
  faded,
}: {
  heightRatio: number;
  color: string;
  faded: boolean;
}) {
  return (
    <div
      className="w-full max-w-[22px] rounded-t-[4px] transition-[height] duration-500"
      style={{
        height: `${Math.max(heightRatio * 100, 1)}%`,
        background: color,
        opacity: faded ? 0.35 : 1,
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Faturas por mes                                                           */
/* -------------------------------------------------------------------------- */

interface InvoiceBar {
  referenceMonth: YearMonth;
  total: number;
  isProjected: boolean;
}

/**
 * Barras cheias = fatura fechada; contornadas tracejadas = ainda projetada.
 * O valor vai ACIMA de cada barra, dispensando eixo Y — em uma serie de dez
 * meses, o rotulo direto e mais rapido de ler do que atravessar a grade.
 */
export function InvoiceBars({ data, height = 200 }: { data: InvoiceBar[]; height?: number }) {
  const max = Math.max(...data.map((invoice) => invoice.total), 1);
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) return <ChartEmpty height={height} />;

  return (
    <div className="flex items-end gap-2" style={{ height: height + 40 }}>
      {data.map((invoice, index) => (
        <div
          key={invoice.referenceMonth}
          className="flex flex-1 flex-col items-center"
          onMouseEnter={() => setHover(index)}
          onMouseLeave={() => setHover(null)}
        >
          <span
            className={
              invoice.isProjected
                ? 'num mb-1.5 text-[10px] text-[var(--color-faint)]'
                : 'num mb-1.5 text-[10px] text-[var(--color-text-secondary)]'
            }
          >
            {invoice.total > 0 ? compactAmount(invoice.total) : '—'}
          </span>

          <div className="flex w-full justify-center" style={{ height }}>
            <div
              className="w-full max-w-[46px] self-end rounded-t-[4px] transition-all duration-500"
              style={{
                height: `${Math.max((invoice.total / max) * 100, 2)}%`,
                background: invoice.isProjected ? 'transparent' : 'var(--color-ink)',
                border: invoice.isProjected ? '1.5px dashed var(--color-line-strong)' : 'none',
                opacity: hover === null || hover === index ? 1 : 0.55,
              }}
              title={`${monthShort(invoice.referenceMonth)}: ${money(invoice.total)}${invoice.isProjected ? ' (projetado)' : ''}`}
            />
          </div>

          <span className="mt-2 text-[10px] whitespace-nowrap text-[var(--color-muted)]">
            {monthShort(invoice.referenceMonth).split('/')[0]}
          </span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2 rounded-[2px]" style={{ background: color }} aria-hidden="true" />
      {label}
    </span>
  );
}

function ChartEmpty({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center text-xs text-[var(--color-faint)]"
      style={{ height }}
    >
      Sem dados no periodo.
    </div>
  );
}
