-- The family's own app icons (house + calendar in the people's colours), drawn by an admin's browser on Setup and served
-- by the Worker at /icon-192.png etc. instead of the standard files. key = the colours they were drawn from. Additive.
CREATE TABLE IF NOT EXISTS app_icons (name TEXT PRIMARY KEY, png BLOB NOT NULL, key TEXT NOT NULL, updated_at TEXT NOT NULL);
