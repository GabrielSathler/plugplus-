import { addMonthsToYearMonth, toYearMonth, type ISODate, type YearMonth } from '../date.ts';
import { percentOf, variationPercent, type Cents } from '../money.ts';
import { cycleProgress, resolveCycleForPurchase } from './credit-card-cycle.ts';
import { summarizeFutureInstallments } from './installments.ts';
import { projectCashflow, type ProjectionInput } from './projection.ts';
import type {
  Budget,
  BudgetStatus,
  CategorySpend,
  DashboardMetrics,
  MonthProjection,
} from '../types.ts';

export interface DashboardInput extends Omit<ProjectionInput, 'from' | 'months'> {
  /** Competencia exibida na tela (seletor de mes do header). */
  month: YearMonth;
  /** Quantos meses a frente projetar para os KPIs prospectivos. */
  horizon?: number;
}

/**
 * KPIs da tela "Visao geral".
 *
 * Cada metrica vem acompanhada do seu delta contra a competencia anterior —
 * um numero sozinho ("81% de comprometimento") nao diz se a situacao esta
 * melhorando ou piorando, que e a unica coisa que motiva acao.
 */
export function computeDashboardMetrics(input: DashboardInput): DashboardMetrics {
  const { month, today, accounts, cards, horizon = 12 } = input;
  const previousMonth = addMonthsToYearMonth(month, -1);

  // Projetamos a partir do mes anterior para ter a base de comparacao de graca,
  // dentro da mesma passada do motor.
  const projection = projectCashflow({ ...input, from: previousMonth, months: horizon + 2 });
  const byMonth = new Map(projection.months.map((m) => [m.month, m]));

  const previous = byMonth.get(previousMonth);
  const current = byMonth.get(month);

  const includedAccounts = accounts.filter((a) => a.isActive && a.includeInTotals);
  const currentBalance = includedAccounts.reduce((sum, a) => sum + a.currentBalance, 0);

  /* --- Fatura em aberto ------------------------------------------------- */

  // "Fatura atual" e "Fatura projetada" sao o MESMO ciclo, nao dois meses: o
  // que ja foi lancado ate hoje contra o que se espera no fechamento. A
  // diferenca entre os dois e o que as recorrencias e as parcelas ainda vao
  // somar antes de o ciclo fechar — que e a informacao acionavel.
  //
  // O ciclo aberto agora e, por definicao, aquele que receberia uma compra
  // feita hoje.
  const openCycles = cards
    .filter((card) => card.isActive)
    .map((card) => {
      const cycle = resolveCycleForPurchase(today, card);
      const posted = input.transactions
        .filter(
          (tx) =>
            tx.creditCardId === card.id &&
            tx.type === 'EXPENSE' &&
            tx.date >= cycle.periodStart &&
            tx.date <= today,
        )
        .reduce((sum, tx) => sum + tx.amount, 0);

      const projected =
        byMonth
          .get(cycle.referenceMonth)
          ?.invoices.find((invoice) => invoice.creditCardId === card.id) ?? null;

      return { card, cycle, posted, projected };
    });

  const openInvoiceTotal = openCycles.reduce((sum, entry) => sum + entry.posted, 0);
  const projectedInvoiceTotal = openCycles.reduce(
    (sum, entry) => sum + (entry.projected?.total ?? entry.posted),
    0,
  );

  // Com mais de um cartao, as datas exibidas sao as do ciclo de maior valor —
  // e o que domina o impacto no caixa e o que o usuario quer acompanhar.
  const primaryCycle = [...openCycles].sort(
    (a, b) => (b.projected?.total ?? b.posted) - (a.projected?.total ?? a.posted),
  )[0];

  const openInvoiceCycleProgressValue = primaryCycle
    ? cycleProgress(primaryCycle.cycle, today).percent
    : 0;

  /* --- Parcelas futuras -------------------------------------------------- */

  const cardsConfig = Object.fromEntries(cards.map((card) => [card.id, card]));
  const futureInstallments = summarizeFutureInstallments(input.transactions, month, cardsConfig);

  /* --- Comprometimento da renda ------------------------------------------ */

  const commitment = (target?: MonthProjection): number => {
    if (!target || target.income === 0) return 0;
    return percentOf(target.expenses, target.income);
  };
  const incomeCommitment = commitment(current);
  const previousCommitment = commitment(previous);

  /* --- Reserva de emergencia --------------------------------------------- */

  // Custo fixo medio = media das saidas dos meses ja projetados no horizonte.
  // Usar a media (e nao o mes corrente) evita que um mes atipico — IPVA, viagem
  // — despenque a reserva e dispare um alerta falso.
  const horizonMonths = projection.months.slice(1, horizon + 1);
  const averageFixedCost =
    horizonMonths.length === 0
      ? 0
      : horizonMonths.reduce((sum, m) => sum + m.expenses, 0) / horizonMonths.length;

  const runway = averageFixedCost === 0 ? 0 : currentBalance / averageFixedCost;
  const previousRunway =
    averageFixedCost === 0 || !previous
      ? null
      : (currentBalance - (current?.net ?? 0)) / averageFixedCost;

  return {
    currentBalance,
    balanceDelta: current?.net ?? 0,
    connectedAccounts: includedAccounts.length,

    openInvoiceTotal,
    openInvoiceCycleProgress: openInvoiceCycleProgressValue,
    openInvoiceClosingDate: primaryCycle?.cycle.closingDate ?? null,
    openInvoiceDueDate: primaryCycle?.cycle.dueDate ?? null,

    projectedInvoiceTotal,
    projectedInvoiceVariation: variationPercent(projectedInvoiceTotal, openInvoiceTotal),
    projectedInvoiceInstallmentCount: openCycles.reduce(
      (sum, entry) => sum + (entry.projected?.installmentCount ?? 0),
      0,
    ),

    monthSurplus: current?.net ?? 0,
    monthSurplusDelta: (current?.net ?? 0) - (previous?.net ?? 0),
    // A sobra "antes dos planos" existe para a tela poder mostrar o antes e o
    // depois no mesmo tile: o usuario precisa ver quanto do aperto e escolha
    // dele e quanto e compromisso ja firmado.
    monthSurplusBeforePlans: (current?.net ?? 0) + (current?.plannedExpenses ?? 0),
    plannedCashThisMonth: current?.plannedExpenses ?? 0,

    spendVariation: variationPercent(current?.expenses ?? 0, previous?.expenses ?? 0),
    spendDelta: (current?.expenses ?? 0) - (previous?.expenses ?? 0),

    incomeCommitment,
    incomeCommitmentDelta: previous ? incomeCommitment - previousCommitment : null,

    futureInstallmentsTotal: futureInstallments.total,
    futureInstallmentsCount: futureInstallments.purchaseCount,
    futureInstallmentsLastMonth: futureInstallments.lastMonth,

    emergencyRunwayMonths: runway,
    emergencyRunwayDelta: previousRunway === null ? null : runway - previousRunway,
  };
}

