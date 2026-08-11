import { toYearMonth, type ISODate, type YearMonth } from '../date.ts';
import type { Cents } from '../money.ts';
import { resolveCycleForPurchase, type CardCycleConfig } from './credit-card-cycle.ts';
import { buildInstallmentPlan } from './installments.ts';
import type {
  PlanSummary,
  SpendingPlan,
  SpendingPlanItem,
  Transaction,
} from '../types.ts';

/**
 * Resumo de um plano de gasto.
 *
 * O numero que o usuario realmente precisa nao e o total: e QUANDO o dinheiro
 * sai. Programar R$ 800 num fim de semana pode significar R$ 180 saindo no
 * sabado e R$ 620 saindo so no dia 5 do mes seguinte, porque foi no cartao.
 * Um total unico esconde exatamente a informacao que muda a decisao.
 */
export function summarizePlan(input: {
  plan: SpendingPlan;
  cards: Readonly<Record<string, CardCycleConfig>>;
  /** Lancamentos reais, para calcular o realizado do periodo. */
  transactions?: readonly Transaction[];
  today: ISODate;
}): PlanSummary {
  const { plan, cards, transactions = [], today } = input;

  const cashImpactByMonth: Record<YearMonth, Cents> = {};
  let total = 0;
  let toInvoice = 0;
  let toAccount = 0;
  let pendingCount = 0;
  let overdueCount = 0;

  const addImpact = (month: YearMonth, amount: Cents): void => {
    cashImpactByMonth[month] = (cashImpactByMonth[month] ?? 0) + amount;
  };

  for (const item of plan.items) {
    total += item.amount;
    if (item.status !== 'PENDING') continue;

    pendingCount += 1;
    const date = item.date ?? plan.startDate;
    if (date < today) overdueCount += 1;

    const card = item.creditCardId ? cards[item.creditCardId] : null;

    if (card && item.paymentMethod === 'CREDIT') {
      toInvoice += item.amount;
      const installments = Math.max(item.installments, 1);

      if (installments > 1) {
        for (const entry of buildInstallmentPlan({
          purchaseDate: date,
          totalAmount: item.amount,
          installments,
          card,
        })) {
          addImpact(entry.referenceMonth, entry.amount);
        }
      } else {
        addImpact(resolveCycleForPurchase(date, card).referenceMonth, item.amount);
      }
      continue;
    }

    toAccount += item.amount;
    addImpact(toYearMonth(date), item.amount);
  }

  return {
    planId: plan.id,
    name: plan.name,
    startDate: plan.startDate,
    endDate: plan.endDate,
    status: plan.status,
    color: plan.color,
    total,
    toInvoice,
    toAccount,
    cashImpactByMonth,
    itemCount: plan.items.length,
    pendingCount,
    overdueCount,
    realized: realizedInPeriod(plan, transactions),
  };
}

/**
 * Gasto real no periodo do plano, nas mesmas contas e cartoes que ele usa.
 *
 * DELIBERADAMENTE APROXIMADO. Casar item planejado com lancamento real exige
 * comparacao difusa (data proxima, valor proximo, estabelecimento parecido) e
 * erra em silencio quando acerta por acaso. Enquanto essa conciliacao nao
 * existe, o honesto e responder uma pergunta mais simples e verificavel —
 * "quanto de fato saiu nessas contas naqueles dias" — e rotular assim na tela,
 * em vez de fingir precisao item a item.
 */
function realizedInPeriod(plan: SpendingPlan, transactions: readonly Transaction[]): Cents {
  const accountIds = new Set(
    plan.items.map((item) => item.accountId).filter((id): id is string => Boolean(id)),
  );
  const cardIds = new Set(
    plan.items.map((item) => item.creditCardId).filter((id): id is string => Boolean(id)),
  );
  if (accountIds.size === 0 && cardIds.size === 0) return 0;

  let realized = 0;
  for (const tx of transactions) {
    if (tx.type !== 'EXPENSE') continue;
    if (tx.date < plan.startDate || tx.date > plan.endDate) continue;

    const matchesSource =
      (tx.accountId && accountIds.has(tx.accountId)) ||
      (tx.creditCardId && cardIds.has(tx.creditCardId));
    if (matchesSource) realized += tx.amount;
  }
  return realized;
}

/** Total planejado que ainda vai acontecer, somando varios planos. */
export function totalPlanned(
  plans: readonly SpendingPlan[],
  today: ISODate,
  month?: YearMonth,
): Cents {
  let total = 0;
  for (const plan of plans) {
    if (plan.status !== 'PLANNED') continue;
    for (const item of plan.items) {
      if (item.status !== 'PENDING') continue;
      const date = item.date ?? plan.startDate;
      if (date < today) continue;
      if (month && toYearMonth(date) !== month) continue;
      total += item.amount;
    }
  }
  return total;
}

/** Planos que tocam uma competencia, ordenados pela data de inicio. */
export function plansInMonth(
  plans: readonly SpendingPlan[],
  month: YearMonth,
): SpendingPlan[] {
  return plans
    .filter((plan) => toYearMonth(plan.startDate) <= month && toYearMonth(plan.endDate) >= month)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** Itens vencidos e nao conciliados — a fila de "confirme o que aconteceu". */
export function pendingReconciliation(
  plans: readonly SpendingPlan[],
  today: ISODate,
): { plan: SpendingPlan; item: SpendingPlanItem }[] {
  const rows: { plan: SpendingPlan; item: SpendingPlanItem }[] = [];
  for (const plan of plans) {
    if (plan.status !== 'PLANNED') continue;
    for (const item of plan.items) {
      if (item.status !== 'PENDING') continue;
      if ((item.date ?? plan.startDate) < today) rows.push({ plan, item });
    }
  }
  return rows;
}
