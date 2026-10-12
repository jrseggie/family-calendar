-- Family Calendar: the starting database for a new family (every table as of release 1.0.0, no family data).
-- Safe to run on a database that already has the tables (IF NOT EXISTS). New database changes come as later numbered files.
-- The family's people, houses and name come from the set-up wizard; the places below are only the starting set.

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  who TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  status TEXT NOT NULL DEFAULT 'Confirmed',
  important INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  notes TEXT,
  created_by TEXT, created_at TEXT,
  updated_by TEXT, updated_at TEXT
, location TEXT, series INTEGER, house_off TEXT);

CREATE TABLE IF NOT EXISTS recurring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  day INTEGER NOT NULL,
  month INTEGER NOT NULL,
  born INTEGER,
  type TEXT NOT NULL DEFAULT 'Birthday',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS school_holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child TEXT NOT NULL,
  school TEXT,
  name TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Confirmed',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS public_holidays (
  date TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#495057',
  type TEXT NOT NULL DEFAULT 'household',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
, grid_column INTEGER NOT NULL DEFAULT 1, family INTEGER NOT NULL DEFAULT 0, child INTEGER NOT NULL DEFAULT 0, boards INTEGER NOT NULL DEFAULT 0, home TEXT, school TEXT);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  see TEXT,
  see_school INTEGER NOT NULL DEFAULT 0,
  see_birthdays INTEGER NOT NULL DEFAULT 0,
  can_edit INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
, invite_email TEXT, feed_token TEXT);

CREATE TABLE IF NOT EXISTS inbox_mail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  subject TEXT,
  size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
);

CREATE TABLE IF NOT EXISTS inbox_parts (
  mail_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (mail_id, seq)
);

CREATE TABLE IF NOT EXISTS digest_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  active INTEGER NOT NULL DEFAULT 1
, verified INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS inbox_seen (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT,
  mail_id INTEGER,
  seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  subject TEXT NOT NULL,
  text TEXT NOT NULL,
  html TEXT NOT NULL,
  sent_at TEXT,
  result TEXT
, to_addr TEXT);

CREATE TABLE IF NOT EXISTS proposal_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL,
  summary TEXT NOT NULL,
  checks TEXT,
  emailed_at TEXT
);

CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS acknowledged (
  day TEXT NOT NULL,
  msg TEXT NOT NULL,
  by_user TEXT,
  at TEXT,
  PRIMARY KEY (day, msg)
);

CREATE TABLE IF NOT EXISTS deleted_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch TEXT NOT NULL,
  event_id INTEGER NOT NULL,
  data TEXT NOT NULL,
  deleted_by TEXT,
  deleted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS health (
  key TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS vault_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  created_by TEXT, created_at TEXT,
  updated_by TEXT, updated_at TEXT
, expires_on TEXT, expiry_label TEXT);

CREATE TABLE IF NOT EXISTS places (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  short TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '🏠',
  kind TEXT NOT NULL DEFAULT 'home',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
, needs TEXT);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS events_dates ON events(start, end);

CREATE INDEX IF NOT EXISTS proposals_status ON proposals(status, batch_id);

CREATE INDEX IF NOT EXISTS deleted_events_batch ON deleted_events(batch);

-- "Family" = everyone ticked "Part of the family" (Setup > People)
INSERT OR IGNORE INTO people (name, color, type, active, sort, grid_column, family) VALUES ('Family', '#495057', 'group', 1, 99, 0, 0);
