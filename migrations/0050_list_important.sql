-- 🛒 Lists: ⭐ Important on a line (✎ box) - shown with a star and the calendar's important yellow. Anyone on the list can set it;
-- a child setting it tells the parents on that list, like a child adding.
ALTER TABLE list_items ADD COLUMN important INTEGER NOT NULL DEFAULT 0;
