// Keep Settings > Weekly email in step with Cloudflare Email Routing (the Worker can only send to "verified destination
// addresses"): an address added on the site that Cloudflare doesn't know yet gets Cloudflare's "verify" email, and each
// address's verified state is copied back into digest_recipients.verified (shown on the Settings tab).
// Needs the Worker secrets CF_API_TOKEN (Email Routing Addresses: Edit) and CF_ACCOUNT_ID; without them it does nothing.
// Runs hourly (mail/src/index.js) and straight after an address is added on Settings.
export const canSyncEmail = (env) => !!(env.CF_API_TOKEN && env.CF_ACCOUNT_ID);
// Cloudflare keys and IDs are only letters, digits, - and _ ; a key pasted into a terminal can bring spaces, line breaks,
// quotes or invisible "bracketed paste" codes along (ESC[200~ … ESC[201~) - drop all of that
const clean = (v) => String(v || "").replace(/\x1b\[20[01]~/g, "").replace(/[^A-Za-z0-9_-]/g, "");

// Cloudflare's list of addresses the Worker may send to: GET = the list, POST { email } = add one (Cloudflare emails it a "verify" link)
function routing(env) {
  const api = `https://api.cloudflare.com/client/v4/accounts/${clean(env.CF_ACCOUNT_ID)}/email/routing/addresses`;
  return async (method, body) => {
    const r = await fetch(api + (method === "GET" ? "?per_page=50" : ""), { method, body: body && JSON.stringify(body),
      headers: { Authorization: `Bearer ${clean(env.CF_API_TOKEN)}`, "Content-Type": "application/json" } });
    const raw = await r.text(), d = (() => { try { return JSON.parse(raw); } catch { return {}; } })();
    if (!d.success) throw new Error(`Cloudflare email addresses (${method}, ${r.status}): ${(d.errors || []).map((e) => `${e.code} ${e.message}`).join("; ") || raw.slice(0, 200)}`);
    return d.result;
  };
}
// { "address": true (verified) | false (waiting for them to click Cloudflare's link) }; an address not listed isn't known yet
export async function destinations(env) {
  return Object.fromEntries((await routing(env)("GET")).map((a) => [a.email.toLowerCase(), !!a.verified]));
}
export const askToVerify = (env, email) => routing(env)("POST", { email });

export async function syncEmailAddresses(env) {
  if (!canSyncEmail(env)) return null;
  const cf = routing(env);
  const rows = (await env.DB.prepare("SELECT id, email, verified FROM digest_recipients").all()).results;
  const dest = await destinations(env);
  const changes = [], stmts = [];
  for (const r of rows) {
    const email = r.email.toLowerCase();
    if (!(email in dest)) { await cf("POST", { email }); dest[email] = false; changes.push(`sent verification to ${email}`); }
    if (Number(dest[email]) !== r.verified) {
      stmts.push(env.DB.prepare("UPDATE digest_recipients SET verified = ? WHERE id = ?").bind(Number(dest[email]), r.id));
      changes.push(`${email} verified=${dest[email]}`);
    }
  }
  stmts.push(env.DB.prepare("INSERT OR REPLACE INTO health (key, at, detail) VALUES ('email_sync', ?, ?)").bind(new Date().toISOString(), changes.join("; ") || null));
  await env.DB.batch(stmts);
  return changes;
}
