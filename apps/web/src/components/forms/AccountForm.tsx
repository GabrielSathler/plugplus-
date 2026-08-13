import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '../../lib/api';
import type { AccountRow } from '../../lib/types';
import { Button } from '../ui';
import { Dialog, Field, MoneyInput, formInputClass, parseMoney } from './shared';

const TYPES = [
  { value: 'CHECKING', label: 'Conta corrente' },
  { value: 'SAVINGS', label: 'Poupanca' },
  { value: 'INVESTMENT', label: 'Investimento' },
  { value: 'CASH', label: 'Dinheiro' },
  { value: 'WALLET', label: 'Carteira digital' },
];

/** Cores de instituições comuns — reconhecer a cor é mais rápido que ler o nome. */
const COLORS = ['#EC7000', '#820AD1', '#FF7A00', '#0F8A72', '#3B6FE0', '#C0453B', '#16161A'];

export function AccountForm({
  open,
  onClose,
  account,
}: {
  open: boolean;
  onClose: () => void;
  /** Ausente = criação. */
  account?: AccountRow;
}) {
  const queryClient = useQueryClient();
  const editing = Boolean(account);

  const [form, setForm] = useState({
    name: account?.name ?? '',
    type: account?.type ?? 'CHECKING',
    institution: account?.institution ?? '',
    accountNumber: account?.accountNumber ?? '',
    balance: account ? (account.currentBalance / 100).toFixed(2).replace('.', ',') : '',
    color: account?.color ?? COLORS[0],
    // Investimento fora do total é o padrão certo: misturar reserva de longo
    // prazo com o caixa do mês inflaria o saldo e esconderia aperto real.
    includeInTotals: account?.includeInTotals ?? true,
  });
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        institution: form.institution.trim() || undefined,
        accountNumber: form.accountNumber.trim() || undefined,
        currentBalance: parseMoney(form.balance),
        color: form.color,
        includeInTotals: form.includeInTotals,
      };
      return editing
        ? api.patch(`/accounts/${account!.id}`, payload)
        : api.post('/accounts', { ...payload, openingBalance: parseMoney(form.balance) });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel salvar.'),
  });

  if (!open) return null;

  return (
    <Dialog
      title={editing ? 'Editar conta' : 'Nova conta'}
      subtitle="Onde o dinheiro entra e sai no dia a dia."
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <Field label="Nome da conta">
          <input
            required
            autoFocus
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Itau · Conta corrente"
            className={formInputClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <select
              value={form.type}
              onChange={(e) => {
                const type = e.target.value;
                setForm((f) => ({
                  ...f,
                  type,
                  // Investimento sai do consolidado por padrão; o usuário pode
                  // reverter, mas o padrão precisa ser o que não engana.
                  includeInTotals: type === 'INVESTMENT' ? false : f.includeInTotals,
                }));
              }}
              className={formInputClass}
            >
              {TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Saldo atual">
            <MoneyInput
              value={form.balance}
              onChange={(balance) => setForm((f) => ({ ...f, balance }))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Instituicao">
            <input
              value={form.institution}
              onChange={(e) => setForm((f) => ({ ...f, institution: e.target.value }))}
              placeholder="Itau"
              className={formInputClass}
            />
          </Field>
          <Field label="Numero (opcional)">
            <input
              value={form.accountNumber}
              onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
              placeholder="0192"
              className={`${formInputClass} num`}
            />
          </Field>
        </div>

        <Field label="Cor">
          <div className="flex gap-2">
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Cor ${color}`}
                onClick={() => setForm((f) => ({ ...f, color }))}
                className={
                  form.color === color
                    ? 'size-7 rounded-full ring-2 ring-[var(--color-text)] ring-offset-2'
                    : 'size-7 rounded-full'
                }
                style={{ background: color }}
              />
            ))}
          </div>
        </Field>

        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={form.includeInTotals}
            onChange={(e) => setForm((f) => ({ ...f, includeInTotals: e.target.checked }))}
            className="mt-0.5 size-4 shrink-0 accent-[var(--color-teal)]"
          />
          <span className="text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
            Somar no saldo consolidado.{' '}
            <span className="text-[var(--color-muted)]">
              Desmarque para investimentos — assim a reserva de longo prazo nao infla o caixa do
              mes.
            </span>
          </span>
        </label>

        {error && (
          <p className="rounded-[var(--radius-control)] bg-[var(--color-negative-soft)] px-3 py-2 text-[13px] text-[var(--color-negative)]">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? 'Salvando...' : editing ? 'Salvar' : 'Criar conta'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export { X };
