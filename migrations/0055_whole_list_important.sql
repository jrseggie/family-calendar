-- ⭐ a whole list can be marked important: its row on the Lists page shows yellow with a ⭐ (the same as an important item), for everyone on it.
ALTER TABLE lists ADD COLUMN important INTEGER NOT NULL DEFAULT 0;
