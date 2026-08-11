import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Module,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ALERT_SEVERITIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_MODES,
  buildContent,
  buildDigestContent,
  decideNotifications,
  findResolved,
  type Alert,
  type AlertSeverity,
  type DeliveryRecord,
  type NotificationChannel,
  type NotificationMode,
  type NotificationPreference,
} from '@finflow/shared';
import { Ctx, type RequestContext } from '../auth/auth.types';
import { AlertsService } from '../modules/alerts.service';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_PORT, PUSH_PORT, type EmailPort, type PushPort } from './channels.port';
import { FirebasePushProvider } from './providers/firebase.push';
import {
  ConsoleEmailProvider,
  ConsolePushProvider,
  ResendEmailProvider,
} from './providers/email.provider';

/* --------------------------------- DTOs ---------------------------------- */

export class UpdatePreferenceDto {
  @IsOptional() @IsBoolean() pushEnabled?: boolean;
  @IsOptional() @IsBoolean() emailEnabled?: boolean;
  @IsOptional() @IsIn(ALERT_SEVERITIES) minSeverity?: string;
  @IsOptional() @IsIn(NOTIFICATION_MODES) mode?: string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Use HH:MM.' })
  quietHoursStart?: string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Use HH:MM.' })
  quietHoursEnd?: string;
  @IsOptional() @IsInt() @Min(0) @Max(23) digestHour?: number;
  @IsOptional() @IsInt() @Min(0) @Max(168) reminderAfterHours?: number;
}

export class RegisterDeviceDto {
  @IsString() @MaxLength(4096) token!: string;
  @IsOptional() @IsIn(['ANDROID', 'IOS', 'WEB']) platform?: string;
  @IsOptional() @IsString() @MaxLength(60) label?: string;
}

export class TestNotificationDto {
  @IsOptional() @IsIn(NOTIFICATION_CHANNELS) channel?: string;
}

