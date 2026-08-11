import { addMonthsToYearMonth, type ISODate, type YearMonth } from '../date.ts';
import { splitInstallments, type Cents, type RemainderPolicy } from '../money.ts';
import { resolveCycleForPurchase, cycleForReferenceMonth, type CardCycleConfig } from './credit-card-cycle.ts';
import type { InvoiceLineKind, Transaction } from '../types.ts';

export interface InstallmentPlanEntry {
  installmentNumber: number;
  installmentTotal: number;
  amount: Cents;
  /** Fatura (mes de vencimento) que recebe esta parcela. */
  referenceMonth: YearMonth;
  closingDate: ISODate;
  dueDate: ISODate;
}

export interface InstallmentPlanInput {
  purchaseDate: ISODate;
  totalAmount: Cents;
  installments: number;
  card: CardCycleConfig;
  remainderPolicy?: RemainderPolicy;
}

/**
 * Expande uma compra parcelada nas faturas que vao recebe-la.
 *
 * A primeira parcela cai na fatura determinada pela data da compra; as demais
 * seguem em faturas consecutivas. Nao ha juros aqui — "12x sem juros" e o caso
 * dominante e o valor total ja e o valor cobrado. Compra com juros deve entrar
 * com o total ja acrescido.
 */
export function buildInstallmentPlan(input: InstallmentPlanInput): InstallmentPlanEntry[] {
  const { purchaseDate, totalAmount, installments, card, remainderPolicy = 'first' } = input;
  const amounts = splitInstallments(totalAmount, installments, remainderPolicy);
  const firstCycle = resolveCycleForPurchase(purchaseDate, card);

  return amounts.map((amount, index) => {
    const referenceMonth = addMonthsToYearMonth(firstCycle.referenceMonth, index);
    const cycle = index === 0 ? firstCycle : cycleForReferenceMonth(referenceMonth, card);
    return {
      installmentNumber: index + 1,
      installmentTotal: installments,
      amount,
      referenceMonth,
      closingDate: cycle.closingDate,
      dueDate: cycle.dueDate,
    };
  });
}

/**
 * Classifica uma linha da fatura para o painel "Composicao da fatura".
 *
 * Derivado, nunca persistido: mudar a regra reclassifica o historico inteiro
 * sem migracao de dados.
 */
export function classifyInvoiceLine(
  transaction: Pick<Transaction, 'installmentTotal' | 'recurringRuleId'>,
  category?: { isFee: boolean } | null,
): InvoiceLineKind {
  if (category?.isFee) return 'FEE';
  if ((transaction.installmentTotal ?? 1) > 1) return 'INSTALLMENT';
  if (transaction.recurringRuleId) return 'SUBSCRIPTION';
  return 'ONE_OFF';
}

export interface FutureInstallmentSummary {
  total: Cents;
  /** Numero de COMPRAS distintas com parcelas em aberto, nao de parcelas. */
  purchaseCount: number;
  lastMonth: YearMonth | null;
  byMonth: Record<YearMonth, Cents>;
}

/**
 * Compromissos ja assumidos: parcelas que ainda vao entrar em faturas futuras.
 *
 * Alimenta o KPI "Parcelas futuras — R$ 9.840 / 9 compras / a vencer ate
 * janeiro". Conta COMPRAS (agrupadas por `installmentGroupId`) e nao parcelas,
 * porque "9 compras" e o que o usuario consegue mapear na cabeca.
 */
export function summarizeFutureInstallments(
  transactions: readonly Transaction[],
  fromMonthExclusive: YearMonth,
  cardsById: Readonly<Record<string, CardCycleConfig>>,
): FutureInstallmentSummary {
  const byMonth: Record<YearMonth, Cents> = {};
  const groups = new Set<string>();
  let total = 0;
  let lastMonth: YearMonth | null = null;

  for (const tx of transactions) {
    if (!tx.creditCardId || (tx.installmentTotal ?? 1) <= 1) continue;
    const card = cardsById[tx.creditCardId];
    if (!card) continue;

    const { referenceMonth } = resolveCycleForPurchase(tx.date, card);
    if (referenceMonth <= fromMonthExclusive) continue;

    total += tx.amount;
    byMonth[referenceMonth] = (byMonth[referenceMonth] ?? 0) + tx.amount;
    groups.add(tx.installmentGroupId ?? tx.id);
    if (!lastMonth || referenceMonth > lastMonth) lastMonth = referenceMonth;
  }

  return { total, purchaseCount: groups.size, lastMonth, byMonth };
}
