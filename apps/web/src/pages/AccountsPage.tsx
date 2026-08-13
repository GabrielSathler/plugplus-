import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard as CreditCardIcon, Landmark, Link2, Plus, RefreshCw, Upload } from 'lucide-react';
import { useState } from 'react';
import { ImportStatementDialog } from '../components/ImportStatementDialog';
import { AccountForm } from '../components/forms/AccountForm';
import { CreditCardForm } from '../components/forms/CreditCardForm';
import { useWorkspace } from '../app/workspace';
import { Badge, Button, Card, CardTitle, Dot, EmptyState, Skeleton, type Tone } from '../components/ui';
import { api } from '../lib/api';
import {
  accountTypeLabel,
  connectionLabel,
  fullDate,
  money,
  percentWhole,
  relativeTime,
} from '../lib/format';
import type { AccountRow, Connection, CreditCardRow } from '../lib/types';

const CONNECTION_TONE: Record<string, Tone> = {
  CONNECTED: 'positive',
  SYNCING: 'accent',
  NEEDS_ACTION: 'warning',
  CONSENT_EXPIRED: 'negative',
  ERROR: 'negative',
  DISCONNECTED: 'neutral',
};

export function AccountsPage() {
  const queryClient = useQueryClient();
  const { session } = useWorkspace();

  const [importing, setImporting] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [creatingCard, setCreatingCard] = useState(false);

  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get<AccountRow[]>('/accounts'),
  });
  const cards = useQuery({
    queryKey: ['credit-cards'],
    queryFn: () => api.get<CreditCardRow[]>('/credit-cards'),
  });
  const connections = useQuery({
    queryKey: ['connections'],
    queryFn: () => api.get<Connection[]>('/integrations/connections'),
  });

  const sync = useMutation({
    mutationFn: (id: string) => api.post(`/integrations/connections/${id}/sync`),
    onSuccess: () => void queryClient.invalidateQueries(),
  });

  const totalBalance = (accounts.data ?? [])
    .filter((account) => account.includeInTotals && account.isActive)
    .reduce((sum, account) => sum + account.currentBalance, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardTitle
            title="Contas"
            subtitle="O consolidado soma apenas as contas marcadas para totalizar"
            action={
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={() => setCreatingAccount(true)}>
                  <Plus className="size-3.5" />
                  Nova conta
                </Button>
                <Button size="sm" onClick={() => setImporting(true)}>
                  <Upload className="size-3.5" />
                  Importar extrato
                </Button>
                <span className="num text-[15px] font-semibold">{money(totalBalance)}</span>
              </div>
            }
          />
          {accounts.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {(accounts.data ?? []).map((account) => (
                <li key={account.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--color-surface-sunken)]">
                    <Landmark className="size-4 text-[var(--color-muted)]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-[13px] font-medium">
                      <Dot color={account.color} />
                      {account.name}
                    </p>
                    <p className="num text-[11px] text-[var(--color-muted)]">
                      {accountTypeLabel(account.type)}
                      {account.accountNumber && ` · ${account.accountNumber}`}
                    </p>
                  </div>
                  {/*
                    Investimento fica fora do consolidado por padrao. Somar
                    reserva de longo prazo ao caixa do mes inflaria o "saldo
                    atual" e esconderia um aperto real de curto prazo.
                  */}
                  {!account.includeInTotals && (
                    <Badge tone="neutral" mono={false}>
                      fora do total
                    </Badge>
                  )}
                  <span className="num shrink-0 text-[13px] font-medium">
                    {money(account.currentBalance)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle
            title="Cartoes"
            subtitle="Ciclo de fechamento e vencimento de cada cartao"
            action={
              <Button size="sm" onClick={() => setCreatingCard(true)}>
                <Plus className="size-3.5" />
                Novo cartao
              </Button>
            }
          />
          {cards.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {(cards.data ?? []).map((card) => (
                <li key={card.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-lg"
                      style={{ background: card.color }}
                    >
                      <CreditCardIcon className="size-4 text-white" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">
                        {card.name}
                        {card.lastFour && (
                          <span className="num font-normal text-[var(--color-muted)]">
                            {' '}
                            · {card.lastFour}
                          </span>
                        )}
                      </p>
                      <p className="num text-[11px] text-[var(--color-muted)]">
                        fecha dia {card.closingDay} · vence dia {card.dueDay}
                      </p>
                    </div>
                    <span className="num shrink-0 text-[11px] text-[var(--color-muted)]">
                      limite {money(card.limitAmount)}
                    </span>
                  </div>

                  <p className="num mt-2 text-[11px] text-[var(--color-faint)]">
                    Ciclo atual: {fullDate(card.currentCycle.closingDate)} →{' '}
                    {fullDate(card.currentCycle.dueDate)} ·{' '}
                    {percentWhole(card.currentCycle.percent)} decorrido
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle
          title="Instituicoes conectadas"
          subtitle={`Open Finance · sincronizacao ${session?.organization.autoSyncPerDay ?? 4}x ao dia`}
        />
        {connections.isLoading ? (
          <Skeleton className="h-32" />
        ) : (connections.data ?? []).length === 0 ? (
          <EmptyState
            icon={<Link2 className="size-6" />}
            title="Nenhuma instituicao conectada"
            description="Conecte um banco para importar lancamentos automaticamente."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {(connections.data ?? []).map((connection) => (
              <li key={connection.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[13px] font-medium">
                    {connection.institutionName}
                    <Badge tone={CONNECTION_TONE[connection.status] ?? 'neutral'} mono={false}>
                      {connectionLabel(connection.status)}
                    </Badge>
                  </p>
                  <p className="num mt-0.5 text-[11px] text-[var(--color-muted)]">
                    {connection.provider} · {connection.accountsLinked} contas · sincronizado{' '}
                    {relativeTime(connection.lastSyncAt)}
                    {/*
                      A data so aparece quando existe: consentimento por prazo
                      indeterminado passou a ser valido com a Resolucao Conjunta
                      7/2023. Quando ha prazo, ele fica visivel — descobrir o
                      vencimento pela ausencia de lancamentos e o pior jeito.
                    */}
                    {connection.consentExpiresAt &&
                      ` · consentimento ate ${fullDate(connection.consentExpiresAt)}`}
                  </p>
                  {connection.lastError && (
                    <p className="mt-1 text-[11px] text-[var(--color-negative)]">
                      {connection.lastError}
                    </p>
                  )}
                </div>

                <Button
                  size="sm"
                  onClick={() => sync.mutate(connection.id)}
                  disabled={sync.isPending}
                >
                  <RefreshCw className={sync.isPending ? 'size-3.5 animate-spin' : 'size-3.5'} />
                  Sincronizar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <AccountForm open={creatingAccount} onClose={() => setCreatingAccount(false)} />
      <CreditCardForm open={creatingCard} onClose={() => setCreatingCard(false)} />
      <ImportStatementDialog
        open={importing}
        onClose={() => setImporting(false)}
        accounts={accounts.data ?? []}
      />
    </div>
  );
}
