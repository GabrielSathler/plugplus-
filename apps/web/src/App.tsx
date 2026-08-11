import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AccountsPage } from './pages/AccountsPage';
import { AlertsPage } from './pages/AlertsPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { CheckingAccountPage } from './pages/CheckingAccountPage';
import { CreditCardPage } from './pages/CreditCardPage';
import { OverviewPage } from './pages/OverviewPage';
import { PlansPage } from './pages/PlansPage';
import { ProjectionsPage } from './pages/ProjectionsPage';
import { ScenariosPage } from './pages/ScenariosPage';
import { SettingsPage } from './pages/SettingsPage';
import { TransactionsPage } from './pages/TransactionsPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/visao-geral" replace />} />
        <Route path="/visao-geral" element={<OverviewPage />} />
        <Route path="/cartao-de-credito" element={<CreditCardPage />} />
        <Route path="/conta-corrente" element={<CheckingAccountPage />} />
        <Route path="/planos" element={<PlansPage />} />
        <Route path="/projecoes" element={<ProjectionsPage />} />
        <Route path="/transacoes" element={<TransactionsPage />} />
        <Route path="/orcamentos" element={<BudgetsPage />} />
        <Route path="/contas" element={<AccountsPage />} />
        <Route path="/cenarios" element={<ScenariosPage />} />
        <Route path="/alertas" element={<AlertsPage />} />
        <Route path="/ajustes" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/visao-geral" replace />} />
      </Route>
    </Routes>
  );
}
