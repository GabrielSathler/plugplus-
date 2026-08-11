import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { projectCashflow } from './projection.ts';
import type { Account, Category, CreditCard, RecurringRule, Scenario, Transaction } from '../types.ts';

const account: Account = {
  id: 'acc-1',
  name: 'Itau',
  type: 'CHECKING',
  institution: 'Itau',
  currency: 'BRL',
  currentBalance: 1_000_000, // R$ 10.000,00
  color: '#0f8a72',
  isActive: true,
  includeInTotals: true,
};

const card: CreditCard = {
  id: 'card-1',
  name: 'Visa Infinite',
  brand: 'VISA',
  lastFour: '4417',
  institution: 'Itau',
  limitAmount: 3_000_000,
  closingDay: 28,
  dueDay: 5,
  closingDayInclusive: false,
  paymentAccountId: 'acc-1',
  color: '#16161a',
  isActive: true,
};

const categories: Category[] = [
  { id: 'cat-mercado', name: 'Mercado', kind: 'EXPENSE', color: '#c0453b', icon: null, parentId: null, isFee: false },
  { id: 'cat-renda', name: 'Renda', kind: 'INCOME', color: '#0f8a72', icon: null, parentId: null, isFee: false },
  { id: 'cat-encargos', name: 'Encargos', kind: 'EXPENSE', color: '#b8863a', icon: null, parentId: null, isFee: true },
];

function tx(overrides: Partial<Transaction> & Pick<Transaction, 'id' | 'date' | 'amount'>): Transaction {
  return {
    description: 'Lancamento',
    merchant: null,
    type: 'EXPENSE',
    paymentMethod: 'PIX',
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
    ...overrides,
  };
}

const baseInput = {
  today: '2026-07-15',
  accounts: [account],
  cards: [card],
  categories,
  recurrences: [] as RecurringRule[],
};

describe('projectCashflow — separacao caixa x fatura', () => {
  it('compra no credito NAO sai do caixa na data da compra', () => {
    const projection = projectCashflow({
      ...baseInput,
      from: '2026-07',
      months: 3,
      transactions: [
        tx({ id: 't1', date: '2026-07-10', amount: 50_000, paymentMethod: 'CREDIT', creditCardId: 'card-1', accountId: null }),
      ],
    });

    const julho = projection.months[0];
    const agosto = projection.months[1];

    // Julho nao tem saida de caixa: a compra so vira fatura.
    assert.equal(julho.expenses, 0);
    assert.equal(julho.closingBalance, 1_000_000);

    // Agosto paga a fatura (vencimento 05/08).
    assert.equal(agosto.cardPayments, 50_000);
    assert.equal(agosto.expenses, 50_000);
    assert.equal(agosto.closingBalance, 950_000);
  });

  it('nao conta o gasto do cartao duas vezes', () => {
    const projection = projectCashflow({
      ...baseInput,
      from: '2026-07',
      months: 6,
      transactions: [
        tx({ id: 't1', date: '2026-07-10', amount: 50_000, paymentMethod: 'CREDIT', creditCardId: 'card-1', accountId: null }),
      ],
    });

    const totalSaidas = projection.months.reduce((sum, m) => sum + m.expenses, 0);
    assert.equal(totalSaidas, 50_000);
  });

  it('despesa em pix sai do caixa no proprio mes', () => {
    const projection = projectCashflow({
      ...baseInput,
      from: '2026-07',
      months: 2,
      transactions: [tx({ id: 't1', date: '2026-07-10', amount: 30_000 })],
    });

    assert.equal(projection.months[0].expenses, 30_000);
    assert.equal(projection.months[0].cardPayments, 0);
    assert.equal(projection.months[0].closingBalance, 970_000);
  });

  it('transferencia entre contas proprias e neutra', () => {
    const projection = projectCashflow({
      ...baseInput,
      from: '2026-07',
      months: 1,
      transactions: [tx({ id: 't1', date: '2026-07-10', amount: 100_000, type: 'TRANSFER' })],
    });
    assert.equal(projection.months[0].expenses, 0);
    assert.equal(projection.months[0].income, 0);
  });
});

