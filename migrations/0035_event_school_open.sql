-- 🏫 "School is open this day" on a School entry (since 2026-10-26): that child has a normal school day even on a public holiday
-- (e.g. a boarding school open on an election day). 1 = open; NULL / 0 = nothing special.
ALTER TABLE events ADD COLUMN school_open INTEGER;
