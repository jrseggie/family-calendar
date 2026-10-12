# Family Calendar

A private calendar website for one family: who's where each night, school holidays, birthdays, a Sunday "week ahead"
email, warnings when a child would be home alone, and a locked page for medical aid, car licences and other family details.
Each family runs its own copy in its own free Cloudflare account – nobody else can see your calendar.

> Free to use and change for families (non-commercial licence, see LICENSE.md). It comes **as-is, without support**.

## What you need

- A **Cloudflare** account – free: <https://dash.cloudflare.com/sign-up>
- A **GitHub** account – free: <https://github.com/signup> (Cloudflare keeps your copy of the calendar there; you won't need to use it)
- About 15 minutes
- Optional: your own web address (about R200 a year, bought inside Cloudflare) – needed only for the emails
- Optional: an Anthropic API key (pay-as-you-go) – only for the "smart inbox" that reads forwarded school letters

## Install

1. Sign in to Cloudflare and GitHub in the same browser.
2. Click: [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jrseggie/family-calendar)
3. On Cloudflare's page: connect your GitHub account when asked, keep the suggested names (or type your own), and under
   **SETUP_CODE** choose a **setup password** (6+ characters – you'll need it once, in step 5). Click **Create and deploy**.
4. Wait for "Success" (2–3 minutes), then open the address it shows (something like `https://family-calendar.yourname.workers.dev`).
5. Type your setup password. The calendar opens on **👋 Set up your calendar**: your family's name, everyone in it (parents,
   children, a child who boards, an au pair, …) and your houses. Then **🔐 Switch on sign-in**: it asks for a Cloudflare key
   (the page shows exactly how to make one) and switches on the email-code sign-in for your family.
6. **Save the recovery key** it shows you (download or print). It unlocks the 🔒 Info page if the calendar ever has to be
   reinstalled.

That's it. Sign in with the code Cloudflare emails you, and add the rest of the family's logins on the ⚙ Setup tab.
Everything else is optional – see [docs/HELP.md](docs/HELP.md): adding your own web address and the emails, the smart inbox,
backups, updates.

## Updates

When a new version comes out, the ⚙ Setup tab says so. To update: open your copy on GitHub → **Actions** →
**Update Family Calendar** → **Run workflow**. Your calendar and settings are kept; changes you made to the code yourself are
replaced by the new version.

## What's new

See [CHANGELOG.md](CHANGELOG.md).