describe('projectCashflow — parcelamento', () => {
  it('abre compra parcelada nao expandida nas faturas seguintes', () => {
    const projection = projectCashflow({
      ...baseInput,
      from: '2026-07',
      months: 5,
      transactions: [
        tx({
          id: 't1',
          date: '2026-07-10',
          amount: 120_000,
          paymentMethod: 'CREDIT',
          creditCardId: 'card-1',
          accountId: null,
          installmentTotal: 3,
        }),
      ],
    });

    const pagamentos = projection.months.map((m) => m.cardPayments);
    assert.deepEqual(pagamentos, [0, 40_000, 40_000, 40_000, 0]);
    assert.equal(projection.months[1].invoices[0].composition.INSTALLMENT, 40_000);
  });

  it('nao reexpande parcelas que ja chegaram abertas do agregador', () => {
    const projection = projectCashflow({
      ...baseInput,
      from: '2026-07',
      months: 4,
      transactions: [
        tx({ id: 't1', date: '2026-07-10', amount: 40_000, paymentMethod: 'CREDIT', creditCardId: 'card-1', accountId: null, installmentTotal: 3, installmentNumber: 1, installmentGroupId: 'g1' }),
        tx({ id: 't2', date: '2026-08-10', amount: 40_000, paymentMethod: 'CREDIT', creditCardId: 'card-1', accountId: null, installmentTotal: 3, installmentNumber: 2, installmentGroupId: 'g1' }),
      ],
    });

    const total = projection.months.reduce((sum, m) => sum + m.cardPayments, 0);
    assert.equal(total, 80_000, 'parcelas ja expandidas nao podem ser abertas de novo');
  });

  it('classifica encargos separado das compras', () => {
    const projection = projectCashflow({
      ...baseInput,
      from: '2026-07',
      months: 2,
      transactions: [
        tx({ id: 't1', date: '2026-07-10', amount: 29_000, paymentMethod: 'CREDIT', creditCardId: 'card-1', accountId: null, categoryId: 'cat-encargos' }),
        tx({ id: 't2', date: '2026-07-11', amount: 10_000, paymentMethod: 'CREDIT', creditCardId: 'card-1', accountId: null }),
      ],
    });

    const fatura = projection.months[1].invoices[0];
    assert.equal(fatura.composition.FEE, 29_000);
    assert.equal(fatura.composition.ONE_OFF, 10_000);
    assert.equal(fatura.total, 39_000);
  });
});

describe('projectCashflow — recorrencias', () => {
  const salario: RecurringRule = {
    id: 'rec-1',
    description: 'Salario Marina',
    amount: 920_000,
    type: 'INCOME',
    frequency: 'MONTHLY',
    dayOfMonth: 5,
    weekday: null,
    startDate: '2025-01-05',
    endDate: null,
    categoryId: 'cat-renda',
    accountId: 'acc-1',
    creditCardId: null,
    paymentMethod: 'TRANSFER',
    isActive: true,
    label: 'Entrada fixa',
  };

  it('projeta a recorrencia nos meses futuros', () => {
    const projection = projectCashflow({
      ...baseInput,
      from: '2026-07',
      months: 3,
      transactions: [],
      recurrences: [salario],
    });

    // Julho: dia 5 ja passou (today = 15/07), entao nao e projetado.
    assert.equal(projection.months[0].income, 0);
    assert.equal(projection.months[1].income, 920_000);
    assert.equal(projection.months[2].income, 920_000);
  });

  it('nao duplica quando a recorrencia ja virou transacao no mes', () => {
    const projection = projectCashflow({
      ...baseInput,
      today: '2026-07-01',
      from: '2026-07',
      months: 2,
      transactions: [
        tx({ id: 't1', date: '2026-07-05', amount: 920_000, type: 'INCOME', categoryId: 'cat-renda', recurringRuleId: 'rec-1' }),
      ],
      recurrences: [salario],
    });

    assert.equal(projection.months[0].income, 920_000, 'o salario ja lancado nao pode ser projetado por cima');
  });

  it('respeita a data de termino da regra', () => {
    const projection = projectCashflow({
      ...baseInput,
      from: '2026-07',
      months: 4,
      transactions: [],
      recurrences: [{ ...salario, endDate: '2026-09-30' }],
    });

    assert.equal(projection.months[3].income, 0);
  });

  it('assinatura no cartao entra na fatura, nao no caixa', () => {
    const netflix: RecurringRule = {
      ...salario,
      id: 'rec-2',
      description: 'Streaming',
      amount: 5_590,
      type: 'EXPENSE',
      dayOfMonth: 20,
      categoryId: 'cat-mercado',
      accountId: null,
      creditCardId: 'card-1',
      paymentMethod: 'CREDIT',
      label: null,
    };

    const projection = projectCashflow({
      ...baseInput,
      from: '2026-07',
      months: 3,
      transactions: [],
      recurrences: [netflix],
    });

    assert.equal(projection.months[0].expenses, 0);
    assert.equal(projection.months[1].invoices[0].composition.SUBSCRIPTION, 5_590);
    assert.equal(projection.months[1].cardPayments, 5_590);
  });
});

