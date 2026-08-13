import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CsrfGuard } from './csrf.guard';
import { TokenService } from './token.service';

@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret-troque-em-producao',
    }),
    // Teto global generoso; os endpoints de autenticação apertam com @Throttle.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    // Ordem importa: o limite de taxa roda ANTES da autenticação, senão uma
    // rajada de login inválido consome bcrypt a cada tentativa — exatamente o
    // que o limite existe para evitar.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Antes do AuthGuard: barra a requisicao forjada sem gastar consulta ao banco.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
