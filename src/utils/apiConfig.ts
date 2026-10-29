/**
 * ChoirMate AI — Production API Configuration Helper
 * Supports same-origin /api/ requests (default) or configurable direct backend URL
 * via VITE_API_URL (e.g. https://choirmate-ai-backend.onrender.com) for Vercel deployment.
 * Automatically falls back to Render backend when hosted on Vercel (`*.vercel.app`) if VITE_API_URL is unset.
 */
function resolveApiBase(): string {
  try {
    const metaEnv = (import.meta as any)?.env;
    if (metaEnv && typeof metaEnv.VITE_API_URL === 'string' && metaEnv.VITE_API_URL.trim()) {
      return metaEnv.VITE_API_URL.trim();
    }
    if (typeof window !== 'undefined' && window.location && window.location.hostname.endsWith('vercel.app')) {
      return 'https://choirmate-ai-backend.onrender.com';
    }
  } catch {
    // Ignore in non-vite contexts
  }
  if (typeof process !== 'undefined' && process.env && typeof process.env.VITE_API_URL === 'string' && process.env.VITE_API_URL.trim()) {
    return process.env.VITE_API_URL.trim();
  }
  return '';
}

export const API_BASE = resolveApiBase().replace(/\/+$/, '');

export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${cleanPath}`;
}
