import { randomBytes } from 'node:crypto';
import type { Response } from 'express';

/**
 * Cookies de sessão.
 *
 * ADR — OS DOIS TOKENS VÃO EM COOKIE httpOnly.
 *
 * O access token não fica mais em memória do JavaScript. Consequência direta:
 * nenhum script da página consegue LER o token e mandá-lo para fora. Um XSS
 * ainda consegue USAR a sessão de dentro do navegador (`fetch` com
 * `credentials`), mas não consegue exfiltrar credencial para usar em outra
 * máquina, depois, com a aba fechada. É essa a fronteira que o httpOnly move.
 *
 * O PREÇO: cookie é enviado automaticamente pelo navegador, inclusive quando
 * quem provoca a requisição é outro site. Isso é CSRF, e o header `Authorization`
 * era imune por construção. Por isso este arquivo anda junto com `csrf.guard.ts`:
 * trocar para cookie sem defesa de CSRF seria trocar um risco por outro.
 *
 * A defesa tem três camadas:
 *   1. `sameSite: lax` — o navegador já não envia o cookie em POST/PATCH/DELETE
 *      disparado por outro site.
 *   2. double-submit token — um valor aleatório em cookie LEGÍVEL que o cliente
 *      repete num header. Outro domínio não consegue ler o cookie (mesma
 *      origem), logo não consegue forjar o header.
 *   3. conferência de `Origin` — rejeita requisição de origem desconhecida.
 */

export const ACCESS_COOKIE = 'finflow_at';
export const REFRESH_COOKIE = 'finflow_rt';
/** Legível por JavaScript de propósito: o cliente precisa copiá-lo para o header. */
export const CSRF_COOKIE = 'finflow_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const ACCESS_MAX_AGE = 15 * 60 * 1000;
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

const isProduction = (): boolean => process.env.NODE_ENV === 'production';

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function setSessionCookies(
  response: Response,
  tokens: { accessToken: string; refreshToken: string; csrfToken: string },
): void {
  // Access: vale para toda a API, porque toda rota autenticada precisa dele.
  response.cookie(ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/api',
    maxAge: ACCESS_MAX_AGE,
  });

  // Refresh: caminho restrito às rotas de autenticação. Não faz sentido
  // acompanhar toda leitura de dashboard — quanto menos ele circula, menor a
  // chance de vazar em log de proxy ou em erro de configuração.
  response.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: REFRESH_MAX_AGE,
  });

  // CSRF: httpOnly FALSE de propósito. Se o JavaScript não puder ler, não tem
  // como devolver no header, e o double-submit não funciona. Não é segredo:
  // vale porque a política de mesma origem impede outro site de lê-lo.
  response.cookie(CSRF_COOKIE, tokens.csrfToken, {
    httpOnly: false,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_MAX_AGE,
  });
}

export function clearSessionCookies(response: Response): void {
  response.clearCookie(ACCESS_COOKIE, { path: '/api' });
  response.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  response.clearCookie(CSRF_COOKIE, { path: '/' });
}
