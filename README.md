# Clinic App (website version)

Dermatology and aesthetics clinic website: chat with AI booking, a staff inbox, a weekly calendar, a client list, and AI automations (recall reminders, win-back, birthdays, aftercare, weekly report).
Facebook Page and email sending are **not** connected yet.

## Setup

Requires Node.js 20 or newer and a Supabase project (Postgres).

1. Create the database tables and sample data: open the Supabase SQL Editor and run `supabase/schema.sql`. (The app also creates them automatically on first start if the tables are missing.)
2. Create `.env` in this folder (it is git-ignored):

```
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@<pooler-host>:6543/postgres
GEMINI_API_KEY=your-gemini-key        (optional; without it the chat only answers basic questions)
GEMINI_MODEL=gemini-3.5-flash         (optional)
ADMIN_PASSWORD=choose-a-password
```

Use the **Transaction pooler** string from Supabase → Connect. Replace the password placeholder with the real database password.

3. Install and run:

```
cd clinic-app
npm install
npm start
```

- Website: http://localhost:3000
- Admin: http://localhost:3000/admin

## Tests

```
npm test
```

The tests create a throwaway schema on the database, run there, and drop it. They use the session pooler (port 5432), so the same host with port 5432 is used for tests. Set `TEST_DATABASE_URL` to override.

## What works

- Public site with services and prices, and a chat widget
- AI answers and books through two tools (availability and booking). Booking needs `GEMINI_API_KEY`
- Double-booking is blocked by a database lock inside a transaction
- Staff inbox: see all chats, reply as staff (pauses the AI), resume the AI
- Emergency words (bleeding, swelling, etc.) pause the AI and flag the chat for staff
- Calendar by week, cancel a booking, create a booking manually
- Client list with visit history
- AI automation lists: treatment recall, win-back, birthdays and anniversaries, aftercare text, and the weekly report (all on screen; sending is not connected yet)

## Before going live (not done yet)

- Replace the single admin password with real user accounts
- Store admin sessions in the database (they are in memory now, so they don't survive restarts or multiple servers)
- Add rate limiting on the public chat endpoint
- Set a strong `ADMIN_PASSWORD`, serve the site over HTTPS, and add the `Secure` flag to the admin cookie
- Review the AI prompt and emergency wording with the clinic and a licensed dermatologist
- Privacy policy and consent text on the website
- Email sending (planned, via a provider such as Resend) and Facebook Messenger (needs Meta App Review)
- Vercel entry point (the app runs as a long-lived Node server today)
