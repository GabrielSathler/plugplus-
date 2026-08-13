import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { ApiError } from '../../lib/api';
import { AuthLayout, Field, FormError, SubmitButton, authInputClass } from './AuthLayout';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setLoading(true);
    try {
      await login(form.email.trim(), form.password);
      navigate('/visao-geral', { replace: true });
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Nao foi possivel entrar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-[24px] leading-tight font-semibold tracking-tight">
        Entrar na sua conta
      </h1>
      <p className="mt-1.5 text-[13px] text-[var(--color-muted)]">
        Acesse o painel financeiro do seu workspace.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-7 space-y-4">
        <FormError message={formError} />

        <Field label="E-mail">
          <input
            autoFocus
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="marina@familia.com"
            className={authInputClass}
          />
        </Field>

        <Field
          label="Senha"
          action={
            /* Recuperação de senha ainda não existe. Um link que leva a lugar
               nenhum é pior do que um aviso honesto de que está por vir. */
            <span
              title="Em breve"
              className="cursor-not-allowed text-[12px] text-[var(--color-faint)]"
            >
              Esqueci a senha
            </span>
          }
        >
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="Sua senha"
              className={`${authInputClass} pr-20`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              className="num absolute top-1/2 right-3 -translate-y-1/2 text-[11px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
            >
              {showPassword ? 'ocultar' : 'mostrar'}
            </button>
          </div>
        </Field>

        <SubmitButton loading={loading}>Entrar</SubmitButton>
      </form>

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--color-line)]" />
        <span className="num text-[10px] tracking-wider text-[var(--color-faint)] uppercase">
          ou
        </span>
        <span className="h-px flex-1 bg-[var(--color-line)]" />
      </div>

      {/* Desabilitados de propósito: SSO e link por e-mail entram junto com o
          sistema de código. Deixá-los clicáveis prometeria o que não existe. */}
      <div className="space-y-2.5">
        <DisabledOption label="Continuar com SSO da empresa" />
        <DisabledOption label="Receber link de acesso por e-mail" />
      </div>

      <p className="mt-6 text-[13px] text-[var(--color-muted)]">
        Ainda nao tem conta?{' '}
        <Link to="/criar-conta" className="font-medium text-[var(--color-teal)] hover:underline">
          Criar workspace
        </Link>
      </p>
    </AuthLayout>
  );
}

function DisabledOption({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      title="Em breve"
      className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-full border border-[var(--color-line)] px-4 py-2.5 text-[13px] text-[var(--color-faint)]"
    >
      {label}
      <span className="num rounded bg-[var(--color-surface-sunken)] px-1.5 py-0.5 text-[9px] tracking-wider uppercase">
        em breve
      </span>
    </button>
  );
}
