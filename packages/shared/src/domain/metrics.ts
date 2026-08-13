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
  Frequency,
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

  /**
   * `null` quando nao ha renda no mes.
   *
   * Uma razao com denominador perto de zero nao e uma metrica, e ruido: R$ 250
   * de gasto sobre R$ 1 de renda devolve 25.000%, que e aritmeticamente exato e
   * nao informa nada. Pior, dispara alerta critico por um numero que so existe
   * porque ainda nao ha renda lancada. Sem renda conhecida a pergunta "quanto
   * da sua renda esta comprometido" simplesmente nao tem resposta.
   */
  const commitment = (target?: MonthProjection): number | null => {
    if (!target || target.income <= 0) return null;
    return percentOf(target.expenses, target.income);
  };
  const incomeCommitment = commitment(current);
  const previousCommitment = commitment(previous);

  /* --- Reserva de emergencia --------------------------------------------- */

  /**
   * Custo fixo = o que se REPETE, e so isso.
   *
   * A versao anterior usava a media de todas as saidas projetadas, e isso
   * estava errado no conceito: um jantar programado de R$ 250, diluido pelo
   * horizonte, virava "custo fixo mensal de R$ 20,80" e a reserva aparecia
   * como 168 meses. O rotulo do tile promete "cobertura de custo fixo" — o
   * denominador tem que ser aquilo que voce vai pagar TODO mes se parar de
   * ganhar: aluguel, escola, plano de saude, assinatura.
   *
   * Parcela em curso fica de fora de proposito: ela acaba. Gasto avulso e
   * plano tambem — sao escolha, e quem perde a renda deixa de fazer.
   */
  const averageFixedCost = input.recurrences
    .filter((rule) => rule.isActive && rule.type === 'EXPENSE')
    .reduce((sum, rule) => sum + monthlyEquivalent(rule.amount, rule.frequency), 0);

  // `null` quando ainda nao ha custo fixo conhecido. Zero seria uma mentira
  // perigosa: sem despesa recorrente a reserva nao acaba em zero mes, ela dura
  // indefinidamente. O tile mostra "—" — "ainda nao da para calcular", nao
  // "voce esta quebrado".
  const runway = averageFixedCost === 0 ? null : currentBalance / averageFixedCost;
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
    // O delta só existe quando os DOIS meses têm renda. Comparar contra um mês
    // sem renda produziria uma variação de milhares de pontos percentuais que
    // não reflete mudança nenhuma no comportamento.
    incomeCommitmentDelta:
      incomeCommitment === null || previousCommitment === null
        ? null
        : incomeCommitment - previousCommitment,

    futureInstallmentsTotal: futureInstallments.total,
    futureInstallmentsCount: futureInstallments.purchaseCount,
    futureInstallmentsLastMonth: futureInstallments.lastMonth,

    emergencyRunwayMonths: runway,
    emergencyRunwayDelta:
      runway === null || previousRunway === null ? null : runway - previousRunway,
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

/**
 * Converte um valor recorrente para o equivalente mensal.
 *
 * Anuidade de R$ 1.200 nao e um custo fixo de R$ 1.200/mes — sao R$ 100. Sem
 * essa normalizacao, uma unica despesa anual esmagaria a reserva de emergencia
 * e dispararia alerta todo mes.
 */
function monthlyEquivalent(amount: Cents, frequency: Frequency): number {
  switch (frequency) {
    case 'WEEKLY':
      // 52 semanas em 12 meses — nao 4, que subestimaria em ~8%.
      return (amount * 52) / 12;
    case 'MONTHLY':
      return amount;
    case 'BIMONTHLY':
      return amount / 2;
    case 'QUARTERLY':
      return amount / 3;
    case 'SEMIANNUAL':
      return amount / 6;
    case 'YEARLY':
      return amount / 12;
  }
}
