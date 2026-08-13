import type { Cents } from './money.ts';
import type { ISODate, YearMonth } from './date.ts';

/* -------------------------------------------------------------------------- */
/*  Enums de dominio                                                          */
/*                                                                            */
/*  Declarados como const objects + union types em vez de `enum` do TS: o      */
/*  SQLite nao suporta enums nativos no Prisma, entao o banco guarda `String`  */
/*  e a validacao vive aqui. Migrar para Postgres depois e trocar o provider   */
/*  e promover estes unions a enums do Prisma, sem tocar no codigo de negocio. */
/* -------------------------------------------------------------------------- */

export const ACCOUNT_TYPES = ['CHECKING', 'SAVINGS', 'INVESTMENT', 'CASH', 'WALLET'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CARD_BRANDS = ['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'OTHER'] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

export const TRANSACTION_TYPES = ['INCOME', 'EXPENSE', 'TRANSFER'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const PAYMENT_METHODS = [
  'CREDIT',
  'DEBIT',
  'PIX',
  'BOLETO',
  'CASH',
  'TRANSFER',
  'AUTO_DEBIT',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const TRANSACTION_STATUSES = ['SCHEDULED', 'PENDING', 'POSTED', 'RECONCILED'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_SOURCES = [
  'MANUAL',
  'RECURRING',
  'OPEN_FINANCE',
  'IMPORT_OFX',
  'IMPORT_CSV',
  'SCENARIO',
] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

export const INVOICE_STATUSES = ['OPEN', 'CLOSED', 'PAID', 'OVERDUE', 'PROJECTED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const FREQUENCIES = ['WEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const CATEGORY_KINDS = ['INCOME', 'EXPENSE'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const MEMBER_ROLES = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const BUDGET_STATUSES = ['ON_TRACK', 'WARNING', 'EXCEEDED'] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export const ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const CONNECTION_STATUSES = [
  'CONNECTED',
  'SYNCING',
  'NEEDS_ACTION',
  'CONSENT_EXPIRED',
  'ERROR',
  'DISCONNECTED',
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/**
 * Como uma despesa entra na composicao da fatura. Derivado dos atributos da
 * transacao (ver `classifyInvoiceLine`), nao persistido — assim uma mudanca de
 * regra reclassifica o historico inteiro sem migracao.
 */
export const INVOICE_LINE_KINDS = ['INSTALLMENT', 'ONE_OFF', 'SUBSCRIPTION', 'FEE'] as const;
export type InvoiceLineKind = (typeof INVOICE_LINE_KINDS)[number];

/* -------------------------------------------------------------------------- */
/*  Entidades                                                                 */
/* -------------------------------------------------------------------------- */

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  currency: string;
  currentBalance: Cents;
  color: string;
  isActive: boolean;
  includeInTotals: boolean;
}

export interface CreditCard {
  id: string;
  name: string;
  brand: CardBrand;
  lastFour: string | null;
  institution: string | null;
  limitAmount: Cents;
  /** Dia do mes em que o ciclo fecha (1-31, com clamp em meses curtos). */
  closingDay: number;
  /** Dia do mes do vencimento (1-31). */
  dueDay: number;
  /**
   * Se `true`, uma compra feita exatamente no dia do fechamento ainda entra na
   * fatura que fecha naquele dia. O padrao (`false`) segue a pratica dominante
   * dos emissores: a partir do dia do fechamento, a compra ja e da proxima.
   */
  closingDayInclusive: boolean;
  /** Conta debitada no vencimento da fatura. */
  paymentAccountId: string | null;
  color: string;
  isActive: boolean;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string | null;
  parentId: string | null;
  isFee: boolean;
}

export interface Transaction {
  id: string;
  description: string;
  merchant: string | null;
  /** Sempre positivo. O sinal vem de `type`. */
  amount: Cents;
  type: TransactionType;
  paymentMethod: PaymentMethod;
  /** Data da compra / competencia. */
  date: ISODate;
  accountId: string | null;
  creditCardId: string | null;
  categoryId: string | null;
  status: TransactionStatus;
  source: TransactionSource;
  installmentNumber: number | null;
  installmentTotal: number | null;
  installmentGroupId: string | null;
  recurringRuleId: string | null;
  transferAccountId: string | null;
  notes: string | null;
  tags: string[];
}

export interface Invoice {
  id: string;
  creditCardId: string;
  /** Competencia da fatura = mes do VENCIMENTO (`YYYY-MM`). Ver adr em credit-card-cycle.ts */
  referenceMonth: YearMonth;
  closingDate: ISODate;
  dueDate: ISODate;
  status: InvoiceStatus;
  total: Cents;
  paidAmount: Cents;
}

export interface RecurringRule {
  id: string;
  description: string;
  amount: Cents;
  type: TransactionType;
  frequency: Frequency;
  /** Dia do mes do lancamento (frequencias mensais ou maiores). */
  dayOfMonth: number | null;
  /** 0 = domingo. Usado quando `frequency === 'WEEKLY'`. */
  weekday: number | null;
  startDate: ISODate;
  endDate: ISODate | null;
  categoryId: string | null;
  accountId: string | null;
  creditCardId: string | null;
  paymentMethod: PaymentMethod;
  isActive: boolean;
  /** Rotulo exibido na tela de conta corrente ("Entrada fixa", "Debito automatico"). */
  label: string | null;
}

export interface Budget {
  id: string;
  categoryId: string;
  /** `null` = orcamento recorrente, vale para todo mes. */
  month: YearMonth | null;
  limitAmount: Cents;
  /** Percentual (0-100) a partir do qual o orcamento entra em "Atencao". */
  alertThreshold: number;
  rollover: boolean;
}

export interface Scenario {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  color: string;
  items: ScenarioItem[];
}

export const SCENARIO_ITEM_KINDS = ['ONE_OFF', 'RECURRING', 'INSTALLMENT'] as const;
export type ScenarioItemKind = (typeof SCENARIO_ITEM_KINDS)[number];

export interface ScenarioItem {
  id: string;
  kind: ScenarioItemKind;
  description: string;
  amount: Cents;
  type: TransactionType;
  startDate: ISODate;
  /** Numero de parcelas (INSTALLMENT) ou de meses de vigencia (RECURRING). */
  months: number | null;
  categoryId: string | null;
  accountId: string | null;
  creditCardId: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Planos de gasto                                                           */
/*                                                                            */
/*  ADR — POR QUE NAO E UM CENARIO NEM UM LANCAMENTO AGENDADO.                */
/*                                                                            */
/*  Sao tres coisas com graus de certeza diferentes, e misturar duas delas    */
/*  estraga a leitura do numero:                                              */
/*                                                                            */
/*    Lancamento agendado  fato certo    "dia 10 o aluguel debita"            */
/*    PLANO DE GASTO       intencao      "neste fim de semana vou gastar 800" */
/*    Cenario              hipotese      "e se eu trocar o carro?"            */
/*                                                                            */
/*  O plano conta no baseline porque voce PRETENDE executa-lo — perguntar     */
/*  "quanto sobra?" ignorando o que voce ja decidiu gastar no sabado devolve  */
/*  um numero que voce sabe estar errado. O cenario fica desligado porque     */
/*  voce ainda nao decidiu. E o plano, diferente dos outros dois, e           */
/*  CONCILIADO depois: da para comparar o que planejou com o que gastou.      */
/* -------------------------------------------------------------------------- */

export const SPENDING_PLAN_STATUSES = ['PLANNED', 'CLOSED', 'CANCELLED'] as const;
export type SpendingPlanStatus = (typeof SPENDING_PLAN_STATUSES)[number];

export const SPENDING_PLAN_ITEM_STATUSES = ['PENDING', 'DONE', 'SKIPPED'] as const;
export type SpendingPlanItemStatus = (typeof SPENDING_PLAN_ITEM_STATUSES)[number];

export interface SpendingPlan {
  id: string;
  name: string;
  /** Periodo do plano. Um unico dia tem `startDate === endDate`. */
  startDate: ISODate;
  endDate: ISODate;
  status: SpendingPlanStatus;
  color: string;
  notes: string | null;
  items: SpendingPlanItem[];
}

export interface SpendingPlanItem {
  id: string;
  description: string;
  /** Valor ESTIMADO em centavos. */
  amount: Cents;
  categoryId: string | null;
  accountId: string | null;
  creditCardId: string | null;
  paymentMethod: PaymentMethod;
  /** `> 1` espalha o gasto planejado pelas faturas seguintes. */
  installments: number;
  /** Data dentro do periodo. `null` usa o inicio do plano. */
  date: ISODate | null;
  status: SpendingPlanItemStatus;
  /** Preenchido quando o item foi conciliado com um lancamento real. */
  matchedTransactionId: string | null;
}

export interface PlanSummary {
  planId: string;
  name: string;
  startDate: ISODate;
  endDate: ISODate;
  status: SpendingPlanStatus;
  color: string;
  total: Cents;
  /** Parcela do total que cai em fatura de cartao. */
  toInvoice: Cents;
  /** Parcela do total que sai direto de conta. */
  toAccount: Cents;
  /** Quando o dinheiro efetivamente sai do caixa, por competencia. */
  cashImpactByMonth: Record<YearMonth, Cents>;
  itemCount: number;
  pendingCount: number;
  /** Itens pendentes com data ja vencida — esperando conciliacao. */
  overdueCount: number;
  /** Gasto real no periodo do plano, nas mesmas contas e cartoes. */
  realized: Cents;
}

export interface BankConnection {
  id: string;
  provider: string;
  institutionName: string;
  status: ConnectionStatus;
  externalItemId: string | null;
  lastSyncAt: string | null;
  consentExpiresAt: ISODate | null;
  accountsLinked: number;
}

/* -------------------------------------------------------------------------- */
/*  Projecoes e metricas (calculados, nunca persistidos)                      */
/* -------------------------------------------------------------------------- */

export interface ProjectedInvoice {
  creditCardId: string;
  creditCardName: string;
  referenceMonth: YearMonth;
  closingDate: ISODate;
  dueDate: ISODate;
  total: Cents;
  status: InvoiceStatus;
  /** `true` quando o ciclo ainda nao fechou — o valor pode subir. */
  isProjected: boolean;
  composition: Record<InvoiceLineKind, Cents>;
  installmentCount: number;
  /** Parcela de `total` que vem de plano de gasto, nao de compra efetivada. */
  plannedTotal: Cents;
}

export interface MonthProjection {
  month: YearMonth;
  openingBalance: Cents;
  /** Todas as entradas do mes. */
  income: Cents;
  /** Todas as saidas de caixa do mes, JA incluindo `cardPayments`. */
  expenses: Cents;
  /** Parcela de `expenses` que corresponde ao pagamento de faturas. */
  cardPayments: Cents;
  /**
   * Parcela de `expenses` que vem de PLANO DE GASTO — intencao, nao fato.
   * A UI usa isto para separar visualmente "ja aconteceu" de "voce pretende".
   */
  plannedExpenses: Cents;
  /** Parcela de `cardPayments` originada de plano. */
  plannedCardPayments: Cents;
  /** `income - expenses`. */
  net: Cents;
  closingBalance: Cents;
  /** `false` enquanto o mes ja aconteceu por completo. */
  isProjected: boolean;
  byCategory: Record<string, Cents>;
  invoices: ProjectedInvoice[];
}

export interface CashflowProjection {
  from: YearMonth;
  months: MonthProjection[];
  /** Menor saldo de fechamento do horizonte — o numero que antecipa aperto. */
  lowestBalance: Cents;
  lowestBalanceMonth: YearMonth;
  /** Meses ate o saldo ficar negativo, `null` se nao acontece no horizonte. */
  monthsUntilNegative: number | null;
}

export interface DashboardMetrics {
  currentBalance: Cents;
  balanceDelta: Cents;
  connectedAccounts: number;

  openInvoiceTotal: Cents;
  openInvoiceCycleProgress: number;
  openInvoiceClosingDate: ISODate | null;
  openInvoiceDueDate: ISODate | null;

  projectedInvoiceTotal: Cents;
  projectedInvoiceVariation: number | null;
  projectedInvoiceInstallmentCount: number;

  monthSurplus: Cents;
  monthSurplusDelta: Cents;
  /** Sobra ignorando planos — permite exibir "R$ 2.644 -> R$ 1.844". */
  monthSurplusBeforePlans: Cents;
  /**
   * Quanto de PLANO sai do CAIXA neste mes.
   *
   * Nao confundir com o total programado: um plano de R$ 800 no cartao pode
   * impactar R$ 0 no mes da compra, porque a fatura debita depois. O total
   * programado vive em `PlanSummary.total` e leva outro nome de proposito —
   * dois campos com o mesmo nome e significados diferentes viram bug.
   */
  plannedCashThisMonth: Cents;

  spendVariation: number | null;
  spendDelta: Cents;

  /**
   * (saidas do mes / renda do mes), em %.
   *  quando nao ha renda lancada — a razao nao teria significado.
   */
  incomeCommitment: number | null;
  incomeCommitmentDelta: number | null;

  futureInstallmentsTotal: Cents;
  futureInstallmentsCount: number;
  futureInstallmentsLastMonth: YearMonth | null;

  /**
   * Saldo liquido dividido pelo custo fixo mensal medio.
   *  enquanto nao ha despesa conhecida — nao ha o que dividir.
   */
  emergencyRunwayMonths: number | null;
  emergencyRunwayDelta: number | null;
}

export interface CategorySpend {
  categoryId: string;
  categoryName: string;
  color: string;
  spent: Cents;
  budget: Cents | null;
  /** 0-100+, `null` quando nao ha orcamento definido. */
  usage: number | null;
  status: BudgetStatus | null;
}

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  /** Rota do app para onde o alerta leva. */
  href: string | null;
  createdAt: ISODate;
}
