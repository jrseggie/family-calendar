-- 👋 how the welcome went: 'calendar' (the site emailed it) | 'email' (from the admin's own email) | 'whatsapp'
ALTER TABLE users ADD COLUMN welcome_via TEXT;