/* -------------------------------- Service -------------------------------- */

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    @Inject(PUSH_PORT) private readonly push: PushPort,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
  ) {}

  /* --- Preferencias ---------------------------------------------------- */

  async getPreference(userId: string, organizationId: string) {
    const existing = await this.prisma.notificationPreference.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
    if (existing) return existing;

    // Criar na primeira leitura, com o padrao, evita espalhar `?? valor` por
    // todo lugar que consulta preferencia.
    return this.prisma.notificationPreference.create({
      data: { userId, organizationId },
    });
  }

  async updatePreference(userId: string, organizationId: string, dto: UpdatePreferenceDto) {
    await this.getPreference(userId, organizationId);
    return this.prisma.notificationPreference.update({
      where: { userId_organizationId: { userId, organizationId } },
      data: { ...dto },
    });
  }

  /* --- Aparelhos -------------------------------------------------------- */

  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    // O token do FCM roda entre reinstalacoes e pode ja existir vinculado a
    // outro usuario (aparelho compartilhado, troca de conta). `upsert` no token
    // reatribui em vez de duplicar.
    return this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      create: {
        userId,
        token: dto.token,
        platform: dto.platform ?? 'WEB',
        label: dto.label ?? null,
      },
      update: { userId, isActive: true, label: dto.label ?? null },
    });
  }

  listDevices(userId: string) {
    return this.prisma.deviceToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async removeDevice(userId: string, id: string) {
    await this.prisma.deviceToken.deleteMany({ where: { id, userId } });
    return { id, deleted: true };
  }

  /* --- Historico de entregas -------------------------------------------- */

  async history(organizationId: string, userId: string, limit = 50) {
    return this.prisma.notificationDelivery.findMany({
      where: { organizationId, userId },
      orderBy: { sentAt: 'desc' },
      take: limit,
    });
  }

  /** Entregas do ciclo corrente, indexadas por chave de alerta — usado na tela. */
  async deliveriesByAlert(organizationId: string, userId: string) {
    const rows = await this.prisma.notificationDelivery.findMany({
      where: { organizationId, userId, resolvedAt: null },
      orderBy: { sentAt: 'desc' },
    });

    const byAlert: Record<string, { channel: string; sentAt: string; status: string }[]> = {};
    for (const row of rows) {
      (byAlert[row.alertKey] ??= []).push({
        channel: row.channel,
        sentAt: row.sentAt.toISOString(),
        status: row.status,
      });
    }
    return byAlert;
  }

  /* --- Varredura e envio ------------------------------------------------ */

  /**
   * Varre os alertas da organizacao e entrega o que ainda nao foi avisado.
   *
   * Chamado por agendador (cron), nao pela leitura da tela: acoplar envio a um
   * `GET` faria a notificacao depender de alguem abrir o app — exatamente o
   * contrario do que ela existe para resolver.
   */
  async dispatch(organizationId: string, options?: { dryRun?: boolean }) {
    const alerts = await this.alerts.list(organizationId);
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId },
      include: { user: true },
    });

    const now = new Date().toISOString();
    const outcome = {
      organizationId,
      alerts: alerts.length,
      sent: 0,
      skipped: 0,
      failed: 0,
      resolved: 0,
      dryRun: Boolean(options?.dryRun),
      details: [] as { user: string; channel: string; alertKey: string; reason: string; ok: boolean }[],
    };

    for (const membership of memberships) {
      // VIEWER recebe aviso? Sim — quem so le tambem precisa saber que a fatura
      // subiu. O papel limita escrita, nao ciencia do proprio dinheiro.
      const preferenceRow = await this.getPreference(membership.userId, organizationId);
      const organization = await this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
      });

      const preference: NotificationPreference = {
        userId: membership.userId,
        pushEnabled: preferenceRow.pushEnabled,
        emailEnabled: preferenceRow.emailEnabled,
        minSeverity: preferenceRow.minSeverity as AlertSeverity,
        mode: preferenceRow.mode as NotificationMode,
        quietHoursStart: preferenceRow.quietHoursStart,
        quietHoursEnd: preferenceRow.quietHoursEnd,
        digestHour: preferenceRow.digestHour,
        reminderAfterHours: preferenceRow.reminderAfterHours,
        timezone: organization.timezone,
      };

      const deliveryRows = await this.prisma.notificationDelivery.findMany({
        where: { organizationId, userId: membership.userId, status: 'SENT' },
        orderBy: { sentAt: 'desc' },
        take: 500,
      });

      const deliveries: DeliveryRecord[] = deliveryRows.map((row) => ({
        alertKey: row.alertKey,
        channel: row.channel as NotificationChannel,
        severity: row.severity as AlertSeverity,
        sentAt: row.sentAt.toISOString(),
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
      }));

      // Alerta que sumiu libera o proximo envio: sem marcar resolvido, "sumiu e
      // voltou" nunca voltaria a avisar.
      const resolved = findResolved(alerts, deliveries);
      if (resolved.length > 0 && !options?.dryRun) {
        await this.prisma.notificationDelivery.updateMany({
          where: {
            organizationId,
            userId: membership.userId,
            alertKey: { in: resolved.map((row) => row.alertKey) },
            resolvedAt: null,
          },
          data: { resolvedAt: new Date() },
        });
        outcome.resolved += resolved.length;
      }

      const decisions = decideNotifications({ alerts, deliveries, preference, now });
      const toSend = decisions.filter((decision) => decision.send);
      outcome.skipped += decisions.length - toSend.length;

      if (toSend.length === 0) continue;

      // No modo resumo, tudo vira UMA mensagem por canal. Cinco pushes seguidos
      // as 8h da manha e a definicao de spam, ainda que cada um seja legitimo.
      if (preference.mode === 'DAILY_DIGEST') {
        for (const channel of ['PUSH', 'EMAIL'] as const) {
          const forChannel = toSend.filter((decision) => decision.channel === channel);
          if (forChannel.length === 0) continue;

          const content = buildDigestContent(forChannel.map((decision) => decision.alert));
          if (!content) continue;

          const result = options?.dryRun
            ? { ok: true }
            : await this.deliver(channel, membership.user, content);

          for (const decision of forChannel) {
            outcome.details.push({
              user: membership.user.email,
              channel,
              alertKey: decision.alert.id,
              reason: decision.reason,
              ok: result.ok,
            });
            if (result.ok) outcome.sent += 1;
            else outcome.failed += 1;

            if (!options?.dryRun) {
              await this.record(
                organizationId,
                membership.userId,
                decision.alert,
                channel,
                decision.reason,
                content.title,
                content.body,
                result,
              );
            }
          }
        }
        continue;
      }

      for (const decision of toSend) {
        const content = buildContent(decision.alert);
        const result = options?.dryRun
          ? { ok: true }
          : await this.deliver(decision.channel, membership.user, content);

        outcome.details.push({
          user: membership.user.email,
          channel: decision.channel,
          alertKey: decision.alert.id,
          reason: decision.reason,
          ok: result.ok,
        });
        if (result.ok) outcome.sent += 1;
        else outcome.failed += 1;

        if (!options?.dryRun) {
          await this.record(
            organizationId,
            membership.userId,
            decision.alert,
            decision.channel,
            decision.reason,
            content.title,
            content.body,
            result,
          );
        }
      }
    }

    this.logger.log(
      `Varredura de ${organizationId}: ${outcome.sent} enviados, ${outcome.skipped} ignorados, ${outcome.failed} falhas.`,
    );
    return outcome;
  }

  private async deliver(
    channel: NotificationChannel,
    user: { id: string; email: string; name: string },
    content: { title: string; body: string; deepLink: string | null; data: Record<string, string> },
  ) {
    if (channel === 'PUSH') {
      const devices = await this.prisma.deviceToken.findMany({
        where: { userId: user.id, isActive: true },
      });
      const result = await this.push.send({
        tokens: devices.map((device) => device.token),
        content,
      });

      // Token morto desativado na hora: cada tentativa futura queima cota e
      // nunca entrega.
      if (result.invalidTokens?.length) {
        await this.prisma.deviceToken.updateMany({
          where: { token: { in: result.invalidTokens } },
          data: { isActive: false },
        });
      }
      if (devices.length > 0) {
        await this.prisma.deviceToken.updateMany({
          where: { userId: user.id, isActive: true },
          data: { lastUsedAt: new Date() },
        });
      }
      return result;
    }

    return this.email.send({
      to: user.email,
      toName: user.name,
      subject: content.title,
      text: `${content.body}\n\n${content.deepLink ? `Abrir: ${appUrl(content.deepLink)}` : ''}`.trim(),
      html: renderEmail(content),
    });
  }

  private record(
    organizationId: string,
    userId: string,
    alert: Alert,
    channel: NotificationChannel,
    reason: string,
    title: string,
    body: string,
    result: { ok: boolean; providerMessageId?: string; error?: string },
  ) {
    return this.prisma.notificationDelivery.create({
      data: {
        organizationId,
        userId,
        alertKey: alert.id,
        channel,
        severity: alert.severity,
        status: result.ok ? 'SENT' : 'FAILED',
        reason,
        title,
        body,
        providerMessageId: result.providerMessageId ?? null,
        error: result.error ?? null,
      },
    });
  }

  /** Dispara uma mensagem de teste — valida canal e credencial sem esperar alerta. */
  async sendTest(userId: string, organizationId: string, channel: NotificationChannel) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const content = {
      title: 'Notificacao de teste do Cardinal',
      body: 'Se voce recebeu isto, o canal esta configurado corretamente.',
      deepLink: '/alertas',
      data: { test: 'true' },
    };

    const result = await this.deliver(channel, user, content);
    return {
      channel,
      provider: channel === 'PUSH' ? this.push.name : this.email.name,
      ...result,
    };
  }

  providers() {
    return { push: this.push.name, email: this.email.name };
  }
}

