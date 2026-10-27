-- 🏠 someone staying who isn't set up as a helper: their name, typed in (e.g. "Granny Chris"); counts as an adult at the house
-- once confirmed (rules.js whereOn), shown as "✅ Granny Chris" in the child's column
ALTER TABLE events ADD COLUMN guest TEXT;
