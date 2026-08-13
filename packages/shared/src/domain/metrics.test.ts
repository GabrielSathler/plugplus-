import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeDashboardMetrics } from './metrics.ts';
import type { Account, Category, CreditCard, RecurringRule, SpendingPlan, Transaction } from '../types.ts';

const account: Account = {
  id: 'acc-1', name: 'Inter', type: 'CHECKING', institution: 'Inter', currency: 'BRL',
  currentBalance: 350_100, color: '#0f8a72', isActive: true, includeInTotals: true,
};

const categories: Category[] = [
  { id: 'cat-lazer', name: 'Lazer', kind: 'EXPENSE', color: '#5f8c1f', icon: null, parentId: null, isFee: false },
  { id: 'cat-renda', name: 'Renda', kind: 'INCOME', color: '#0f8a72', icon: null, parentId: null, isFee: false },
];

const base = {
  month: '2026-08' as const,
  today: '2026-08-10',
  accounts: [account],
  cards: [] as CreditCard[],
  categories,
  transactions: [] as Transaction[],
  recurrences: [] as RecurringRule[],
};

/** Reproduz a tela reportada: R$ 3.501 de saldo, R$ 1 de renda, R$ 250 planejados. */
const planoDe250: SpendingPlan = {
  id: 'p1', name: 'Fim de semana', startDate: '2026-08-15', endDate: '2026-08-15',
  status: 'PLANNED', color: '#8257e5', notes: null,
  items: [{
    id: 'i1', description: 'Jantar', amount: 25_000, categoryId: 'cat-lazer',
    accountId: 'acc-1', creditCardId: null, paymentMethod: 'PIX', installments: 1,
    date: null, status: 'PENDING', matchedTransactionId: null,
  }],
};

const rendaDeUmReal: Transaction = {
  id: 't1', description: 'Teste', merchant: null, amount: 100, type: 'INCOME',
  paymentMethod: 'PIX', date: '2026-08-01', accountId: 'acc-1', creditCardId: null,
  categoryId: 'cat-renda', status: 'POSTED', source: 'MANUAL', installmentNumber: null,
  installmentTotal: null, installmentGroupId: null, recurringRuleId: null,
  transferAccountId: null, notes: null, tags: [],
};

describe('comprometimento da renda', () => {
  /*
   * O DOMINIO NAO ARREDONDA A VERDADE.
   *
   * Com R$ 1 de renda e R$ 250 de gasto, 25.000% e o valor correto e o motor
   * devolve exatamente isso. Esconder aqui seria mentir na camada errada.
   *
   * O que era problema — a tela gritando "25000%" e o alerta subindo como
   * critico — foi resolvido onde nasce: a Visao geral exibe "> 999%" porque o
   * digito exato nao acrescenta nada depois desse ponto, e o alerta so dispara
   * acima de um piso de renda. Este teste trava a separacao: motor exato,
   * apresentacao sensata.
   */
  it('devolve a razao exata mesmo quando ela e absurda', () => {
    const m = computeDashboardMetrics({ ...base, transactions: [rendaDeUmReal], plans: [planoDe250] });
    assert.equal(m.incomeCommitment, 25000);
  });

  it('e null quando nao ha renda no mes', () => {
    const m = computeDashboardMetrics({ ...base, plans: [planoDe250] });
    assert.equal(m.incomeCommitment, null);
    assert.equal(m.incomeCommitmentDelta, null);
  });

  it('calcula normalmente quando ha renda de verdade', () => {
    const salario: Transaction = { ...rendaDeUmReal, id: 't2', amount: 1_000_000 };
    const m = computeDashboardMetrics({ ...base, transactions: [salario], plans: [planoDe250] });
    // R$ 250 de gasto sobre R$ 10.000 de renda = 2,5%.
    assert.ok(m.incomeCommitment !== null && Math.abs(m.incomeCommitment - 2.5) < 0.01);
  });
});

describe('reserva de emergencia', () => {
  it('NAO trata gasto avulso planejado como custo fixo', () => {
    const m = computeDashboardMetrics({ ...base, plans: [planoDe250] });
    // Antes: 3501 / (250/12) = 168 meses. Um jantar nao e custo fixo.
    assert.equal(m.emergencyRunwayMonths, null);
  });

  it('e null sem despesa recorrente — sem custo fixo nao ha o que dividir', () => {
    assert.equal(computeDashboardMetrics(base).emergencyRunwayMonths, null);
  });

  it('usa apenas o que se repete', () => {
    const aluguel: RecurringRule = {
      id: 'r1', description: 'Aluguel', amount: 100_000, type: 'EXPENSE', frequency: 'MONTHLY',
      dayOfMonth: 10, weekday: null, startDate: '2026-01-10', endDate: null,
      categoryId: null, accountId: 'acc-1', creditCardId: null, paymentMethod: 'AUTO_DEBIT',
      isActive: true, label: null,
    };
    const m = computeDashboardMetrics({ ...base, recurrences: [aluguel], plans: [planoDe250] });
    // 3501 / 1000 = 3,5 meses — o plano de R$ 250 nao entra na conta.
    assert.ok(m.emergencyRunwayMonths !== null);
    assert.ok(Math.abs(m.emergencyRunwayMonths - 3.501) < 0.01);
  });

  it('normaliza frequencia: anuidade de 1.200 vale 100 por mes', () => {
    const anuidade: RecurringRule = {
      id: 'r2', description: 'Anuidade', amount: 120_000, type: 'EXPENSE', frequency: 'YEARLY',
      dayOfMonth: 1, weekday: null, startDate: '2026-01-01', endDate: null,
      categoryId: null, accountId: 'acc-1', creditCardId: null, paymentMethod: 'AUTO_DEBIT',
      isActive: true, label: null,
    };
    const m = computeDashboardMetrics({ ...base, recurrences: [anuidade] });
    // 3501 / 100 = 35,01 meses. Sem normalizar seriam 2,9 — 12x pior.
    assert.ok(m.emergencyRunwayMonths !== null);
    assert.ok(Math.abs(m.emergencyRunwayMonths - 35.01) < 0.05);
  });

  it('ignora recorrencia desativada', () => {
    const desativada: RecurringRule = {
      id: 'r3', description: 'Antigo', amount: 100_000, type: 'EXPENSE', frequency: 'MONTHLY',
      dayOfMonth: 10, weekday: null, startDate: '2026-01-10', endDate: null,
      categoryId: null, accountId: 'acc-1', creditCardId: null, paymentMethod: 'AUTO_DEBIT',
      isActive: false, label: null,
    };
    assert.equal(computeDashboardMetrics({ ...base, recurrences: [desativada] }).emergencyRunwayMonths, null);
  });
});
