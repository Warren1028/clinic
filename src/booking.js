const { getSettings } = require('./db');

const CLINIC_TZ = 'Asia/Manila';
const LEAD_MINUTES = 60; // no same-slot bookings closer than this from now
const BOOKING_LOCK_KEY = 4242; // one lock for all bookings, so two requests can't take the same slot

class BookingError extends Error {}

// Clinic-local "now" as { date: 'YYYY-MM-DD', time: 'HH:MM' }
function clinicNow(at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: CLINIC_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(at).map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`,
  };
}

function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isValidTime(s) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

// 'YYYY-MM-DD HH:MM' plus minutes
function addMinutes(dateStr, timeStr, minutes) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi) + minutes * 60000;
  const x = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())} ${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`;
}

function dayOfWeek(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

// Digits only, Philippine mobile or landline with at least 10 digits
function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length === 12) digits = `0${digits.slice(2)}`;
  if (digits.length < 10 || digits.length > 11) return null;
  return digits;
}

async function findService(db, name) {
  const all = await db.all('SELECT * FROM services WHERE active = 1');
  const q = String(name || '').trim().toLowerCase();
  if (!q) return null;
  return all.find((s) => s.name.toLowerCase() === q)
    || all.find((s) => s.name.toLowerCase().includes(q) || q.includes(s.name.toLowerCase()))
    || null;
}

async function findDentist(db, name) {
  const all = await db.all('SELECT * FROM dentists WHERE active = 1');
  const q = String(name || '').trim().toLowerCase();
  if (!q) return null;
  return all.find((d) => d.name.toLowerCase() === q)
    || all.find((d) => d.name.toLowerCase().includes(q))
    || null;
}

// All open start times for a date, optionally for one service and/or one dentist.
// Returns [{ time: 'HH:MM', dentistId, dentistName, serviceId, serviceName }]
async function availableSlots(db, date, { serviceId = null, serviceName = null, dentistId = null } = {}) {
  if (!isValidDate(date)) throw new BookingError('Invalid date. Use YYYY-MM-DD.');
  const settings = await getSettings(db);
  const now = clinicNow();
  if (date < now.date) return [];
  if (!settings.openDays.includes(dayOfWeek(date))) return [];

  let service = null;
  if (serviceId) service = await db.one('SELECT * FROM services WHERE id = ? AND active = 1', [serviceId]);
  else if (serviceName) service = await findService(db, serviceName);
  if (!service) return [];

  let dentists = await db.all('SELECT * FROM dentists WHERE active = 1 ORDER BY id');
  if (dentistId) dentists = dentists.filter((d) => d.id === Number(dentistId));

  const dayStart = `${date} 00:00`;
  const dayEnd = `${date} 23:59`;
  const earliest = date === now.date ? addMinutes(date, now.time, LEAD_MINUTES) : null;
  const slots = [];

  for (const dentist of dentists) {
    const booked = await db.all(
      `SELECT starts_at, ends_at FROM appointments
       WHERE dentist_id = ? AND status = 'booked' AND starts_at BETWEEN ? AND ?`,
      [dentist.id, dayStart, dayEnd]
    );

    for (let t = toMinutes(settings.hoursOpen); t < toMinutes(settings.hoursClose); t += settings.slotMinutes) {
      const time = fromMinutes(t);
      const start = `${date} ${time}`;
      const end = addMinutes(date, time, service.duration_min);
      if (end.slice(11) > settings.hoursClose) continue; // must finish before closing
      if (earliest && start < earliest) continue;
      const clash = booked.some((b) => b.starts_at < end && b.ends_at > start);
      if (clash) continue;
      slots.push({
        time,
        dentistId: dentist.id,
        dentistName: dentist.name,
        serviceId: service.id,
        serviceName: service.name,
      });
    }
  }
  return slots.sort((a, b) => (a.time === b.time ? a.dentistName.localeCompare(b.dentistName) : a.time.localeCompare(b.time)));
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function fromMinutes(n) {
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Creates a booking. Takes a lock and re-checks the slot inside a transaction,
// so two requests can't take the same dentist at the same time.
async function bookAppointment(db, input) {
  const { date, time, serviceName, dentistName, patientName, phone, source = 'ai', conversationId = null } = input;

  if (!isValidDate(date)) throw new BookingError('Invalid date. Use YYYY-MM-DD.');
  if (!isValidTime(time)) throw new BookingError('Invalid time. Use HH:MM (24-hour).');
  const service = await findService(db, serviceName);
  if (!service) throw new BookingError(`Unknown service "${serviceName}".`);
  let dentist = null;
  if (dentistName) {
    dentist = await findDentist(db, dentistName);
    if (!dentist) throw new BookingError(`Unknown dentist "${dentistName}".`);
  }
  const name = String(patientName || '').trim();
  if (name.length < 2) throw new BookingError('Patient name is required.');
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone) throw new BookingError('Phone number must be 10 to 11 digits.');

  return db.transaction(async (tx) => {
    await tx.all('SELECT pg_advisory_xact_lock(?)', [BOOKING_LOCK_KEY]);

    const candidates = (await availableSlots(tx, date, { serviceId: service.id, dentistId: dentist ? dentist.id : null }))
      .filter((s) => s.time === time);
    if (candidates.length === 0) throw new BookingError('That time is no longer available. Please choose another slot.');
    const slot = candidates[0];

    const now = new Date().toISOString();
    let client = await tx.one('SELECT * FROM clients WHERE phone = ?', [cleanPhone]);
    if (!client) {
      const id = await tx.insert('INSERT INTO clients (full_name, phone, created_at) VALUES (?, ?, ?)', [name, cleanPhone, now]);
      client = { id, full_name: name };
    }
    const startsAt = `${date} ${time}`;
    const endsAt = addMinutes(date, time, service.duration_min);
    const appointmentId = await tx.insert(
      `INSERT INTO appointments (client_id, dentist_id, service_id, starts_at, ends_at, status, source, created_at)
       VALUES (?, ?, ?, ?, ?, 'booked', ?, ?)`,
      [client.id, slot.dentistId, service.id, startsAt, endsAt, source, now]
    );

    if (conversationId) {
      await tx.run('UPDATE conversations SET client_id = ? WHERE id = ?', [client.id, conversationId]);
    }
    return {
      appointmentId,
      clientId: client.id,
      service: service.name,
      dentist: slot.dentistName,
      startsAt,
      endsAt,
    };
  });
}

async function listAppointments(db, from, to) {
  return db.all(
    `SELECT a.id, a.starts_at, a.ends_at, a.status, a.source, a.dentist_id,
            c.id AS client_id, c.full_name AS client_name, c.phone AS client_phone,
            d.name AS dentist_name, s.name AS service_name
     FROM appointments a
     JOIN clients c ON c.id = a.client_id
     JOIN dentists d ON d.id = a.dentist_id
     JOIN services s ON s.id = a.service_id
     WHERE a.starts_at >= ? AND a.starts_at < ?
     ORDER BY a.starts_at`,
    [`${from} 00:00`, `${to} 00:00`]
  );
}

async function setAppointmentStatus(db, id, status) {
  if (!['booked', 'cancelled', 'done', 'no_show'].includes(status)) throw new BookingError('Invalid status.');
  const r = await db.run('UPDATE appointments SET status = ? WHERE id = ?', [status, id]);
  if (r.changes === 0) throw new BookingError('Appointment not found.');
}

module.exports = {
  BookingError, CLINIC_TZ, clinicNow, isValidDate, isValidTime, addMinutes, normalizePhone,
  findService, findDentist, availableSlots, bookAppointment, listAppointments, setAppointmentStatus,
};
