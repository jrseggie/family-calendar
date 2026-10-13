-- Smart inbox: count tries per email and note when a run picked it up, so one email it can't read is set aside after
-- 3 tries (status 'failed') instead of blocking the inbox, and two runs never read the same email. Additive.
ALTER TABLE inbox_mail ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inbox_mail ADD COLUMN claimed_at TEXT;
