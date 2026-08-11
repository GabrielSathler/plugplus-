/**
 * Cliente HTTP do FinFlow.
 *
 * Caminho relativo `/api` de proposito: o Vite encaminha para o Nest em
 * desenvolvimento e, em producao, o mesmo build funciona atras de qualquer
 * proxy sem recompilar uma URL absoluta.
 */

const BASE = '/api';

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

async function request<T>(path: string, init?: RequestInit & { query?: Query }): Promise<T> {
  const { query, ...rest } = init ?? {};
  const token = localStorage.getItem('finflow:token');

  const response = await fetch(buildUrl(path, query), {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...rest.headers,
    },
  });

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message: unknown }).message)
        : `Falha na requisicao (${response.status})`;
    throw new ApiError(response.status, message, body);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: unknown, query?: Query) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined, query }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string, query?: Query) => request<T>(path, { method: 'DELETE', query }),
};
