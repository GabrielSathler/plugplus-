import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { projectCashflow } from './projection.ts';
import { summarizePlan, totalPlanned, pendingReconciliation } from './plans.ts';
import type {
  Account,
  Category,
  CreditCard,
  RecurringRule,
  SpendingPlan,
  SpendingPlanItem,
  Transaction,
} from '../types.ts';

const account: Account = {
  id: 'acc-1',
  name: 'Itau',
  type: 'CHECKING',
  institution: 'Itau',
  currency: 'BRL',
  currentBalance: 1_000_000,
  color: '#0f8a72',
  isActive: true,
  includeInTotals: true,
};

/** Fecha 28, vence 05 do mes seguinte. */
const card: CreditCard = {
  id: 'card-1',
  name: 'Visa Infinite',
  brand: 'VISA',
  lastFour: '4417',
  institution: 'Itau',
  limitAmount: 2_200_000,
  closingDay: 28,
  dueDay: 5,
  closingDayInclusive: false,
  paymentAccountId: 'acc-1',
  color: '#16161a',
  isActive: true,
};

const categories: Category[] = [
  { id: 'cat-lazer', name: 'Lazer', kind: 'EXPENSE', color: '#5f8c1f', icon: null, parentId: null, isFee: false },
  { id: 'cat-mercado', name: 'Mercado', kind: 'EXPENSE', color: '#c0453b', icon: null, parentId: null, isFee: false },
];

function item(overrides: Partial<SpendingPlanItem> & Pick<SpendingPlanItem, 'id' | 'amount'>): SpendingPlanItem {
  return {
    description: 'Gasto',
    categoryId: 'cat-lazer',
    accountId: null,
    creditCardId: null,
    paymentMethod: 'PIX',
    installments: 1,
    date: null,
    status: 'PENDING',
    matchedTransactionId: null,
    ...overrides,
  };
}

/** Fim de semana de 15 a 17/08: R$ 620 no cartao, R$ 180 na conta. */
const fimDeSemana: SpendingPlan = {
  id: 'plan-1',
  name: 'Fim de semana',
  startDate: '2026-08-15',
  endDate: '2026-08-17',
  status: 'PLANNED',
  color: '#8257e5',
  notes: null,
  items: [
    item({ id: 'i1', description: 'Restaurante', amount: 30_000, creditCardId: 'card-1', paymentMethod: 'CREDIT' }),
    item({ id: 'i2', description: 'Cinema', amount: 12_000, creditCardId: 'card-1', paymentMethod: 'CREDIT' }),
    item({ id: 'i3', description: 'Combustivel', amount: 20_000, creditCardId: 'card-1', paymentMethod: 'CREDIT' }),
    item({ id: 'i4', description: 'Mercado', amount: 18_000, accountId: 'acc-1', categoryId: 'cat-mercado', date: '2026-08-16' }),
  ],
};

const baseInput = {
  today: '2026-08-10',
  accounts: [account],
  cards: [card],
  categories,
  transactions: [] as Transaction[],
  recurrences: [] as RecurringRule[],
};

describe('summarizePlan', () => {
  const summary = summarizePlan({
    plan: fimDeSemana,
    cards: { 'card-1': card },
    today: '2026-08-10',
  });

  it('separa o que cai na fatura do que sai da conta', () => {
    assert.equal(summary.total, 80_000);
    assert.equal(summary.toInvoice, 62_000);
    assert.equal(summary.toAccount, 18_000);
  });

  it('coloca o gasto do cartao no mes do VENCIMENTO, nao no do passeio', () => {
    // Compra em 15/08 fecha em 28/08 e vence em 05/09 -> competencia 2026-09.
    assert.equal(summary.cashImpactByMonth['2026-09'], 62_000);
    // O pix do mercado sai no proprio agosto.
    assert.equal(summary.cashImpactByMonth['2026-08'], 18_000);
  });

  it('conta itens pendentes e vencidos', () => {
    assert.equal(summary.itemCount, 4);
    assert.equal(summary.pendingCount, 4);
    assert.equal(summary.overdueCount, 0);
  });

  it('ignora item ja conciliado no impacto futuro', () => {
    const parcial = summarizePlan({
      plan: {
        ...fimDeSemana,
        items: fimDeSemana.items.map((i) => (i.id === 'i1' ? { ...i, status: 'DONE' as const } : i)),
      },
      cards: { 'card-1': card },
      today: '2026-08-10',
    });
    assert.equal(parcial.total, 80_000, 'o total planejado nao muda');
    assert.equal(parcial.toInvoice, 32_000, 'mas o que ainda vai cair na fatura, sim');
    assert.equal(parcial.pendingCount, 3);
  });

  it('marca item vencido e nao conciliado', () => {
    const atrasado = summarizePlan({
      plan: fimDeSemana,
      cards: { 'card-1': card },
      today: '2026-08-20',
    });
    assert.equal(atrasado.overdueCount, 4);
  });
});

