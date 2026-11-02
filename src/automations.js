// Lists and numbers behind the AI automation pages and the weekly report.
// Nothing here sends messages. Sending needs a channel (email or Messenger) and consent.
const { clinicNow } = require('./booking');
const { getSettings } = require('./db');

const DAY = 86400000;

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonths(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / DAY);
}

// Patients whose recall interval for a service has passed and who have no booking for it ahead.
async function dueForRecall(db) {
  const { date: today, time } = clinicNow();
  const now = `${today} ${time}`;
  const rows = await db.all(
    `SELECT c.id AS client_id, c.full_name, c.phone, c.email, c.promo_consent,
            s.id AS service_id, s.name AS service_name, s.recall_months,
            MAX(a.starts_at) AS last_visit
     FROM appointments a
     JOIN clients c ON c.id = a.client_id
     JOIN services s ON s.id = a.service_id
     WHERE s.recall_months IS NOT NULL AND s.active = 1
       AND a.status IN ('booked', 'done') AND a.starts_at < ?
     GROUP BY c.id, s.id`,
    [now]
  );

  const due = [];
  for (const r of rows) {
    const dueDate = addMonths(r.last_visit.slice(0, 10), r.recall_months);
    if (dueDate > today) continue;
    const upcoming = await db.one(
      `SELECT 1 AS x FROM appointments WHERE client_id = ? AND service_id = ? AND status = 'booked' AND starts_at >= ? LIMIT 1`,
      [r.client_id, r.service_id, now]
    );
    if (upcoming) continue;
    due.push({
      clientId: r.client_id,
      name: r.full_name,
      phone: r.phone,
      email: r.email,
      service: r.service_name,
      lastVisit: r.last_visit.slice(0, 10),
      dueDate,
      overdueDays: daysBetween(dueDate, today),
      promoConsent: Boolean(r.promo_consent),
    });
  }
  return due.sort((a, b) => b.overdueDays - a.overdueDays);
}

// Patients who have visited before, have nothing booked, and have not been in for N days.
async function lapsedClients(db, days) {
  const { date: today, time } = clinicNow();
  const now = `${today} ${time}`;
  const cutoff = addDays(today, -days);
  const rows = await db.all(
    `SELECT c.id, c.full_name, c.phone, c.email, c.promo_consent,
            (SELECT MAX(starts_at) FROM appointments a WHERE a.client_id = c.id AND a.status IN ('booked', 'done') AND a.starts_at < ?) AS last_visit,
            (SELECT COUNT(*) FROM appointments a WHERE a.client_id = c.id AND a.status = 'booked' AND a.starts_at >= ?) AS upcoming
     FROM clients c
     WHERE c.id IN (SELECT client_id FROM appointments WHERE status IN ('booked', 'done'))`,
    [now, now]
  );

  return rows
    .filter((r) => r.last_visit && r.last_visit.slice(0, 10) < cutoff && r.upcoming === 0)
    .map((r) => ({
      clientId: r.id,
      name: r.full_name,
      phone: r.phone,
      email: r.email,
      lastVisit: r.last_visit.slice(0, 10),
      daysAway: daysBetween(r.last_visit.slice(0, 10), today),
      promoConsent: Boolean(r.promo_consent),
    }))
    .sort((a, b) => b.daysAway - a.daysAway);
}

// Birthdays and first-visit anniversaries within the next `withinDays` days.
async function upcomingCelebrations(db, withinDays = 14) {
  const today = clinicNow().date;
  const year = Number(today.slice(0, 4));
  const clients = await db.all(
    `SELECT c.id, c.full_name, c.birthday, c.email, c.promo_consent,
            (SELECT MIN(starts_at) FROM appointments a WHERE a.client_id = c.id AND a.status != 'cancelled') AS first_visit
     FROM clients c`
  );

  // Next occurrence of a month-day, on or after today
  const nextOccurrence = (ymd) => {
    const md = ymd.slice(5);
    let next = `${year}-${md}`;
    if (next < today) next = `${year + 1}-${md}`;
    return next;
  };

  const out = [];
  for (const c of clients) {
    const promoConsent = Boolean(c.promo_consent);
    if (c.birthday) {
      const when = nextOccurrence(String(c.birthday).slice(0, 10));
      const days = daysBetween(today, when);
      if (days <= withinDays) {
        out.push({ type: 'birthday', clientId: c.id, name: c.full_name, email: c.email, date: when, daysAway: days, promoConsent });
      }
    }
    if (c.first_visit) {
      const firstDate = c.first_visit.slice(0, 10);
      const when = nextOccurrence(firstDate);
      const days = daysBetween(today, when);
      const years = Number(when.slice(0, 4)) - Number(firstDate.slice(0, 4));
      if (years >= 1 && days <= withinDays) {
        out.push({ type: 'anniversary', clientId: c.id, name: c.full_name, email: c.email, date: when, daysAway: days, years, promoConsent });
      }
    }
  }
  return out.sort((a, b) => a.daysAway - b.daysAway);
}

