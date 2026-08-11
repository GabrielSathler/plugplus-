import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';

/** Identidade resolvida pelo guard e anexada a requisicao. */
export interface RequestContext {
  userId: string;
  organizationId: string;
  role: string;
  email: string;
}

export const IS_PUBLIC_KEY = 'isPublic';
/** Marca uma rota como acessivel sem autenticacao. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Injeta o `RequestContext` resolvido pelo `AuthGuard` no handler. */
export const Ctx = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestContext => {
    const request = context.switchToHttp().getRequest<{ ctx: RequestContext }>();
    return request.ctx;
  },
);