describe('projectCashflow com planos', () => {
  it('plano no cartao nao sai do caixa no fim de semana, e sim no vencimento', () => {
    const projection = projectCashflow({
      ...baseInput,
      from: '2026-08',
      months: 3,
      plans: [fimDeSemana],
    });

    const agosto = projection.months[0];
    const setembro = projection.months[1];

    // Agosto sente apenas o pix de R$ 180.
    assert.equal(agosto.expenses, 18_000);
    assert.equal(agosto.plannedExpenses, 18_000);
    assert.equal(agosto.cardPayments, 0);

    // Setembro paga a fatura com os R$ 620 planejados.
    assert.equal(setembro.cardPayments, 62_000);
    assert.equal(setembro.plannedCardPayments, 62_000);
    assert.equal(setembro.closingBalance, 1_000_000 - 80_000);
  });

  it('separa planejado de realizado dentro do mesmo mes', () => {
    const projection = projectCashflow({
      ...baseInput,
      from: '2026-08',
      months: 1,
      transactions: [
        {
          id: 't1',
          description: 'Conta de luz',
          merchant: null,
          amount: 25_000,
          type: 'EXPENSE',
          paymentMethod: 'PIX',
          date: '2026-08-12',
          accountId: 'acc-1',
          creditCardId: null,
          categoryId: 'cat-mercado',
          status: 'POSTED',
          source: 'MANUAL',
          installmentNumber: null,
          installmentTotal: null,
          installmentGroupId: null,
          recurringRuleId: null,
          transferAccountId: null,
          notes: null,
          tags: [],
        },
      ],
      plans: [fimDeSemana],
    });

    const agosto = projection.months[0];
    assert.equal(agosto.expenses, 43_000, 'soma o real e o planejado');
    assert.equal(agosto.plannedExpenses, 18_000, 'mas sabe quanto e so intencao');
  });

  it('nao conta plano do passado — a transacao real assumiu o lugar', () => {
    const projection = projectCashflow({
      ...baseInput,
      today: '2026-08-25', // fim de semana ja passou
      from: '2026-08',
      months: 3,
      plans: [fimDeSemana],
    });

    assert.equal(projection.months[0].expenses, 0);
    assert.equal(projection.months[1].cardPayments, 0);
  });

  it('plano cancelado nao entra na conta', () => {
    const projection = projectCashflow({
      ...baseInput,
      from: '2026-08',
      months: 3,
      plans: [{ ...fimDeSemana, status: 'CANCELLED' }],
    });
    assert.equal(projection.months[0].expenses, 0);
    assert.equal(projection.months[1].cardPayments, 0);
  });

  it('plano parcelado se espalha pelas faturas seguintes', () => {
    const viagem: SpendingPlan = {
      ...fimDeSemana,
      id: 'plan-2',
      name: 'Viagem',
      items: [
        item({
          id: 'v1',
          description: 'Passagens',
          amount: 120_000,
          creditCardId: 'card-1',
          paymentMethod: 'CREDIT',
          installments: 3,
        }),
      ],
    };

    const projection = projectCashflow({
      ...baseInput,
      from: '2026-08',
      months: 5,
      plans: [viagem],
    });

    assert.deepEqual(
      projection.months.map((m) => m.cardPayments),
      [0, 40_000, 40_000, 40_000, 0],
    );
    assert.equal(projection.months[1].invoices[0].plannedTotal, 40_000);
  });

  it('plano no cartao consome o orcamento da categoria no mes da compra', () => {
    const projection = projectCashflow({
      ...baseInput,
      from: '2026-08',
      months: 1,
      plans: [fimDeSemana],
    });

    // Restaurante + cinema + combustivel, todos em Lazer, na competencia da compra.
    assert.equal(projection.months[0].byCategory['cat-lazer'], 62_000);
    assert.equal(projection.months[0].byCategory['cat-mercado'], 18_000);
  });

  it('a fatura distingue o que e compra efetivada do que e plano', () => {
    const projection = projectCashflow({
      ...baseInput,
      from: '2026-08',
      months: 3,
      transactions: [
        {
          id: 't1',
          description: 'Compra ja feita',
          merchant: null,
          amount: 50_000,
          type: 'EXPENSE',
          paymentMethod: 'CREDIT',
          date: '2026-08-11',
          accountId: null,
          creditCardId: 'card-1',
          categoryId: 'cat-lazer',
          status: 'POSTED',
          source: 'MANUAL',
          installmentNumber: null,
          installmentTotal: null,
          installmentGroupId: null,
          recurringRuleId: null,
          transferAccountId: null,
          notes: null,
          tags: [],
        },
      ],
      plans: [fimDeSemana],
    });

    const fatura = projection.months[1].invoices[0];
    assert.equal(fatura.total, 112_000);
    assert.equal(fatura.plannedTotal, 62_000, 'so a parte planejada');
  });
});

describe('totalPlanned e pendingReconciliation', () => {
  it('soma apenas o que ainda vai acontecer', () => {
    assert.equal(totalPlanned([fimDeSemana], '2026-08-10'), 80_000);
    assert.equal(totalPlanned([fimDeSemana], '2026-08-20'), 0, 'tudo ja venceu');
  });

  it('filtra por competencia da data do item', () => {
    assert.equal(totalPlanned([fimDeSemana], '2026-08-10', '2026-08'), 80_000);
    assert.equal(totalPlanned([fimDeSemana], '2026-08-10', '2026-09'), 0);
  });

  it('lista os itens que esperam confirmacao', () => {
    assert.equal(pendingReconciliation([fimDeSemana], '2026-08-10').length, 0);
    assert.equal(pendingReconciliation([fimDeSemana], '2026-08-20').length, 4);
  });
});
