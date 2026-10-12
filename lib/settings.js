// Site-wide settings (table `settings`, Setup > "This calendar"): the family's name and web address. Everything the
// site, the emails, invites and the phone feed call themselves comes from brand() - nothing is named in the code.
export const SETTING_KEYS = ["family_name", "site_name", "short_name", "site_url", "uid_prefix"];

export async function loadSettings(db) {
  try {
    const rows = (await db.prepare("SELECT key, value FROM settings").all()).results;
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch { return {}; }   // table not there yet (a brand-new database)
}

// names and addresses for a family, e.g. family_name "Smith" -> "Smith Calendar", "Smith Family Calendar", "Smiths".
// origin = the address the site was opened on, used when no web address is set yet.
export function brand(s = {}, origin = "") {
  const family = String(s.family_name || "").trim();
  const url = String(s.site_url || origin || "").trim().replace(/\/+$/, "");
  let host = "";
  try { host = url ? new URL(url).host.replace(/^www\./, "") : ""; } catch { /* not a URL yet */ }
  return {
    family,
    site: String(s.site_name || "").trim() || (family ? `${family} Calendar` : "Family Calendar"),   // header, page title, email sender
    full: family ? `${family} Family Calendar` : "Family Calendar",                                    // email headings, invites
    short: String(s.short_name || "").trim() || (family ? `${family}s` : "Calendar"),                  // phone home-screen name
    feed: family ? `${family} Family` : "Family Calendar",                                             // name of the phone-calendar feed
    url, host,
    inbox: host ? `inbox@${host}` : "",
    from: host ? `calendar@${host}` : "",
    uid: String(s.uid_prefix || "").trim() || "cal",   // start of invite / feed IDs (never change it: phones match on it)
  };
}
