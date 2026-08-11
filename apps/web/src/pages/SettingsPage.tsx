import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../app/workspace';
import { Badge, Card, CardTitle, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { roleLabel } from '../lib/format';
import type { Member } from '../lib/types';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { session } = useWorkspace();

  const { data: members, isLoading } = useQuery({
    queryKey: ['members'],
    queryFn: () => api.get<Member[]>('/auth/members'),
  });

  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch('/settings', patch),
    onSuccess: () => void queryClient.invalidateQueries(),
  });

  const organization = session?.organization;

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Card>
        <CardTitle title="Pessoas no plano" subtitle="Quem tem acesso a este workspace" />
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {(members ?? []).map((member) => (
              <li key={member.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--color-surface-sunken)] text-[11px] font-semibold text-[var(--color-text-secondary)]">
                  {member.user.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{member.user.name}</p>
                  <p className="truncate text-[11px] text-[var(--color-muted)]">
                    {member.user.email}
                  </p>
                </div>
                <Badge tone="neutral" mono={false}>
                  {roleLabel(member.role)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle title="Preferencias" subtitle="Valem para todos os relatorios do workspace" />
        {!organization ? (
          <Skeleton className="h-64" />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            <PreferenceRow
              label="Moeda e formato"
              description="Aplicado a todos os relatorios"
              value={`${organization.currency} · ${organization.locale}`}
            />

            <PreferenceRow
              label="Inicio do mes financeiro"
              description="Base para orcamentos e fechamentos"
              value={`Dia ${organization.fiscalMonthStartDay}`}
            />

            {/*
              Editaveis in-place: o horizonte de projecao e a meta de
              comprometimento mudam o que a Visao geral mostra, entao o ajuste
              precisa estar a um clique do resultado, nao atras de um formulario.
            */}
            <PreferenceRow
              label="Horizonte padrao de projecao"
              description="Usado ao abrir o dashboard"
              value={
                <select
                  value={organization.projectionHorizon}
                  onChange={(event) =>
                    update.mutate({ projectionHorizon: Number(event.target.value) })
                  }
                  className={selectClass}
                >
                  {[3, 6, 12, 18, 24].map((value) => (
                    <option key={value} value={value}>
                      {value} meses
                    </option>
                  ))}
                </select>
              }
            />

            <PreferenceRow
              label="Meta de comprometimento da renda"
              description="Dispara o alerta quando ultrapassada"
              value={
                <select
                  value={organization.commitmentTarget}
                  onChange={(event) =>
                    update.mutate({ commitmentTarget: Number(event.target.value) })
                  }
                  className={selectClass}
                >
                  {[50, 60, 65, 70, 75, 80, 90].map((value) => (
                    <option key={value} value={value}>
                      ate {value}%
                    </option>
                  ))}
                </select>
              }
            />

            <PreferenceRow
              label="Sincronizacao automatica"
              description="Open Finance nas contas conectadas"
              value={
                <select
                  value={organization.autoSyncPerDay}
                  onChange={(event) =>
                    update.mutate({ autoSyncPerDay: Number(event.target.value) })
                  }
                  className={selectClass}
                >
                  {[0, 1, 2, 4, 8, 24].map((value) => (
                    <option key={value} value={value}>
                      {value === 0 ? 'Manual' : `${value}x ao dia`}
                    </option>
                  ))}
                </select>
              }
            />

            <PreferenceRow
              label="Exportacao"
              description="Envio automatico para o contador"
              value={organization.exportPreference}
            />

            <PreferenceRow
              label="Fuso horario"
              description="Define o corte de dia dos lancamentos"
              value={organization.timezone}
            />
          </ul>
        )}
      </Card>
    </div>
  );
}

const selectClass =
  'num rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-[12px] text-[var(--color-teal)] outline-none focus:border-[var(--color-teal)]';

function PreferenceRow({
  label,
  description,
  value,
}: {
  label: string;
  description: string;
  value: React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{label}</p>
        <p className="text-[11px] text-[var(--color-muted)]">{description}</p>
      </div>
      {typeof value === 'string' ? (
        <span className="num shrink-0 text-[12px] text-[var(--color-teal)]">{value}</span>
      ) : (
        <span className="shrink-0">{value}</span>
      )}
    </li>
  );
}
