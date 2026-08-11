import {
  endOfMonth,
  monthRange,
  toYearMonth,
  type ISODate,
  type YearMonth,
} from '../date.ts';
import type { Cents } from '../money.ts';
import {
  cycleForReferenceMonth,
  resolveCycleForPurchase,
  deriveInvoiceStatus,
  type CardCycleConfig,
} from './credit-card-cycle.ts';
import { buildInstallmentPlan, classifyInvoiceLine } from './installments.ts';
import { occurrencesInMonth } from './recurrence.ts';
import type {
  Account,
  CashflowProjection,
  Category,
  CreditCard,
  InvoiceLineKind,
  MonthProjection,
  ProjectedInvoice,
  RecurringRule,
  Scenario,
  SpendingPlan,
  Transaction,
} from '../types.ts';

export interface ProjectionInput {
  from: YearMonth;
  months: number;
  today: ISODate;
  accounts: readonly Account[];
  cards: readonly CreditCard[];
  categories: readonly Category[];
  /** Historico + agendados. Parcelas podem vir expandidas ou como compra unica. */
  transactions: readonly Transaction[];
  recurrences: readonly RecurringRule[];
  /** Cenarios "e se" sobrepostos a projecao. Apenas os ativos sao aplicados. */
  scenarios?: readonly Scenario[];
  /**
   * Planos de gasto. Entram no BASELINE (diferente de cenario) porque sao
   * intencao assumida, nao hipotese — mas ficam rastreados a parte para a UI
   * distinguir 'ja aconteceu' de 'voce pretende'.
   */
  plans?: readonly SpendingPlan[];
  /**
   * Saldo inicial do horizonte. Quando omitido, usa a soma dos saldos atuais
   * das contas marcadas com `includeInTotals`.
   */
  openingBalance?: Cents;
}

interface CashEvent {
  month: YearMonth;
  amount: Cents;
  isIncome: boolean;
  categoryId: string | null;
  isCardPayment: boolean;
  /** Quanto deste evento vem de plano de gasto. Subconjunto de `amount`. */
  plannedAmount: Cents;
}

interface InvoiceAccumulator {
  total: Cents;
  composition: Record<InvoiceLineKind, Cents>;
  installmentCount: number;
  plannedTotal: Cents;
}

const emptyComposition = (): Record<InvoiceLineKind, Cents> => ({
  INSTALLMENT: 0,
  ONE_OFF: 0,
  SUBSCRIPTION: 0,
  FEE: 0,
});

/**
 * Projecao de fluxo de caixa mes a mes.
 *
 * INVARIANTE CENTRAL — nada de contagem dupla. Uma compra no credito NAO sai da
 * conta corrente na data da compra; ela entra na fatura, e a FATURA sai da
 * conta no vencimento. Despesas em debito/pix/boleto/dinheiro saem na propria
 * data. Sem essa separacao, todo gasto no cartao seria contado duas vezes e a
 * projecao de saldo ficaria inutil.
 */
