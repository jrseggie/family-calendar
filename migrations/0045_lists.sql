-- 🛒 Lists (shopping lists and the like): for the family's own logins only (admins + logins whose person is "part of the family").
-- A list is private to its owner unless people are added to it (list_members). place = a key from `places`, or 'other' with place_name.
CREATE TABLE IF NOT EXISTS lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  place TEXT,
  place_name TEXT,
  owner_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS list_members (
  list_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (list_id, user_id)
);
-- client_id: made on the phone, so an item added with no signal is only ever added once when it's sent later
CREATE TABLE IF NOT EXISTS list_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  note TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  added_by TEXT,
  done_by TEXT,
  done_at TEXT,
  client_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS list_items_list ON list_items (list_id, done);