function appUrl(path: string): string {
  return `${process.env.APP_URL ?? 'http://localhost:5173'}${path}`;
}

/** HTML minimo e a prova de cliente de e-mail: tabela, estilo inline, sem CSS externo. */
function renderEmail(content: {
  title: string;
  body: string;
  deepLink: string | null;
}): string {
  const link = content.deepLink
    ? `<p style="margin:24px 0 0"><a href="${appUrl(content.deepLink)}" style="background:#16161A;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-size:14px">Abrir no Cardinal</a></p>`
    : '';

  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F3EF;padding:32px 16px">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #E7E4DC;border-radius:12px;padding:28px;font-family:-apple-system,Segoe UI,sans-serif">
<tr><td>
<p style="margin:0 0 20px;font-size:13px;font-weight:600;color:#0F8A72;letter-spacing:.08em">CARDINAL</p>
<h1 style="margin:0 0 10px;font-size:19px;line-height:1.3;color:#16171A">${escapeHtml(content.title)}</h1>
<p style="margin:0;font-size:14px;line-height:1.6;color:#55534E">${escapeHtml(content.body)}</p>
${link}
</td></tr></table>
</td></tr></table>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------- Controller ------------------------------ */

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get('preferences')
  @ApiOperation({ summary: 'Preferencias de notificacao do usuario corrente.' })
  async preferences(@Ctx() ctx: RequestContext) {
    const [preference, devices] = await Promise.all([
      this.service.getPreference(ctx.userId, ctx.organizationId),
      this.service.listDevices(ctx.userId),
    ]);
    return { preference, devices, providers: this.service.providers() };
  }

  @Patch('preferences')
  updatePreferences(@Ctx() ctx: RequestContext, @Body() dto: UpdatePreferenceDto) {
    return this.service.updatePreference(ctx.userId, ctx.organizationId, dto);
  }

  @Post('devices')
  @ApiOperation({ summary: 'Registra o token FCM de um aparelho.' })
  registerDevice(@Ctx() ctx: RequestContext, @Body() dto: RegisterDeviceDto) {
    return this.service.registerDevice(ctx.userId, dto);
  }

  @Delete('devices/:id')
  removeDevice(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.service.removeDevice(ctx.userId, id);
  }

  @Get('history')
  @ApiOperation({ summary: 'Ultimas notificacoes entregues a este usuario.' })
  history(@Ctx() ctx: RequestContext) {
    return this.service.history(ctx.organizationId, ctx.userId);
  }

  @Get('deliveries')
  @ApiOperation({ summary: 'Entregas ativas indexadas por chave de alerta.' })
  deliveries(@Ctx() ctx: RequestContext) {
    return this.service.deliveriesByAlert(ctx.organizationId, ctx.userId);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envia uma notificacao de teste no canal escolhido.' })
  test(@Ctx() ctx: RequestContext, @Body() dto: TestNotificationDto) {
    return this.service.sendTest(
      ctx.userId,
      ctx.organizationId,
      (dto.channel as NotificationChannel) ?? 'PUSH',
    );
  }

  @Post('dispatch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Varre alertas e entrega o que ainda nao foi avisado.',
    description:
      'Endpoint para o agendador chamar. `?dryRun=true` calcula as decisoes sem enviar nada — ' +
      'use para conferir o comportamento antes de ligar o cron.',
  })
  dispatch(@Ctx() ctx: RequestContext, @Query('dryRun') dryRun?: string) {
    return this.service.dispatch(ctx.organizationId, { dryRun: dryRun === 'true' });
  }
}

