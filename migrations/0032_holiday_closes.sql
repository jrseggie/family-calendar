-- School holidays: the time school closes on the first day, e.g. 12:00 (since 2026-10-21; HH:MM, empty = not known).
ALTER TABLE school_holidays ADD COLUMN closes_at TEXT;
