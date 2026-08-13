import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { newCsrfToken } from './cookies';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Emissão e rotação de tokens.
 *
 * O par é assimétrico de propósito:
 *
 *   ACCESS  JWT curto (15 min). Verificável sem consultar o banco, que é o
 *           motivo de existir; em troca não dá para revogar, então dura pouco.
 *
 *   REFRESH valor aleatório opaco (30 dias). Não é JWT justamente para PODER
 *           ser revogado: quem manda é a linha no banco.
 *
 * OS DOIS vão em cookie httpOnly (ver cookies.ts). Nenhum token passa por
 * JavaScript, então nenhum pode ser exfiltrado por script injetado. O preço é
 * a exposição a CSRF, coberta pelo `csrfToken` emitido junto.
 */

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_DAYS = 30;

export interface AccessTokenPayload {
  sub: string;
  org: string;
}

export interface IssuedTokens {
  accessToken: string;
  /** Valor do double-submit; vai num cookie legivel e e repetido num header. */
  csrfToken: string;
  /** Valor CRU do refresh — só existe aqui e no cookie; o banco guarda o hash. */
  refreshToken: string;
  expiresAt: Date;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * SHA-256, não bcrypt.
   *
   * Para senha, o hash precisa ser LENTO — a entropia vem de um humano e um
   * atacante testa bilhões de palpites. Aqui o segredo tem 256 bits de
   * aleatoriedade: não existe dicionário, força bruta é inviável por
   * construção, e o hash é consultado a cada renovação. Lento aqui só
   * atrasaria o usuário sem ganhar segurança nenhuma.
   */
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issue(
    userId: string,
    organizationId: string,
    context: { userAgent?: string; ip?: string; family?: string },
  ): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, org: organizationId } satisfies AccessTokenPayload,
      { expiresIn: ACCESS_TOKEN_TTL },
    );

    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 86_400_000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hash(refreshToken),
        // Sem família informada, este login abre uma cadeia nova.
        family: context.family ?? randomUUID(),
        expiresAt,
        userAgent: context.userAgent?.slice(0, 255) ?? null,
        ip: context.ip ?? null,
      },
    });

    return { accessToken, refreshToken, csrfToken: newCsrfToken(), expiresAt };
  }

  /**
   * Troca um refresh válido por um par novo.
   *
   * DETECÇÃO DE REUSO: um token já rotacionado ser apresentado de novo só
   * acontece de duas formas — o cliente legítimo repetiu uma requisição, ou
   * alguém copiou o token. Como os dois são indistinguíveis, o tratamento é o
   * mesmo e é o mais conservador: revoga a família inteira. O usuário legítimo
   * faz login de novo; o ladrão também perde o acesso.
   */
  async rotate(
    rawToken: string,
    context: { userAgent?: string; ip?: string },
  ): Promise<IssuedTokens & { userId: string; organizationId: string }> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
    });

    if (!existing) throw new UnauthorizedException('Sessão inválida.');

    if (existing.revokedAt) {
      this.logger.warn(
        `Refresh token reutilizado (família ${existing.family}) — revogando a família inteira.`,
      );
      await this.revokeFamily(existing.family);
      throw new UnauthorizedException('Sessão encerrada por segurança. Entre novamente.');
    }

    if (existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Sessão expirada.');
    }

    const membership = await this.prisma.membership.findFirst({
      where: { userId: existing.userId },
      orderBy: { id: 'asc' },
    });
    if (!membership) throw new UnauthorizedException('Usuário sem organização.');

    const issued = await this.issue(existing.userId, membership.organizationId, {
      ...context,
      family: existing.family,
    });

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    return {
      ...issued,
      userId: existing.userId,
      organizationId: membership.organizationId,
    };
  }

  async revoke(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(family: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Encerra todas as sessões do usuário — usado ao trocar a senha. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Remove tokens vencidos ou revogados há mais de 30 dias.
   *
   * O revogado precisa sobreviver um tempo depois de morto: é ele que permite
   * detectar reuso. Apagar na hora transformaria um token roubado em
   * "desconhecido" em vez de "reutilizado", e a família não seria derrubada.
   */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const result = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }],
      },
    });
    return result.count;
  }
}

