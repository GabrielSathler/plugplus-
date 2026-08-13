import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/auth';
import { ApiError } from '../../lib/api';
import { AuthLayout, Field, FormError, SubmitButton, authInputClass } from './AuthLayout';

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
}

export function SignupPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', email: '', password: '', workspaceName: '' });
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * Validação no cliente é conveniência, não segurança — o servidor valida de
   * novo e é ele que manda. O ganho aqui é o usuário saber do problema sem
   * esperar a ida e volta.
   */
  function validate(): boolean {
    const next: FieldErrors = {};
    if (form.name.trim().length < 2) next.name = 'Informe seu nome.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'E-mail invalido.';
    if (form.password.length < 8) next.password = 'A senha precisa de ao menos 8 caracteres.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;

    setLoading(true);
    try {
      await register({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        workspaceName: form.workspaceName.trim() || undefined,
      });
      navigate('/visao-geral', { replace: true });
    } catch (error) {
      // Conflito de e-mail aponta para o campo, não para o topo do formulário:
      // é ali que a pessoa precisa agir.
      if (error instanceof ApiError && error.status === 409) {
        setErrors({ email: error.message });
      } else {
        setFormError(
          error instanceof ApiError ? error.message : 'Nao foi possivel criar a conta.',
        );
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-[24px] leading-tight font-semibold tracking-tight">
        Criar seu workspace
      </h1>
      <p className="mt-1.5 text-[13px] text-[var(--color-muted)]">
        Depois voce convida quem participa do orcamento.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-7 space-y-4">
        <FormError message={formError} />

        <Field label="Seu nome" error={errors.name}>
          <input
            autoFocus
            autoComplete="name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Marina Ribeiro"
            aria-invalid={Boolean(errors.name)}
            className={authInputClass}
          />
        </Field>

        <Field label="E-mail de trabalho" error={errors.email}>
          <input
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="marina@familia.com"
            aria-invalid={Boolean(errors.email)}
            className={authInputClass}
          />
        </Field>

        <Field label="Senha" error={errors.password}>
          {/* `new-password` faz o gerenciador de senhas oferecer uma senha forte
              em vez de preencher a antiga. */}
          <input
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            placeholder="Minimo de 8 caracteres"
            aria-invalid={Boolean(errors.password)}
            className={authInputClass}
          />
        </Field>

        <Field label="Nome do workspace">
          <input
            value={form.workspaceName}
            onChange={(e) => setForm((f) => ({ ...f, workspaceName: e.target.value }))}
            placeholder="Familia Ribeiro (opcional)"
            className={authInputClass}
          />
        </Field>

        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--color-teal)]"
          />
          <span className="text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
            Concordo com os termos de uso e com a politica de privacidade.
          </span>
        </label>

        <SubmitButton loading={loading} disabled={!accepted}>
          Criar workspace
        </SubmitButton>
      </form>

      <p className="mt-5 text-[13px] text-[var(--color-muted)]">
        Ja tem conta?{' '}
        <Link to="/entrar" className="font-medium text-[var(--color-teal)] hover:underline">
          Entrar
        </Link>
      </p>
    </AuthLayout>
  );
}
