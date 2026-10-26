-- A limited login with "can add / edit" may be kept to only some of the people it sees (e.g. a helper: sees the child, edits only her own entries)
-- NULL = everyone it sees (as before)
ALTER TABLE users ADD COLUMN edit_who TEXT;
