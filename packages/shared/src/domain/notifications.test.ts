import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildDigestContent,
  decideNotifications,
  findResolved,
  isWithinQuietHours,
  type DeliveryRecord,
  type NotificationPreference,
} from './notifications.ts';
import type { Alert } from '../types.ts';

const preference: NotificationPreference = {
  userId: 'u1',
  pushEnabled: true,
  emailEnabled: true,
  minSeverity: 'WARNING',
  mode: 'IMMEDIATE',
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  digestHour: 8,
  reminderAfterHours: 24,
  timezone: 'America/Sao_Paulo',
};

function alert(overrides: Partial<Alert> & Pick<Alert, 'id'>): Alert {
  return {
    severity: 'CRITICAL',
    title: 'Lazer estourou o orcamento',
    description: 'R$ 1.212 gastos contra um limite de R$ 500.',
    href: '/orcamentos',
    createdAt: '2026-08-10',
    ...overrides,
  };
}

/** 10h no horario de Brasilia (UTC-3) — fora do silencio. */
const MEIO_DIA = '2026-08-10T13:00:00.000Z';
/** 23h em Brasilia — dentro do silencio. */
const NOITE = '2026-08-11T02:00:00.000Z';

function decisionsFor(input: {
  alerts: Alert[];
  deliveries?: DeliveryRecord[];
  preference?: Partial<NotificationPreference>;
  now?: string;
}) {
  return decideNotifications({
    alerts: input.alerts,
    deliveries: input.deliveries ?? [],
    preference: { ...preference, ...input.preference },
    now: input.now ?? MEIO_DIA,
  });
}

describe('decideNotifications — quando enviar', () => {
  it('envia na primeira vez, nos dois canais', () => {
    const decisions = decisionsFor({ alerts: [alert({ id: 'a1' })] });
    assert.equal(decisions.length, 2);
    assert.ok(decisions.every((d) => d.send && d.reason === 'FIRST_TIME'));
  });

  it('nao reenvia o mesmo alerta inalterado', () => {
    const decisions = decisionsFor({
      alerts: [alert({ id: 'a1' })],
      deliveries: [
        { alertKey: 'a1', channel: 'PUSH', severity: 'CRITICAL', sentAt: MEIO_DIA, resolvedAt: null },
        { alertKey: 'a1', channel: 'EMAIL', severity: 'CRITICAL', sentAt: MEIO_DIA, resolvedAt: null },
      ],
    });
    assert.ok(decisions.every((d) => !d.send && d.reason === 'ALREADY_SENT'));
  });

  it('reenvia quando a severidade piora', () => {
    const decisions = decisionsFor({
      alerts: [alert({ id: 'a1', severity: 'CRITICAL' })],
      deliveries: [
        { alertKey: 'a1', channel: 'PUSH', severity: 'WARNING', sentAt: MEIO_DIA, resolvedAt: null },
      ],
    });
    const push = decisions.find((d) => d.channel === 'PUSH')!;
    assert.equal(push.send, true);
    assert.equal(push.reason, 'ESCALATED');
  });

  it('nao reenvia quando a severidade melhora', () => {
    const decisions = decisionsFor({
      alerts: [alert({ id: 'a1', severity: 'WARNING' })],
      deliveries: [
        { alertKey: 'a1', channel: 'PUSH', severity: 'CRITICAL', sentAt: MEIO_DIA, resolvedAt: null },
      ],
    });
    assert.equal(decisions.find((d) => d.channel === 'PUSH')!.send, false);
  });

  it('reenvia quando o alerta sumiu e voltou', () => {
    const decisions = decisionsFor({
      alerts: [alert({ id: 'a1' })],
      deliveries: [
        {
          alertKey: 'a1',
          channel: 'PUSH',
          severity: 'CRITICAL',
          sentAt: '2026-08-01T13:00:00.000Z',
          resolvedAt: '2026-08-05T13:00:00.000Z',
        },
      ],
    });
    const push = decisions.find((d) => d.channel === 'PUSH')!;
    assert.equal(push.send, true);
    assert.equal(push.reason, 'RECURRED');
  });

  it('relembra depois do intervalo configurado', () => {
    const decisions = decisionsFor({
      alerts: [alert({ id: 'a1' })],
      deliveries: [
        {
          alertKey: 'a1',
          channel: 'PUSH',
          severity: 'CRITICAL',
          sentAt: '2026-08-09T12:00:00.000Z', // 25 h antes
          resolvedAt: null,
        },
      ],
    });
    assert.equal(decisions.find((d) => d.channel === 'PUSH')!.reason, 'REMINDER');
  });

  it('nao relembra quando o lembrete esta desligado', () => {
    const decisions = decisionsFor({
      alerts: [alert({ id: 'a1' })],
      preference: { reminderAfterHours: 0 },
      deliveries: [
        {
          alertKey: 'a1',
          channel: 'PUSH',
          severity: 'CRITICAL',
          sentAt: '2026-07-01T12:00:00.000Z',
          resolvedAt: null,
        },
      ],
    });
    assert.equal(decisions.find((d) => d.channel === 'PUSH')!.reason, 'ALREADY_SENT');
  });
});

