import type {
  Alert,
  BudgetStatus,
  CategorySpend,
  DashboardMetrics,
  ISODate,
  InvoiceLineKind,
  PlanSummary,
  ProjectedInvoice,
  YearMonth,
} from '@finflow/shared';

/* Formatos de resposta da API — espelham os services do Nest. */

export interface Session {
  user: { id: string; name: string; email: string; initials: string };
  organization: {
    id: string;
    name: string;
    badge: string;
    currency: string;
    locale: string;
    timezone: string;
    fiscalMonthStartDay: number;
    projectionHorizon: number;
    autoSyncPerDay: number;
    exportPreference: string;
    commitmentTarget: number;
    role: string;
  };
}

export interface Member {
  id: string;
  role: string;
  user: { id: string; name: string; email: string; initials: string };
}

export interface BalancePoint {
  month: YearMonth;
  balance: number;
  isProjected: boolean;
}

export interface FutureInstallment {
  groupId: string;
  description: string;
  merchant: string | null;
  cardId: string | null;
  paidCount: number;
  totalCount: number;
  remainingAmount: number;
  nextAmount: number;
  lastMonth: YearMonth;
}

export interface OverviewResponse {
  month: YearMonth;
  today: ISODate;
  commitmentTarget: number;
  metrics: DashboardMetrics;
  balanceSeries: BalancePoint[];
  categorySpend: CategorySpend[];
  futureInstallments: FutureInstallment[];
  alerts: Alert[];
}

export interface CheckingResponse {
  month: YearMonth;
  today: ISODate;
  kpis: {
    income: number;
    expenses: number;
    net: number;
    lowestProjectedBalance: number;
    lowestProjectedMonth: YearMonth;
  };
  series: { month: YearMonth; income: number; expenses: number; isProjected: boolean }[];
  accounts: {
    id: string;
    name: string;
    type: string;
    institution: string | null;
    currentBalance: number;
    color: string;
  }[];
  recurrences: {
    id: string;
    description: string;
    amount: number;
    type: string;
    dayOfMonth: number | null;
    label: string;
  }[];
}

export interface CreditCardResponse {
  month: YearMonth;
  today: ISODate;
  card: {
    id: string;
    name: string;
    brand: string;
    lastFour: string | null;
    color: string;
    limitAmount: number;
    closingDay: number;
    dueDay: number;
  } | null;
  cards: { id: string; name: string; brand: string; lastFour: string | null }[];
  openInvoice: {
    referenceMonth: YearMonth;
    posted: number;
    projectedAtClosing: number;
    closingDate: ISODate;
    dueDate: ISODate;
    elapsedDays: number;
    totalDays: number;
    percent: number;
    composition: Record<InvoiceLineKind, number>;
  };
  series: ProjectedInvoice[];
  stats: {
    averageSixMonths: number;
    highestInvoice: number;
    limitAmount: number;
    limitUsedPercent: number;
  };
}

export interface ProjectionMonth {
  month: YearMonth;
  openingBalance: number;
  income: number;
  expenses: number;
  cardPayments: number;
  net: number;
  closingBalance: number;
  isProjected: boolean;
  invoices: ProjectedInvoice[];
}

export interface ProjectionResponse {
  from: YearMonth;
  months: ProjectionMonth[];
  lowestBalance: number;
  lowestBalanceMonth: YearMonth;
  monthsUntilNegative: number | null;
  appliedScenarios: { id: string; name: string; color: string }[];
}

export interface TransactionRow {
  id: string;
  description: string;
  merchant: string | null;
  amount: number;
  type: string;
  paymentMethod: string;
  date: ISODate;
  status: string;
  source: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
  installmentGroupId: string | null;
  category: { id: string; name: string; color: string; icon: string | null } | null;
  account: {
    id: string;
    name: string;
    institution: string | null;
    accountNumber: string | null;
  } | null;
  creditCard: { id: string; name: string; brand: string; lastFour: string | null } | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface BudgetsResponse {
  month: YearMonth;
  items: (CategorySpend & { budgetId: string | null })[];
  unbudgeted: CategorySpend[];
  totals: { limit: number; spent: number };
}

export interface Scenario {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  color: string;
  items: {
    id: string;
    kind: string;
    description: string;
    amount: number;
    type: string;
    startDate: ISODate;
    months: number | null;
  }[];
}

export interface Connection {
  id: string;
  provider: string;
  institutionName: string;
  status: string;
  lastSyncAt: string | null;
  consentExpiresAt: ISODate | null;
  accountsLinked: number;
  lastError: string | null;
}

export interface AccountRow {
  id: string;
  name: string;
  type: string;
  institution: string | null;
  accountNumber: string | null;
  currentBalance: number;
  color: string;
  isActive: boolean;
  includeInTotals: boolean;
}

export interface CreditCardRow {
  id: string;
  name: string;
  brand: string;
  lastFour: string | null;
  institution: string | null;
  limitAmount: number;
  closingDay: number;
  dueDay: number;
  color: string;
  isActive: boolean;
  paymentAccount: { id: string; name: string; institution: string | null } | null;
  currentCycle: {
    referenceMonth: YearMonth;
    closingDate: ISODate;
    dueDate: ISODate;
    elapsedDays: number;
    totalDays: number;
    percent: number;
  };
}

export type { Alert, BudgetStatus, CategorySpend, DashboardMetrics, ProjectedInvoice };

/* --- Planos de gasto ------------------------------------------------------ */

export interface PlanItemRow {
  id: string;
  description: string;
  amount: number;
  installments: number;
  date: ISODate | null;
  status: string;
  paymentMethod: string;
  matchedTransactionId: string | null;
  category: { id: string; name: string; color: string } | null;
  account: { id: string; name: string; accountNumber: string | null } | null;
  creditCard: { id: string; name: string; lastFour: string | null } | null;
}

export interface PlanRow {
  id: string;
  name: string;
  startDate: ISODate;
  endDate: ISODate;
  status: string;
  color: string;
  notes: string | null;
  items: PlanItemRow[];
  summary: PlanSummary;
}

export interface PlansResponse {
  month: YearMonth;
  today: ISODate;
  items: PlanRow[];
  totals: {
    plannedThisMonth: number;
    plannedTotal: number;
    toInvoice: number;
    toAccount: number;
    surplusBeforePlans: number;
    surplusAfterPlans: number;
  };
  awaitingReconciliation: number;
}

/* --- Notificacoes --------------------------------------------------------- */

export type DeliveriesByAlert = Record<
  string,
  { channel: string; sentAt: string; status: string }[]
>;

export interface NotificationSettings {
  preference: {
    pushEnabled: boolean;
    emailEnabled: boolean;
    minSeverity: string;
    mode: string;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    digestHour: number;
    reminderAfterHours: number;
  };
  devices: {
    id: string;
    token: string;
    platform: string;
    label: string | null;
    isActive: boolean;
    lastUsedAt: string | null;
  }[];
  providers: { push: string; email: string };
}
