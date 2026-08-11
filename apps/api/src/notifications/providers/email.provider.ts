import { Injectable, Logger } from '@nestjs/common';
import type { DeliveryResult, EmailPort } from '../channels.port';

/**
 * Envio de e-mail transacional via Resend (https://resend.com/docs).
 *
 * Escolhido como adaptador de referencia por ser um unico POST autenticado por
 * bearer token — cabe em 40 linhas e nao exige SDK. SendGrid, Postmark e SES
 * entram no mesmo lugar trocando URL, cabecalho e o formato do corpo; nada
 * fora deste arquivo muda, que e o ponto de existir a porta.
 *
 * NAO USE SMTP DIRETO para isto. Um servidor proprio significa cuidar de SPF,
 * DKIM, DMARC, reputacao de IP e bounce handling — trabalho que decide se o
 * aviso de fatura chega na caixa de entrada ou no spam, e que nenhum produto
 * em estagio de prototipo deveria assumir.
 */
@Injectable()
export class ResendEmailProvider implements EmailPort {
  readonly name = 'RESEND';
  private readonly logger = new Logger(ResendEmailProvider.name);

  static isConfigured(): boolean {
    return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
  }

  async send(input: {
    to: string;
    toName?: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<DeliveryResult> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM,
          to: [input.toName ? `${input.toName} <${input.to}>` : input.to],
          subject: input.subject,
          // Enviar texto junto com HTML nao e redundancia: cliente de e-mail
          // que bloqueia HTML mostra o texto, e filtros de spam penalizam
          // mensagem so-HTML.
          text: input.text,
          ...(input.html ? { html: input.html } : {}),
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        return { ok: false, error: `${response.status}: ${text.slice(0, 200)}` };
      }

      const body = (await response.json()) as { id?: string };
      return { ok: true, providerMessageId: body.id };
    } catch (error) {
      this.logger.error('Falha ao enviar e-mail', error);
      return { ok: false, error: error instanceof Error ? error.message : 'Erro de rede.' };
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Adaptadores de sandbox                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Registra o que SERIA enviado, sem sair da maquina.
 *
 * E o padrao quando nao ha credencial. Vale mais do que parece: notificacao e
 * uma das poucas funcionalidades em que um bug vaza para fora do produto e
 * chega no bolso do usuario. Desenvolver contra um provedor que so imprime
 * torna impossivel mandar push de teste para a base inteira por engano.
 */
@Injectable()
export class ConsolePushProvider implements Pick<EmailPort, never> {
  readonly name = 'CONSOLE';
  private readonly logger = new Logger('PushSandbox');

  async send(input: {
    tokens: string[];
    content: { title: string; body: string; deepLink: string | null };
  }): Promise<DeliveryResult> {
    this.logger.log(
      `[push simulado] ${input.tokens.length} aparelho(s) · ${input.content.title} — ${input.content.body}`,
    );
    return {
      ok: true,
      providerMessageId: `sandbox_${Math.random().toString(36).slice(2, 10)}`,
    };
  }
}

@Injectable()
export class ConsoleEmailProvider implements EmailPort {
  readonly name = 'CONSOLE';
  private readonly logger = new Logger('EmailSandbox');

  async send(input: { to: string; subject: string; text: string }): Promise<DeliveryResult> {
    this.logger.log(`[e-mail simulado] para ${input.to} · ${input.subject}`);
    return {
      ok: true,
      providerMessageId: `sandbox_${Math.random().toString(36).slice(2, 10)}`,
    };
  }
}
