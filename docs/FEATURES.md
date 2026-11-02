# ClinicPilot Features (single build reference)

Source: mockup `reference/clinicpilot-mockup.html` (outside this repo). Working app: this repo.

## 0. Current scope

- **Dropped:** SMS (no SMS provider; phase 3 removed).
- **Planned channels:** email (for reminders and win-back, after D3) and Facebook Messenger (after D5 and Meta App Review).
- **Built this round:** Postgres (Supabase) data layer, Gemini AI, AI automation pages (lists), weekly report on screen.

## 1. How to use this file

- Every task in the build must map to a row here. No work starts unless it has a row.
- Status legend:
  - **Built**: works in the app today
  - **Partial**: some of it works; the gap is in the notes
  - **Lists only**: the data and screen work, but nothing is sent
  - **Not built**: planned, not started
  - **Dropped**: removed from scope, with reason

## 2. Feature inventory by screen

### Shell and global
| Feature | Status | Notes |
|---|---|---|
| Sidebar with Main / AI Automations / Business groups | Built | |
| Mobile menu button | Built | |
| Branch selector | Not built | Phase 5 (D6) |
| "AI Assistant active" pill | Built | Shows "AI off" without `GEMINI_API_KEY` |
| Clinic avatar / initials | Built | |
| Staff login | Partial | One shared password; sessions in memory |

### Dashboard
| Feature | Status | Notes |
|---|---|---|
| KPI: appointments today | Built | |
| KPI: booked by AI (7 days, vs last week) | Built | |
| KPI: no-show rate (this month) | Built | Shows – until a visit is marked done or no-show |
| Today's schedule | Built | |
| AI activity feed (live) | Built | |
| Needs a human list with reason chips | Built | Reasons: Medical, Asked for staff, Unclear, Booking help |
| Due for treatment card (count) | Built | Links to Treatment Reminders |
| Celebrations card (count, 7 days) | Built | Links to Birthdays & Anniversaries |
| Connections panel (website / Facebook / email) | Built | Shows what's next; SMS removed |

### Calendar
| Feature | Status | Notes |
|---|---|---|
| Weekly grid, overlap layout, prev / today / next | Built | |
| "+ New appointment" (staff) | Built | |
| Appointment details: done, no-show, cancel | Built | |
| Colour by practitioner | Partial | Practitioners only; rooms and equipment not modelled |
| Held slot "awaiting confirmation" | Not built | Decision D2 |

### Conversations (inbox)
| Feature | Status | Notes |
|---|---|---|
| Thread list with channel badges and status tags | Partial | Website only |
| Filters: All / Needs human / Staff replying | Built | |
| Chat view: patient, AI, staff messages | Built | |
| Take over / resume AI | Built | |
| Client context panel | Built | |
| Facebook thread | Not built | Messenger, after D5 |
| System event lines | Not built | |

### Clients
| Feature | Status | Notes |
|---|---|---|
| Searchable table (case-insensitive) | Built | |
| Status chips (New / Active / Lapsed 90+) | Built | |
| Client drawer: visit timeline, book, open conversation | Built | |
| "+ Add client" and edit | Not built | Clients are created on booking today |
| Birthday and promo consent per client | Built | Set on the Birthdays page |
| Consent for reminders and offers (with opt-out log) | Partial | Single flag; no per-channel log or timestamps |

### AI Automations
| Feature | Status | Notes |
|---|---|---|
| Treatment Reminders: due list | Lists only | Reminder interval per service; excludes patients already booked |
| Treatment Reminders: sending | Not built | Needs email or Messenger |
| Win-back: lapsed patients list | Lists only | Days threshold in settings (default 90) |
| Win-back: offer builder and message preview | Not built | Needs email or Messenger |
| Care Instructions: aftercare text per treatment | Built | Stored per service |
| Care Instructions: sending aftercare | Not built | Needs email or Messenger |
| Birthdays & Anniversaries: 14-day list | Lists only | Anniversaries from first visit |
| Birthday messages with offers | Not built | Needs email or Messenger and consent |

### Weekly AI Report
| Feature | Status | Notes |
|---|---|---|
| KPIs for 7 or 30 days | Built | AI and staff bookings, visits, no-shows, new clients, chats, upcoming |
| Chats handed to staff, by reason | Built | |
| Questions the AI could not answer | Built | |
| Print / save as PDF | Built | |
| Email delivery | Not built | Needs email provider (D3) |
| "What the AI noticed" and suggested actions | Not built | Needs weeks of real data |

