/** Server-only LI.FI transport. Keep identical in API and listener. */
export const getLifiConfig = () => ({
  apiKey: process.env.LIFI_API_KEY?.trim() || '',
  integrator: process.env.LIFI_INTEGRATOR?.trim() || 'payli',
});

export const lifiRequest = async (path: 'quote' | 'status', query: URLSearchParams, timeoutMs: number): Promise<Response> => {
  const { apiKey } = getLifiConfig();
  const response = await fetch(`https://li.quest/v1/${path}?${query}`, {
    headers: apiKey ? { 'x-lifi-api-key': apiKey } : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.ok) return response;

  let detail = '';
  try {
    const body = await response.json() as { message?: unknown; description?: unknown };
    detail = String(body.message || body.description || '').replace(/[\r\n]+/g, ' ');
  } catch { /* Some upstream failures have no JSON body. */ }
  if (apiKey) detail = detail.replaceAll(apiKey, '[redacted]');
  detail = detail.slice(0, 300);
  const hint = response.status === 401
    ? `Check runtime LIFI_API_KEY (${apiKey ? 'configured' : 'missing'}) and LI.FI key validity.`
    : response.status === 403 ? 'Check LI.FI key IP and integrator restrictions.' : '';
  throw new Error(`Payment route ${path} unavailable (${response.status})${detail ? `: ${detail}` : ''}${hint ? `. ${hint}` : ''}`);
};
