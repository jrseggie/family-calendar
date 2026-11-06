-- 😴 Snooze on a reminder (the card a tapped reminder opens): it comes back at snooze_until, and a must-be-done entry stops
-- nagging until then.
ALTER TABLE events ADD COLUMN snooze_until TEXT;
