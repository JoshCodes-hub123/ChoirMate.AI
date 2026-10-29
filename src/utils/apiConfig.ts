/**
 * ChoirMate AI — Production API Configuration Helper
 * Supports same-origin /api/ requests (default) or configurable direct backend URL
 * via VITE_API_URL (e.g. https://choirmate-api.onrender.com) for Vercel deployment.
 * Fully isomorphic: safe in both browser Vite runtime and Node.js server.
 */
function resolveApiBase(): string {
  try {
    const metaEnv = (import.meta as any)?.env;
    if (metaEnv && typeof metaEnv.VITE_API_URL === 'string') {
      return metaEnv.VITE_API_URL;
    }
  } catch {
    // Ignore in non-vite contexts
  }
  if (typeof process !== 'undefined' && process.env && typeof process.env.VITE_API_URL === 'string') {
    return process.env.VITE_API_URL;
  }
  return '';
}

export const API_BASE = resolveApiBase().replace(/\/+$/, '');

export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${cleanPath}`;
}
