-- The day each login last opened the calendar (stamped at most once a day) - for the usage check-in's
-- "logins used in the last 30 days" (lib/usage.js). Additive: the running code works without it.
ALTER TABLE users ADD COLUMN last_seen TEXT;
