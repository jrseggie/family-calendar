-- 📌 a job on a list (for someone, with a due date) can also have a time and a reminder: its calendar entry gets them, so the phone
-- reminder (lib/reminders.js) goes to whoever it's for. Ticking ✅ Done on that reminder ticks the line off on its list too.
ALTER TABLE list_items ADD COLUMN due_time TEXT;
ALTER TABLE list_items ADD COLUMN remind TEXT;
