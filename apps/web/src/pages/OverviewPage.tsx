import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, Inbox } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useWorkspace } from '../app/workspace';
import { BalanceChart } from '../components/charts';
import { GettingStarted } from '../components/GettingStarted';
import {
  Badge,
  Card,
  CardTitle,
  EmptyState,
  Progress,
  Skeleton,
  StatGridSkeleton,
  StatTile,
  type Tone,
} from '../components/ui';
import { api } from '../lib/api';
import {
  decimal,
  fullDate,
  money,
  monthTitle,
  percentWhole,
  signedCompact,
  signedPercent,
} from '../lib/format';
import type { OverviewResponse } from '../lib/types';

export function OverviewPage() {
  const { month } = useWorkspace();
  const { data, isLoading } = useQuery({
    queryKey: ['overview', month],
    queryFn: () => api.get<OverviewResponse>('/dashboard/overview', { month }),
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <StatGridSkeleton count={5} />
        <StatGridSkeleton count={3} />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const { metrics: m } = data;

  /*
   * Workspace sem nada cadastrado não mostra oito KPIs zerados.
   *
   * Zero aqui não é informação — é a ausência dela, e a tela cheia de "R$ 0"
   * não diz o que fazer a seguir. O critério é conta E contexto: sem conta
   * conectada e sem nenhum gasto, ainda não existe nada para medir.
   */
  const isEmpty =
    m.connectedAccounts === 0 && data.categorySpend.length === 0 && m.currentBalance === 0;

  if (isEmpty) {
    return (
      <div className="space-y-3">
        <GettingStarted />
        <p className="text-center text-[12px] text-[var(--color-muted)]">
          Assim que houver uma conta e um lancamento, o painel completo aparece aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* --- KPIs: cinco no topo, tres na segunda linha ------------------- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="Saldo atual"
          value={money(m.currentBalance)}
          badge={signedCompact(m.balanceDelta)}
          badgeTone={m.balanceDelta >= 0 ? 'positive' : 'negative'}
          caption={`Somando ${m.connectedAccounts} contas conectadas`}
        />

        <StatTile
          label="Fatura atual do cartao"
          value={money(m.openInvoiceTotal)}
          badge={`${percentWhole(m.openInvoiceCycleProgress)} do ciclo`}
          badgeTone="neutral"
          caption={
            m.openInvoiceClosingDate
              ? `Fecha em ${fullDate(m.openInvoiceClosingDate).slice(0, 5)}`
              : 'Sem cartao ativo'
          }
        />

        {/*
          O tom do badge segue o SIGNIFICADO, nao o sinal. Uma fatura 56% maior
          e um alerta, ainda que o numero venha com "+". Colorir por sinal
          faria a tela dar boas-vindas a uma piora.
        */}
        <StatTile
          label="Fatura projetada"
          value={money(m.projectedInvoiceTotal)}
          badge={m.projectedInvoiceVariation !== null ? signedPercent(m.projectedInvoiceVariation) : undefined}
          badgeTone={invoiceTrendTone(m.projectedInvoiceVariation)}
          caption={
            m.projectedInvoiceInstallmentCount > 0
              ? `Inclui ${m.projectedInvoiceInstallmentCount} parcelas em curso`
              : 'Estimativa no fechamento do ciclo'
          }
        />

        {/*
          O que voce PROGRAMOU aparece dentro da sobra, com o antes ao lado.
          Um numero unico esconderia que parte do aperto e escolha sua deste
          mes e nao compromisso ja firmado — que e justamente a parte sobre a
          qual voce ainda pode mudar de ideia.
        */}
        <StatTile
          label="Sobra prevista no mes"
          value={money(m.monthSurplus)}
          valueTone={m.monthSurplus < 0 ? 'negative' : undefined}
          badge={signedCompact(m.monthSurplusDelta)}
          badgeTone={m.monthSurplusDelta >= 0 ? 'positive' : 'negative'}
          caption={
            m.plannedCashThisMonth > 0
              ? `Era ${money(m.monthSurplusBeforePlans)} · ${money(m.plannedCashThisMonth)} de planos saem neste mes`
              : 'Depois de contas fixas e cartao'
          }
        />

        <StatTile
          label="Gasto vs mes anterior"
          value={m.spendVariation !== null ? signedPercent(m.spendVariation) : '—'}
          valueTone={m.spendVariation !== null && m.spendVariation > 0 ? 'negative' : undefined}
          badge={signedCompact(m.spendDelta)}
          badgeTone={m.spendDelta > 0 ? 'negative' : 'positive'}
          caption={topCategoriesCaption(data)}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/*
          Sem renda lancada nao existe razao a calcular. E, mesmo com renda, um
          comprometimento acima de 999% nao acrescenta nada ao que "acima de
          999%" ja diz — o digito exato so rouba espaco e assusta.
        */}
        <StatTile
          label="Comprometimento da renda"
          value={
            m.incomeCommitment === null
              ? '—'
              : m.incomeCommitment > 999
                ? '> 999%'
                : percentWhole(m.incomeCommitment)
          }
          valueTone={
            m.incomeCommitment !== null && m.incomeCommitment > data.commitmentTarget
              ? 'warning'
              : undefined
          }
          badge={
            m.incomeCommitmentDelta !== null
              ? `${m.incomeCommitmentDelta >= 0 ? '+' : ''}${decimal(m.incomeCommitmentDelta)} p.p.`
              : undefined
          }
          badgeTone={(m.incomeCommitmentDelta ?? 0) > 0 ? 'negative' : 'positive'}
          caption={
            m.incomeCommitment === null
              ? 'Lance sua renda do mes para calcular'
              : `Meta do plano: ate ${data.commitmentTarget}%`
          }
        />

        <StatTile
          label="Parcelas futuras"
          value={money(m.futureInstallmentsTotal)}
          badge={`${m.futureInstallmentsCount} compras`}
          badgeTone="neutral"
          caption={
            m.futureInstallmentsLastMonth
              ? `A vencer ate ${monthTitle(m.futureInstallmentsLastMonth).toLowerCase()}`
              : 'Nenhuma parcela em aberto'
          }
        />

        <StatTile
          label="Reserva de emergencia"
          value={m.emergencyRunwayMonths === null ? '—' : `${decimal(m.emergencyRunwayMonths)} meses`}
          valueTone={
            m.emergencyRunwayMonths !== null && m.emergencyRunwayMonths < 3 ? 'warning' : undefined
          }
          badge={
            m.emergencyRunwayDelta !== null
              ? `${m.emergencyRunwayDelta >= 0 ? '+' : ''}${decimal(m.emergencyRunwayDelta)}`
              : undefined
          }
          badgeTone={(m.emergencyRunwayDelta ?? 0) >= 0 ? 'positive' : 'negative'}
          caption={
            m.emergencyRunwayMonths === null
              ? 'Cadastre suas contas fixas para calcular'
              : 'Cobertura de custo fixo'
          }
        />
      </div>

      {/* --- Grafico + categorias ---------------------------------------- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <Card>
          <CardTitle
            title="Saldo consolidado e projecao"
            subtitle="Realizado ate hoje, projetado por recorrencias e parcelas lancadas"
          />
          <BalanceChart data={data.balanceSeries} />
        </Card>

        <Card>
          <CardTitle title="Gasto por categoria" subtitle="No mes, em relacao ao orcamento" />
          {data.categorySpend.length === 0 ? (
            <EmptyState title="Nenhum gasto categorizado" description="Lance uma despesa para ver a distribuicao." />
          ) : (
            <ul className="space-y-3">
              {data.categorySpend.map((row) => (
                <li key={row.categoryId}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13px] font-medium">{row.categoryName}</span>
                    <span className="num shrink-0 text-[13px] text-[var(--color-text-secondary)]">
                      {money(row.spent)}
                    </span>
                  </div>
                  <Progress value={row.usage ?? 0} status={row.status ?? 'ON_TRACK'} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* --- Parcelas futuras + alertas ---------------------------------- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardTitle
            title="Parcelas futuras a vencer"
            subtitle="Compromissos ja assumidos, agrupados por compra"
            action={
              <Link
                to="/transacoes"
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-teal)] hover:underline"
              >
                Ver todas <ArrowRight className="size-3" />
              </Link>
            }
          />
          {data.futureInstallments.length === 0 ? (
            <EmptyState
              icon={<Inbox className="size-6" />}
              title="Nenhuma parcela em aberto"
              description="Compras parceladas aparecem aqui com o que ainda falta pagar."
            />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {data.futureInstallments.slice(0, 5).map((item) => (
                <li key={item.groupId} className="flex items-center gap-3 py-2.5 first:pt-0">
                  <span className="num grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--color-surface-sunken)] text-[10px] font-semibold text-[var(--color-text-secondary)]">
                    {item.paidCount}/{item.totalCount}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      {item.description}
                      {item.merchant && (
                        <span className="font-normal text-[var(--color-muted)]"> · {item.merchant}</span>
                      )}
                    </p>
                    <p className="text-[11px] text-[var(--color-muted)]">
                      ate {monthTitle(item.lastMonth).toLowerCase()}
                    </p>
                  </div>
                  <span className="num shrink-0 text-[13px] font-medium">{money(item.nextAmount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle
            title="Precisa de atencao"
            subtitle="Avisos derivados do estado atual das contas"
            action={
              data.alerts.length > 3 ? (
                <Link
                  to="/alertas"
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-teal)] hover:underline"
                >
                  Ver {data.alerts.length} <ArrowRight className="size-3" />
                </Link>
              ) : undefined
            }
          />
          {data.alerts.length === 0 ? (
            <EmptyState title="Nada exigindo acao" description="Orcamentos, faturas e saldo dentro do esperado." />
          ) : (
            <ul className="space-y-2">
              {data.alerts.slice(0, 3).map((alert) => (
                <li key={alert.id}>
                  <AlertRow
                    severity={alert.severity}
                    title={alert.title}
                    description={alert.description}
                    href={alert.href}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * Linha de alerta.
 *
 * A severidade nunca e so cor: vem com um ponto colorido E um rotulo textual,
 * porque cor sozinha exclui quem nao a distingue e some em impressao.
 */
export function AlertRow({
  severity,
  title,
  description,
  href,
}: {
  severity: string;
  title: string;
  description: string;
  href: string | null;
}) {
  const tone: Tone =
    severity === 'CRITICAL' ? 'negative' : severity === 'WARNING' ? 'warning' : 'neutral';
  const label = severity === 'CRITICAL' ? 'Critico' : severity === 'WARNING' ? 'Atencao' : 'Info';
  const dotColor =
    severity === 'CRITICAL'
      ? 'var(--color-negative)'
      : severity === 'WARNING'
        ? 'var(--color-warning)'
        : 'var(--color-muted)';
  const background =
    severity === 'CRITICAL'
      ? 'var(--color-negative-soft)'
      : severity === 'WARNING'
        ? 'var(--color-warning-soft)'
        : 'var(--color-surface-sunken)';

  const content = (
    <div className="rounded-[var(--radius-control)] px-3 py-2.5" style={{ background }}>
      <div className="flex items-start gap-2">
        <span
          className="mt-1.5 size-1.5 shrink-0 rounded-full"
          style={{ background: dotColor }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="text-[13px] font-medium text-[var(--color-text)]">{title}</p>
            <Badge tone={tone} mono={false} className="shrink-0">
              {label}
            </Badge>
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
            {description}
          </p>
        </div>
      </div>
    </div>
  );

  return href ? (
    <Link to={href} className="block transition-opacity hover:opacity-80">
      {content}
    </Link>
  ) : (
    content
  );
}

function invoiceTrendTone(variation: number | null): Tone {
  if (variation === null) return 'neutral';
  if (variation > 25) return 'negative';
  if (variation > 5) return 'warning';
  return 'positive';
}

function topCategoriesCaption(data: OverviewResponse): string {
  const overspent = data.categorySpend
    .filter((row) => row.status === 'EXCEEDED' || row.status === 'WARNING')
    .slice(0, 2)
    .map((row) => row.categoryName.toLowerCase());

  if (overspent.length === 0) return 'Todas as categorias no trilho';
  return `Alta em ${overspent.join(' e ')}`;
}

export { AlertCircle };
