-- ✏️ pencilled-in entries (status Tentative) confirmed with "✅ It's on": when and by whom. The entry shows ✅ for 3 days and
-- the weekly email lists it under "Confirmed since last week". Additive: the running code works without it.
ALTER TABLE events ADD COLUMN confirmed_at TEXT;
ALTER TABLE events ADD COLUMN confirmed_by TEXT;
