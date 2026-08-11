import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from './auth.types';

export interface LoginResult {
  accessToken: string;
  user: { id: string; name: string; email: string; initials: string };
  organization: { id: string; name: string; badge: string; role: string };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { include: { organization: true }, orderBy: { id: 'asc' } } },
    });

    // Mensagem unica para usuario inexistente e senha errada: diferenciar as
    // duas transforma o endpoint em um verificador de e-mails cadastrados.
    const invalid = (): never => {
      throw new UnauthorizedException('E-mail ou senha invalidos.');
    };

    if (!user) invalid();
    const matches = await bcrypt.compare(password, user!.passwordHash);
    if (!matches) invalid();

    const membership = user!.memberships[0];
    if (!membership) throw new UnauthorizedException('Usuario sem organizacao vinculada.');

    const accessToken = await this.jwt.signAsync({
      sub: user!.id,
      org: membership.organizationId,
    });

    return {
      accessToken,
      user: { id: user!.id, name: user!.name, email: user!.email, initials: user!.initials },
      organization: {
        id: membership.organization.id,
        name: membership.organization.name,
        badge: membership.organization.badge,
        role: membership.role,
      },
    };
  }

  /** Sessao corrente: usuario, organizacao e preferencias que o header consome. */
  async me(ctx: RequestContext) {
    const [user, organization] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } }),
    ]);

    return {
      user: { id: user.id, name: user.name, email: user.email, initials: user.initials },
      organization: {
        id: organization.id,
        name: organization.name,
        badge: organization.badge,
        currency: organization.currency,
        locale: organization.locale,
        timezone: organization.timezone,
        fiscalMonthStartDay: organization.fiscalMonthStartDay,
        projectionHorizon: organization.projectionHorizon,
        autoSyncPerDay: organization.autoSyncPerDay,
        exportPreference: organization.exportPreference,
        commitmentTarget: organization.commitmentTarget,
        role: ctx.role,
      },
    };
  }

  async members(organizationId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId },
      include: { user: true },
      orderBy: { id: 'asc' },
    });

    return memberships.map((membership) => ({
      id: membership.id,
      role: membership.role,
      user: {
        id: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        initials: membership.user.initials,
      },
    }));
  }
}
