# Handoff: Clinic App (ClinicPilot)

Read sections 1, 3, and 6 first. Section 7 lists what is still missing.

## 1. What this project is

A dermatology and aesthetics clinic website with an AI chat that answers questions and books appointments, plus a staff dashboard (inbox, calendar, clients, AI automations, weekly report). It is built to hand over to clinics as a one-time sale, where each clinic hosts its own copy.

Channels:
- **Website chat:** built and working.
- **Email:** planned. Needs a provider (for example Resend) and a sending domain.
- **Facebook Messenger:** planned. Needs Meta App Review and follows Messenger's 24-hour messaging rules.
- **SMS:** dropped.

## 2. Stack

| Part | Choice |
|---|---|
| Server | Node.js 20+, no framework, built-in `http` |
| Database | Supabase (hosted Postgres), accessed with the `pg` driver |
| AI | Google Gemini (`GEMINI_MODEL`, default `gemini-3.5-flash`) with function calling |
| Front end | Plain HTML, CSS, and JavaScript in `public/` |
| Tests | Node's built-in test runner (`npm test`) |

## 3. Where things are

| Path | What it is |
|---|---|
| `src/server.js` | HTTP server, all `/api/*` routes, admin login |
| `src/db.js` | Postgres connection, query helpers, transactions, schema check, settings |
| `src/booking.js` | Availability, booking rules, double-booking lock |
| `src/chat.js` | Conversations, messages, handoffs, chat-to-booking |
| `src/ai.js` | Gemini calls, tools (check availability, book), system prompt, fallback replies |
| `src/automations.js` | Recall due list, win-back list, birthdays and anniversaries, weekly report |
| `src/knowledge.js` | Reads `knowledge/faq.json` (keyword fallback answers) |
| `supabase/schema.sql` | Tables, row-level security, and sample data. Safe to run again |
| `public/index.html` | Public website with services, FAQ, and chat widget |
| `public/admin.html` | Staff dashboard |
| `test/booking.test.js` | 15 tests, run in a throwaway database schema |
| `docs/FEATURES.md` | Feature list, status, and build order |

## 4. How to run

1. In Supabase, run `supabase/schema.sql` in the SQL Editor (or let the app create the tables on first start).
2. Create `clinic-app/.env` (git-ignored):

```
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@<pooler-host>:6543/postgres
GEMINI_API_KEY=your-key       (optional; without it the chat runs in fallback mode)
ADMIN_PASSWORD=choose-a-password
```

Use the Transaction pooler string from Supabase → Connect.

3. `npm install`, then `npm start`.
   - Website: http://localhost:3000
   - Staff dashboard: http://localhost:3000/admin
4. `npm test` runs the 15 tests in a temporary schema. The tests use the session pooler (port 5432) so they stay in that schema.

Without `GEMINI_API_KEY`, the chat answers basic questions (prices, hours, address, services) and flags everything else for staff. It cannot book.

## 5. What is built and working

**Website (public)**
- Services and prices from the database
- Chat widget with a secret token per visitor, so one visitor can't read another's chat
- Booking through the chat's Book button, with the same rules as staff bookings

**AI (`ai.js`, `chat.js`)**
- Gemini with two tools: `check_availability` and `book_appointment`
- Clinic info and rules go into the system prompt. No diagnoses, no invented prices or times
- Emergency words (English and Tagalog) pause the AI and flag "Medical"
- Requests for a person pause the AI and flag "Asked for staff"
- Unclear messages or API errors flag "Unclear" and keep the AI running

**Booking (`booking.js`)**
- Open hours, open days, slot length, and a 60-minute lead time, all from settings
- A service must finish before closing time
- A database lock inside a transaction stops two bookings taking the same slot (returns 409 on the admin API)
- Phone numbers checked (10 to 11 digits, `+63` converted)
- Patients matched by phone number

**Staff dashboard (`admin.html`)**
- Login with one shared password (cookie session, 12 hours, in memory)
- Dashboard KPIs, today's schedule, live activity, "Needs a human" list, connections panel, and counts for due-for-treatment and celebrations
- Calendar: week view, new appointment, mark done / no-show / cancel
- Conversations: filters, chat view, take over, resume AI, staff reply
- Clients: search, status chips, client drawer with visit timeline
- **AI automations (lists only, sending not connected):**
  - Treatment Reminders: patients due for a recall visit, with a reminder interval per service
  - Win-back: patients not seen in N days (default 90) with nothing booked, with a setting for N
  - Care Instructions: aftercare text per treatment
  - Birthdays & Anniversaries: next 14 days, and birthday and consent entry per client
  - Weekly AI Report: 7 or 30 days of bookings, visits, no-shows, new clients, chats, handoffs, and questions the AI couldn't answer. Print-friendly, not emailed
