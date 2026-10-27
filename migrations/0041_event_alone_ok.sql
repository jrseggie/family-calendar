-- 🏡 "Nobody – <child>'s OK alone": a child left at home on purpose (no adult) - the "no adult there" ⚠ goes for those days
-- (a school day without a lift booked still gets a gentle reminder); shown as "🏡 Alone (OK)" in the child's column
ALTER TABLE events ADD COLUMN alone_ok INTEGER NOT NULL DEFAULT 0;
