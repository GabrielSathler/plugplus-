import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Ctx, Public, type RequestContext } from './auth.types';
import { REFRESH_COOKIE, clearSessionCookies, setSessionCookies } from './cookies';
import { TokenService } from './token.service';

export class RegisterDto {
  @IsString() @MinLength(2, { message: 'Informe seu nome.' }) @MaxLength(80) name!: string;

  @IsEmail({}, { message: 'E-mail inválido.' }) @MaxLength(160) email!: string;

  // O mínimo de 8 caracteres é o piso do NIST e é o que a tela promete. Regras
  // de "1 maiúscula, 1 símbolo" foram removidas da recomendação por
  // empurrarem as pessoas para senhas curtas e previsíveis (Senha@123);
  // comprimento é o que de fato aumenta a entropia.
  @IsString() @MinLength(8, { message: 'A senha precisa de ao menos 8 caracteres.' }) @MaxLength(200)
  password!: string;

  @IsOptional() @IsString() @MaxLength(80) workspaceName?: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'E-mail inválido.' }) email!: string;
  @IsString() @MinLength(1, { message: 'Informe a senha.' }) password!: string;
}

/* ------------------------------- Controller ------------------------------ */

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  // Cinco tentativas por minuto por IP. Segura força bruta e enumeração de
  // e-mail sem atrapalhar quem errou a senha duas vezes.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cria a conta e o workspace, e já abre a sessão.' })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.register(dto, contextOf(request));
    setSessionCookies(response, session);
    return toBody(session);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Autentica e abre a sessão.' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.login(dto.email, dto.password, contextOf(request));
    setSessionCookies(response, session);
    return toBody(session);
  }

  /**
   * Troca o refresh do cookie por um access token novo.
   *
   * `@Public` porque é chamado JUSTAMENTE quando o access token expirou — pedir
   * um access válido aqui seria circular. Quem autentica é o cookie.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renova o access token e rotaciona o refresh.' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const raw = request.cookies?.[REFRESH_COOKIE];
    if (!raw) throw new UnauthorizedException('Sessão não encontrada.');

    try {
      const rotated = await this.tokens.rotate(raw, contextOf(request));
      setSessionCookies(response, rotated);
      const session = await this.auth.me({
        userId: rotated.userId,
        organizationId: rotated.organizationId,
        role: '',
        email: '',
      });
      return { ...session, csrfToken: rotated.csrfToken };
    } catch (error) {
      // Sessão inválida deixa de existir no cliente também: sem limpar, o
      // navegador reenviaria o mesmo cookie morto em todo carregamento.
      clearSessionCookies(response);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Encerra a sessão deste aparelho.' })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const raw = request.cookies?.[REFRESH_COOKIE];
    if (raw) await this.tokens.revoke(raw);
    clearSessionCookies(response);
  }

  @Get('me')
  @ApiOperation({ summary: 'Sessão corrente: usuário, organização e preferências.' })
  me(@Ctx() ctx: RequestContext) {
    return this.auth.me(ctx);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Aparelhos com sessão ativa.' })
  sessions(@Ctx() ctx: RequestContext) {
    return this.auth.sessions(ctx.userId);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Encerra a sessão em todos os aparelhos.' })
  async logoutAll(@Ctx() ctx: RequestContext, @Res({ passthrough: true }) response: Response) {
    await this.tokens.revokeAllForUser(ctx.userId);
    clearSessionCookies(response);
  }

  @Get('members')
  @ApiOperation({ summary: 'Pessoas com acesso ao workspace.' })
  members(@Ctx() ctx: RequestContext) {
    return this.auth.members(ctx.organizationId);
  }
}

/* -------------------------------------------------------------------------- */

function contextOf(request: Request) {
  return {
    userAgent: request.headers['user-agent'],
    ip: request.ip,
  };
}


/**
 * Corpo da resposta.
 *
 * NENHUM token de sessão entra aqui: access e refresh vivem só nos cookies
 * httpOnly. O `csrfToken` permanece no corpo porque precisa ser lido pelo
 * cliente — ele não é segredo, e a proteção vem de outro domínio não conseguir
 * lê-lo por causa da política de mesma origem.
 */
function toBody<T extends { refreshToken: string; accessToken: string; expiresAt: Date }>(
  session: T,
) {
  const { refreshToken: _r, accessToken: _a, expiresAt: _e, ...rest } = session;
  return rest;
}
