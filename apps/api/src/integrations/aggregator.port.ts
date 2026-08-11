import type { ISODate } from '@finflow/shared';

/**
 * Porta de agregacao bancaria (Open Finance).
 *
 * ADR — POR QUE UMA PORTA E NAO O SDK DIRETO. O mercado brasileiro tem tres
 * agregadores com contratos parecidos mas incompativeis (Pluggy, Belvo, Klavi),
 * e a conexao direta ao Open Finance exige ser instituicao autorizada pelo BACEN.
 * Trocar de agregador — por preco, por cobertura de instituicoes ou por
 * incidente — nao pode significar reescrever o dominio. Tudo que o app conhece
 * e esta interface; cada provider e um adaptador de ~200 linhas.
 *
 * O que os tres tem em comum e o que esta modelado aqui:
 *   1. um "item"/"link" representa o vinculo usuario <-> instituicao;
 *   2. o vinculo nasce de um widget/token de conexao no front;
 *   3. contas e cartoes sao descobertos depois do vinculo;
 *   4. transacoes chegam por pull paginado ou por webhook de atualizacao;
 *   5. o consentimento tem prazo e pode ser revogado a qualquer momento.
 *
 * SOBRE O PRAZO DO CONSENTIMENTO: a Resolucao Conjunta 7/2023 (BACEN/CMN)
 * derrubou o teto rigido de 12 meses — o prazo passou a ser negociado entre
 * instituicao e cliente, podendo ser maior ou indeterminado, e a renovacao
 * virou um passo unico na receptora em vez de refazer a jornada inteira. Por
 * isso `consentExpiresAt` e NULAVEL: consentimento sem prazo definido e um
 * estado valido, nao um dado faltando. O que continua verdade em qualquer
 * cenario e o direito de revogar a qualquer momento — dai o status
 * `CONSENT_EXPIRED` existir mesmo sem data de expiracao.
 */
export interface AggregatorPort {
  readonly name: string;

  /** Token efemero que o widget do front consome para abrir o fluxo de consentimento. */
  createConnectToken(input: { organizationId: string }): Promise<{ token: string; expiresIn: number }>;

  /** Contas e cartoes descobertos apos o consentimento. */
  listAccounts(itemId: string): Promise<AggregatedAccount[]>;

  /** Lancamentos de uma conta/cartao em uma janela de datas. */
  listTransactions(input: {
    itemId: string;
    accountId: string;
    from: ISODate;
    to: ISODate;
    cursor?: string;
  }): Promise<{ transactions: AggregatedTransaction[]; nextCursor?: string }>;

  /** Faturas de cartao ja fechadas pelo emissor, quando o provider expoe. */
  listCreditCardBills?(itemId: string, accountId: string): Promise<AggregatedBill[]>;

  /** Valida a assinatura do webhook. Nunca confie no corpo sem isto. */
  verifyWebhook(input: { rawBody: string; headers: Record<string, string | undefined> }): boolean;

  /** Traduz o corpo do webhook para um evento neutro. */
  parseWebhook(payload: unknown): AggregatorEvent | null;
}

export interface AggregatedAccount {
  externalId: string;
  name: string;
  /** `BANK` vira Account; `CREDIT` vira CreditCard. */
  kind: 'BANK' | 'CREDIT';
  institution: string;
  number: string | null;
  currency: string;
  /** Saldo em CENTAVOS. */
  balance: number;
  creditCard?: {
    brand: string;
    lastFour: string | null;
    /** Limite em CENTAVOS. */
    limit: number;
    closingDay: number;
    dueDay: number;
  };
}

export interface AggregatedTransaction {
  externalId: string;
  description: string;
  merchant: string | null;
  /** CENTAVOS, sempre positivo. */
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  date: ISODate;
  /** Categoria sugerida pelo provider; a regra local pode sobrescrever. */
  providerCategory: string | null;
  installment?: { number: number; total: number; groupId: string | null };
  paymentMethod: 'CREDIT' | 'DEBIT' | 'PIX' | 'BOLETO' | 'TRANSFER' | 'CASH';
}

export interface AggregatedBill {
  externalId: string;
  /** Competencia YYYY-MM pelo VENCIMENTO. */
  referenceMonth: string;
  closingDate: ISODate;
  dueDate: ISODate;
  total: number;
  minimumPayment: number | null;
  paid: boolean;
}

export type AggregatorEvent =
  | { kind: 'ITEM_UPDATED'; itemId: string }
  | { kind: 'ITEM_ERROR'; itemId: string; message: string }
  | { kind: 'CONSENT_EXPIRED'; itemId: string }
  | { kind: 'TRANSACTIONS_CREATED'; itemId: string; accountId: string };

export const AGGREGATOR_PORT = Symbol('AGGREGATOR_PORT');