/* -------------------------------------------------------------------------- */
/*  Orcamentos                                                                */
/* -------------------------------------------------------------------------- */

export function budgetStatus(spent: Cents, limit: Cents, alertThreshold: number): BudgetStatus {
  if (limit <= 0) return 'ON_TRACK';
  const usage = percentOf(spent, limit);
  if (usage > 100) return 'EXCEEDED';
  if (usage >= alertThreshold) return 'WARNING';
  return 'ON_TRACK';
}

export interface CategorySpendInput {
  month: YearMonth;
  spendByCategory: Readonly<Record<string, Cents>>;
  categories: readonly { id: string; name: string; color: string; kind: string }[];
  budgets: readonly Budget[];
}

/**
 * Gasto por categoria cruzado com orcamento, ordenado do maior para o menor.
 *
 * Categorias sem gasto e sem orcamento sao omitidas: uma lista com 30 linhas
 * zeradas esconde as 6 que importam.
 */
export function computeCategorySpend(input: CategorySpendInput): CategorySpend[] {
  const { month, spendByCategory, categories, budgets } = input;

  const budgetFor = (categoryId: string): Budget | undefined =>
    budgets.find((b) => b.categoryId === categoryId && b.month === month) ??
    budgets.find((b) => b.categoryId === categoryId && b.month === null);

  return categories
    .filter((category) => category.kind === 'EXPENSE')
    .map((category) => {
      const spent = spendByCategory[category.id] ?? 0;
      const budget = budgetFor(category.id);
      const limit = budget?.limitAmount ?? null;

      return {
        categoryId: category.id,
        categoryName: category.name,
        color: category.color,
        spent,
        budget: limit,
        usage: limit === null || limit === 0 ? null : percentOf(spent, limit),
        status:
          limit === null
            ? null
            : budgetStatus(spent, limit, budget?.alertThreshold ?? 80),
      };
    })
    .filter((row) => row.spent > 0 || row.budget !== null)
    .sort((a, b) => b.spent - a.spent);
}

/* -------------------------------------------------------------------------- */
/*  Series para graficos                                                      */
/* -------------------------------------------------------------------------- */

export interface BalanceSeriesPoint {
  month: YearMonth;
  balance: Cents;
  isProjected: boolean;
}

/**
 * Serie do grafico "Saldo consolidado e projecao".
 *
 * O ponto de fronteira aparece nas DUAS series (realizado e projetado) de
 * proposito: sem isso a linha tracejada comeca solta, com um vao visivel entre
 * o ultimo ponto solido e o primeiro tracejado.
 */
export function buildBalanceSeries(
  projection: { months: MonthProjection[] },
  today: ISODate,
): BalanceSeriesPoint[] {
  const currentMonth = toYearMonth(today);
  return projection.months.map((month) => ({
    month: month.month,
    balance: month.closingBalance,
    isProjected: month.month > currentMonth,
  }));
}

export interface IncomeExpensePoint {
  month: YearMonth;
  income: Cents;
  expenses: Cents;
  isProjected: boolean;
}

export function buildIncomeExpenseSeries(
  projection: { months: MonthProjection[] },
  today: ISODate,
): IncomeExpensePoint[] {
  const currentMonth = toYearMonth(today);
  return projection.months.map((month) => ({
    month: month.month,
    income: month.income,
    expenses: month.expenses,
    isProjected: month.month > currentMonth,
  }));
}
