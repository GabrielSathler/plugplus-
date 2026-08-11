import type { NotificationContent } from '@finflow/shared';

/**
 * Portas de entrega de notificacao.
 *
 * Mesmo padrao do `AggregatorPort`: o dominio conhece a interface, nunca o SDK.
 * Trocar Firebase por OneSignal, ou o remetente de e-mail por outro, vira um
 * adaptador novo — nenhuma regra de quando notificar muda junto.
 *
 * As duas portas devolvem RESULTADO em vez de lancar excecao. Uma falha de
 * entrega nao pode derrubar a varredura inteira: se o push falhar para um
 * aparelho, o e-mail daquele mesmo alerta ainda precisa sair, e os alertas
 * seguintes tambem.
 */

export interface DeliveryResult {
  ok: boolean;
  /** Id da mensagem no provedor, para rastrear entrega depois. */
  providerMessageId?: string;
  error?: string;
  /**
   * Tokens que o provedor recusou como invalidos ou nao registrados.
   * Precisam ser desativados: tentar de novo queima cota e nunca entrega.
   */
  invalidTokens?: string[];
}

export interface PushPort {
  readonly name: string;
  send(input: {
    tokens: string[];
    content: NotificationContent;
  }): Promise<DeliveryResult>;
}

export interface EmailPort {
  readonly name: string;
  send(input: {
    to: string;
    toName?: string;
    subject: string;
    /** Corpo em texto puro — sempre presente, mesmo com HTML. */
    text: string;
    html?: string;
  }): Promise<DeliveryResult>;
}

export const PUSH_PORT = Symbol('PUSH_PORT');
export const EMAIL_PORT = Symbol('EMAIL_PORT');
