import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BellOff,
  Mail,
  Monitor,
  Send,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { useWorkspace } from '../app/workspace';
import { Badge, Button, Card, CardTitle, EmptyState, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import { AlertRow } from './OverviewPage';
import type { Alert, DeliveriesByAlert, NotificationSettings } from '../lib/types';

const GROUPS = [
  { severity: 'CRITICAL', title: 'Critico', subtitle: 'Exige acao ainda neste mes' },
  { severity: 'WARNING', title: 'Atencao', subtitle: 'Vale acompanhar de perto' },
  { severity: 'INFO', title: 'Informativo', subtitle: 'Sem impacto imediato' },
];

/**
 * Alertas e a entrega deles.
 *
 * A tela mostra duas coisas que sao deliberadamente separadas no back-end: o
 * ALERTA, recalculado do estado a cada carregamento e que some sozinho quando
 * a causa some; e a ENTREGA, que fica gravada para responder "ja te avisei
 * disto?". Por isso cada aviso carrega, embaixo, por onde e quando saiu.
 */
export function AlertsPage() {
  const { month } = useWorkspace();
  const queryClient = useQueryClient();

  const alerts = useQuery({
    queryKey: ['alerts', month],
    queryFn: () => api.get<Alert[]>('/alerts', { month }),
  });
  const deliveries = useQuery({
    queryKey: ['deliveries'],
    queryFn: () => api.get<DeliveriesByAlert>('/notifications/deliveries'),
  });
  const settings = useQuery({
    queryKey: ['notification-settings'],
    queryFn: () => api.get<NotificationSettings>('/notifications/preferences'),
  });

  const dispatch = useMutation({
    mutationFn: () => api.post<{ sent: number; skipped: number }>('/notifications/dispatch'),
    onSuccess: () => void queryClient.invalidateQueries(),
  });

  if (alerts.isLoading || !alerts.data) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  const pendingCount = alerts.data.filter(
    (alert) => !(deliveries.data ?? {})[alert.id]?.length,
  ).length;

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <p className="text-xs text-[var(--color-muted)]">
          Avisos sao derivados do estado atual a cada carregamento, nunca guardados — quando a
          causa desaparece, o aviso some junto. O que fica gravado e o <strong>envio</strong>, para
          o mesmo alerta nao ser notificado duas vezes.
        </p>

        {alerts.data.length === 0 ? (
          <Card>
            <EmptyState
              icon={<ShieldCheck className="size-7" />}
              title="Nada exigindo acao"
              description="Faturas, orcamentos, saldo projetado e consentimentos bancarios estao dentro do esperado."
            />
          </Card>
        ) : (
          GROUPS.map((group) => {
            const rows = alerts.data.filter((alert) => alert.severity === group.severity);
            if (rows.length === 0) return null;

            return (
              <Card key={group.severity}>
                <CardTitle title={`${group.title} · ${rows.length}`} subtitle={group.subtitle} />
                <ul className="space-y-3">
                  {rows.map((alert) => (
                    <li key={alert.id}>
                      <AlertRow
                        severity={alert.severity}
                        title={alert.title}
                        description={alert.description}
                        href={alert.href}
                      />
                      <DeliveryTrail entries={(deliveries.data ?? {})[alert.id] ?? []} />
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })
        )}
      </div>

      <div className="space-y-3">
        <Card>
          <CardTitle
            title="Envio"
            subtitle={
              settings.data
                ? `push por ${settings.data.providers.push.toLowerCase()} · e-mail por ${settings.data.providers.email.toLowerCase()}`
                : undefined
            }
          />

          <div className="mb-3 rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] px-3 py-2.5">
            <p className="text-[13px]">
              <strong className="num">{pendingCount}</strong>{' '}
              {pendingCount === 1 ? 'aviso ainda nao enviado' : 'avisos ainda nao enviados'}
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
              Em producao um agendador chama a varredura de tempos em tempos. Aqui da para
              disparar a mao.
            </p>
          </div>

          <Button
            variant="primary"
            onClick={() => dispatch.mutate()}
            disabled={dispatch.isPending}
            className="w-full"
          >
            <Send className="size-3.5" />
            {dispatch.isPending ? 'Enviando...' : 'Rodar varredura agora'}
          </Button>

          {dispatch.data && (
            <p className="num mt-2 text-center text-[11px] text-[var(--color-muted)]">
              {dispatch.data.sent} enviados · {dispatch.data.skipped} ignorados
            </p>
          )}
        </Card>

        {settings.data && <NotificationSettingsCard settings={settings.data} />}
      </div>
    </div>
  );
}

/** Por onde e quando o aviso saiu. Vazio significa "detectado, ainda nao enviado". */
function DeliveryTrail({
  entries,
}: {
  entries: { channel: string; sentAt: string; status: string }[];
}) {
  if (entries.length === 0) {
    return (
      <p className="mt-1 pl-5 text-[10px] text-[var(--color-faint)]">
        detectado · ainda nao enviado
      </p>
    );
  }

  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-5 text-[10px] text-[var(--color-muted)]">
      {entries.map((entry) => (
        <span key={`${entry.channel}-${entry.sentAt}`} className="inline-flex items-center gap-1">
          {entry.channel === 'PUSH' ? (
            <Bell className="size-2.5" />
          ) : (
            <Mail className="size-2.5" />
          )}
          {entry.channel === 'PUSH' ? 'push' : 'e-mail'}
          <span className={entry.status === 'FAILED' ? 'text-[var(--color-negative)]' : ''}>
            {entry.status === 'FAILED' ? 'falhou' : relativeTime(entry.sentAt)}
          </span>
        </span>
      ))}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/*  Preferencias                                                              */
/* -------------------------------------------------------------------------- */

const PLATFORM_ICON: Record<string, typeof Smartphone> = {
  ANDROID: Smartphone,
  IOS: Smartphone,
  WEB: Monitor,
};

function NotificationSettingsCard({ settings }: { settings: NotificationSettings }) {
  const queryClient = useQueryClient();
  const [testResult, setTestResult] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch('/notifications/preferences', patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notification-settings'] }),
  });

  const test = useMutation({
    mutationFn: (channel: string) =>
      api.post<{ ok: boolean; error?: string; provider: string }>('/notifications/test', {
        channel,
      }),
    onSuccess: (result) =>
      setTestResult(
        result.ok
          ? `Enviado via ${result.provider.toLowerCase()}.`
          : (result.error ?? 'Falha no envio.'),
      ),
  });

  const removeDevice = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/devices/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notification-settings'] }),
  });

  const { preference, devices } = settings;

  return (
    <Card>
      <CardTitle title="Como voce quer ser avisado" />

      <ul className="divide-y divide-[var(--color-line)]">
        <Toggle
          icon={<Bell className="size-3.5" />}
          label="Push no celular"
          checked={preference.pushEnabled}
          onChange={(value) => update.mutate({ pushEnabled: value })}
        />
        <Toggle
          icon={<Mail className="size-3.5" />}
          label="E-mail"
          checked={preference.emailEnabled}
          onChange={(value) => update.mutate({ emailEnabled: value })}
        />

        <Row label="Avisar a partir de">
          <select
            value={preference.minSeverity}
            onChange={(e) => update.mutate({ minSeverity: e.target.value })}
            className={selectClass}
          >
            <option value="INFO">tudo</option>
            <option value="WARNING">atencao</option>
            <option value="CRITICAL">so critico</option>
          </select>
        </Row>

        <Row label="Quando enviar">
          <select
            value={preference.mode}
            onChange={(e) => update.mutate({ mode: e.target.value })}
            className={selectClass}
          >
            <option value="IMMEDIATE">na hora</option>
            <option value="DAILY_DIGEST">resumo diario</option>
          </select>
        </Row>

        {preference.mode === 'DAILY_DIGEST' ? (
          <Row label="Hora do resumo">
            <select
              value={preference.digestHour}
              onChange={(e) => update.mutate({ digestHour: Number(e.target.value) })}
              className={selectClass}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </Row>
        ) : (
          /* No modo resumo o silencio nao se aplica — nada sai fora da hora marcada. */
          <Row label="Silencio noturno">
            <span className="num text-[12px] text-[var(--color-teal)]">
              {preference.quietHoursStart ?? '—'} as {preference.quietHoursEnd ?? '—'}
            </span>
          </Row>
        )}

        <Row label="Relembrar se continuar">
          <select
            value={preference.reminderAfterHours}
            onChange={(e) => update.mutate({ reminderAfterHours: Number(e.target.value) })}
            className={selectClass}
          >
            <option value={0}>nunca</option>
            <option value={12}>12 h</option>
            <option value={24}>24 h</option>
            <option value={72}>3 dias</option>
            <option value={168}>1 semana</option>
          </select>
        </Row>
      </ul>

      <div className="mt-4 border-t border-[var(--color-line)] pt-3">
        <p className="mb-2 flex items-center justify-between text-[11px] font-medium text-[var(--color-muted)]">
          Aparelhos registrados
          <span className="num">{devices.filter((device) => device.isActive).length}</span>
        </p>

        {devices.length === 0 ? (
          <p className="flex items-start gap-1.5 text-[11px] text-[var(--color-faint)]">
            <BellOff className="mt-0.5 size-3 shrink-0" />
            Nenhum aparelho registrado — o push nao tem para onde ir. O app registra o token do
            Firebase ao pedir permissao de notificacao.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {devices.map((device) => {
              const Icon = PLATFORM_ICON[device.platform] ?? Monitor;
              return (
                <li key={device.id} className="flex items-center gap-2 text-[11px]">
                  <Icon className="size-3 shrink-0 text-[var(--color-muted)]" />
                  <span className="min-w-0 flex-1 truncate">
                    {device.label ?? device.platform.toLowerCase()}
                  </span>
                  {!device.isActive && (
                    <Badge tone="neutral" mono={false}>
                      inativo
                    </Badge>
                  )}
                  <button
                    type="button"
                    aria-label="Remover aparelho"
                    onClick={() => removeDevice.mutate(device.id)}
                    className="text-[var(--color-faint)] hover:text-[var(--color-negative)]"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => test.mutate('PUSH')} disabled={test.isPending}>
            Testar push
          </Button>
          <Button size="sm" onClick={() => test.mutate('EMAIL')} disabled={test.isPending}>
            Testar e-mail
          </Button>
        </div>

        {testResult && (
          <p className="mt-2 text-[11px] text-[var(--color-muted)]">{testResult}</p>
        )}
      </div>
    </Card>
  );
}

const selectClass =
  'num rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-[12px] text-[var(--color-teal)] outline-none focus:border-[var(--color-teal)]';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-[13px]">{label}</span>
      {children}
    </li>
  );
}

function Toggle({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span className="flex items-center gap-2 text-[13px]">
        <span className="text-[var(--color-muted)]">{icon}</span>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={
          checked
            ? 'relative h-5 w-9 rounded-full bg-[var(--color-teal)] transition-colors'
            : 'relative h-5 w-9 rounded-full bg-[var(--color-line-strong)] transition-colors'
        }
      >
        <span
          className={
            checked
              ? 'absolute top-0.5 left-[18px] size-4 rounded-full bg-white transition-all'
              : 'absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-all'
          }
        />
      </button>
    </li>
  );
}
