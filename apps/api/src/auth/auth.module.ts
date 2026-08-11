import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret-troque-em-producao',
      // `expiresIn` do @nestjs/jwt e tipado como o template literal do pacote
      // `ms`, que uma env var (string aberta) nao satisfaz em tempo de tipo.
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as `${number}d` },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
