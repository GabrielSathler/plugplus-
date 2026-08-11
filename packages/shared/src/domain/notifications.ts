import type { Alert, AlertSeverity } from '../types.ts';

/**
 * Decisao de notificacao.
 *
 * ADR — O ALERTA CONTINUA DERIVADO; O QUE SE PERSISTE E A ENTREGA.
 *
 * Alertas sao recalculados do estado a cada leitura e somem sozinhos quando a
 * causa some (ver alerts.service.ts). Notificar, porem, exige memoria: sem ela
 * cada varredura reenviaria o mesmo push. A saida nao e passar a gravar
 * alertas — e gravar ENTREGAS, indexadas pela chave deterministica do alerta.
 *
 * Isso preserva a propriedade que importa (nao existe alerta obsoleto para
 * limpar) e ainda responde "ja avisei esta pessoa sobre isto?".
 *
 * As quatro perguntas que este modulo responde, e que sao a razao de ele ser
 * puro e testado em vez de espalhado pelo dispatcher:
 *
 *   1. E a primeira vez?                    -> envia
 *   2. Piorou desde o ultimo aviso?         -> envia de novo (escalada)
 *   3. Sumiu e voltou?                      -> envia de novo (nova ocorrencia)
 *   4. Continua igual ha muito tempo?       -> relembra, no maximo a cada N horas
 *
 * Errar qualquer uma delas produz o pior defeito possivel num produto de
 * notificacao: spam. E spam faz o usuario desligar o canal, o que destroi o
 * valor de todos os alertas, inclusive os que importam.
 */

