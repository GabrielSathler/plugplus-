import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useWorkspace } from '../app/workspace';
import { Badge, Card, Segmented, Skeleton, Table, Td, Th } from '../components/ui';
import { api } from '../lib/api';
import { amount, money, monthTitle, signedCompact } from '../lib/format';
import type { ProjectionResponse } from '../lib/types';

const HORIZONS = [
  { value: 3, label: '3 meses' },
  { value: 6, label: '6 meses' },
  { value: 12, label: '12 meses' },
];

export function ProjectionsPage() {
  const { month } = useWorkspace();
  const [months, setMonths] = useState(6);

  const { data, isLoading } = useQuery({
    queryKey: ['projection', month, months],
    queryFn: () =>
      api.get<ProjectionResponse>('/projections/cashflow', { from: month, months }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight">Projecao de {months} meses</h1>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            Base: recorrencias ativas e parcelas ja lancadas. Nenhuma estimativa de gasto variavel
            novo.
          </p>
          {data && data.appliedScenarios.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-[var(--color-muted)]">Cenarios aplicados:</span>
              {data.appliedScenarios.map((scenario) => (
                <Badge key={scenario.id} tone="warning" mono={false}>
                  {scenario.name}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <Segmented
          ariaLabel="Horizonte de projecao"
          options={HORIZONS}
          value={months}
          onChange={setMonths}
        />
      </div>

      {data && data.monthsUntilNegative !== null && (
        <div className="flex items-start gap-2.5 rounded-[var(--radius-card)] bg-[var(--color-negative-soft)] px-4 py-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--color-negative)]" />
          <p className="text-[13px] text-[var(--color-negative)]">
            O saldo fica negativo em{' '}
            <strong className="num">{monthTitle(data.lowestBalanceMonth)}</strong>, chegando a{' '}
            <strong className="num">{money(data.lowestBalance)}</strong>. Revise as parcelas e
            contas fixas do periodo.
          </p>
        </div>
      )}

      <Card padded={false}>
        {isLoading || !data ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Mes</Th>
                <Th align="right">Entradas</Th>
                <Th align="right">Saidas</Th>
                <Th align="right">Fatura cartao</Th>
                <Th align="right">Resultado</Th>
                <Th align="right">Saldo final</Th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((row) => (
                <tr key={row.month} className="hover:bg-[var(--color-surface-sunken)]">
                  <Td className="font-medium">
                    <span className="flex items-center gap-2">
                      {monthTitle(row.month)}
                      {!row.isProjected && (
                        <Badge tone="neutral" mono={false}>
                          realizado
                        </Badge>
                      )}
                    </span>
                  </Td>
                  <Td align="right" mono className="text-[var(--color-teal)]">
                    R$ {amount(row.income)}
                  </Td>
                  {/*
                    `Saidas` JA inclui a fatura; `Fatura cartao` e detalhe, nao
                    parcela somada. Somar as duas colunas contaria o cartao duas
                    vezes — por isso a coluna de fatura fica em cinza claro, com
                    peso visual de anotacao.
                  */}
                  <Td align="right" mono className="text-[var(--color-text-secondary)]">
                    R$ {amount(row.expenses)}
                  </Td>
                  <Td align="right" mono className="text-[var(--color-faint)]">
                    R$ {amount(row.cardPayments)}
                  </Td>
                  <Td
                    align="right"
                    mono
                    className={
                      row.net >= 0 ? 'text-[var(--color-teal)]' : 'text-[var(--color-negative)]'
                    }
                  >
                    {signedCompact(row.net)}
                  </Td>
                  <Td
                    align="right"
                    mono
                    className={
                      row.closingBalance < 0
                        ? 'font-semibold text-[var(--color-negative)]'
                        : 'font-semibold'
                    }
                  >
                    {money(row.closingBalance)}
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[var(--color-surface-sunken)]">
                <Td className="th">Menor saldo do periodo</Td>
                <Td colSpan={4} />
                <Td align="right" mono className="font-semibold">
                  {money(data.lowestBalance)}
                </Td>
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>

      <p className="text-[11px] text-[var(--color-muted)]">
        Compras no credito nao saem do caixa na data da compra: entram na fatura e debitam no
        vencimento. Por isso a coluna <span className="font-medium">Fatura cartao</span> e um
        recorte de <span className="font-medium">Saidas</span>, nao um valor adicional.
      </p>
    </div>
  );
}
