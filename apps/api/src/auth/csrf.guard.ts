import {
  CanActivate,
  ForbiddenException,
  Injectable,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER } from './cookies';
import { IS_PUBLIC_KEY } from './auth.types';

/**
 * Defesa contra CSRF.
 *
 * Necessária porque a sessão passou a viver em cookie: o navegador anexa
 * cookie sozinho, e um formulário hospedado em outro domínio consegue disparar
 * uma requisição autenticada sem o usuário perceber. Com `Authorization:
 * Bearer` isso era impossível — nenhum site consegue fazer o SEU JavaScript
 * montar um header.
 *
 * DOIS FILTROS, e uma requisição precisa passar nos dois:
 *
 *   ORIGEM     `Origin`/`Referer` tem que bater com um host conhecido. Barra o
 *              caso simples e não custa nada.
 *
 *   DOUBLE-SUBMIT  o valor do cookie `finflow_csrf` tem que ser repetido no
 *              header `x-csrf-token`. Outro domínio não consegue LER esse
 *              cookie por causa da política de mesma origem, então não
 *              consegue montar o header — mesmo conseguindo disparar a
 *              requisição com o cookie de sessão junto.
 *
 * SÓ VALE PARA MÉTODO INSEGURO. GET não muda estado; exigir token nele
 * quebraria abertura de link e não protegeria nada.
 *
 * SÓ VALE PARA SESSÃO POR COOKIE. Cliente que autentica com `Authorization`
 * (Swagger, script, app nativo) está imune a CSRF por construção, e exigir o
 * header dele seria burocracia sem ganho.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (SAFE_METHODS.has(request.method)) return true;

    // Sem cookie de sessão não há o que sequestrar: ou a rota é pública, ou o
    // cliente vai autenticar por header.
    const hasSessionCookie = Boolean(request.cookies?.[ACCESS_COOKIE]);
    const usesBearer = request.headers.authorization?.toLowerCase().startsWith('bearer ');
    if (!hasSessionCookie || usesBearer) {
      // `login` e `register` são públicos e ainda não têm sessão; `refresh` e
      // `logout` usam o cookie de refresh e por isso são verificados.
      const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (isPublic || !hasSessionCookie) return true;
    }

    this.assertOrigin(request);
    this.assertDoubleSubmit(request);
    return true;
  }

  private assertOrigin(request: Request): void {
    const origin = request.headers.origin ?? refererOrigin(request.headers.referer);
    // Requisição sem `Origin` nem `Referer` não vem de navegador em contexto
    // cross-site (o navegador sempre manda um dos dois em POST). Deixar passar
    // mantém curl e testes funcionando sem abrir brecha de CSRF real.
    if (!origin) return;

    const allowed = (process.env.CORS_ORIGIN ?? 'http://localhost:5273')
      .split(',')
      .map((value) => value.trim());

    if (!allowed.includes(origin)) {
      throw new ForbiddenException(`Origem nao permitida: ${origin}`);
    }
  }

  private assertDoubleSubmit(request: Request): void {
    const cookieToken = request.cookies?.[CSRF_COOKIE];
    const headerToken = request.headers[CSRF_HEADER];

    if (typeof cookieToken !== 'string' || typeof headerToken !== 'string') {
      throw new ForbiddenException('Token CSRF ausente.');
    }

    const a = Buffer.from(cookieToken);
    const b = Buffer.from(headerToken);
    // Comparação em tempo constante. Comprimentos diferentes fazem
    // `timingSafeEqual` lançar, então são checados antes.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Token CSRF invalido.');
    }
  }
}

function refererOrigin(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
