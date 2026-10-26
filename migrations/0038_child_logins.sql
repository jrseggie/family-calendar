-- 🧒 Child logins (lib/child.js): add entries for anyone, change / delete only their own
ALTER TABLE events ADD COLUMN created_login INTEGER;   -- users.id of the login that added it (new entries from now on)
ALTER TABLE users ADD COLUMN person TEXT;              -- the person this login is (a Child's own entries aren't pencilled in)
