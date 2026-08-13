import { TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Moldura das telas de entrada e cadastro.
 *
 * Divisão em duas colunas: à esquerda o formulário, à direita a prova do que o
 * produto entrega. O painel direito não é decoração — mostra um saldo projetado
 * real, que é exatamente a promessa da marca. Em telas estreitas ele some, e o
 * formulário fica sozinho: quem abre no celular quer entrar, não ser convencido.
 */
export function AuthLayout({
  children,
  aside = <DefaultAside />,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <div className="flex flex-col justify-center bg-[var(--color-canvas)] px-6 py-12 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-[380px]">
          <Link to="/" className="mb-9 inline-flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-lg bg-[var(--color-teal-bright)]">
              <TrendingUp className="size-4 text-white" strokeWidth={2.5} />
            </span>
            <span className="text-[15px] font-bold tracking-tight">Cardinal</span>
          </Link>

          {children}

          <p className="num mt-12 text-[10px] tracking-[0.12em] text-[var(--color-faint)] uppercase">
            Cardinal · dados via open finance
          </p>
        </div>
      </div>

      <aside className="hidden flex-col justify-center bg-[var(--color-surface)] px-16 lg:flex">
        {aside}
      </aside>
    </div>
  );
}

function DefaultAside() {
  return (
    <div className="max-w-[420px]">
      <h2 className="text-[26px] leading-tight font-semibold tracking-tight text-[var(--color-text)]">
        Todo o dinheiro da familia em uma projecao so.
      </h2>
      <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
        Cartao, conta corrente, parcelas em curso e planos de gasto no mesmo saldo projetado.
      </p>

      {/* Números ilustrativos: a tela de entrada não tem sessão para consultar
          dados reais, e inventar um endpoint público de amostra exporia
          informação de alguém. */}
      <div className="mt-7 rounded-[var(--radius-card)] bg-[var(--color-ink)] p-5 text-white">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] text-white/55">Saldo consolidado</span>
          <span className="num text-[10px] tracking-wider text-white/40 uppercase">ago 2026</span>
        </div>
        <p className="num mt-2 text-[30px] leading-none font-semibold">R$ 34.370</p>

        <div className="mt-4 h-[3px] overflow-hidden rounded-full bg-white/15">
          <div className="h-full w-[56%] rounded-full bg-[var(--color-teal-bright)]" />
        </div>
        <div className="mt-2 flex items-baseline justify-between text-[10px]">
          <span className="text-white/50">realizado ate hoje</span>
          <span className="text-[var(--color-teal-bright)]">
            projetado <span className="num">R$ 61.061</span>
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <MiniStat label="Parcelas futuras" value="R$ 32.504" />
        <MiniStat label="Reserva" value="3,8 meses" />
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-[var(--color-muted)]">
        Conexao criptografada. O Cardinal le os dados das contas e nunca movimenta dinheiro.
      </p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3.5">
      <p className="text-[11px] text-[var(--color-muted)]">{label}</p>
      <p className="num mt-1.5 text-[17px] leading-none font-semibold">{value}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Peças de formulário                                                       */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  error,
  children,
  action,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-[var(--color-text)]">{label}</span>
        {action}
      </span>
      {children}
      {/* `role="alert"` faz o leitor de tela anunciar o erro no momento em que
          ele aparece, em vez de o usuário descobrir tabulando de volta. */}
      {error && (
        <span role="alert" className="mt-1.5 block text-[12px] text-[var(--color-negative)]">
          {error}
        </span>
      )}
    </label>
  );
}

export const authInputClass =
  'w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2.5 text-[14px] text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-faint)] focus:border-[var(--color-teal)]';

export function SubmitButton({
  children,
  loading,
  disabled,
}: {
  children: ReactNode;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="w-full rounded-full bg-[var(--color-ink)] px-4 py-3 text-[14px] font-medium text-white transition-colors hover:bg-[#2a2a30] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {loading ? 'Aguarde...' : children}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-[var(--radius-control)] bg-[var(--color-negative-soft)] px-3.5 py-2.5 text-[13px] text-[var(--color-negative)]"
    >
      {message}
    </p>
  );
}
