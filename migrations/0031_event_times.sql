-- An optional time on an entry (since 2026-10-21): start_time / end_time as HH:MM in the calendar's time zone.
-- Empty = an all-day entry, as before. For an entry over several days: the time it starts on the first day and
-- (optionally) the time it ends on the last day.
ALTER TABLE events ADD COLUMN start_time TEXT;
ALTER TABLE events ADD COLUMN end_time TEXT;
