import { Injectable } from '@nestjs/common';
import {
  addMonthsToYearMonth,
  computeCategorySpend,
  formatCurrency,
  formatISODateBR,
  formatYearMonthShort,
  percentOf,
  projectCashflow,
  toYearMonth,
  type Alert,
  type YearMonth,
} from '@finflow/shared';
import { SnapshotService } from '../domain/snapshot.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Deriva os avisos do painel "Precisa de atencao".
 *
 * Alertas sao CALCULADOS a cada leitura, nunca persistidos. Um alerta guardado
 * em tabela envelhece: o orcamento volta ao normal e o aviso continua la ate
 * alguem rodar um job de limpeza. Derivando do estado, o aviso some no instante
 * em que a causa some.
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly snapshots: SnapshotService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * @param preloaded snapshot ja carregado por quem chamou. Sem isto, a Visao
   *   geral carregava o estado da organizacao DUAS vezes na mesma requisicao —
   *   9 consultas desperdicadas, cada uma pagando a latencia ate o banco.
   */
  async list(
    organizationId: string,
    month?: string,
    preloaded?: Awaited<ReturnType<SnapshotService['load']>>,
  ): Promise<Alert[]> {
    const snapshot = preloaded ?? (await this.snapshots.load(organizationId));
    const target = (month ?? toYearMonth(snapshot.today)) as YearMonth;
    const alerts: Alert[] = [];

    const projection = projectCashflow({ ...snapshot, from: addMonthsToYearMonth(target, -6), months: 19 });
    const byMonth = new Map(projection.months.map((m) => [m.month, m]));

    /* --- Fatura acima da media ------------------------------------------- */

    const history = projection.months
      .filter((m) => m.month < target && m.invoices.length > 0)
      .slice(-6);
    const average =
      history.length === 0
        ? 0
        : history.reduce((sum, m) => sum + m.invoices.reduce((s, i) => s + i.total, 0), 0) /
          history.length;

    const nextMonth = addMonthsToYearMonth(target, 1);
    const nextInvoiceTotal = (byMonth.get(nextMonth)?.invoices ?? []).reduce(
      (sum, invoice) => sum + invoice.total,
      0,
    );

    if (average > 0 && nextInvoiceTotal > average * 1.2) {
      const overshoot = Math.round(percentOf(nextInvoiceTotal - average, average));
      const installments = (byMonth.get(nextMonth)?.invoices ?? []).reduce(
        (sum, invoice) => sum + invoice.installmentCount,
        0,
      );
      alerts.push({
        id: `invoice-spike-${nextMonth}`,
        severity: overshoot > 40 ? 'CRITICAL' : 'WARNING',
        title: `Fatura de ${formatYearMonthShort(nextMonth)} ${overshoot}% acima da media`,
        description:
          installments > 0
            ? `${installments} parcelas entram no ciclo. Projetado: ${formatCurrency(nextInvoiceTotal)} contra media de ${formatCurrency(Math.round(average))}.`
            : `Projetado: ${formatCurrency(nextInvoiceTotal)} contra media de ${formatCurrency(Math.round(average))}.`,
        href: '/cartao-de-credito',
        createdAt: snapshot.today,
      });
    }

    /* --- Orcamentos estourados ------------------------------------------- */

    const spend = computeCategorySpend({
      month: target,
      spendByCategory: byMonth.get(target)?.byCategory ?? {},
      categories: snapshot.categories,
      budgets: snapshot.budgets,
    });

    for (const row of spend.filter((r) => r.status === 'EXCEEDED')) {
      alerts.push({
        id: `budget-exceeded-${row.categoryId}`,
        severity: 'CRITICAL',
        title: `${row.categoryName} estourou o orcamento`,
        description: `${formatCurrency(row.spent)} gastos contra um limite de ${formatCurrency(row.budget ?? 0)}.`,
        href: '/orcamentos',
        createdAt: snapshot.today,
      });
    }

    /* --- Saldo projetado negativo ----------------------------------------- */

    const forward = projectCashflow({ ...snapshot, from: target, months: 12 });
    if (forward.monthsUntilNegative !== null) {
      const monthLabel = formatYearMonthShort(forward.lowestBalanceMonth);
      alerts.push({
        id: `negative-balance-${forward.lowestBalanceMonth}`,
        severity: 'CRITICAL',
        title: `Saldo fica negativo em ${monthLabel}`,
        description: `Menor saldo projetado: ${formatCurrency(forward.lowestBalance)}. Revise as parcelas e contas fixas do periodo.`,
        href: '/projecoes',
        createdAt: snapshot.today,
      });
    }

    /* --- Comprometimento de renda acima da meta --------------------------- */

    const current = byMonth.get(target);
    /*
     * O piso de renda existe para o alerta nao virar ruido.
     *
     * Com R$ 1 de renda lancada e R$ 250 de gasto, a razao da 25.000% e o
     * aviso subia como CRITICO — por um numero que so existe porque a renda
     * ainda nao foi registrada. Alerta que dispara sem causa real e o caminho
     * mais curto para o usuario parar de ler alertas.
     */
    const MIN_INCOME_FOR_COMMITMENT = 10_000; // R$ 100,00
    if (current && current.income >= MIN_INCOME_FOR_COMMITMENT) {
      const commitment = percentOf(current.expenses, current.income);
      const goal = snapshot.organization.commitmentTarget;
      if (commitment > goal) {
        alerts.push({
          id: `commitment-${target}`,
          severity: commitment > goal + 15 ? 'CRITICAL' : 'WARNING',
          title: `Comprometimento da renda em ${commitment.toFixed(0)}%`,
          description: `A meta do plano e ate ${goal}%. Sobram ${formatCurrency(current.net)} depois das contas fixas e do cartao.`,
          href: '/projecoes',
          createdAt: snapshot.today,
        });
      }
    }

    /* --- Consentimento Open Finance a vencer ------------------------------ */

    const connections = await this.prisma.bankConnection.findMany({ where: { organizationId } });
    for (const connection of connections) {
      if (connection.status === 'CONSENT_EXPIRED' || connection.status === 'NEEDS_ACTION') {
        alerts.push({
          id: `connection-${connection.id}`,
          severity: 'WARNING',
          title: `${connection.institutionName} precisa de reconexao`,
          description:
            connection.lastError ??
            'O consentimento Open Finance venceu. Sem renovar, os lancamentos param de chegar.',
          href: '/contas',
          createdAt: snapshot.today,
        });
        continue;
      }
      if (connection.consentExpiresAt) {
        const daysLeft = daysBetweenISO(snapshot.today, connection.consentExpiresAt);
        if (daysLeft <= 30 && daysLeft >= 0) {
          alerts.push({
            id: `consent-${connection.id}`,
            severity: daysLeft <= 7 ? 'WARNING' : 'INFO',
            title: `Consentimento de ${connection.institutionName} vence em ${daysLeft} dias`,
            description: `Renove ate ${formatISODateBR(connection.consentExpiresAt)} para nao interromper a sincronizacao.`,
            href: '/contas',
            createdAt: snapshot.today,
          });
        }
      }
    }

    const severityWeight = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
    return alerts.sort((a, b) => severityWeight[a.severity] - severityWeight[b.severity]);
  }
}

function daysBetweenISO(from: string, to: string): number {
  const parse = (value: string): number => {
    const [y, m, d] = value.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}
