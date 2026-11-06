-- ✅ "Must confirm it's done" on a calendar entry with a reminder (e.g. a child's chore): the reminder keeps coming every 30 minutes
-- (not 21:00-07:00) until someone in Who or a parent marks it done; the parents hear when it's done, and once if it's 2 hours late.
ALTER TABLE events ADD COLUMN must_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN done_at TEXT;
ALTER TABLE events ADD COLUMN done_by TEXT;
