import { Injectable } from '@nestjs/common';
import {
  addMonthsToYearMonth,
  buildBalanceSeries,
  buildIncomeExpenseSeries,
  computeCategorySpend,
  computeDashboardMetrics,
  cycleForReferenceMonth,
  cycleProgress,
  percentOf,
  projectCardInvoices,
  resolveCycleForPurchase,
  projectCashflow,
  toYearMonth,
  type YearMonth,
} from '@finflow/shared';
import { SnapshotService, type DomainSnapshot } from '../domain/snapshot.service';
import { AlertsService } from './alerts.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly snapshots: SnapshotService,
    private readonly alerts: AlertsService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*  Tela "Visao geral"                                                */
  /* ------------------------------------------------------------------ */

  async overview(organizationId: string, month?: string) {
    const snapshot = await this.snapshots.load(organizationId);
    const target = (month ?? toYearMonth(snapshot.today)) as YearMonth;

    const metrics = computeDashboardMetrics({ ...snapshot, month: target });

    // A serie do grafico abre 6 meses atras para o usuario ver de onde veio,
    // nao so para onde vai — a linha solida da contexto a tracejada.
    const seriesStart = addMonthsToYearMonth(target, -6);
    const projection = projectCashflow({
      ...snapshot,
      from: seriesStart,
      months: 6 + snapshot.organization.projectionHorizon + 1,
    });

    const currentMonth = projection.months.find((m) => m.month === target);

    const [categorySpend, alerts] = await Promise.all([
      Promise.resolve(
        computeCategorySpend({
          month: target,
          spendByCategory: currentMonth?.byCategory ?? {},
          categories: snapshot.categories,
          budgets: snapshot.budgets,
        }),
      ),
      this.alerts.list(organizationId, target),
    ]);

    return {
      month: target,
      today: snapshot.today,
      commitmentTarget: snapshot.organization.commitmentTarget,
      metrics,
      balanceSeries: buildBalanceSeries(projection, snapshot.today),
      categorySpend: categorySpend.slice(0, 8),
      futureInstallments: this.futureInstallments(snapshot, target),
      alerts,
    };
  }

  /**
   * "Parcelas futuras a vencer" — agrupado por COMPRA, nao por parcela.
   *
   * A lista mostra "Notebook Dell · 4/10 · ate abril 2027": o usuario pensa em
   * compras que ainda esta pagando, e cada parcela numa linha separada
   * transformaria oito compras em oitenta linhas.
   */
  private futureInstallments(snapshot: DomainSnapshot, month: YearMonth) {
    const cardsById = new Map(snapshot.cards.map((card) => [card.id, card]));
    const groups = new Map<
      string,
      {
        groupId: string;
        description: string;
        merchant: string | null;
        cardId: string | null;
        paidCount: number;
        totalCount: number;
        remainingAmount: number;
        nextAmount: number;
        lastMonth: YearMonth;
      }
    >();

    for (const tx of snapshot.transactions) {
      if (!tx.creditCardId || (tx.installmentTotal ?? 1) <= 1) continue;
      const card = cardsById.get(tx.creditCardId);
      if (!card) continue;

      const groupId = tx.installmentGroupId ?? tx.id;
      // O rotulo da compra sem o sufixo " · parcela N/M" gerado na criacao.
      const label = tx.description.replace(/\s·\s*parcela\s+\d+\/\d+$/i, '');
      const cycle = cycleForReferenceMonth(
        toYearMonth(tx.date) as YearMonth,
        card,
      );
      const referenceMonth = cycle.referenceMonth;

      const existing = groups.get(groupId) ?? {
        groupId,
        description: label,
        merchant: tx.merchant,
        cardId: tx.creditCardId,
        paidCount: 0,
        totalCount: tx.installmentTotal ?? 1,
        remainingAmount: 0,
        nextAmount: 0,
        lastMonth: referenceMonth,
      };

      if (referenceMonth <= month) {
        existing.paidCount = Math.max(existing.paidCount, tx.installmentNumber ?? 0);
      } else {
        existing.remainingAmount += tx.amount;
        if (existing.nextAmount === 0) existing.nextAmount = tx.amount;
        if (referenceMonth > existing.lastMonth) existing.lastMonth = referenceMonth;
      }

      groups.set(groupId, existing);
    }

    return [...groups.values()]
      .filter((group) => group.remainingAmount > 0)
      .sort((a, b) => b.remainingAmount - a.remainingAmount);
  }

  /* ------------------------------------------------------------------ */
  /*  Tela "Conta corrente"                                             */
  /* ------------------------------------------------------------------ */

  async checkingAccount(organizationId: string, month?: string) {
    const snapshot = await this.snapshots.load(organizationId);
    const target = (month ?? toYearMonth(snapshot.today)) as YearMonth;

    // Doze meses de barras: seis para tras, o corrente e o restante projetado.
    const from = addMonthsToYearMonth(target, -5);
    const projection = projectCashflow({ ...snapshot, from, months: 12 });
    const current = projection.months.find((m) => m.month === target);

    const forward = projectCashflow({ ...snapshot, from: target, months: 12 });

    return {
      month: target,
      today: snapshot.today,
      kpis: {
        income: current?.income ?? 0,
        expenses: current?.expenses ?? 0,
        net: current?.net ?? 0,
        lowestProjectedBalance: forward.lowestBalance,
        lowestProjectedMonth: forward.lowestBalanceMonth,
      },
      series: buildIncomeExpenseSeries(projection, snapshot.today),
      accounts: snapshot.accounts.filter((account) => account.isActive),
      recurrences: snapshot.recurrences
        .filter((rule) => rule.isActive && rule.paymentMethod !== 'CREDIT')
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'INCOME' ? -1 : 1;
          return b.amount - a.amount;
        })
        .map((rule) => ({
          id: rule.id,
          description: rule.description,
          amount: rule.amount,
          type: rule.type,
          dayOfMonth: rule.dayOfMonth,
          label: rule.label ?? (rule.type === 'INCOME' ? 'Entrada fixa' : 'Debito automatico'),
        })),
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Tela "Cartao de credito"                                          */
  /* ------------------------------------------------------------------ */

  async creditCard(organizationId: string, cardId?: string, month?: string) {
    const snapshot = await this.snapshots.load(organizationId);
    const target = (month ?? toYearMonth(snapshot.today)) as YearMonth;

    // Sem cartao explicito, abre no principal — o de maior limite. Ordem
    // alfabetica abriria num cartao secundario e faria a tela parecer vazia.
    const card =
      snapshot.cards.find((c) => c.id === cardId) ??
      [...snapshot.cards]
        .filter((c) => c.isActive)
        .sort((a, b) => b.limitAmount - a.limitAmount)[0];

    if (!card) {
      return { month: target, today: snapshot.today, card: null, cards: [] };
    }

    // O ciclo aberto e, por definicao, o que receberia uma compra feita hoje.
    // Derivar de `mes + 1` daria certo para um cartao que vence no mes seguinte
    // e erraria para um que fecha e vence no mesmo mes.
    const cycle = resolveCycleForPurchase(snapshot.today, card);
    const openMonth = cycle.referenceMonth;
    const progress = cycleProgress(cycle, snapshot.today);

    const series = projectCardInvoices({
      ...snapshot,
      cardId: card.id,
      from: addMonthsToYearMonth(target, -3),
      months: 10,
    });

    const openInvoice = series.find((invoice) => invoice.referenceMonth === openMonth);

    // Gasto ja lancado no ciclo corrente contra o total projetado no fechamento:
    // a diferenca e o que as recorrencias ainda vao adicionar ate fechar.
    const postedInCycle = snapshot.transactions
      .filter(
        (tx) =>
          tx.creditCardId === card.id &&
          tx.date >= cycle.periodStart &&
          tx.date <= snapshot.today,
      )
      .reduce((sum, tx) => sum + tx.amount, 0);

    const closed = series.filter((invoice) => !invoice.isProjected && invoice.total > 0);
    const lastSix = closed.slice(-6);
    const average =
      lastSix.length === 0
        ? 0
        : Math.round(lastSix.reduce((sum, invoice) => sum + invoice.total, 0) / lastSix.length);
    const highest = series.reduce((max, invoice) => Math.max(max, invoice.total), 0);

    return {
      month: target,
      today: snapshot.today,
      card: {
        id: card.id,
        name: card.name,
        brand: card.brand,
        lastFour: card.lastFour,
        color: card.color,
        limitAmount: card.limitAmount,
        closingDay: card.closingDay,
        dueDay: card.dueDay,
      },
      cards: snapshot.cards.map((c) => ({
        id: c.id,
        name: c.name,
        brand: c.brand,
        lastFour: c.lastFour,
      })),
      openInvoice: {
        referenceMonth: openMonth,
        posted: postedInCycle,
        projectedAtClosing: openInvoice?.total ?? 0,
        closingDate: cycle.closingDate,
        dueDate: cycle.dueDate,
        elapsedDays: progress.elapsedDays,
        totalDays: progress.totalDays,
        percent: progress.percent,
        composition: openInvoice?.composition ?? {
          INSTALLMENT: 0,
          ONE_OFF: 0,
          SUBSCRIPTION: 0,
          FEE: 0,
        },
      },
      series,
      stats: {
        averageSixMonths: average,
        highestInvoice: highest,
        limitAmount: card.limitAmount,
        limitUsedPercent:
          card.limitAmount > 0 ? percentOf(openInvoice?.total ?? 0, card.limitAmount) : 0,
      },
    };
  }
}
