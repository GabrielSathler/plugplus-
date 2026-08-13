import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  resolveCycleForPurchase,
  today as todayIn,
  type CardCycleConfig,
} from '@finflow/shared';
import { ApiError, api } from '../../lib/api';
import { fullDate, monthTitle } from '../../lib/format';
import type { AccountRow, CreditCardRow } from '../../lib/types';
import { Button } from '../ui';
import { Dialog, Field, MoneyInput, formInputClass, parseMoney } from './shared';

const BRANDS = ['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'OTHER'];
const COLORS = ['#16161A', '#820AD1', '#EC7000', '#0F8A72', '#3B6FE0', '#C0453B'];

export function CreditCardForm({
  open,
  onClose,
  card,
}: {
  open: boolean;
  onClose: () => void;
  card?: CreditCardRow;
}) {
  const queryClient = useQueryClient();
  const editing = Boolean(card);

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get<AccountRow[]>('/accounts'),
    enabled: open,
  });

  const [form, setForm] = useState({
    name: card?.name ?? '',
    brand: card?.brand ?? 'VISA',
    lastFour: card?.lastFour ?? '',
    institution: card?.institution ?? '',
    limitAmount: card ? (card.limitAmount / 100).toFixed(2).replace('.', ',') : '',
    closingDay: card?.closingDay ?? 28,
    dueDay: card?.dueDay ?? 5,
    paymentAccountId: card?.paymentAccount?.id ?? '',
    color: card?.color ?? COLORS[0],
  });
  const [error, setError] = useState<string | null>(null);

  /**
   * Prévia do ciclo, recalculada a cada mudança de dia.
   *
   * É o coração do produto exposto no formulário: a pessoa vê, ANTES de salvar,
   * que uma compra feita hoje vai parar na fatura de tal mês. Fechamento e
   * vencimento são o campo que mais se erra ao cadastrar cartão, e o erro só
   * apareceria semanas depois, como projeção deslocada em um mês inteiro.
   */
  const preview = useMemo(() => {
    const config: CardCycleConfig = {
      closingDay: Number(form.closingDay),
      dueDay: Number(form.dueDay),
    };
    if (
      !Number.isInteger(config.closingDay) ||
      config.closingDay < 1 ||
      config.closingDay > 31 ||
      !Number.isInteger(config.dueDay) ||
      config.dueDay < 1 ||
      config.dueDay > 31
    ) {
      return null;
    }
    try {
      return resolveCycleForPurchase(todayIn(), config);
    } catch {
      return null;
    }
  }, [form.closingDay, form.dueDay]);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        brand: form.brand,
        lastFour: form.lastFour.trim() || undefined,
        institution: form.institution.trim() || undefined,
        limitAmount: parseMoney(form.limitAmount),
        closingDay: Number(form.closingDay),
        dueDay: Number(form.dueDay),
        paymentAccountId: form.paymentAccountId || undefined,
        color: form.color,
      };
      return editing
        ? api.patch(`/credit-cards/${card!.id}`, payload)
        : api.post('/credit-cards', payload);
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
      title={editing ? 'Editar cartao' : 'Novo cartao'}
      subtitle="O ciclo de fechamento define em qual fatura cada compra cai."
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
        <Field label="Nome do cartao">
          <input
            required
            autoFocus
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Visa Infinite"
            className={formInputClass}
          />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Bandeira">
            <select
              value={form.brand}
              onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
              className={formInputClass}
            >
              {BRANDS.map((brand) => (
                <option key={brand} value={brand}>
                  {brand === 'OTHER' ? 'Outra' : brand}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Final">
            <input
              maxLength={4}
              value={form.lastFour}
              onChange={(e) =>
                setForm((f) => ({ ...f, lastFour: e.target.value.replace(/\D/g, '') }))
              }
              placeholder="4417"
              className={`${formInputClass} num`}
            />
          </Field>
          <Field label="Limite">
            <MoneyInput
              value={form.limitAmount}
              onChange={(limitAmount) => setForm((f) => ({ ...f, limitAmount }))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha no dia">
            <input
              required
              type="number"
              min={1}
              max={31}
              value={form.closingDay}
              onChange={(e) => setForm((f) => ({ ...f, closingDay: Number(e.target.value) }))}
              className={`${formInputClass} num`}
            />
          </Field>
          <Field label="Vence no dia">
            <input
              required
              type="number"
              min={1}
              max={31}
              value={form.dueDay}
              onChange={(e) => setForm((f) => ({ ...f, dueDay: Number(e.target.value) }))}
              className={`${formInputClass} num`}
            />
          </Field>
        </div>

        {preview && (
          <div className="rounded-[var(--radius-control)] border border-[var(--color-teal-line)] bg-[var(--color-teal-soft)] px-3 py-2.5">
            <p className="text-[12px] leading-relaxed text-[var(--color-teal)]">
              Uma compra feita <strong>hoje</strong> cai na fatura de{' '}
              <strong className="num">{monthTitle(preview.referenceMonth)}</strong> — fecha{' '}
              <span className="num">{fullDate(preview.closingDate)}</span> e vence{' '}
              <span className="num">{fullDate(preview.dueDate)}</span>.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Instituicao">
            <input
              value={form.institution}
              onChange={(e) => setForm((f) => ({ ...f, institution: e.target.value }))}
              placeholder="Itau"
              className={formInputClass}
            />
          </Field>
          <Field
            label="Conta que paga"
            hint="A fatura debita nela no vencimento."
          >
            <select
              value={form.paymentAccountId}
              onChange={(e) => setForm((f) => ({ ...f, paymentAccountId: e.target.value }))}
              className={formInputClass}
            >
              <option value="">Nenhuma</option>
              {(accounts ?? [])
                .filter((account) => account.isActive)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
            </select>
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
            {save.isPending ? 'Salvando...' : editing ? 'Salvar' : 'Criar cartao'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