export function projectCashflow(input: ProjectionInput): CashflowProjection {
  const {
    from,
    months,
    today,
    accounts,
    cards,
    categories,
    transactions,
    recurrences,
    scenarios = [],
    plans = [],
  } = input;

  const horizon = monthRange(from, months);
  const horizonEnd = horizon[horizon.length - 1] ?? from;
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const categoriesById = new Map(categories.map((category) => [category.id, category]));

  const openingBalance =
    input.openingBalance ??
    accounts
      .filter((account) => account.includeInTotals && account.isActive)
      .reduce((sum, account) => sum + account.currentBalance, 0);

  const events: CashEvent[] = [];
  /** `cardId -> referenceMonth -> acumulador` */
  const invoices = new Map<string, Map<YearMonth, InvoiceAccumulator>>();

  const addToInvoice = (
    cardId: string,
    referenceMonth: YearMonth,
    amount: Cents,
    kind: InvoiceLineKind,
    countsAsInstallment: boolean,
    isPlanned = false,
  ): void => {
    let byMonth = invoices.get(cardId);
    if (!byMonth) {
      byMonth = new Map();
      invoices.set(cardId, byMonth);
    }
    let bucket = byMonth.get(referenceMonth);
    if (!bucket) {
      bucket = {
        total: 0,
        composition: emptyComposition(),
        installmentCount: 0,
        plannedTotal: 0,
      };
      byMonth.set(referenceMonth, bucket);
    }
    bucket.total += amount;
    bucket.composition[kind] += amount;
    if (countsAsInstallment) bucket.installmentCount += 1;
    if (isPlanned) bucket.plannedTotal += amount;
  };

  /* ---------------------------------------------------------------------- */
  /*  1. Transacoes conhecidas (realizadas + agendadas)                      */
  /* ---------------------------------------------------------------------- */

  for (const tx of transactions) {
    if (tx.type === 'TRANSFER') continue; // Transferencia interna nao muda o total.

    const isCredit = Boolean(tx.creditCardId) && tx.paymentMethod === 'CREDIT';

    if (isCredit) {
      const card = cardsById.get(tx.creditCardId!);
      if (!card) continue;

      const category = tx.categoryId ? categoriesById.get(tx.categoryId) : null;
      const kind = classifyInvoiceLine(tx, category ?? null);

      // Uma compra parcelada pode chegar de duas formas: ja expandida em N
      // transacoes (vindo do Open Finance) ou como compra unica com
      // `installmentTotal` (lancada a mao). O segundo caso precisa ser aberto.
      const needsExpansion =
        (tx.installmentTotal ?? 1) > 1 && tx.installmentNumber === null;

      if (needsExpansion) {
        const plan = buildInstallmentPlan({
          purchaseDate: tx.date,
          totalAmount: tx.amount,
          installments: tx.installmentTotal!,
          card,
        });
        for (const entry of plan) {
          if (entry.referenceMonth > horizonEnd) continue;
          addToInvoice(card.id, entry.referenceMonth, entry.amount, kind, true);
        }
      } else {
        const { referenceMonth } = resolveCycleForPurchase(tx.date, card);
        if (referenceMonth <= horizonEnd) {
          addToInvoice(
            card.id,
            referenceMonth,
            tx.amount,
            kind,
            (tx.installmentTotal ?? 1) > 1,
          );
        }
      }
      continue;
    }

    // Debito, pix, boleto, dinheiro: impacto direto no caixa, na data do fato.
    events.push({
      month: toYearMonth(tx.date),
      amount: tx.amount,
      isIncome: tx.type === 'INCOME',
      categoryId: tx.categoryId,
      isCardPayment: false,
      plannedAmount: 0,
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  2. Recorrencias — geradas apenas para meses sem lancamento efetivo     */
  /* ---------------------------------------------------------------------- */

  // Uma regra ja materializada em transacao (salario que caiu) nao pode ser
  // projetada de novo por cima. A chave e (regra, competencia).
  const materialized = new Set(
    transactions
      .filter((tx) => tx.recurringRuleId)
      .map((tx) => `${tx.recurringRuleId}:${toYearMonth(tx.date)}`),
  );

  for (const rule of recurrences) {
    if (!rule.isActive) continue;
    for (const month of horizon) {
      if (materialized.has(`${rule.id}:${month}`)) continue;
      const dates = occurrencesInMonth(rule, month);
      for (const date of dates) {
        if (date < today) continue; // O passado ja esta nas transacoes reais.

        if (rule.creditCardId && rule.paymentMethod === 'CREDIT') {
          const card = cardsById.get(rule.creditCardId);
          if (!card) continue;
          const { referenceMonth } = resolveCycleForPurchase(date, card);
          if (referenceMonth > horizonEnd) continue;
          addToInvoice(card.id, referenceMonth, rule.amount, 'SUBSCRIPTION', false);
          continue;
        }

        events.push({
          month,
          amount: rule.amount,
          isIncome: rule.type === 'INCOME',
          categoryId: rule.categoryId,
          isCardPayment: false,
          plannedAmount: 0,
        });
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  3. Cenarios "e se"                                                    */
  /* ---------------------------------------------------------------------- */

  for (const scenario of scenarios) {
    if (!scenario.isActive) continue;
    for (const item of scenario.items) {
      const card = item.creditCardId ? cardsById.get(item.creditCardId) : null;
      const kindByItem: InvoiceLineKind =
        item.kind === 'INSTALLMENT'
          ? 'INSTALLMENT'
          : item.kind === 'RECURRING'
            ? 'SUBSCRIPTION'
            : 'ONE_OFF';

      if (item.kind === 'INSTALLMENT' && card) {
        const plan = buildInstallmentPlan({
          purchaseDate: item.startDate,
          totalAmount: item.amount,
          installments: Math.max(item.months ?? 1, 1),
          card,
        });
        for (const entry of plan) {
          if (entry.referenceMonth > horizonEnd) continue;
          addToInvoice(card.id, entry.referenceMonth, entry.amount, 'INSTALLMENT', true);
        }
        continue;
      }

      const occurrences =
        item.kind === 'RECURRING'
          ? monthRange(toYearMonth(item.startDate), Math.max(item.months ?? months, 1))
          : [toYearMonth(item.startDate)];

      for (const month of occurrences) {
        if (month < from || month > horizonEnd) continue;
        if (card) {
          addToInvoice(card.id, month, item.amount, kindByItem, false);
        } else {
          events.push({
            month,
            amount: item.amount,
            isIncome: item.type === 'INCOME',
            categoryId: item.categoryId,
            isCardPayment: false,
            plannedAmount: 0,
          });
        }
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  4. Planos de gasto                                                    */
  /* ---------------------------------------------------------------------- */

  for (const plan of plans) {
    if (plan.status !== 'PLANNED') continue;

    for (const item of plan.items) {
      // Item ja conciliado ou descartado saiu de cena: a transacao real
      // assumiu o lugar dele.
      if (item.status !== 'PENDING') continue;

      const date = item.date ?? plan.startDate;

      // Mesma regra das recorrencias: o passado ja esta nas transacoes reais.
      // Sem isto, um plano do fim de semana passado continuaria somando por
      // cima do gasto que de fato aconteceu — contagem dupla silenciosa.
      // O item vencido e nao conciliado aparece na tela como pendencia.
      if (date < today) continue;

      const card = item.creditCardId ? cardsById.get(item.creditCardId) : null;

      if (card && item.paymentMethod === 'CREDIT') {
        const installments = Math.max(item.installments, 1);

        if (installments > 1) {
          const schedule = buildInstallmentPlan({
            purchaseDate: date,
            totalAmount: item.amount,
            installments,
            card,
          });
          for (const entry of schedule) {
            if (entry.referenceMonth > horizonEnd) continue;
            addToInvoice(card.id, entry.referenceMonth, entry.amount, 'INSTALLMENT', true, true);
          }
        } else {
          const { referenceMonth } = resolveCycleForPurchase(date, card);
          if (referenceMonth <= horizonEnd) {
            addToInvoice(card.id, referenceMonth, item.amount, 'ONE_OFF', false, true);
          }
        }
        continue;
      }

      const month = toYearMonth(date);
      if (month < from || month > horizonEnd) continue;

      events.push({
        month,
        amount: item.amount,
        isIncome: false,
        categoryId: item.categoryId,
        isCardPayment: false,
        plannedAmount: item.amount,
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  5. Faturas viram saida de caixa no mes do vencimento                   */
  /* ---------------------------------------------------------------------- */

  const projectedInvoicesByMonth = new Map<YearMonth, ProjectedInvoice[]>();

  for (const card of cards) {
    const byMonth = invoices.get(card.id);
    if (!byMonth) continue;

    for (const [referenceMonth, bucket] of byMonth) {
      if (referenceMonth < from || referenceMonth > horizonEnd) continue;

      const cycle = cycleForReferenceMonth(referenceMonth, card);
      const status = deriveInvoiceStatus(cycle, today, 0, bucket.total);

      const projected: ProjectedInvoice = {
        creditCardId: card.id,
        creditCardName: card.name,
        referenceMonth,
        closingDate: cycle.closingDate,
        dueDate: cycle.dueDate,
        total: bucket.total,
        status,
        isProjected: today <= cycle.periodEnd,
        composition: bucket.composition,
        installmentCount: bucket.installmentCount,
        plannedTotal: bucket.plannedTotal,
      };

      const list = projectedInvoicesByMonth.get(referenceMonth) ?? [];
      list.push(projected);
      projectedInvoicesByMonth.set(referenceMonth, list);

      events.push({
        month: referenceMonth,
        amount: bucket.total,
        isIncome: false,
        categoryId: null,
        isCardPayment: true,
        // O pagamento da fatura carrega a proporcao planejada dela: parte veio
        // de compra efetivada, parte do que voce so pretende gastar.
        plannedAmount: bucket.plannedTotal,
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  5. Consolidacao mensal                                                */
  /* ---------------------------------------------------------------------- */

  const eventsByMonth = new Map<YearMonth, CashEvent[]>();
  for (const event of events) {
    const list = eventsByMonth.get(event.month) ?? [];
    list.push(event);
    eventsByMonth.set(event.month, list);
  }

  let runningBalance = openingBalance;
  let lowestBalance = Number.POSITIVE_INFINITY;
  let lowestBalanceMonth = from;
  let monthsUntilNegative: number | null = null;

  const result: MonthProjection[] = horizon.map((month, index) => {
    const monthEvents = eventsByMonth.get(month) ?? [];
    const byCategory: Record<string, Cents> = {};

    let income = 0;
    let expenses = 0;
    let cardPayments = 0;
    let plannedExpenses = 0;
    let plannedCardPayments = 0;

    for (const event of monthEvents) {
      if (event.isIncome) {
        income += event.amount;
      } else {
        expenses += event.amount;
        plannedExpenses += event.plannedAmount;
        if (event.isCardPayment) {
          cardPayments += event.amount;
          plannedCardPayments += event.plannedAmount;
        }
      }
      if (!event.isIncome && event.categoryId) {
        byCategory[event.categoryId] = (byCategory[event.categoryId] ?? 0) + event.amount;
      }
    }

    // Gastos no cartao tambem compoem o gasto por categoria, mesmo sem terem
    // saido do caixa ainda — e o que o usuario espera ver no orcamento.
    for (const tx of transactions) {
      if (tx.type !== 'EXPENSE' || !tx.creditCardId || !tx.categoryId) continue;
      if (toYearMonth(tx.date) !== month) continue;
      byCategory[tx.categoryId] = (byCategory[tx.categoryId] ?? 0) + tx.amount;
    }

    // Plano no cartao tambem consome orcamento da categoria no mes da COMPRA,
    // ainda que o caixa so sinta no vencimento da fatura. Sem isto, programar
    // R$ 300 de lazer nao mexeria na barra de Lazer, que e justamente onde o
    // usuario vai olhar para decidir se cabe.
    for (const plan of plans) {
      if (plan.status !== 'PLANNED') continue;
      for (const item of plan.items) {
        if (item.status !== 'PENDING' || !item.categoryId || !item.creditCardId) continue;
        const date = item.date ?? plan.startDate;
        if (date < today || toYearMonth(date) !== month) continue;
        byCategory[item.categoryId] = (byCategory[item.categoryId] ?? 0) + item.amount;
      }
    }

    const openingBalanceOfMonth = runningBalance;
    const net = income - expenses;
    runningBalance += net;

    if (runningBalance < lowestBalance) {
      lowestBalance = runningBalance;
      lowestBalanceMonth = month;
    }
    if (monthsUntilNegative === null && runningBalance < 0) {
      monthsUntilNegative = index;
    }

    return {
      month,
      openingBalance: openingBalanceOfMonth,
      income,
      expenses,
      cardPayments,
      plannedExpenses,
      plannedCardPayments,
      net,
      closingBalance: runningBalance,
      isProjected: endOfMonth(month) > today,
      byCategory,
      invoices: projectedInvoicesByMonth.get(month) ?? [],
    };
  });

  return {
    from,
    months: result,
    lowestBalance: Number.isFinite(lowestBalance) ? lowestBalance : openingBalance,
    lowestBalanceMonth,
    monthsUntilNegative,
  };
}

/** Projecao de uma unica competencia — atalho usado por KPIs de tela. */
export function projectMonth(input: Omit<ProjectionInput, 'months'>): MonthProjection {
  const projection = projectCashflow({ ...input, months: 1 });
  return projection.months[0];
}

/**
 * Faturas de um cartao em uma janela de meses, incluindo as ja fechadas.
 * Alimenta o grafico "Faturas por mes" (barras cheias = realizado, contornadas
 * = projetado).
 */
export function projectCardInvoices(
  input: Omit<ProjectionInput, 'from' | 'months'> & {
    cardId: string;
    from: YearMonth;
    months: number;
  },
): ProjectedInvoice[] {
  const projection = projectCashflow(input);
  const found = projection.months.flatMap((month) =>
    month.invoices.filter((invoice) => invoice.creditCardId === input.cardId),
  );

  // Meses sem nenhum lancamento nao aparecem no acumulador; o grafico precisa
  // da serie completa, entao completamos com faturas zeradas.
  const card = input.cards.find((c) => c.id === input.cardId);
  if (!card) return found;

  const byMonth = new Map(found.map((invoice) => [invoice.referenceMonth, invoice]));
  return monthRange(input.from, input.months).map((month) => {
    const existing = byMonth.get(month);
    if (existing) return existing;
    const cycle = cycleForReferenceMonth(month, card);
    return {
      creditCardId: card.id,
      creditCardName: card.name,
      referenceMonth: month,
      closingDate: cycle.closingDate,
      dueDate: cycle.dueDate,
      total: 0,
      status: deriveInvoiceStatus(cycle, input.today, 0, 0),
      isProjected: input.today <= cycle.periodEnd,
      composition: emptyComposition(),
      installmentCount: 0,
      plannedTotal: 0,
    };
  });
}

export type { CardCycleConfig };
