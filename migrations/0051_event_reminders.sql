-- 🔔 calendar reminders on the phone (lib/reminders.js): an entry can ask for one - events.remind = 'at' (at the start time),
-- '15' / '60' (minutes before) or 'eve' (the evening before, 18:00). It goes to the logins of the people in Who (Family = all of
-- them) who turned notifications on. event_reminders = what was sent, so nobody gets the same reminder twice.
ALTER TABLE events ADD COLUMN remind TEXT;
CREATE TABLE IF NOT EXISTS event_reminders (
  event_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  fire_at TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id, fire_at)
);