- **Message Queue:** "Prepare messages" queues recall, win-back, birthday, and anniversary messages for consented clients. Templates are editable. Nothing is sent yet.
- **Analytics:** bookings by source and week, visits and no-shows, chat outcomes and handoff reasons, practitioner and service load, and patient repeat rate. Periods of 7, 30, 90, or 365 days.
- Branches page is still a placeholder

**Database (`supabase/schema.sql`)**
- Tables: services, dentists, clients, appointments, conversations, messages, settings
- Row-level security on every table. The public key can't read data; the server's service key bypasses it
- Sample data: eight dermatology and aesthetics services (consultation, facial, Hydrafacial, Botox, fillers, laser hair removal, chemical peel, thread lift), two practitioners, clinic settings, three clients
- Service descriptions are shown when a patient taps a service in the chat (edit them on the Care Instructions page)
- Existing databases: run `supabase/migrations/001_derma.sql` once to hide the old dental services

Appointment statuses: booked, done, no_show, cancelled.

## 6. Decisions and open questions

- **D1 Pricing model:** one-time sale, clinic hosts. Confirm.
- **D2 Held slots:** bookings are instant today. Should they start as "held" until the patient confirms?
- **D3 Email provider:** Resend (suggested) or another. Needs a sending domain the clinic owns.
- **D4 Payments:** track payments and deposits, or bookings only? Drives revenue numbers.
- **D5 Meta App Review:** who submits it, and who pays for verification time.
- **D6 Multi-branch:** part of the launch, or later?

## 7. What is still missing

### 7a. Must have before a clinic uses it
- **Settings screen** in the dashboard for clinic name, address, phone, hours, open days, services, prices, dentists, and AI instructions. Today these change only in the database.
- **Real staff accounts** with roles (owner, receptionist, practitioner). One shared password today.
- **Persistent admin sessions.** Sessions are in memory, so restarts log everyone out, and they won't work across several server instances (for example on Vercel).
- **Security basics:** HTTPS, `Secure` cookie flag, rate limiting on chat and login, input size checks on every route.
- **Deployment:** a Vercel (or other host) entry point, environment variables set on the host, and a backup plan (Supabase backups on the paid tier).
- **Privacy basics (Data Privacy Act, RA 10173):** privacy policy, terms, consent wording in the chat, a data processing agreement with the clinic, and a way to handle deletion requests.
- **Medical review:** the emergency keyword list and the AI's rules, reviewed by a licensed dermatologist.
- **Real AI test:** several booking scenarios with the real Gemini key.
- **Browser check** of every admin page, including the automation pages and mobile widths.

### 7b. Needed for a good first launch
- Email sending for reminders and win-back (after D3), with consent checks
- Facebook Messenger channel for chat replies (after D5)
- Edit and add clients; reschedule appointments
- Patient confirmation after booking, sent outside the chat
- Consent tracking per client and channel, with an opt-out
- Held slots (D2)
- Staff alerts when a chat needs a human (sound or email)
- Clinic timezone setting (hard-coded to Asia/Manila in `booking.js`)
- Public site restyle to match the mockup
- Cancel and change bookings through the AI

### 7c. Later
- Payments and deposits (D4)
- Branches (D6)
- Audit log of staff actions
- CSV export of clients and appointments
- Error logging and monitoring
- Automated browser tests

### 7d. Business and paperwork
- License terms for the one-time sale
- Who submits Meta App Review and who pays (D5)
- Email provider account and sending domain (D3)
- Clinic setup and staff training guide
- Pricing and support plan (D1)

## 8. Known gaps and cautions

- **Login:** one shared password. Change it before any use outside your machine.
- **Admin sessions:** in memory only.
- **Automations:** lists work, but nothing is sent yet.
- **Weekly report:** on screen only, not emailed.
- **Medical content:** the emergency list is short.
- **Privacy:** patient data is health-related. Get the paperwork in 7a in place first.
- **Secrets:** the database password, service key, and Gemini key were pasted into a chat log during setup. Rotate them.

## 9. Next steps (in order)

1. Rotate the database password, service key, and Gemini key. Put the new values in `.env` only.
2. Browser-check the admin pages, including the automation pages.
3. Build the settings screen (7a).
4. Move admin sessions into the database, then add the Vercel entry point.
5. Add staff accounts and the security items.
6. Confirm D3 (email provider), then build email sending with consent checks.
7. Real AI booking runs with the Gemini key; fix what breaks.

## 10. How to continue in a new session

Start by reading `docs/handoff.md` and `docs/FEATURES.md`. Work from the phase and the rows in `FEATURES.md`. Each change should map to one row there.
