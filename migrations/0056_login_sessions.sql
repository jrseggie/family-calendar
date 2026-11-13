-- 🚪 Sign out (Settings › Logins): signed_out_at = when an admin pressed "Sign out everywhere" - any sign-in older than that is sent
-- to Cloudflare's sign-out page and has to sign in again with the emailed code. session_from / session_to = the latest sign-in seen
-- for this login (when it started, when it runs out), shown on the login's form.
ALTER TABLE users ADD COLUMN signed_out_at TEXT;
ALTER TABLE users ADD COLUMN session_from TEXT;
ALTER TABLE users ADD COLUMN session_to TEXT;
