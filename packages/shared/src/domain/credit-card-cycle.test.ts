import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cycleForReferenceMonth,
  cycleProgress,
  deriveInvoiceStatus,
  resolveCycleForPurchase,
} from './credit-card-cycle.ts';

/** Cartao do prototipo: fecha 28, vence 05 do mes seguinte. */
const VISA = { closingDay: 28, dueDay: 5 };
/** Cartao que fecha cedo e vence no mesmo mes. */
const EARLY = { closingDay: 3, dueDay: 10 };

describe('resolveCycleForPurchase', () => {
  it('joga compra anterior ao fechamento na fatura que fecha no mes', () => {
    const cycle = resolveCycleForPurchase('2026-07-20', VISA);
    assert.equal(cycle.closingDate, '2026-07-28');
    assert.equal(cycle.dueDate, '2026-08-05');
    assert.equal(cycle.referenceMonth, '2026-08');
  });

  it('joga compra NO dia do fechamento para a fatura seguinte (padrao exclusivo)', () => {
    const cycle = resolveCycleForPurchase('2026-07-28', VISA);
    assert.equal(cycle.closingDate, '2026-08-28');
    assert.equal(cycle.dueDate, '2026-09-05');
  });

  it('respeita closingDayInclusive quando o emissor fecha no fim do dia', () => {
    const cycle = resolveCycleForPurchase('2026-07-28', { ...VISA, closingDayInclusive: true });
    assert.equal(cycle.closingDate, '2026-07-28');
    assert.equal(cycle.dueDate, '2026-08-05');
  });

  it('joga compra posterior ao fechamento na fatura seguinte', () => {
    const cycle = resolveCycleForPurchase('2026-07-29', VISA);
    assert.equal(cycle.closingDate, '2026-08-28');
    assert.equal(cycle.referenceMonth, '2026-09');
  });

  it('vence no mesmo mes quando dueDay > closingDay', () => {
    const cycle = resolveCycleForPurchase('2026-07-01', EARLY);
    assert.equal(cycle.closingDate, '2026-07-03');
    assert.equal(cycle.dueDate, '2026-07-10');
    assert.equal(cycle.referenceMonth, '2026-07');
  });

  it('vira o ano corretamente na virada de dezembro', () => {
    const cycle = resolveCycleForPurchase('2026-12-29', VISA);
    assert.equal(cycle.closingDate, '2027-01-28');
    assert.equal(cycle.dueDate, '2027-02-05');
    assert.equal(cycle.referenceMonth, '2027-02');
  });

  it('ancora dia 31 no ultimo dia de fevereiro', () => {
    const cycle = resolveCycleForPurchase('2026-02-25', { closingDay: 31, dueDay: 10 });
    assert.equal(cycle.closingDate, '2026-02-28');
    // dueDay(10) < closingDay(31) => vence no mes seguinte.
    assert.equal(cycle.dueDate, '2026-03-10');
  });

  it('trata ano bissexto no clamp de fevereiro', () => {
    const cycle = resolveCycleForPurchase('2028-02-20', { closingDay: 30, dueDay: 8 });
    assert.equal(cycle.closingDate, '2028-02-29');
  });

  it('cobre o periodo sem buraco nem sobreposicao entre ciclos consecutivos', () => {
    const julho = resolveCycleForPurchase('2026-07-20', VISA);
    const agosto = resolveCycleForPurchase('2026-08-20', VISA);
    assert.equal(julho.periodEnd, '2026-07-27');
    assert.equal(agosto.periodStart, '2026-07-28');
  });
});

describe('cycleForReferenceMonth', () => {
  it('e o inverso exato de resolveCycleForPurchase', () => {
    for (const date of ['2026-01-15', '2026-03-28', '2026-07-29', '2026-11-02', '2026-12-31']) {
      const forward = resolveCycleForPurchase(date, VISA);
      const backward = cycleForReferenceMonth(forward.referenceMonth, VISA);
      assert.deepEqual(backward, forward, `round-trip falhou para ${date}`);
    }
  });

  it('vale tambem para cartao que vence no mesmo mes', () => {
    const forward = resolveCycleForPurchase('2026-05-01', EARLY);
    const backward = cycleForReferenceMonth(forward.referenceMonth, EARLY);
    assert.deepEqual(backward, forward);
  });
});

describe('cycleProgress', () => {
  it('mede o avanco do ciclo em dias', () => {
    const cycle = resolveCycleForPurchase('2026-07-20', VISA);
    const progress = cycleProgress(cycle, '2026-07-15');
    assert.equal(progress.totalDays, 30); // 28/06 a 27/07
    assert.equal(progress.elapsedDays, 18);
    assert.ok(progress.percent > 55 && progress.percent < 65);
  });

  it('satura em 100% depois do fechamento', () => {
    const cycle = resolveCycleForPurchase('2026-07-20', VISA);
    const progress = cycleProgress(cycle, '2026-09-01');
    assert.equal(progress.percent, 100);
  });
});

describe('deriveInvoiceStatus', () => {
  const cycle = resolveCycleForPurchase('2026-07-20', VISA);

  it('OPEN enquanto o ciclo corre', () => {
    assert.equal(deriveInvoiceStatus(cycle, '2026-07-15', 0, 10_000), 'OPEN');
  });

  it('CLOSED entre fechamento e vencimento', () => {
    assert.equal(deriveInvoiceStatus(cycle, '2026-08-01', 0, 10_000), 'CLOSED');
  });

  it('OVERDUE depois do vencimento sem pagamento', () => {
    assert.equal(deriveInvoiceStatus(cycle, '2026-08-10', 0, 10_000), 'OVERDUE');
  });

  it('PAID quando quitada, independente da data', () => {
    assert.equal(deriveInvoiceStatus(cycle, '2026-08-10', 10_000, 10_000), 'PAID');
  });

  it('PROJECTED antes do ciclo comecar', () => {
    assert.equal(deriveInvoiceStatus(cycle, '2026-06-01', 0, 10_000), 'PROJECTED');
  });
});
