import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './app/auth';
import { AppShell } from './components/AppShell';
import { AccountsPage } from './pages/AccountsPage';
import { AlertsPage } from './pages/AlertsPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { CheckingAccountPage } from './pages/CheckingAccountPage';
import { CreditCardPage } from './pages/CreditCardPage';
import { LandingPage } from './pages/LandingPage';
import { OverviewPage } from './pages/OverviewPage';
import { PlansPage } from './pages/PlansPage';
import { ProjectionsPage } from './pages/ProjectionsPage';
import { ScenariosPage } from './pages/ScenariosPage';
import { SettingsPage } from './pages/SettingsPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<PublicOnly />}>
        <Route index element={<LandingPage />} />
        <Route path="entrar" element={<LoginPage />} />
        <Route path="criar-conta" element={<SignupPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/visao-geral" element={<OverviewPage />} />
          <Route path="/cartao-de-credito" element={<CreditCardPage />} />
          <Route path="/conta-corrente" element={<CheckingAccountPage />} />
          <Route path="/projecoes" element={<ProjectionsPage />} />
          <Route path="/planos" element={<PlansPage />} />
          <Route path="/transacoes" element={<TransactionsPage />} />
          <Route path="/orcamentos" element={<BudgetsPage />} />
          <Route path="/contas" element={<AccountsPage />} />
          <Route path="/cenarios" element={<ScenariosPage />} />
          <Route path="/alertas" element={<AlertsPage />} />
          <Route path="/ajustes" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * Guarda de rota.
 *
 * `checking` renderiza uma tela neutra em vez de redirecionar: enquanto o
 * cookie de refresh está sendo validado ainda não se sabe se há sessão, e
 * mandar para o login nesse intervalo faria a tela piscar a cada recarga de
 * quem está logado.
 *
 * O destino pretendido é guardado em `state` para a volta cair na página que a
 * pessoa tentou abrir, não numa home genérica.
 */
function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'checking') return <Booting />;
  if (status === 'anonymous') {
    return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

/** Quem já entrou não precisa ver landing nem formulário de login. */
function PublicOnly() {
  const { status } = useAuth();
  if (status === 'checking') return <Booting />;
  if (status === 'authenticated') return <Navigate to="/visao-geral" replace />;
  return <Outlet />;
}

function Booting() {
  return (
    <div className="grid min-h-screen place-items-center bg-[var(--color-canvas)]">
      <div className="flex items-center gap-2.5 text-[13px] text-[var(--color-muted)]">
        <span className="size-3 animate-pulse rounded-full bg-[var(--color-teal)]" />
        Carregando sua sessao...
      </div>
    </div>
  );
}