describe('decideNotifications — filtros do usuario', () => {
  it('respeita o canal desligado', () => {
    const decisions = decisionsFor({
      alerts: [alert({ id: 'a1' })],
      preference: { pushEnabled: false },
    });
    assert.equal(decisions.find((d) => d.channel === 'PUSH')!.reason, 'CHANNEL_OFF');
    assert.equal(decisions.find((d) => d.channel === 'EMAIL')!.send, true);
  });

  it('respeita a severidade minima', () => {
    const decisions = decisionsFor({
      alerts: [alert({ id: 'a1', severity: 'INFO' })],
      preference: { minSeverity: 'WARNING' },
    });
    assert.ok(decisions.every((d) => !d.send && d.reason === 'BELOW_THRESHOLD'));
  });

  it('cala durante o silencio noturno, inclusive para critico', () => {
    const decisions = decisionsFor({ alerts: [alert({ id: 'a1' })], now: NOITE });
    assert.ok(decisions.every((d) => !d.send && d.reason === 'QUIET_HOURS'));
  });

  it('volta a enviar depois do silencio — o adiamento nao perde o aviso', () => {
    const silenciado = decisionsFor({ alerts: [alert({ id: 'a1' })], now: NOITE });
    assert.equal(silenciado[0].send, false);

    // Nada foi registrado como entregue, entao a varredura seguinte envia.
    const manha = decisionsFor({ alerts: [alert({ id: 'a1' })], now: '2026-08-11T11:00:00.000Z' });
    assert.equal(manha[0].send, true);
    assert.equal(manha[0].reason, 'FIRST_TIME');
  });

  it('no modo resumo so envia na hora combinada', () => {
    const foraDaHora = decisionsFor({
      alerts: [alert({ id: 'a1' })],
      preference: { mode: 'DAILY_DIGEST', digestHour: 8 },
      now: MEIO_DIA,
    });
    assert.ok(foraDaHora.every((d) => d.reason === 'AWAITING_DIGEST'));

    const naHora = decisionsFor({
      alerts: [alert({ id: 'a1' })],
      preference: { mode: 'DAILY_DIGEST', digestHour: 8 },
      now: '2026-08-10T11:30:00.000Z', // 08:30 em Brasilia
    });
    assert.ok(naHora.every((d) => d.send));
  });
});

describe('isWithinQuietHours', () => {
  it('trata a janela que cruza a meia-noite', () => {
    const p = { ...preference, quietHoursStart: '22:00', quietHoursEnd: '07:00' };
    assert.equal(isWithinQuietHours('2026-08-11T02:00:00.000Z', p), true); // 23:00 BRT
    assert.equal(isWithinQuietHours('2026-08-11T08:00:00.000Z', p), true); // 05:00 BRT
    assert.equal(isWithinQuietHours('2026-08-11T13:00:00.000Z', p), false); // 10:00 BRT
    assert.equal(isWithinQuietHours('2026-08-11T23:00:00.000Z', p), false); // 20:00 BRT
  });

  it('trata a janela que nao cruza a meia-noite', () => {
    const p = { ...preference, quietHoursStart: '09:00', quietHoursEnd: '17:00' };
    assert.equal(isWithinQuietHours('2026-08-11T15:00:00.000Z', p), true); // 12:00 BRT
    assert.equal(isWithinQuietHours('2026-08-11T23:00:00.000Z', p), false); // 20:00 BRT
  });

  it('desliga quando nao ha janela configurada', () => {
    assert.equal(
      isWithinQuietHours(NOITE, { ...preference, quietHoursStart: null, quietHoursEnd: null }),
      false,
    );
  });
});

describe('findResolved', () => {
  it('marca entregas cujo alerta desapareceu', () => {
    const deliveries: DeliveryRecord[] = [
      { alertKey: 'a1', channel: 'PUSH', severity: 'CRITICAL', sentAt: MEIO_DIA, resolvedAt: null },
      { alertKey: 'a2', channel: 'PUSH', severity: 'WARNING', sentAt: MEIO_DIA, resolvedAt: null },
    ];
    const resolved = findResolved([alert({ id: 'a1' })], deliveries);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].alertKey, 'a2');
  });

  it('nao marca de novo o que ja esta resolvido', () => {
    const deliveries: DeliveryRecord[] = [
      { alertKey: 'a2', channel: 'PUSH', severity: 'WARNING', sentAt: MEIO_DIA, resolvedAt: MEIO_DIA },
    ];
    assert.equal(findResolved([], deliveries).length, 0);
  });
});

describe('buildDigestContent', () => {
  it('resume varios alertas em uma linha', () => {
    const content = buildDigestContent([
      alert({ id: 'a1', severity: 'CRITICAL', title: 'Lazer estourou' }),
      alert({ id: 'a2', severity: 'CRITICAL', title: 'Mercado estourou' }),
      alert({ id: 'a3', severity: 'WARNING', title: 'Renda comprometida' }),
    ])!;
    assert.equal(content.title, '3 avisos, 2 criticos');
    assert.equal(content.deepLink, '/alertas');
  });

  it('um alerta so vira o proprio alerta, sem embrulho', () => {
    const content = buildDigestContent([alert({ id: 'a1', title: 'Lazer estourou' })])!;
    assert.equal(content.title, 'Lazer estourou');
  });

  it('nenhum alerta nao gera aviso', () => {
    assert.equal(buildDigestContent([]), null);
  });
});