describe('projectCashflow — saldo e alertas', () => {
  it('encadeia o saldo de fechamento entre os meses', () => {
    const projection = projectCashflow({
      ...baseInput,
      from: '2026-07',
      months: 3,
      transactions: [
        tx({ id: 't1', date: '2026-07-20', amount: 100_000 }),
        tx({ id: 't2', date: '2026-08-20', amount: 200_000 }),
      ],
    });

    assert.equal(projection.months[0].closingBalance, 900_000);
    assert.equal(projection.months[1].openingBalance, 900_000);
    assert.equal(projection.months[1].closingBalance, 700_000);
    assert.equal(projection.months[2].closingBalance, 700_000);
  });

  it('reporta o menor saldo do horizonte e quando o caixa vira', () => {
    const projection = projectCashflow({
      ...baseInput,
      from: '2026-07',
      months: 3,
      transactions: [
        tx({ id: 't1', date: '2026-07-20', amount: 400_000 }),
        tx({ id: 't2', date: '2026-08-20', amount: 900_000 }),
      ],
    });

    assert.equal(projection.months[1].closingBalance, -300_000);
    assert.equal(projection.lowestBalance, -300_000);
    assert.equal(projection.lowestBalanceMonth, '2026-08');
    assert.equal(projection.monthsUntilNegative, 1);
  });

  it('resultado do mes bate com entradas menos saidas', () => {
    const projection = projectCashflow({
      ...baseInput,
      from: '2026-07',
      months: 2,
      transactions: [
        tx({ id: 't1', date: '2026-07-05', amount: 1_480_000, type: 'INCOME', categoryId: 'cat-renda' }),
        tx({ id: 't2', date: '2026-07-20', amount: 590_000 }),
        tx({ id: 't3', date: '2026-07-10', amount: 674_000, paymentMethod: 'CREDIT', creditCardId: 'card-1', accountId: null }),
      ],
    });

    const julho = projection.months[0];
    assert.equal(julho.net, julho.income - julho.expenses);

    const agosto = projection.months[1];
    // A saida total de agosto e exatamente a fatura, e ela esta dentro de expenses.
    assert.equal(agosto.cardPayments, 674_000);
    assert.equal(agosto.expenses, 674_000);
    assert.equal(agosto.net, -674_000);
  });
});

describe('projectCashflow — cenarios "e se"', () => {
  const compraCarro: Scenario = {
    id: 'sc-1',
    name: 'Trocar o carro',
    description: null,
    isActive: true,
    color: '#b8863a',
    items: [
      {
        id: 'si-1',
        kind: 'INSTALLMENT',
        description: 'Entrada parcelada',
        amount: 300_000,
        type: 'EXPENSE',
        startDate: '2026-08-10',
        months: 3,
        categoryId: 'cat-mercado',
        accountId: null,
        creditCardId: 'card-1',
      },
    ],
  };

  it('aplica o cenario ativo sobre a projecao', () => {
    const semCenario = projectCashflow({ ...baseInput, from: '2026-07', months: 6, transactions: [] });
    const comCenario = projectCashflow({
      ...baseInput,
      from: '2026-07',
      months: 6,
      transactions: [],
      scenarios: [compraCarro],
    });

    assert.equal(semCenario.months[5].closingBalance, 1_000_000);
    assert.equal(comCenario.months[5].closingBalance, 700_000);
  });

  it('ignora cenario desativado', () => {
    const projection = projectCashflow({
      ...baseInput,
      from: '2026-07',
      months: 6,
      transactions: [],
      scenarios: [{ ...compraCarro, isActive: false }],
    });
    assert.equal(projection.months[5].closingBalance, 1_000_000);
  });
});
