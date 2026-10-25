import { ApiError, guardWrite, json, readJson, requireAccount, verifyCsrf, type AuthEnv } from './auth';

export const QUOTE_IDS = new Set([...Array.from({ length: 7 }, (_, i) => `text-${i + 1}`), ...Array.from({ length: 15 }, (_, i) => `scan-${i + 1}`), ...Array.from({length:24},(_,i)=>`classic-${i+1}`)]);
export async function handleQuotes(request: Request, env: AuthEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/quotes/')) return null;
  const account = await requireAccount(request, env);
  if (request.method !== 'GET') { guardWrite(request); verifyCsrf(request, account); }
  if (path === '/api/quotes/settings' && request.method === 'GET') {
    const row = await env.DB.prepare('SELECT enabled,idle_minutes FROM quote_settings WHERE account_id=?').bind(account.accountId).first<{enabled: number; idle_minutes: number}>();
    return json({ enabled: row ? !!row.enabled : true, idleMinutes: row?.idle_minutes ?? 5 });
  }
  if (path === '/api/quotes/settings' && request.method === 'PUT') {
    const body = await readJson(request, 4096);
    if (typeof body.enabled !== 'boolean' || ![1,5,10,15].includes(body.idleMinutes as number)) throw new ApiError(422, 'invalid_settings', 'Vyber platný čas zobrazenia citátu.');
    await env.DB.prepare('INSERT INTO quote_settings(account_id,enabled,idle_minutes) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET enabled=excluded.enabled,idle_minutes=excluded.idle_minutes').bind(account.accountId, body.enabled ? 1 : 0, body.idleMinutes).run();
    return json({ enabled: body.enabled, idleMinutes: body.idleMinutes });
  }
  if (path === '/api/quotes/saved' && request.method === 'GET') {
    const result = await env.DB.prepare('SELECT quote_id,saved_at FROM saved_quotes WHERE account_id=? ORDER BY saved_at DESC,quote_id').bind(account.accountId).all();
    return json({ saved: result.results.map(row => ({ quoteId: row.quote_id, savedAt: row.saved_at })) });
  }
  if (path === '/api/quotes/saved' && ['POST','DELETE'].includes(request.method)) {
    const body = await readJson(request, 4096);
    if (typeof body.quoteId !== 'string' || !QUOTE_IDS.has(body.quoteId)) throw new ApiError(422, 'invalid_quote', 'Tento citát sa v zbierke nenachádza.');
    if (request.method === 'POST') await env.DB.prepare('INSERT INTO saved_quotes(account_id,quote_id,saved_at) VALUES(?,?,?) ON CONFLICT(account_id,quote_id) DO NOTHING').bind(account.accountId, body.quoteId, Date.now()).run();
    else {
      const removeSelection = env.DB.prepare('UPDATE profile_showcases SET quote_ids=(SELECT json_group_array(value) FROM json_each(profile_showcases.quote_ids) WHERE value<>?),revision=revision+1,updated_at=? WHERE account_id=? AND EXISTS(SELECT 1 FROM json_each(profile_showcases.quote_ids) WHERE value=?)').bind(body.quoteId, Date.now(), account.accountId, body.quoteId);
      const removeSaved = env.DB.prepare('DELETE FROM saved_quotes WHERE account_id=? AND quote_id=?').bind(account.accountId, body.quoteId);
      if (typeof env.DB.batch === 'function') await env.DB.batch([removeSelection, removeSaved]);
      else {
        // Revoke the explicit selection before deleting the saved item. A failure
        // leaves the quote saved, rather than preserving a hidden selection.
        await removeSelection.run();
        await removeSaved.run();
      }
    }
    return json({ ok: true });
  }
  return json({ error: { code: 'not_found', message: 'Táto cesta sa nenašla.' } }, 404);
}
