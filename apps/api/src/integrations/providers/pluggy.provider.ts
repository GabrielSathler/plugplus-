import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ISODate } from '@finflow/shared';
import type {
  AggregatedAccount,
  AggregatedBill,
  AggregatedTransaction,
  AggregatorEvent,
  AggregatorPort,
} from '../aggregator.port';

/**
 * Adaptador Pluggy (https://docs.pluggy.ai).
 *
 * Escolhido como provider padrao de producao pela cobertura do mercado
 * brasileiro e por expor DUAS coisas que os concorrentes tratam mal e que este
 * produto depende:
 *   - `creditCardMetadata` com `balanceCloseDate` e `balanceDueDate`, ou seja,
 *     fechamento e vencimento reais do emissor em vez de configuracao manual;
 *   - `creditCardMetadata.installmentNumber/totalInstallments` na transacao,
 *     que e o que permite projetar parcelamento sem o usuario digitar nada.
 *
 * STATUS: o fluxo de credenciais e assinatura esta implementado; as chamadas
 * dependem de `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET`. Sem elas o provider
 * se recusa a subir e o app cai para o sandbox — nunca falha silenciosamente
 * devolvendo lista vazia, que seria lido como "o banco nao tem lancamentos".
 */
@Injectable()
export class PluggyProvider implements AggregatorPort {
  readonly name = 'PLUGGY';
  private readonly logger = new Logger(PluggyProvider.name);
  private readonly baseUrl = process.env.PLUGGY_BASE_URL ?? 'https://api.pluggy.ai';

  private apiKey: string | null = null;
  private apiKeyExpiresAt = 0;

  static isConfigured(): boolean {
    return Boolean(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET);
  }

