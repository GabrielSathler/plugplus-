import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { splitInstallments, sumCents } from '../money.ts';
import { buildInstallmentPlan, classifyInvoiceLine, summarizeFutureInstallments } from './installments.ts';
import type { Transaction } from '../types.ts';

const VISA = { closingDay: 28, dueDay: 5 };

describe('splitInstallments', () => {
  it('nao perde centavo em divisao inexata', () => {
    const parts = splitInstallments(10_000, 3);
    assert.deepEqual(parts, [3334, 3333, 3333]);
    assert.equal(sumCents(parts), 10_000);
  });

  it('joga a sobra na ultima parcela quando pedido', () => {
    const parts = splitInstallments(10_000, 3, 'last');
    assert.deepEqual(parts, [3333, 3333, 3334]);
    assert.equal(sumCents(parts), 10_000);
  });

  it('fecha exato em divisao redonda', () => {
    assert.deepEqual(splitInstallments(12_000, 12), Array(12).fill(1000));
  });

  it('preserva o total para qualquer numero de parcelas', () => {
    for (let count = 1; count <= 24; count += 1) {
      assert.equal(sumCents(splitInstallments(99_999, count)), 99_999, `falhou em ${count}x`);
    }
  });

  it('rejeita contagem invalida', () => {
    assert.throws(() => splitInstallments(1000, 0), RangeError);
    assert.throws(() => splitInstallments(1000, 1.5), RangeError);
  });
});

describe('buildInstallmentPlan', () => {
  it('distribui parcelas em faturas consecutivas a partir da compra', () => {
    const plan = buildInstallmentPlan({
      purchaseDate: '2026-07-20',
      totalAmount: 120_000,
      installments: 3,
      card: VISA,
    });

    assert.equal(plan.length, 3);
    assert.deepEqual(
      plan.map((p) => p.referenceMonth),
      ['2026-08', '2026-09', '2026-10'],
    );
    assert.deepEqual(
      plan.map((p) => p.dueDate),
      ['2026-08-05', '2026-09-05', '2026-10-05'],
    );
    assert.equal(sumCents(plan.map((p) => p.amount)), 120_000);
  });

  it('empurra tudo um mes quando a compra cai depois do fechamento', () => {
    const plan = buildInstallmentPlan({
      purchaseDate: '2026-07-29',
      totalAmount: 60_000,
      installments: 2,
      card: VISA,
    });
    assert.deepEqual(
      plan.map((p) => p.referenceMonth),
      ['2026-09', '2026-10'],
    );
  });

  it('atravessa a virada de ano', () => {
    const plan = buildInstallmentPlan({
      purchaseDate: '2026-11-10',
      totalAmount: 90_000,
      installments: 4,
      card: VISA,
    });
    assert.deepEqual(
      plan.map((p) => p.referenceMonth),
      ['2026-12', '2027-01', '2027-02', '2027-03'],
    );
  });
});

describe('classifyInvoiceLine', () => {
  it('separa parcelada, assinatura, avulsa e encargo', () => {
    assert.equal(classifyInvoiceLine({ installmentTotal: 12, recurringRuleId: null }), 'INSTALLMENT');
    assert.equal(classifyInvoiceLine({ installmentTotal: 1, recurringRuleId: 'r1' }), 'SUBSCRIPTION');
    assert.equal(classifyInvoiceLine({ installmentTotal: null, recurringRuleId: null }), 'ONE_OFF');
    assert.equal(
      classifyInvoiceLine({ installmentTotal: 3, recurringRuleId: null }, { isFee: true }),
      'FEE',
    );
  });
});

describe('summarizeFutureInstallments', () => {
  const base: Omit<Transaction, 'id' | 'date' | 'amount' | 'installmentNumber' | 'installmentGroupId'> = {
    description: 'Compra',
    merchant: null,
    type: 'EXPENSE',
    paymentMethod: 'CREDIT',
    accountId: null,
    creditCardId: 'card-1',
    categoryId: null,
    status: 'POSTED',
    source: 'MANUAL',
    installmentTotal: 10,
    recurringRuleId: null,
    transferAccountId: null,
    notes: null,
    tags: [],
  };

  it('conta compras distintas, nao parcelas', () => {
    const transactions: Transaction[] = [
      { ...base, id: 't1', date: '2026-07-10', amount: 48_900, installmentNumber: 4, installmentGroupId: 'g1' },
      { ...base, id: 't2', date: '2026-08-10', amount: 48_900, installmentNumber: 5, installmentGroupId: 'g1' },
      { ...base, id: 't3', date: '2026-09-10', amount: 48_900, installmentNumber: 6, installmentGroupId: 'g1' },
      { ...base, id: 't4', date: '2026-09-12', amount: 20_000, installmentNumber: 2, installmentGroupId: 'g2' },
    ];

    const summary = summarizeFutureInstallments(transactions, '2026-08', { 'card-1': VISA });

    // A compra de 10/07 vence em 08/2026, que nao e "> 2026-08" — fica de fora.
    assert.equal(summary.purchaseCount, 2);
    assert.equal(summary.total, 48_900 + 48_900 + 20_000);
    assert.equal(summary.lastMonth, '2026-10');
  });

  it('ignora compras a vista', () => {
    const transactions: Transaction[] = [
      { ...base, id: 't1', date: '2026-09-10', amount: 5000, installmentTotal: 1, installmentNumber: null, installmentGroupId: null },
    ];
    const summary = summarizeFutureInstallments(transactions, '2026-08', { 'card-1': VISA });
    assert.equal(summary.total, 0);
    assert.equal(summary.purchaseCount, 0);
  });
});
