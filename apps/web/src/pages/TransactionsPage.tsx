import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useWorkspace } from '../app/workspace';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FilterChips,
  Skeleton,
  Table,
  Td,
  Th,
} from '../components/ui';
import { api } from '../lib/api';
import { dayMonth, signedAmount } from '../lib/format';
import type { Paginated, TransactionRow } from '../lib/types';

type Scope = 'ALL' | 'CARD' | 'ACCOUNT' | 'INSTALLMENTS';

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'CARD', label: 'Cartao' },
  { value: 'ACCOUNT', label: 'Conta corrente' },
  { value: 'INSTALLMENTS', label: 'Parceladas' },
];

export function TransactionsPage() {
  const { month } = useWorkspace();
  const [scope, setScope] = useState<Scope>('ALL');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);

  // Debounce da busca: sem ele, cada tecla vira uma requisicao e a lista
  // pisca a cada caractere.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', month, scope, debounced, page],
    queryFn: () =>
      api.get<Paginated<TransactionRow>>('/transactions', {
        month,
        search: debounced || undefined,
        scope: scope === 'ALL' ? undefined : scope,
        page,
        pageSize: 25,
      }),
  });

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--color-faint)]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por descricao, valor ou estabelecimento"
            aria-label="Buscar transacoes"
            className="w-full rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] py-2.5 pr-3 pl-9 text-[13px] outline-none placeholder:text-[var(--color-faint)] focus:bg-[var(--color-surface)] focus:ring-1 focus:ring-[var(--color-teal)]"
          />
        </div>

        <FilterChips
          ariaLabel="Filtrar por origem"
          options={SCOPES}
          value={scope}
          onChange={(value) => {
            setScope(value);
            setPage(1);
          }}
        />
      </div>

      {isLoading ? (
        <div className="space-y-2 px-4 pb-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="Nenhuma transacao encontrada"
          description={
            debounced
              ? `Nada corresponde a "${debounced}" neste mes.`
              : 'Nao ha lancamentos nesta competencia com os filtros atuais.'
          }
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Data</Th>
                <Th>Descricao</Th>
                <Th>Categoria</Th>
                <Th>Origem</Th>
                <Th align="right">Valor</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id} className="hover:bg-[var(--color-surface-sunken)]">
                  <Td mono className="w-20 text-[var(--color-muted)]">
                    {dayMonth(row.date)}
                  </Td>

                  <Td>
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{row.description}</span>
                      {row.status === 'SCHEDULED' && (
                        <Badge tone="neutral" mono={false}>
                          agendada
                        </Badge>
                      )}
                    </span>
                  </Td>

                  <Td>
                    {row.category ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-surface-sunken)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]">
                        <span
                          className="size-1.5 rounded-full"
                          style={{ background: row.category.color }}
                          aria-hidden="true"
                        />
                        {row.category.name}
                      </span>
                    ) : (
                      <span className="text-[11px] text-[var(--color-faint)]">sem categoria</span>
                    )}
                  </Td>

                  <Td className="text-[var(--color-teal)]">
                    <span className="text-[12px]">
                      {row.creditCard
                        ? `${row.creditCard.name} · ${row.creditCard.lastFour ?? ''}`
                        : row.account
                          ? `${row.account.institution ?? row.account.name} · ${row.account.accountNumber ?? ''}`
                          : '—'}
                    </span>
                  </Td>

                  <Td
                    align="right"
                    mono
                    className={
                      row.type === 'INCOME'
                        ? 'font-medium text-[var(--color-teal)]'
                        : 'font-medium text-[var(--color-text)]'
                    }
                  >
                    {signedAmount(row.amount, row.type)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          <div className="flex items-center justify-between px-4 py-3">
            <p className="num text-xs text-[var(--color-muted)]">
              {data.total} lancamentos · pagina {data.page} de {data.totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Anterior
              </Button>
              <Button
                size="sm"
                disabled={page >= data.totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                Proxima
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