  /** A API key da Pluggy vale 2h; renovamos com folga de 5 min. */
  private async authenticate(): Promise<string> {
    if (this.apiKey && Date.now() < this.apiKeyExpiresAt) return this.apiKey;

    if (!PluggyProvider.isConfigured()) {
      throw new ServiceUnavailableException(
        'Pluggy nao configurada. Defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.',
      );
    }

    const response = await fetch(`${this.baseUrl}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: process.env.PLUGGY_CLIENT_ID,
        clientSecret: process.env.PLUGGY_CLIENT_SECRET,
      }),
    });

    if (!response.ok) {
      throw new ServiceUnavailableException(`Falha ao autenticar na Pluggy: ${response.status}`);
    }

    const body = (await response.json()) as { apiKey: string };
    this.apiKey = body.apiKey;
    this.apiKeyExpiresAt = Date.now() + 115 * 60 * 1000;
    return this.apiKey;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const apiKey = await this.authenticate();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...init?.headers, 'X-API-KEY': apiKey, 'content-type': 'application/json' },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new ServiceUnavailableException(`Pluggy ${path} respondeu ${response.status}: ${text}`);
    }
    return (await response.json()) as T;
  }

  async createConnectToken(input: {
    organizationId: string;
  }): Promise<{ token: string; expiresIn: number }> {
    const body = await this.request<{ accessToken: string }>('/connect_token', {
      method: 'POST',
      body: JSON.stringify({ clientUserId: input.organizationId }),
    });
    return { token: body.accessToken, expiresIn: 1800 };
  }

  async listAccounts(itemId: string): Promise<AggregatedAccount[]> {
    const body = await this.request<{ results: PluggyAccount[] }>(`/accounts?itemId=${itemId}`);

    return body.results.map((account) => ({
      externalId: account.id,
      name: account.name,
      kind: account.type === 'CREDIT' ? 'CREDIT' : 'BANK',
      institution: account.owner ?? 'Instituicao',
      number: account.number ?? null,
      currency: account.currencyCode ?? 'BRL',
      balance: toCents(account.balance),
      creditCard: account.creditData
        ? {
            brand: (account.creditData.brand ?? 'OTHER').toUpperCase(),
            lastFour: account.number?.slice(-4) ?? null,
            limit: toCents(account.creditData.creditLimit ?? 0),
            // O provider entrega a DATA do proximo fechamento/vencimento; o que
            // o dominio precisa e o DIA do ciclo.
            closingDay: dayOf(account.creditData.balanceCloseDate),
            dueDay: dayOf(account.creditData.balanceDueDate),
          }
        : undefined,
    }));
  }

  async listTransactions(input: {
    itemId: string;
    accountId: string;
    from: ISODate;
    to: ISODate;
    cursor?: string;
  }): Promise<{ transactions: AggregatedTransaction[]; nextCursor?: string }> {
    const page = input.cursor ?? '1';
    const body = await this.request<{
      results: PluggyTransaction[];
      page: number;
      totalPages: number;
    }>(
      `/transactions?accountId=${input.accountId}&from=${input.from}&to=${input.to}&page=${page}&pageSize=200`,
    );

    const transactions = body.results.map((tx): AggregatedTransaction => {
      const metadata = tx.creditCardMetadata;
      return {
        externalId: tx.id,
        description: tx.description,
        merchant: tx.merchant?.name ?? null,
        // Pluggy manda saida como negativo; o dominio guarda modulo + `type`.
        amount: Math.abs(toCents(tx.amount)),
        type: tx.amount >= 0 ? 'INCOME' : 'EXPENSE',
        date: tx.date.slice(0, 10),
        providerCategory: tx.category ?? null,
        installment:
          metadata?.totalInstallments && metadata.totalInstallments > 1
            ? {
                number: metadata.installmentNumber ?? 1,
                total: metadata.totalInstallments,
                groupId: metadata.payeeMCC ? String(metadata.payeeMCC) : null,
              }
            : undefined,
        paymentMethod: mapPaymentMethod(tx.paymentData?.paymentMethod, Boolean(metadata)),
      };
    });

    return {
      transactions,
      nextCursor: body.page < body.totalPages ? String(body.page + 1) : undefined,
    };
  }

  async listCreditCardBills(itemId: string, accountId: string): Promise<AggregatedBill[]> {
    const body = await this.request<{ results: PluggyBill[] }>(
      `/bills?accountId=${accountId}`,
    );
    return body.results.map((bill) => ({
      externalId: bill.id,
      referenceMonth: bill.dueDate.slice(0, 7),
      closingDate: bill.billDate?.slice(0, 10) ?? bill.dueDate.slice(0, 10),
      dueDate: bill.dueDate.slice(0, 10),
      total: toCents(bill.totalAmount),
      minimumPayment: bill.minimumPayment ? toCents(bill.minimumPayment) : null,
      paid: Boolean(bill.paidAmount && bill.paidAmount >= bill.totalAmount),
    }));
  }

  /**
   * Assinatura HMAC-SHA256 do corpo cru.
   *
   * Precisa do corpo EXATO recebido, nao do JSON re-serializado: qualquer
   * diferenca de espaco ou ordem de chave invalida o hash. Por isso o webhook
   * usa `rawBody` (habilitado no bootstrap).
   */
  verifyWebhook(input: {
    rawBody: string;
    headers: Record<string, string | undefined>;
  }): boolean {
    const secret = process.env.PLUGGY_WEBHOOK_SECRET;
    const signature = input.headers['x-pluggy-signature'] ?? input.headers['X-Pluggy-Signature'];
    if (!secret || !signature) return false;

    const expected = createHmac('sha256', secret).update(input.rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    // Comprimentos diferentes fazem `timingSafeEqual` lancar, entao checamos antes.
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(payload: unknown): AggregatorEvent | null {
    const body = payload as { event?: string; itemId?: string; error?: { message?: string } };
    if (!body?.itemId) return null;

    switch (body.event) {
      case 'item/updated':
        return { kind: 'ITEM_UPDATED', itemId: body.itemId };
      case 'item/error':
        return {
          kind: 'ITEM_ERROR',
          itemId: body.itemId,
          message: body.error?.message ?? 'Erro no item.',
        };
      case 'item/login_succeeded':
        return { kind: 'ITEM_UPDATED', itemId: body.itemId };
      case 'item/waiting_user_input':
      case 'consent/revoked':
        return { kind: 'CONSENT_EXPIRED', itemId: body.itemId };
      default:
        this.logger.debug(`Evento Pluggy ignorado: ${body.event}`);
        return null;
    }
  }
}

/* ------------------------------- Tipos crus ------------------------------- */

interface PluggyAccount {
  id: string;
  type: string;
  name: string;
  number?: string;
  owner?: string;
  currencyCode?: string;
  balance: number;
  creditData?: {
    brand?: string;
    creditLimit?: number;
    balanceCloseDate?: string;
    balanceDueDate?: string;
  };
}

interface PluggyTransaction {
  id: string;
  description: string;
  amount: number;
  date: string;
  category?: string;
  merchant?: { name?: string };
  paymentData?: { paymentMethod?: string };
  creditCardMetadata?: {
    installmentNumber?: number;
    totalInstallments?: number;
    payeeMCC?: number;
  };
}

interface PluggyBill {
  id: string;
  dueDate: string;
  billDate?: string;
  totalAmount: number;
  minimumPayment?: number;
  paidAmount?: number;
}

/** Reais (float do provider) para centavos (inteiro do dominio). */
function toCents(value: number): number {
  return Math.round(value * 100);
}

function dayOf(date?: string): number {
  if (!date) return 1;
  return Number(date.slice(8, 10)) || 1;
}

function mapPaymentMethod(
  method: string | undefined,
  isCreditCard: boolean,
): AggregatedTransaction['paymentMethod'] {
  if (isCreditCard) return 'CREDIT';
  switch (method?.toUpperCase()) {
    case 'PIX':
      return 'PIX';
    case 'BOLETO':
      return 'BOLETO';
    case 'TED':
    case 'DOC':
    case 'TRANSFER':
      return 'TRANSFER';
    case 'DEBIT':
      return 'DEBIT';
    default:
      return 'DEBIT';
  }
}