// Weekly summary for the last `days` days (clinic time). Counts come straight from the database.
async function weeklyReport(db, days = 7) {
  const today = clinicNow().date;
  const from = addDays(today, -(days - 1));
  const fromIso = new Date(Date.now() - days * DAY).toISOString();

  const aiBooked = (await db.one(
    `SELECT COUNT(*) AS n FROM appointments WHERE source != 'staff' AND status != 'cancelled' AND created_at >= ?`, [fromIso]
  )).n;
  const staffBooked = (await db.one(
    `SELECT COUNT(*) AS n FROM appointments WHERE source = 'staff' AND status != 'cancelled' AND created_at >= ?`, [fromIso]
  )).n;
  const newClients = (await db.one('SELECT COUNT(*) AS n FROM clients WHERE created_at >= ?', [fromIso])).n;
  const chats = (await db.one('SELECT COUNT(*) AS n FROM conversations WHERE created_at >= ?', [fromIso])).n;
  const visits = await db.one(
    `SELECT SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) AS no_show
     FROM appointments WHERE starts_at >= ? AND starts_at <= ?`,
    [`${from} 00:00`, `${today} 23:59`]
  );
  const upcoming = (await db.one(
    `SELECT COUNT(*) AS n FROM appointments WHERE status = 'booked' AND starts_at >= ? AND starts_at <= ?`,
    [`${today} 00:00`, `${addDays(today, 7)} 23:59`]
  )).n;

  const handoffs = await db.all(
    `SELECT handoff_reason AS reason, COUNT(*) AS n FROM conversations
     WHERE created_at >= ? AND handoff_reason != '' GROUP BY handoff_reason`,
    [fromIso]
  );

  // Patient messages from chats the AI could not answer
  const unanswered = await db.all(
    `SELECT m.text, m.created_at FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.sender = 'patient' AND c.handoff_reason = 'unclear' AND m.created_at >= ?
     ORDER BY m.id DESC LIMIT 15`,
    [fromIso]
  );

  const settings = await getSettings(db);
  return {
    from,
    to: today,
    days,
    aiBooked,
    staffBooked,
    newClients,
    chats,
    done: Number(visits.done) || 0,
    noShows: Number(visits.no_show) || 0,
    upcoming,
    handoffs,
    unanswered,
    winbackCount: (await lapsedClients(db, settings.winbackDays)).length,
  };
}

async function getTemplates(db) {
  const rows = await db.all('SELECT kind, body FROM message_templates');
  return Object.fromEntries(rows.map((r) => [r.kind, r.body]));
}

// Fills {placeholders}. Unknown placeholders stay as they are, so a typo is visible.
function render(body, vars) {
  return body.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

// Queues messages for everyone due now who has consented AND has an email address.
// Nothing is sent here. Running it again is safe: the unique key stops duplicates.
async function prepareDrafts(db) {
  const s = await getSettings(db);
  const tpl = await getTemplates(db);
  const base = { clinic: s.clinicName, clinic_phone: s.clinicPhone };
  const today = clinicNow().date;
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const made = { recall: 0, winback: 0, birthday: 0, anniversary: 0 };
  const skipped = { noEmail: 0, noConsent: 0 };

  // Client must have consented to marketing and have an email address
  // Recall and win-back go out the next day at 10:00. Birthdays and anniversaries go out on the day at 09:00.
  const nextDay = addDays(today, 1);
  const add = async (client, kind, ref, vars, sendAt) => {
    if (!client.promoConsent) { skipped.noConsent++; return; }
    if (!client.email) { skipped.noEmail++; return; }
    const r = await db.run(
      `INSERT INTO outbox (client_id, kind, ref, channel, body, status, created_at, send_at)
       VALUES (?, ?, ?, 'email', ?, 'queued', ?, ?) ON CONFLICT (client_id, kind, ref) DO NOTHING`,
      [client.clientId, kind, ref, render(tpl[kind] || '', { ...base, ...vars }), new Date().toISOString(), sendAt]
    );
    made[kind] += r.changes;
  };

  for (const r of await dueForRecall(db)) {
    await add({ ...r, promoConsent: r.promoConsent }, 'recall', `${r.service}:${r.dueDate}`, { first_name: firstName(r.name), service: r.service }, `${nextDay} 10:00`);
  }
  for (const c of await lapsedClients(db, s.winbackDays)) {
    await add(c, 'winback', month, { first_name: firstName(c.name) }, `${nextDay} 10:00`);
  }
  for (const c of await upcomingCelebrations(db, 7)) {
    if (c.type === 'birthday') await add(c, 'birthday', year, { first_name: firstName(c.name) }, `${c.date} 09:00`);
    else await add(c, 'anniversary', year, { first_name: firstName(c.name), years: c.years }, `${c.date} 09:00`);
  }
  return { ...made, skipped };
}

async function listOutbox(db, status = 'queued') {
  return db.all(
    `SELECT o.id, o.kind, o.ref, o.channel, o.body, o.status, o.created_at, o.send_at, c.full_name, c.phone, c.email
     FROM outbox o JOIN clients c ON c.id = o.client_id
     WHERE o.status = ? ORDER BY o.id DESC LIMIT 200`,
    [status]
  );
}

async function outboxCounts(db) {
  const rows = await db.all('SELECT status, COUNT(*) AS n FROM outbox GROUP BY status');
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

module.exports = {
  dueForRecall, lapsedClients, upcomingCelebrations, weeklyReport, addDays,
  getTemplates, render, prepareDrafts, listOutbox, outboxCounts,
};
