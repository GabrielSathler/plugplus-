import { Injectable, Logger } from '@nestjs/common';
import { createSign } from 'node:crypto';
import type { NotificationContent } from '@finflow/shared';
import type { DeliveryResult, PushPort } from '../channels.port';

/**
 * Push via Firebase Cloud Messaging, API HTTP v1.
 *
 * POR QUE NAO `firebase-admin`. O SDK oficial arrasta dezenas de megabytes e
 * um grafo grande de dependencias para usar UM endpoint. O que ele faz de util
 * aqui — assinar um JWT com a chave da conta de servico, trocar por um access
 * token e postar a mensagem — sao as ~80 linhas abaixo, sem dependencia nova.
 *
 * O que o SDK faz e este adaptador NAO faz, e que precisa entrar antes de
 * escalar: envio em lote acima de 500 tokens, retry com backoff em erro 5xx e
 * o mapeamento completo dos codigos de erro do FCM. O caso que mais importa —
 * limpar token morto — esta coberto via `invalidTokens`.
 *
 * A API legada (`fcm.googleapis.com/fcm/send`, com server key) foi desligada
 * pelo Google; qualquer tutorial que use `Authorization: key=...` esta morto.
 */
@Injectable()
export class FirebasePushProvider implements PushPort {
  readonly name = 'FIREBASE';
  private readonly logger = new Logger(FirebasePushProvider.name);

  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  static isConfigured(): boolean {
    return Boolean(
      process.env.FIREBASE_PROJECT_ID &&
        process.env.FIREBASE_CLIENT_EMAIL &&
        process.env.FIREBASE_PRIVATE_KEY,
    );
  }

  /**
   * Troca a chave da conta de servico por um access token OAuth2.
   * Vale 1 hora; renovamos com 5 minutos de folga.
   */
  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) return this.accessToken;

    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL!;
    // A chave vem do .env com `\n` literal; sem desescapar, o PEM nao valida.
    const privateKey = process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n');

    const issuedAt = Math.floor(Date.now() / 1000);
    const claims = {
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: issuedAt,
      exp: issuedAt + 3600,
    };

    const encode = (value: object): string =>
      Buffer.from(JSON.stringify(value)).toString('base64url');

    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
    });

    if (!response.ok) {
      throw new Error(`Falha ao autenticar no Google: ${response.status} ${await response.text()}`);
    }

    const body = (await response.json()) as { access_token: string; expires_in: number };
    this.accessToken = body.access_token;
    this.accessTokenExpiresAt = Date.now() + (body.expires_in - 300) * 1000;
    return this.accessToken;
  }

  /**
   * O FCM v1 envia para UM token por requisicao. Disparamos em paralelo e
   * consolidamos: a entrega e considerada boa se ao menos um aparelho recebeu —
   * o usuario foi avisado, ainda que o tablet velho tenha falhado.
   */
  async send(input: { tokens: string[]; content: NotificationContent }): Promise<DeliveryResult> {
    if (input.tokens.length === 0) {
      return { ok: false, error: 'Nenhum aparelho registrado.' };
    }

    let accessToken: string;
    try {
      accessToken = await this.authenticate();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Erro de autenticacao.' };
    }

    const projectId = process.env.FIREBASE_PROJECT_ID!;
    const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    const results = await Promise.all(
      input.tokens.map(async (token) => {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${accessToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              message: {
                token,
                notification: { title: input.content.title, body: input.content.body },
                data: input.content.data,
                android: { priority: 'high' },
                apns: { payload: { aps: { sound: 'default' } } },
                ...(input.content.deepLink
                  ? { webpush: { fcmOptions: { link: input.content.deepLink } } }
                  : {}),
              },
            }),
          });

          if (response.ok) {
            const body = (await response.json()) as { name?: string };
            return { token, ok: true, messageId: body.name };
          }

          const text = await response.text();
          // 404 UNREGISTERED e 400 INVALID_ARGUMENT em `token` significam
          // aparelho que desinstalou o app ou token rotacionado.
          const dead =
            response.status === 404 ||
            text.includes('UNREGISTERED') ||
            text.includes('INVALID_ARGUMENT');
          return { token, ok: false, dead, error: `${response.status}: ${text.slice(0, 200)}` };
        } catch (error) {
          return {
            token,
            ok: false,
            dead: false,
            error: error instanceof Error ? error.message : 'Erro de rede.',
          };
        }
      }),
    );

    const delivered = results.filter((result) => result.ok);
    const invalidTokens = results.filter((r) => !r.ok && r.dead).map((r) => r.token);

    if (invalidTokens.length > 0) {
      this.logger.warn(`${invalidTokens.length} tokens invalidos serao desativados.`);
    }

    return {
      ok: delivered.length > 0,
      providerMessageId: delivered[0]?.messageId,
      error: delivered.length === 0 ? results.find((r) => !r.ok)?.error : undefined,
      invalidTokens,
    };
  }
}
