-- ✉️ Welcome email for a new login (Settings > Who can sign in; lib/welcome.js)
ALTER TABLE users ADD COLUMN welcome_at TEXT;     -- when the welcome email was queued
ALTER TABLE users ADD COLUMN welcome_wait TEXT;   -- asked for, waiting for their address to be confirmed with Cloudflare
ALTER TABLE users ADD COLUMN welcome_by TEXT;     -- who asked for it (named in the email)
