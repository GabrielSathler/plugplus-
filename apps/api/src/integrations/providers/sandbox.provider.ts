import { Injectable, Logger } from '@nestjs/common';
import { addDays, today as todayIn, type ISODate } from '@finflow/shared';
import type {
  AggregatedAccount,
  AggregatedTransaction,
  AggregatorEvent,
  AggregatorPort,
} from '../aggregator.port';

/**
 * Provider de sandbox: implementa a porta inteira sem rede.
 *
 * Serve a dois propositos alem da demo. Primeiro, o desenvolvimento nao fica
 * refem de credencial de agregador nem de limite de chamadas. Segundo, e o
 * contrato executavel da porta — se o adaptador Pluggy real divergir dele, a
 * diferenca aparece nos testes e nao em producao.
 */
@Injectable()
export class SandboxAggregatorProvider implements AggregatorPort {
  readonly name = 'SANDBOX';
  private readonly logger = new Logger(SandboxAggregatorProvider.name);

  async createConnectToken(): Promise<{ token: string; expiresIn: number }> {
    return { token: `sandbox_${Math.random().toString(36).slice(2)}`, expiresIn: 1800 };
  }

  async listAccounts(itemId: string): Promise<AggregatedAccount[]> {
    this.logger.debug(`Sandbox: descobrindo contas do item ${itemId}`);
    return [
      {
        externalId: `${itemId}:checking`,
        name: 'Conta corrente',
        kind: 'BANK',
        institution: 'Banco Sandbox',
        number: '0192',
        currency: 'BRL',
        balance: 3_437_000,
      },
      {
        externalId: `${itemId}:card`,
        name: 'Cartao Sandbox',
        kind: 'CREDIT',
        institution: 'Banco Sandbox',
        number: null,
        currency: 'BRL',
        balance: 0,
        creditCard: {
          brand: 'VISA',
          lastFour: '4417',
          limit: 2_200_000,
          closingDay: 28,
          dueDay: 5,
        },
      },
    ];
  }

  async listTransactions(input: {
    itemId: string;
    accountId: string;
    from: ISODate;
    to: ISODate;
  }): Promise<{ transactions: AggregatedTransaction[]; nextCursor?: string }> {
    const base = todayIn();
    const transactions: AggregatedTransaction[] = [
      {
        externalId: `${input.accountId}:sbx-1`,
        description: 'Supermercado Sandbox',
        merchant: 'SUPERMERCADO SANDBOX LTDA',
        amount: 18_400,
        type: 'EXPENSE',
        date: addDays(base, -2),
        providerCategory: 'Groceries',
        paymentMethod: 'CREDIT',
      },
      {
        externalId: `${input.accountId}:sbx-2`,
        description: 'Assinatura Sandbox',
        merchant: 'SANDBOX SUBSCRIPTIONS',
        amount: 3_990,
        type: 'EXPENSE',
        date: addDays(base, -5),
        providerCategory: 'Subscriptions',
        paymentMethod: 'CREDIT',
      },
    ];
    return { transactions };
  }

  verifyWebhook(): boolean {
    // O sandbox aceita qualquer corpo de proposito: e o unico provider onde
    // isso e seguro, porque ele nunca roda com dado real.
    return true;
  }

  parseWebhook(payload: unknown): AggregatorEvent | null {
    const body = payload as { event?: string; itemId?: string };
    if (!body?.itemId) return null;
    if (body.event === 'item/error') {
      return { kind: 'ITEM_ERROR', itemId: body.itemId, message: 'Erro simulado do sandbox.' };
    }
    return { kind: 'ITEM_UPDATED', itemId: body.itemId };
  }
}
