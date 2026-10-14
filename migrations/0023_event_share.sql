-- 🖨️ the printout for a "tracked" person (e.g. a co-parent or their lawyer): per entry show (the title) | busy ("Not available")
-- | hide (left off); NULL = automatic (public/rules.js shareMode). Additive: the running code works without it.
ALTER TABLE events ADD COLUMN share TEXT;
