-- 🛒 Lists: items can be put in order (sort) and in an optional department (category) - e.g. Fruit & veg, Pantry
ALTER TABLE list_items ADD COLUMN sort REAL;
ALTER TABLE list_items ADD COLUMN category TEXT;
