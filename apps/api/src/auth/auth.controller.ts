import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { Ctx, Public, type RequestContext } from './auth.types';

class LoginDto {
  @IsEmail({}, { message: 'E-mail invalido.' })
  email!: string;

  @IsString()
  @MinLength(6, { message: 'A senha precisa de ao menos 6 caracteres.' })
  password!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Autentica e devolve o token de acesso.' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('me')
  @ApiOperation({ summary: 'Sessao corrente: usuario, organizacao e preferencias.' })
  me(@Ctx() ctx: RequestContext) {
    return this.auth.me(ctx);
  }

  @Get('members')
  @ApiOperation({ summary: 'Pessoas com acesso ao plano.' })
  members(@Ctx() ctx: RequestContext) {
    return this.auth.members(ctx.organizationId);
  }
}