### Message Queue
| Feature | Status | Notes |
|---|---|---|
| Prepare messages for consented clients due now | Built | Creates queued messages only; re-running adds nothing new (one per client, type and cycle) |
| Editable templates (recall, win-back, birthday, anniversary) | Built | Placeholders: {first_name} {service} {clinic} {clinic_phone} {years} |
| Cancel a queued message | Built | |
| Send queued messages | Not built | Needs email or Messenger (D3, D5) |
| Unsubscribe link in each email | Not built | Needed before email sending |

### Consent
| Feature | Status | Notes |
|---|---|---|
| Marketing consent per client | Built | Set on the Birthdays page |
| Consent history (granted or withdrawn, when, by whom) | Partial | Rows are written on every change; history viewable by API, not yet on screen |
| Consent for service reminders | Partial | Same flag as marketing for now; split when the clinic decides the wording |

### Analytics
| Feature | Status | Notes |
|---|---|---|
| Bookings by source (AI website, Book button, staff) | Built | 7, 30, 90 days, or 1 year |
| Bookings and visits by week | Built | |
| No-show rate and visits done | Built | |
| Chats: linked to a patient, handed to staff, reasons | Built | "Linked" means the chat is tied to a patient record |
| Practitioner load and service mix | Built | |
| Patient repeat rate (2+ visits) | Built | Counts visits marked done |
| Revenue and payments | Not built | Needs decision D4 |
| Conversion from chat to booking, exact | Partial | Uses linked chats as the proxy |

### Branches
| Feature | Status | Notes |
|---|---|---|
| Branch cards, per-branch calendar and staff | Not built | Phase 5 (D6) |

## 3. Cross-cutting features

| Feature | Status | Notes |
|---|---|---|
| Channels: website | Built | |
| Channels: email | Not built | After D3 |
| Channels: Facebook Messenger | Not built | After D5 and App Review |
| Data layer: Supabase Postgres | Built | `src/db.js`, schema in `supabase/schema.sql` |
| Double-booking protection | Built | Database lock inside a transaction (`src/booking.js`) |
| Handoff: take over, resume, emergency pause | Built | Emergency words in `src/ai.js` |
| AI guardrails: no diagnosis, no invented prices or times | Built | Prompt rules in `src/ai.js` |
| Row-level security on all tables | Built | Public key can't read data |
| Audit log of staff actions | Not built | Needed for privacy compliance |
| Security: admin rate limit, HTTPS, cookie Secure flag | Not built | See `docs/handoff.md` |
| Admin sessions in the database | Not built | Needed for Vercel or several servers |

## 4. Mockup content

- Done: services are dermatology and aesthetics (consultation, facial, Hydrafacial, Botox, fillers, laser hair removal, chemical peel, thread lift). Durations, prices, and aftercare are placeholders for the clinic to confirm.
- Still to do: replace the mockup's fake figures (₱486k, 92% without staff, 3.8% no-show, 40.5% conversion) until real data exists.
- Mockup brand names are placeholders. Replace with the clinic's details in Settings (7a).

## 5. Build order

1. **Phase 1, Website.** Built, plus the settings screen and staff accounts still open.
   - Done when: a patient can book on the website and staff can run the day from the dashboard.
2. **Phase 2, Email.** Provider and domain (D3), consent checks, reminder and win-back sending.
   - Done when: a reminder is sent, a reply books, and the opt-out works.
3. **Phase 3, Facebook Messenger.** Webhook, Page connect, App Review (D5), 24-hour window UI.
   - Done when: a Messenger booking appears in the inbox and the calendar.
4. **Phase 4, AI automations sending.** Treatment reminders, then care instructions, birthdays, win-back, on top of phase 2.
   - Done when: each automation has consent checks and a log of what was sent.
5. **Phase 5, Business.** Staff accounts, audit log, security, branches (if sold), email delivery of the weekly report.
   - Done when: two staff accounts work with separate logins, and the report is emailed.

## 6. Decisions needed from the boss

- **D1. Pricing model:** one-time sale, clinic hosts. Confirm.
- **D2. Held slots:** does a booking start as "held" until the patient confirms, or is it instant?
- **D3. Email provider and sending domain:** which provider, and which domain the clinic owns.
- **D4. Payments:** track payment or deposits, or only bookings? This drives revenue numbers.
- **D5. Meta App Review:** who submits it, and who pays for the verification time.
- **D6. Multi-branch:** is it sold at launch, or later?

## 7. Out of scope for now

- Before and after photos
- Inline payment card, unless D4 says yes
- SMS (dropped)
- Native mobile apps
- Multi-language UI (the AI already replies in English, Tagalog, or Taglish)
