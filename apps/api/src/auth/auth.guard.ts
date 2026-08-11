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
import { IS_PUBLIC_KEY, type RequestContext } from './auth.types';

/**
 * Resolve a identidade da requisicao e o tenant (organizacao) alvo.
 *
 * TODO ANTES DE PRODUCAO: `DEV_AUTO_LOGIN` existe para o protótipo abrir sem
 * tela de login (que nao faz parte dos fluxos desenhados). Ele resolve a
 * requisicao sem token para o usuario semeado. Precisa ser `false` em qualquer
 * ambiente compartilhado — com ele ligado a API responde a qualquer chamada
 * anonima como se fosse a dona da conta.
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
    const token = extractBearerToken(request);

    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<{ sub: string; org: string }>(token);
        request.ctx = await this.buildContext(payload.sub, payload.org);
        return true;
      } catch {
        throw new UnauthorizedException('Token invalido ou expirado.');
      }
    }

    if (process.env.DEV_AUTO_LOGIN === 'true') {
      request.ctx = await this.buildDemoContext();
      return true;
    }

    throw new UnauthorizedException('Autenticacao obrigatoria.');
  }

  private async buildContext(userId: string, organizationId: string): Promise<RequestContext> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { user: true },
    });
    if (!membership) throw new UnauthorizedException('Sem acesso a esta organizacao.');

    return {
      userId,
      organizationId,
      role: membership.role,
      email: membership.user.email,
    };
  }

  private async buildDemoContext(): Promise<RequestContext> {
    const email = process.env.DEMO_USER_EMAIL ?? 'marina@familia.com';
    const membership = await this.prisma.membership.findFirst({
      where: { user: { email } },
      include: { user: true },
      orderBy: { id: 'asc' },
    });
    if (!membership) {
      throw new UnauthorizedException(
        'Nenhum usuario semeado. Rode `npm run db:reset` antes de usar DEV_AUTO_LOGIN.',
      );
    }
    return {
      userId: membership.userId,
      organizationId: membership.organizationId,
      role: membership.role,
      email: membership.user.email,
    };
  }
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}
