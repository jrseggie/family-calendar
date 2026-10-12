// 🔒 Info page encryption (AES-256-GCM, Web Crypto). The key is the Pages secret VAULT_KEY (32 random bytes, base64);
// the setup wizard shows a recovery copy to keep safe. The database, its backups, the inbox routine and the
// Cloudflare key only ever see the scrambled text: only the signed-in site can turn it back into the details.
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(secret) {
  const raw = unb64(String(secret || ""));
  if (raw.length !== 32) throw new Error("VAULT_KEY must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

// object -> "v1:<base64 iv + ciphertext>"
export async function seal(secret, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), new TextEncoder().encode(JSON.stringify(obj))));
  const out = new Uint8Array(iv.length + ct.length); out.set(iv); out.set(ct, iv.length);
  return "v1:" + b64(out);
}

export async function open(secret, text) {
  const all = unb64(String(text).replace(/^v1:/, ""));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, await key(secret), all.slice(12));
  return JSON.parse(new TextDecoder().decode(plain));
}
