# What's new in Family Calendar

## 1.0.17
- 🖨️ Print for a co-parent: tap a "tracked" person (e.g. an ex-partner) in the filter row to see their children's calendars, then
  "Print for …" makes a clean schedule (Save as PDF) with only what they need: their own plans in full, school and exams, the
  children's own activities - everything else just says "Not available", and where anyone sleeps is never shown. On days the
  children are with them, the children's own entries show in full. Each line can be changed before printing.

## 1.0.16
- iPhone home-screen app: the title bar sits below the blurred clock / battery area, so it's easy to read.

## 1.0.15
- New installs: signing in lasts 6 months before the email code is asked again (was 30 days).

## 1.0.14
- Safer sign-in: changes are only accepted from the calendar's own pages, and new installs set the sign-in cookie so other websites can't use it.
- Holiday planner: other entries in the holiday (e.g. a school camp) are never renamed; they show as fixed rows.
- ⚠ sheet: ✅ / 🚫 on a requested stay updates that stay instead of adding a second one.
- Weekly email and monthly backup: if one address fails, only that one is tried again (nobody gets it twice).
- Smart inbox: an email it can't read is set aside after 3 tries instead of blocking the inbox.
- "Approve all": an item that can't be added stays waiting with the reason; the rest go in.
- Only children with a school (Setup → People) have school days – no "lifts!" warnings for toddlers.
- Backups restore cleanly (into the same calendar or a fresh install).
- Dates like "Last changed" show in your phone's / PC's own time zone.
- Smaller fixes: one ✅ on a confirmed stay, no "OK, noted" button for view-only logins, no ⚠ "two places" for a pencilled-in plan.
- 🌍 Country: the set-up wizard and Setup → This calendar ask for the country (guessed from your phone / PC). It sets the
  public holidays (~200 countries, with states / provinces where holidays differ) and the time zone the weekly email, backups,
  invites and the inbox use. Extra countries' holidays can be shown for information (they don't change school days).
- New app icon: a house with the calendar as its window, in the family's own colours (drawn when an admin opens Setup);
  the installed app is called by the calendar name (e.g. "Smith Calendar"), which fits under a desktop icon.
- Dark mode: weekends are shaded more clearly.
- Usage check-in: its own small card at the bottom of Setup; in the set-up wizard the "let the maker know" box starts ticked (untick it to stay anonymous).

## 1.0.13
- Changes → Recently deleted: names as outlined pills in each person's colour (like the filter row), easier to read.
- Changes tab: who made each change is shown in their own colour.

## 1.0.12
- 🗓 Plan the holiday: tap a child's 🌿 holiday (or a ❓ day) and set where they sleep as stretches – "Town House 27 Nov – 12 Dec,
  Beach House 13 Dec – 3 Jan …" – with a count of nights still not planned. "Same for <other child>" copies it to the days they're also on holiday.
- "Where are they staying?": "To" starts at the end of the days still not planned (not the same day).

## 1.0.11
- ✏️ Pencilled-in plans (tick "Pencilled in – might not happen"): ✏️ at the end and a dashed outline on the Month grid, "maybe" in lists
  and the weekly email. "✅ It's on" / "🗑 Not happening" on the entry; once confirmed it shows ✅ for 3 days (who and when are kept).
- Pencilled-in plans don't raise ⚠ – they give a lighter "❔ If … goes ahead: …" note instead (on the date, on Upcoming, in the email).
- Needs sorting nudges anything still pencilled in 2 weeks before it starts: on or not?
- Weekly email: "✅ Confirmed since last week" and "❔ If pencilled-in plans go ahead".
- The inbox reader pencils in dates marked TBC / provisional.

## 1.0.10
- Usage check-in: once a day the calendar tells the Family Calendar maker it's in use (a random number, the version, how many logins
  are used) – with the calendar's name only if you tick the box in the set-up wizard / choose "Yes" on Setup → This calendar. "Off" sends nothing.

## 1.0.9
- Change the order of people (= the columns on the Month grid) with ↑ ↓ – on Setup → People or in the set-up wizard (the Family group too).
- Set-up wizard: shorter role names (Child (boards), Helper, Visits the children) so they fit.

## 1.0.8
- 🌴 Leave: a new "Leave" category for helpers (au pair, gardener, domestic …). Leave shows greyed and striped on the Month grid,
  as an "On leave" line on Upcoming and in the weekly email. A helper on leave isn't offered for staying over / house-sitting,
  doesn't count as an adult at a house, and a stay booked during their leave gets a ⚠.
- "Staying with" / "house-sitting" buttons: pick the helper from a list (instead of a row of buttons per helper).

## 1.0.7
- Set-up wizard, run again: shows everyone already in the calendar with their role and school (change them there); keeps the calendar name, phone-icon name and house short names.

## 1.0.6
- Setup → Smart inbox: a clear green "● On" / grey "○ Off" label.

## 1.0.5
- Updates install themselves every night once the update job is added (older installs: replace the update job once – see Help).
- Setup says which GitHub account to sign in as; Help explains GitHub's "404" page (shown when you're not signed in).

## 1.0.4
- Setup → This calendar: a clean version line – "Update available" with one green "⬆️ Update to …" button (the first time it asks where your GitHub copy is, with a link to add the update job); the set-up wizard has its own small row.

## 1.0.3
- Weekly email: choose the day, time and time zone (Setup → Weekly email → 🕖 Change day & time), e.g. Monday 07:00.
- Setup → Weekly email: the badges no longer stretch.
- Help: what to do if an update doesn't show up.

## 1.0.2
- Opens on the Month view; the set-up and sign-in cards show there too, with bright green buttons.
- House icons are picked from a list (set-up wizard and Setup → Places).
- No inbox address is shown until the calendar has its own domain.
- Clear instructions when Cloudflare's Zero Trust still has to be switched on.
- Updates: fill in "Your GitHub copy" on Setup → This calendar, then "Add the update button" (first time) and "Update now".

## 1.0.1
- A new install now shows the setup-password box (it was hidden behind a "couldn't load" message).
- No more "preview URLs" warning when installing.

## 1.0.0 – first release
- Month grid with a column per person, Upcoming list, Birthdays, School holidays, Changes, phone-calendar feed.
- ⚠ Needs sorting: a child at a house with no adult, someone down for two places, a visit on a school day, a boarder's
  holiday not planned, a house that needs someone (e.g. for the dogs) – with one-tap "helper staying / house-sitting" buttons.
- Sunday "week ahead" email, calendar invites, repeats, undo, search.
- 🔒 Info page (encrypted): medical aid, vehicles, firearm licences … with expiry countdowns, "Renew soon" in the Sunday
  email and a calendar reminder a month before.
- 📥 Smart inbox (optional, your own Anthropic key): forward letters to inbox@ and approve the dates it finds.
- Backups: download any time, a copy emailed to the admins every month, plus Cloudflare's 30 days of restore points.
