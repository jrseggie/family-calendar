-- 🛒 Lists: a line can be FOR one or more people (e.g. "Fix the door locks" on the DIY list, for Dad), with an optional due date.
-- for_ids = ",3,7," (logins on that list); assigned_by = who set it (they hear when it's done); due = YYYY-MM-DD (a calendar entry
-- "📌 …" on that day, tied to the line by events.source "🛒 List item #<id>"). All optional: most lines never use them.
ALTER TABLE list_items ADD COLUMN for_ids TEXT;
ALTER TABLE list_items ADD COLUMN assigned_by INTEGER;
ALTER TABLE list_items ADD COLUMN due TEXT;
