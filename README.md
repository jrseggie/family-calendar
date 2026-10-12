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
3. On Cloudflare's page: click **New GitHub connection** and allow it (if it then shows a "Select a repository" page instead,
   go back to this page and click the Deploy button again). Tick **Create private Git repository**, keep the suggested names,
   under **SETUP_CODE** choose a **setup password** (6+ characters – you'll need it once, in step 5), switch **Enable Preview
   builds** off, leave **Protect with Cloudflare Access** off (the calendar does that itself in step 5), and click **Deploy**.
4. Wait for "Success" (2–3 minutes), then open the address it shows (something like `https://family-calendar.yourname.workers.dev`).
5. Type your setup password. The calendar opens on **👋 Set up your calendar**: your family's name, everyone in it (parents,
   children, a child who boards, an au pair, …) and your houses. Then **🔐 Switch on sign-in**: it asks for a Cloudflare key
   (the page shows exactly how to make one) and switches on the email-code sign-in for your family.
   **Once, before that:** in the Cloudflare dashboard click **Zero Trust**, type any team name and choose the **Free** plan.
   Cloudflare asks for card details – the Free plan (up to 50 people) is not charged.
6. **Save the recovery key** it shows you (download or print). It unlocks the 🔒 Info page if the calendar ever has to be
   reinstalled.
7. Sign in with the code Cloudflare emails you. On **⚙ Setup → This calendar → Edit**, fill in **Your GitHub copy** (the address
   of the copy Cloudflare made, e.g. `github.com/yourname/family-calendar`) – Setup then has the links you need for updates.

That's it. Add the rest of the family's logins on the ⚙ Setup tab.
Everything else is optional – see [docs/HELP.md](docs/HELP.md): adding your own web address and the emails, the smart inbox,
backups, updates.

## Updates

Once set up, new versions **install themselves overnight**. Set-up (once): **⚙ Setup → This calendar → Edit → Your GitHub copy**,
then the link under it, **add the update job** – GitHub opens (sign in if it shows "404") – click **Commit changes**.
(Cloudflare's install doesn't copy the update job over, so this one step is by hand.)
Can't wait for the night? When Setup says a new version is out, the green **⬆️ Update** button opens GitHub: click **Run workflow**.
Your calendar and settings are kept; changes you made to the code yourself are replaced by the new version.

## What's new

See [CHANGELOG.md](CHANGELOG.md).
