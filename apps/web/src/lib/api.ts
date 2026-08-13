/**
 * Cliente HTTP do Cardinal.
 *
 * NENHUM token de sessão passa por aqui. Access e refresh vivem em cookies
 * httpOnly que o navegador anexa sozinho e o JavaScript não consegue ler —
 * script injetado não tem o que exfiltrar.
 *
 * O preço dessa escolha é CSRF: cookie vai junto mesmo quando quem provoca a
 * requisição é outro site. A contramedida é o double-submit abaixo — o valor
 * do cookie `finflow_csrf` repetido no header. Outro domínio não consegue ler
 * esse cookie, logo não consegue montar o header.
 */

const BASE = '/api';
const CSRF_COOKIE = 'finflow_csrf';
const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query?: Query): string {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

/** Lê o token CSRF do cookie legível deixado pelo servidor. */
function csrfToken(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Renovação em voo único.
 *
 * Ao expirar o access token, várias telas tomam 401 ao mesmo tempo. Sem esta
 * promessa compartilhada, cada uma chamaria `/auth/refresh` — e como cada
 * renovação ROTACIONA o refresh, a segunda apresentaria um token já consumido,
 * o servidor leria isso como roubo e derrubaria a sessão inteira. O bug
 * apareceria como "fui deslogado do nada ao abrir o app".
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const token = csrfToken();
      const response = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: token ? { [CSRF_HEADER]: token } : {},
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Liberado no próximo tick para que chamadas concorrentes ainda aguardem
      // esta mesma promessa em vez de abrirem outra.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

/** Disparado quando a sessão acaba de vez — o AuthProvider escuta e redireciona. */
export const SESSION_EXPIRED = 'finflow:session-expired';

async function request<T>(
  path: string,
  init?: RequestInit & { query?: Query },
  isRetry = false,
): Promise<T> {
  const { query, ...rest } = init ?? {};
  const method = (rest.method ?? 'GET').toUpperCase();
  const token = csrfToken();

  const response = await fetch(buildUrl(path, query), {
    ...rest,
    // Sem isto o navegador não anexa os cookies e toda requisição sai anônima.
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      // Só em método que muda estado; GET não precisa e o servidor não exige.
      ...(!SAFE_METHODS.has(method) && token ? { [CSRF_HEADER]: token } : {}),
      ...rest.headers,
    },
  });

  // Uma única tentativa de renovação por requisição. `isRetry` corta o laço:
  // se o 401 persistir depois de renovar, o problema não é o token expirado.
  if (response.status === 401 && !isRetry && !path.startsWith('/auth/refresh')) {
    const renewed = await refreshSession();
    if (renewed) return request<T>(path, init, true);
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED));
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }
    const raw =
      typeof body === 'object' && body !== null && 'message' in body
        ? (body as { message: unknown }).message
        : null;
    // O class-validator devolve uma lista; a primeira é a que o formulário mostra.
    const message = Array.isArray(raw)
      ? String(raw[0])
      : raw
        ? String(raw)
        : `Falha na requisição (${response.status})`;
    throw new ApiError(response.status, message, body);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Envio de arquivo em multipart.
 *
 * NÃO define `content-type`: o navegador precisa gerar o cabeçalho com o
 * `boundary` do FormData. Passar o nosso JSON padrão aqui faz o servidor não
 * conseguir separar as partes, e o arquivo chega vazio — falha silenciosa
 * clássica de upload.
 */
async function requestForm<T>(path: string, form: FormData): Promise<T> {
  const token = csrfToken();
  const response = await fetch(buildUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: token ? { [CSRF_HEADER]: token } : {},
    body: form,
  });

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }
    const raw =
      typeof body === 'object' && body !== null && 'message' in body
        ? (body as { message: unknown }).message
        : null;
    throw new ApiError(
      response.status,
      Array.isArray(raw) ? String(raw[0]) : raw ? String(raw) : 'Falha no envio do arquivo.',
      body,
    );
  }

  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>(path, { method: 'GET', query }),
  postForm: <T>(path: string, form: FormData) => requestForm<T>(path, form),
  post: <T>(path: string, body?: unknown, query?: Query) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined, query }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string, query?: Query) => request<T>(path, { method: 'DELETE', query }),
};

export { refreshSession };
