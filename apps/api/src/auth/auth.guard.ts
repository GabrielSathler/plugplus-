import {
  CanActivate,
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_COOKIE } from './cookies';
import { IS_PUBLIC_KEY, type RequestContext } from './auth.types';
import type { AccessTokenPayload } from './token.service';

/**
 * Valida o access token e resolve o tenant da requisição.
 *
 * O token carrega usuário e organização, mas a AUTORIZAÇÃO não sai dele: o
 * vínculo é reconferido no banco a cada requisição. Um JWT continua válido
 * depois de a pessoa ser removida do workspace — confiar só na assinatura
 * daria acesso a quem já foi desligado, por até 15 minutos.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { ctx?: RequestContext }>();
    const token = extractToken(request);
    if (!token) throw new UnauthorizedException('Autenticação obrigatória.');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      // Mensagem estável: é o sinal que o cliente usa para tentar renovar.
      throw new UnauthorizedException('Token inválido ou expirado.');
    }

    const membership = await this.resolveMembership(payload.sub, payload.org);
    if (!membership) throw new UnauthorizedException('Sem acesso a esta organização.');

    request.ctx = {
      userId: payload.sub,
      organizationId: payload.org,
      role: membership.role,
      email: membership.email,
    };
    return true;
  }

  /**
   * Vínculo do usuário com a organização, com cache curto em processo.
   *
   * Sem cache, TODA requisição autenticada paga uma ida ao banco só para
   * reconferir o papel — e com o banco em outra região isso são ~200 ms
   * somados a cada leitura de tela, antes de a consulta útil começar.
   *
   * A troca: alguém removido do workspace continua entrando por até 30 s. É
   * aceitável porque o papel muda raramente e a alternativa — confiar apenas
   * no JWT — daria 15 minutos de acesso indevido. Revogação imediata continua
   * possível encerrando as sessões, que apaga o refresh e derruba na próxima
   * renovação.
   *
   * Em mais de uma instância cada processo tem o seu cache; como o TTL é curto
   * e o dado é o mesmo, a divergência máxima é esses 30 s.
   */
  private async resolveMembership(
    userId: string,
    organizationId: string,
  ): Promise<{ role: string; email: string } | null> {
    const key = `${userId}:${organizationId}`;
    const cached = AuthGuard.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { user: { select: { email: true } } },
    });

    const value = membership
      ? { role: membership.role, email: membership.user.email }
      : null;

    AuthGuard.cache.set(key, { value, expiresAt: Date.now() + MEMBERSHIP_TTL_MS });

    // Poda preguiçosa: sem isto o mapa cresceria para sempre num processo de
    // vida longa. Roda só quando o cache passa do teto, não a cada requisição.
    if (AuthGuard.cache.size > 5_000) {
      const now = Date.now();
      for (const [entryKey, entry] of AuthGuard.cache) {
        if (entry.expiresAt <= now) AuthGuard.cache.delete(entryKey);
      }
    }

    return value;
  }

  private static readonly cache = new Map<
    string,
    { value: { role: string; email: string } | null; expiresAt: number }
  >();
}

const MEMBERSHIP_TTL_MS = 30_000;

/**
 * Cookie primeiro, header depois.
 *
 * O navegador usa o cookie httpOnly — o token nunca passa por JavaScript, que
 * e o ponto da mudanca. O header Bearer continua aceito para cliente que nao
 * e navegador (Swagger, script, app nativo), onde cookie nao se aplica e CSRF
 * nao existe.
 */
function extractToken(request: Request): string | null {
  const fromCookie = request.cookies?.[ACCESS_COOKIE];
  if (typeof fromCookie === 'string' && fromCookie) return fromCookie;

  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}
