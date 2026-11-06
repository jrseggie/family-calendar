-- Logins: first name and surname kept apart (Settings > logins). users.name = the first name, which is what the site shows everywhere;
-- the surname is only for telling logins apart on Settings. Existing "First Surname" names are split, and list items they added / completed
-- follow.
ALTER TABLE users ADD COLUMN surname TEXT;
UPDATE users SET surname = trim(substr(name, instr(name, ' ') + 1)), name = trim(substr(name, 1, instr(name, ' ') - 1)) WHERE instr(trim(name), ' ') > 0 AND surname IS NULL;
UPDATE list_items SET added_by = (SELECT u.name FROM users u WHERE u.surname IS NOT NULL AND u.name || ' ' || u.surname = list_items.added_by)
  WHERE added_by IN (SELECT name || ' ' || surname FROM users WHERE surname IS NOT NULL);
UPDATE list_items SET done_by = (SELECT u.name FROM users u WHERE u.surname IS NOT NULL AND u.name || ' ' || u.surname = list_items.done_by)
  WHERE done_by IN (SELECT name || ' ' || surname FROM users WHERE surname IS NOT NULL);
