// Analytics for the admin Analytics page. Numbers come straight from the database.
// "Booked" counts appointments by when they were made. "Visits" counts them by appointment date.
const { clinicNow } = require('./booking');
const { addDays, outboxCounts } = require('./automations');

const DAY = 86400000;

// Monday of the week containing this YYYY-MM-DD date
function weekOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

async function analytics(db, days = 90) {
  const today = clinicNow().date;
  const from = addDays(today, -(days - 1));
  const fromIso = new Date(Date.now() - days * DAY).toISOString();
  const fromTs = `${from} 00:00`;
  const toTs = `${today} 23:59`;

  const bookings = await db.all('SELECT source, status, created_at FROM appointments WHERE created_at >= ?', [fromIso]);
  const visits = await db.all(
    `SELECT status, starts_at FROM appointments WHERE starts_at >= ? AND starts_at <= ? AND status IN ('done', 'no_show')`,
    [fromTs, toTs]
  );
  const chats = await db.all('SELECT client_id, handoff_reason FROM conversations WHERE created_at >= ?', [fromIso]);
  const dentists = await db.all(
    `SELECT d.name, COUNT(*) AS n FROM appointments a JOIN dentists d ON d.id = a.dentist_id
     WHERE a.starts_at >= ? AND a.starts_at <= ? AND a.status != 'cancelled' GROUP BY d.name ORDER BY n DESC`,
    [fromTs, toTs]
  );
  const services = await db.all(
    `SELECT s.name, COUNT(*) AS n FROM appointments a JOIN services s ON s.id = a.service_id
     WHERE a.starts_at >= ? AND a.starts_at <= ? AND a.status != 'cancelled' GROUP BY s.name ORDER BY n DESC`,
    [fromTs, toTs]
  );
  const patientVisits = await db.all(`SELECT client_id, COUNT(*) AS n FROM appointments WHERE status = 'done' GROUP BY client_id`);

  // Bookings by source. 'website' = booked by the AI, 'chat' = Book button, 'staff' = made by staff.
  const active = bookings.filter((b) => b.status !== 'cancelled');
  const bySource = { website: 0, chat: 0, staff: 0 };
  for (const b of active) bySource[b.source === 'staff' ? 'staff' : b.source === 'chat' ? 'chat' : 'website']++;

  const visitsDone = visits.filter((v) => v.status === 'done').length;
  const visitsNoShow = visits.length - visitsDone;

  // Week-by-week: bookings made that week, and visits on appointments that week
  const weeks = {};
  const week = (w) => (weeks[w] ||= { week: w, website: 0, chat: 0, staff: 0, done: 0, noShow: 0 });
  for (const b of active) {
    const key = b.source === 'staff' ? 'staff' : b.source === 'chat' ? 'chat' : 'website';
    week(weekOf(b.created_at.slice(0, 10)))[key]++;
  }
  for (const v of visits) {
    const w = week(weekOf(v.starts_at.slice(0, 10)));
    if (v.status === 'done') w.done++;
    else w.noShow++;
  }

  // Chats: how many led to a booking (linked to a patient), and how many were handed to staff
  const reasons = {};
  for (const c of chats) if (c.handoff_reason) reasons[c.handoff_reason] = (reasons[c.handoff_reason] || 0) + 1;
  const linked = chats.filter((c) => c.client_id).length;
  const handoffs = chats.filter((c) => c.handoff_reason).length;

  const repeat = patientVisits.filter((p) => p.n >= 2).length;

  return {
    from,
    to: today,
    days,
    bookings: { total: active.length, ...bySource },
    visits: { done: visitsDone, noShow: visitsNoShow, noShowRate: pct(visitsNoShow, visits.length) },
    weekly: Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week)),
    chats: { total: chats.length, linked, linkRate: pct(linked, chats.length), handoffs, handoffRate: pct(handoffs, chats.length), reasons },
    dentists,
    services,
    retention: { patients: patientVisits.length, repeat, rate: pct(repeat, patientVisits.length) },
    messages: await outboxCounts(db),
  };
}

module.exports = { analytics, weekOf };
