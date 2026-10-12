# Family Calendar – help

There's no support, so this page tries to answer the usual questions. Everything here is done by an admin, on the ⚙ Setup tab
unless it says otherwise.

## People, houses and who's where
- **Setup → People**: everyone in the calendar. *Child* = needs an adult at home; *Boards at school*; *Usually sleeps at*.
  Types: **Household** (lives there, own column), **Helper** (au pair / nanny – counts as the adult when an entry says they're
  staying), **Tracked** (someone outside the house whose plans with the children you follow – a plan on a school day gets a ⚠),
  **Group** (Family).
- **Setup → Places**: your houses (rename them, add a holiday house), school, friend's, away. Fill in *Someone needs to sleep here
  because of…* (e.g. the dogs) and you get a ⚠ when nobody is due there – with "house-sitting" and "not required" buttons.
- The **⚠** on a date means something needs sorting. Tap it to see what, and to fix it in one tap.

## Logins
Add each person on **Setup → Who can sign in** with their email address. They sign in with a code Cloudflare emails them.
The calendar adds them to Cloudflare's sign-in list by itself. *Limited* logins only see the people you pick (e.g. a grandparent).

## Your own web address and the emails
The Sunday "week ahead" email, calendar invites and the inbox need a web address (domain) of your own:
1. In Cloudflare: **Domain Registration → Register Domains** and buy one (e.g. `smithfamily.co.za`).
2. **Workers & Pages → your calendar → Settings → Domains & Routes → Add → Custom domain** → type your domain.
3. **Your domain → Email → Email Routing** → turn it on. Under **Routing rules**, add `inbox@yourdomain` → *Send to a Worker* →
   your calendar.
4. On the calendar: **Setup → This calendar → Web address** = `https://yourdomain`. The calendar adds the new address to its
   sign-in by itself; tell the family to use the new address from now on.
5. **Setup → Weekly email**: add the addresses. Each one gets an email from Cloudflare – click the link in it once.

## Smart inbox (optional)
Forward school letters and invitations to `inbox@yourdomain`; Claude reads them and the dates appear under **Upcoming → Waiting
for approval**. Nothing is added until you approve it. **Setup → 📥 Smart inbox** explains how to get an Anthropic API key
(pay-as-you-go, roughly R1–2 per email – set a monthly spend limit).

## Backups
- Cloudflare keeps 30 days of restore points by itself.
- On the 1st of every month the admins get a full backup by email (if emails are set up).
- **Setup → 🗄️ Backups → Download a backup** any time.
- To restore a backup into an empty calendar: `npx wrangler d1 execute <database> --remote --file calendar-backup-….sql`
  (or ask someone technical to).

## The recovery key
The 🔒 Info page is locked with a key that only exists in your Cloudflare account – and in the recovery copy you saved when
switching on sign-in. If you ever reinstall, put it back as the Worker secret `VAULT_KEY` before opening the Info page.

## Updates
**Setup → This calendar** shows when a new version is out. Fill in **Your GitHub copy** there once (Edit). Then:
**Add the update button** (first time only – click *Commit changes* on the GitHub page it opens) and **Update now** →
*Run workflow*. Cloudflare rebuilds the calendar a minute later.

## Sign-in says Zero Trust isn't switched on
Cloudflare's free sign-in service has to be switched on once by hand: dashboard → **Zero Trust** → any team name → **Free**
plan. It asks for card details; the Free plan (up to 50 people) isn't charged. Then click **Switch on sign-in** again.

## Something's wrong
- **Updated, but Setup still shows the old version** (after 5 minutes): Cloudflare sometimes skips a build when two changes
  arrive close together. On GitHub open your copy, edit `CHANGELOG.md`, add an empty line at the end and commit – Cloudflare
  then builds the latest version.
- **"The calendar's background jobs haven't run"** on Upcoming: after an update Cloudflare can take up to ~30 minutes to restart
  the scheduled jobs. If it lasts longer, run the update again.
- **No emails arrive**: check the address is ticked as confirmed on **Setup → Weekly email**, and that Email Routing is on.
- **Can't sign in**: make sure your email is on **Setup → Who can sign in** (another admin can add it).
