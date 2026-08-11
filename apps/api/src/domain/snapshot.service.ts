import { Injectable } from '@nestjs/common';
import type {
  Account as PrismaAccount,
  Budget as PrismaBudget,
  Category as PrismaCategory,
  CreditCard as PrismaCreditCard,
  RecurringRule as PrismaRecurringRule,
  Scenario as PrismaScenario,
  ScenarioItem as PrismaScenarioItem,
  SpendingPlan as PrismaSpendingPlan,
  SpendingPlanItem as PrismaSpendingPlanItem,
  Transaction as PrismaTransaction,
} from '@prisma/client';
import {
  today as todayIn,
  type Account,
  type AccountType,
  type Budget,
  type CardBrand,
  type Category,
  type CategoryKind,
  type CreditCard,
  type Frequency,
  type ISODate,
  type PaymentMethod,
  type RecurringRule,
  type Scenario,
  type ScenarioItemKind,
  type SpendingPlan,
  type SpendingPlanItemStatus,
  type SpendingPlanStatus,
  type Transaction,
  type TransactionSource,
  type TransactionStatus,
  type TransactionType,
} from '@finflow/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface DomainSnapshot {
  today: ISODate;
  organization: {
    id: string;
    currency: string;
    timezone: string;
    projectionHorizon: number;
    commitmentTarget: number;
  };
  accounts: Account[];
  cards: CreditCard[];
  categories: Category[];
  transactions: Transaction[];
  recurrences: RecurringRule[];
  scenarios: Scenario[];
  budgets: Budget[];
  plans: SpendingPlan[];
}

/**
 * Carrega o estado da organizacao e o traduz para os tipos puros do motor.
 *
 * Existe para manter `packages/shared` sem nenhuma dependencia de Prisma ou
 * Nest: o motor recebe objetos simples, roda em Node e no browser, e e testavel
 * sem banco. Toda a traducao de `String` do SQLite para os unions do dominio
 * acontece aqui, num lugar so.
 */
@Injectable()
export class SnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async load(organizationId: string): Promise<DomainSnapshot> {
    const [
      organization,
      accounts,
      cards,
      categories,
      transactions,
      recurrences,
      scenarios,
      budgets,
      plans,
    ] = await Promise.all([
        this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
        this.prisma.account.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }),
        this.prisma.creditCard.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }),
        this.prisma.category.findMany({
          where: { organizationId },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        }),
        this.prisma.transaction.findMany({ where: { organizationId }, orderBy: { date: 'desc' } }),
        this.prisma.recurringRule.findMany({ where: { organizationId } }),
        this.prisma.scenario.findMany({ where: { organizationId }, include: { items: true } }),
        this.prisma.budget.findMany({ where: { organizationId } }),
        this.prisma.spendingPlan.findMany({
          where: { organizationId },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { startDate: 'asc' },
        }),
      ]);

    return {
      today: todayIn(organization.timezone),
      organization: {
        id: organization.id,
        currency: organization.currency,
        timezone: organization.timezone,
        projectionHorizon: organization.projectionHorizon,
        commitmentTarget: organization.commitmentTarget,
      },
      accounts: accounts.map(toAccount),
      cards: cards.map(toCreditCard),
      categories: categories.map(toCategory),
      transactions: transactions.map(toTransaction),
      recurrences: recurrences.map(toRecurringRule),
      scenarios: scenarios.map(toScenario),
      budgets: budgets.map(toBudget),
      plans: plans.map(toSpendingPlan),
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  Tradutores Prisma -> dominio                                              */
/* -------------------------------------------------------------------------- */

export function toAccount(row: PrismaAccount): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type as AccountType,
    institution: row.institution,
    currency: row.currency,
    currentBalance: row.currentBalance,
    color: row.color,
    isActive: row.isActive,
    includeInTotals: row.includeInTotals,
  };
}

export function toCreditCard(row: PrismaCreditCard): CreditCard {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand as CardBrand,
    lastFour: row.lastFour,
    institution: row.institution,
    limitAmount: row.limitAmount,
    closingDay: row.closingDay,
    dueDay: row.dueDay,
    closingDayInclusive: row.closingDayInclusive,
    paymentAccountId: row.paymentAccountId,
    color: row.color,
    isActive: row.isActive,
  };
}

export function toCategory(row: PrismaCategory): Category {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as CategoryKind,
    color: row.color,
    icon: row.icon,
    parentId: row.parentId,
    isFee: row.isFee,
  };
}

export function toTransaction(row: PrismaTransaction): Transaction {
  return {
    id: row.id,
    description: row.description,
    merchant: row.merchant,
    amount: row.amount,
    type: row.type as TransactionType,
    paymentMethod: row.paymentMethod as PaymentMethod,
    date: row.date,
    accountId: row.accountId,
    creditCardId: row.creditCardId,
    categoryId: row.categoryId,
    status: row.status as TransactionStatus,
    source: row.source as TransactionSource,
    installmentNumber: row.installmentNumber,
    installmentTotal: row.installmentTotal,
    installmentGroupId: row.installmentGroupId,
    recurringRuleId: row.recurringRuleId,
    transferAccountId: row.transferAccountId,
    notes: row.notes,
    tags: parseTags(row.tags),
  };
}

export function toRecurringRule(row: PrismaRecurringRule): RecurringRule {
  return {
    id: row.id,
    description: row.description,
    amount: row.amount,
    type: row.type as TransactionType,
    frequency: row.frequency as Frequency,
    dayOfMonth: row.dayOfMonth,
    weekday: row.weekday,
    startDate: row.startDate,
    endDate: row.endDate,
    categoryId: row.categoryId,
    accountId: row.accountId,
    creditCardId: row.creditCardId,
    paymentMethod: row.paymentMethod as PaymentMethod,
    isActive: row.isActive,
    label: row.label,
  };
}

export function toScenario(row: PrismaScenario & { items: PrismaScenarioItem[] }): Scenario {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    color: row.color,
    items: row.items.map((item) => ({
      id: item.id,
      kind: item.kind as ScenarioItemKind,
      description: item.description,
      amount: item.amount,
      type: item.type as TransactionType,
      startDate: item.startDate,
      months: item.months,
      categoryId: item.categoryId,
      accountId: item.accountId,
      creditCardId: item.creditCardId,
    })),
  };
}

export function toSpendingPlan(
  row: PrismaSpendingPlan & { items: PrismaSpendingPlanItem[] },
): SpendingPlan {
  return {
    id: row.id,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status as SpendingPlanStatus,
    color: row.color,
    notes: row.notes,
    items: row.items.map((item) => ({
      id: item.id,
      description: item.description,
      amount: item.amount,
      categoryId: item.categoryId,
      accountId: item.accountId,
      creditCardId: item.creditCardId,
      paymentMethod: item.paymentMethod as PaymentMethod,
      installments: item.installments,
      date: item.date,
      status: item.status as SpendingPlanItemStatus,
      matchedTransactionId: item.matchedTransactionId,
    })),
  };
}

export function toBudget(row: PrismaBudget): Budget {
  return {
    id: row.id,
    categoryId: row.categoryId,
    month: row.month,
    limitAmount: row.limitAmount,
    alertThreshold: row.alertThreshold,
    rollover: row.rollover,
  };
}

/** SQLite guarda tags como JSON. Dado corrompido nunca deve derrubar a leitura. */
export function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}