export const NOTIFICATION_CHANNELS = ['PUSH', 'EMAIL'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_MODES = ['IMMEDIATE', 'DAILY_DIGEST'] as const;
export type NotificationMode = (typeof NOTIFICATION_MODES)[number];

export const DELIVERY_STATUSES = ['SENT', 'FAILED', 'SUPPRESSED'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface NotificationPreference {
  userId: string;
  pushEnabled: boolean;
  emailEnabled: boolean;
  /** Severidade minima que dispara notificacao. */
  minSeverity: AlertSeverity;
  mode: NotificationMode;
  /** `HH:MM` no fuso do usuario. Nulo desliga o silencio. */
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  /** Hora do dia (0-23) em que o resumo diario sai. */
  digestHour: number;
  /** Horas ate relembrar um alerta ainda ativo. `0` desliga o lembrete. */
  reminderAfterHours: number;
  timezone: string;
}

/** Ultima entrega conhecida para um par (alerta, canal) de um usuario. */
export interface DeliveryRecord {
  alertKey: string;
  channel: NotificationChannel;
  /** Severidade no momento do envio — base para detectar escalada. */
  severity: AlertSeverity;
  /** Instante ISO completo do envio. */
  sentAt: string;
  /**
   * Preenchido quando o alerta deixou de existir. Uma entrega resolvida nao
   * bloqueia o proximo envio: e assim que "sumiu e voltou" volta a avisar.
   */
  resolvedAt: string | null;
}

export type SendReason = 'FIRST_TIME' | 'ESCALATED' | 'RECURRED' | 'REMINDER';
export type SkipReason =
  | 'CHANNEL_OFF'
  | 'BELOW_THRESHOLD'
  | 'QUIET_HOURS'
  | 'ALREADY_SENT'
  | 'AWAITING_DIGEST';

export interface NotificationDecision {
  alert: Alert;
  channel: NotificationChannel;
  send: boolean;
  reason: SendReason | SkipReason;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };

export interface DecideInput {
  alerts: readonly Alert[];
  /** Entregas anteriores do MESMO usuario. */
  deliveries: readonly DeliveryRecord[];
  preference: NotificationPreference;
  /** Instante ISO completo da varredura. */
  now: string;
}

export function decideNotifications(input: DecideInput): NotificationDecision[] {
  const { alerts, deliveries, preference, now } = input;
  const decisions: NotificationDecision[] = [];

  const lastByKey = new Map<string, DeliveryRecord>();
  for (const delivery of deliveries) {
    const key = `${delivery.alertKey}:${delivery.channel}`;
    const previous = lastByKey.get(key);
    if (!previous || delivery.sentAt > previous.sentAt) lastByKey.set(key, delivery);
  }

  const channels: NotificationChannel[] = ['PUSH', 'EMAIL'];
  const quiet = isWithinQuietHours(now, preference);
  const digestTime = isDigestTime(now, preference);

  for (const alert of alerts) {
    for (const channel of channels) {
      const enabled = channel === 'PUSH' ? preference.pushEnabled : preference.emailEnabled;
      if (!enabled) {
        decisions.push({ alert, channel, send: false, reason: 'CHANNEL_OFF' });
        continue;
      }

      if (SEVERITY_RANK[alert.severity] < SEVERITY_RANK[preference.minSeverity]) {
        decisions.push({ alert, channel, send: false, reason: 'BELOW_THRESHOLD' });
        continue;
      }

      // No modo resumo, nada sai fora da hora combinada — nem o critico. Quem
      // escolheu resumo diario pediu exatamente para nao ser interrompido.
      if (preference.mode === 'DAILY_DIGEST' && !digestTime) {
        decisions.push({ alert, channel, send: false, reason: 'AWAITING_DIGEST' });
        continue;
      }

      // Silencio noturno ADIA, nao descarta: como a entrega nao fica
      // registrada, a proxima varredura depois do silencio envia normalmente.
      // Nao precisa de fila nem de agendamento para isso funcionar.
      if (preference.mode === 'IMMEDIATE' && quiet) {
        decisions.push({ alert, channel, send: false, reason: 'QUIET_HOURS' });
        continue;
      }

      const last = lastByKey.get(`${alert.id}:${channel}`);

      if (!last) {
        decisions.push({ alert, channel, send: true, reason: 'FIRST_TIME' });
        continue;
      }

      if (last.resolvedAt) {
        decisions.push({ alert, channel, send: true, reason: 'RECURRED' });
        continue;
      }

      if (SEVERITY_RANK[alert.severity] > SEVERITY_RANK[last.severity]) {
        decisions.push({ alert, channel, send: true, reason: 'ESCALATED' });
        continue;
      }

      if (
        preference.reminderAfterHours > 0 &&
        hoursBetween(last.sentAt, now) >= preference.reminderAfterHours
      ) {
        decisions.push({ alert, channel, send: true, reason: 'REMINDER' });
        continue;
      }

      decisions.push({ alert, channel, send: false, reason: 'ALREADY_SENT' });
    }
  }

  return decisions;
}

/**
 * Entregas cujo alerta sumiu — devem ser marcadas como resolvidas.
 *
 * Sem isto o item 3 ("sumiu e voltou") nunca dispara: a entrega antiga
 * continuaria bloqueando o proximo aviso para sempre.
 */
export function findResolved(
  alerts: readonly Alert[],
  deliveries: readonly DeliveryRecord[],
): DeliveryRecord[] {
  const active = new Set(alerts.map((alert) => alert.id));
  return deliveries.filter((delivery) => !delivery.resolvedAt && !active.has(delivery.alertKey));
}

/* -------------------------------------------------------------------------- */
/*  Horarios                                                                  */
/* -------------------------------------------------------------------------- */

/** Minutos desde a meia-noite no fuso do usuario. */
export function minutesOfDayInTimeZone(instant: string, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [hour, minute] = formatter.format(new Date(instant)).split(':').map(Number);
  return hour * 60 + minute;
}

function parseClock(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + (minute || 0);
}

/**
 * Janela de silencio, tratando a virada de meia-noite.
 *
 * `22:00` a `07:00` NAO e um intervalo crescente: precisa virar "depois das 22
 * OU antes das 7". Comparar como intervalo simples silenciaria o dia inteiro em
 * vez da noite — e o alerta so chegaria em horario nenhum.
 */
export function isWithinQuietHours(instant: string, preference: NotificationPreference): boolean {
  const { quietHoursStart, quietHoursEnd, timezone } = preference;
  if (!quietHoursStart || !quietHoursEnd) return false;

  const now = minutesOfDayInTimeZone(instant, timezone);
  const start = parseClock(quietHoursStart);
  const end = parseClock(quietHoursEnd);

  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/** Verdadeiro dentro da hora do resumo diario. */
export function isDigestTime(instant: string, preference: NotificationPreference): boolean {
  const minutes = minutesOfDayInTimeZone(instant, preference.timezone);
  return Math.floor(minutes / 60) === preference.digestHour;
}

export function hoursBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
}

/* -------------------------------------------------------------------------- */
/*  Conteudo da mensagem                                                      */
/* -------------------------------------------------------------------------- */

export interface NotificationContent {
  title: string;
  body: string;
  /** Rota do app aberta ao tocar na notificacao. */
  deepLink: string | null;
  /** Dados estruturados enviados junto no push. */
  data: Record<string, string>;
}

const SEVERITY_PREFIX: Record<AlertSeverity, string> = {
  CRITICAL: '',
  WARNING: '',
  INFO: '',
};

/**
 * Monta o texto do aviso.
 *
 * O titulo do alerta ja e uma frase completa e especifica ("Fatura de setembro
 * 56% acima da media"), entao vira o titulo do push sem prefixo decorativo.
 * Emoji e "Atencao!" na frente roubam os primeiros caracteres — que sao os
 * unicos que aparecem na tela bloqueada.
 */
export function buildContent(alert: Alert): NotificationContent {
  return {
    title: `${SEVERITY_PREFIX[alert.severity]}${alert.title}`,
    body: alert.description,
    deepLink: alert.href,
    data: {
      alertKey: alert.id,
      severity: alert.severity,
      ...(alert.href ? { href: alert.href } : {}),
    },
  };
}

/** Agrupa varios alertas em um unico aviso, para o modo resumo. */
export function buildDigestContent(alerts: readonly Alert[]): NotificationContent | null {
  if (alerts.length === 0) return null;
  if (alerts.length === 1) return buildContent(alerts[0]);

  const critical = alerts.filter((alert) => alert.severity === 'CRITICAL').length;
  const title =
    critical > 0
      ? `${alerts.length} avisos, ${critical} ${critical === 1 ? 'critico' : 'criticos'}`
      : `${alerts.length} avisos das suas contas`;

  return {
    title,
    body: alerts
      .slice(0, 3)
      .map((alert) => alert.title)
      .join(' · '),
    deepLink: '/alertas',
    data: { count: String(alerts.length), critical: String(critical) },
  };
}