/**
 * Provedores escolhidos em boot.
 *
 * Sem credencial, cai no sandbox que apenas registra em log. Notificacao e a
 * funcionalidade em que um engano vaza para fora do produto e chega no celular
 * de gente real — o padrao seguro tem de ser "nao envia".
 */
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    FirebasePushProvider,
    ResendEmailProvider,
    ConsolePushProvider,
    ConsoleEmailProvider,
    {
      provide: PUSH_PORT,
      inject: [FirebasePushProvider, ConsolePushProvider],
      useFactory: (firebase: FirebasePushProvider, sandbox: ConsolePushProvider): PushPort => {
        if (process.env.NOTIFICATIONS_PROVIDER === 'sandbox') return sandbox as PushPort;
        if (FirebasePushProvider.isConfigured()) return firebase;
        new Logger('NotificationsModule').warn(
          'Firebase sem credenciais — push apenas registrado em log.',
        );
        return sandbox as PushPort;
      },
    },
    {
      provide: EMAIL_PORT,
      inject: [ResendEmailProvider, ConsoleEmailProvider],
      useFactory: (resend: ResendEmailProvider, sandbox: ConsoleEmailProvider): EmailPort => {
        if (process.env.NOTIFICATIONS_PROVIDER === 'sandbox') return sandbox;
        if (ResendEmailProvider.isConfigured()) return resend;
        new Logger('NotificationsModule').warn(
          'Remetente de e-mail sem credenciais — envio apenas registrado em log.',
        );
        return sandbox;
      },
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
