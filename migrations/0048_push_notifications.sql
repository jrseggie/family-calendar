-- 🔔 Phone notifications (Web Push, lib/push.js). Each phone that said yes (👤 menu) is one row in push_subs.
-- push_pending = notifications waiting to go out in one go: a child adding several things to a list the parents are on gives the
-- parents ONE notification once they've stopped for a moment, and so does anyone adding to a list while someone is shopping.
-- lists.shopping_by / shopping_until = "🛒 I'm going to the shop" (for 2 hours, the shopper hears about anything added).
CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  device TEXT,
  created_at TEXT NOT NULL,
  last_ok TEXT,
  fails INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs (user_id);
CREATE TABLE IF NOT EXISTS push_pending (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_id INTEGER NOT NULL,
  list_id INTEGER NOT NULL,
  actor_id INTEGER NOT NULL,
  actor TEXT,
  text TEXT NOT NULL,
  why TEXT,
  created_at TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_pending_group ON push_pending (recipient_id, list_id, actor_id, sent);
ALTER TABLE lists ADD COLUMN shopping_by INTEGER;
ALTER TABLE lists ADD COLUMN shopping_until TEXT;
