import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService, type IssuedTokens } from './token.service';
import type { RequestContext } from './auth.types';

/**
 * Custo do bcrypt.
 *
 * 12 leva ~250 ms nesta máquina. É lento de propósito: cada tentativa de força
 * bruta paga o mesmo preço, e uma senha vazada em dump vira inviável de
 * reverter. Abaixo de 10 o hash fica barato demais para quem tem GPU; muito
 * acima disso o login começa a incomodar e vira vetor de negação de serviço.
 */
const BCRYPT_ROUNDS = 12;

export interface SessionResult extends IssuedTokens {
  user: { id: string; name: string; email: string; initials: string };
  organization: { id: string; name: string; badge: string; role: string };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Cria conta, workspace e o vínculo entre os dois.
   *
   * Tudo em UMA transação: um usuário sem organização não consegue entrar em
   * lugar nenhum, e uma organização órfã fica ocupando nome. Se qualquer passo
   * falhar, nada é criado.
   */
  async register(
    input: { name: string; email: string; password: string; workspaceName?: string },
    context: { userAgent?: string; ip?: string },
  ): Promise<SessionResult> {
    const email = normalizeEmail(input.email);
    const name = input.name.trim();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Já existe uma conta com este e-mail.');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    const { user, organization } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name, email, passwordHash, initials: initialsFrom(name) },
      });

      const organization = await tx.organization.create({
        data: {
          name: input.workspaceName?.trim() || `Workspace de ${name.split(' ')[0]}`,
          badge: 'PESSOAL',
        },
      });

      await tx.membership.create({
        data: { userId: user.id, organizationId: organization.id, role: 'OWNER' },
      });

      // Um workspace sem categorias não consegue lançar nada — a primeira tela
      // seria um formulário travado. Semear o mínimo é parte de criar a conta.
      await tx.category.createMany({ data: defaultCategories(organization.id) });

      return { user, organization };
    });

    const issued = await this.tokens.issue(user.id, organization.id, context);

    return {
      ...issued,
      user: { id: user.id, name: user.name, email: user.email, initials: user.initials },
      organization: {
        id: organization.id,
        name: organization.name,
        badge: organization.badge,
        role: 'OWNER',
      },
    };
  }

  async login(
    email: string,
    password: string,
    context: { userAgent?: string; ip?: string },
  ): Promise<SessionResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      include: { memberships: { include: { organization: true }, orderBy: { id: 'asc' } } },
    });

    // Mensagem única para e-mail inexistente e senha errada: diferenciar as
    // duas transforma o endpoint num verificador de quem tem conta aqui.
    //
    // O bcrypt roda mesmo sem usuário, contra um hash descartável, para o
    // tempo de resposta não denunciar a diferença — sem isso, "e-mail não
    // existe" volta em 5 ms e "senha errada" em 250 ms, e a comparação de
    // tempo entrega a informação que a mensagem escondeu.
    const hash = user?.passwordHash ?? DUMMY_HASH;
    const matches = await bcrypt.compare(password, hash);

    if (!user || !matches) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const membership = user.memberships[0];
    if (!membership) throw new UnauthorizedException('Usuário sem organização vinculada.');

    const issued = await this.tokens.issue(user.id, membership.organizationId, context);

    return {
      ...issued,
      user: { id: user.id, name: user.name, email: user.email, initials: user.initials },
      organization: {
        id: membership.organization.id,
        name: membership.organization.name,
        badge: membership.organization.badge,
        role: membership.role,
      },
    };
  }

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

  /** Sessões ativas do usuário, para ele reconhecer e encerrar aparelhos. */
  async sessions(userId: string) {
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => ({
      id: row.id,
      userAgent: row.userAgent,
      ip: row.ip,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    }));
  }
}

/**
 * Hash descartável usado quando o e-mail não existe.
 *
 * Precisa ser um bcrypt VÁLIDO — `compare` com string inválida retorna na hora
 * e o objetivo, que é gastar o mesmo tempo, se perde. Este é o hash de uma
 * senha aleatória que ninguém conhece.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.7Bn0kiPbQTPjPqiHUZ0.LQfFvtRvSHu';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** "Marina Ribeiro" -> "MR"; nome de uma palavra -> duas primeiras letras. */
function initialsFrom(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** Categorias mínimas para o workspace novo não abrir travado. */
function defaultCategories(organizationId: string) {
  return [
    { name: 'Moradia', kind: 'EXPENSE', color: '#0F8A72', icon: 'House', sortOrder: 0 },
    { name: 'Mercado', kind: 'EXPENSE', color: '#C0453B', icon: 'ShoppingCart', sortOrder: 1 },
    { name: 'Educacao', kind: 'EXPENSE', color: '#3B6FE0', icon: 'GraduationCap', sortOrder: 2 },
    { name: 'Transporte', kind: 'EXPENSE', color: '#B8863A', icon: 'Car', sortOrder: 3 },
    { name: 'Saude', kind: 'EXPENSE', color: '#B33C86', icon: 'HeartPulse', sortOrder: 4 },
    { name: 'Lazer', kind: 'EXPENSE', color: '#5F8C1F', icon: 'Ticket', sortOrder: 5 },
    { name: 'Assinaturas', kind: 'EXPENSE', color: '#8257E5', icon: 'Repeat', sortOrder: 6 },
    { name: 'Renda', kind: 'INCOME', color: '#0F8A72', icon: 'TrendingUp', sortOrder: 7 },
    {
      name: 'Encargos e anuidade',
      kind: 'EXPENSE',
      color: '#8C8A85',
      icon: 'Receipt',
      isFee: true,
      sortOrder: 8,
    },
  ].map((category) => ({ ...category, organizationId }));
}

export { BadRequestException };
