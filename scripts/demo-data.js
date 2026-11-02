// Demo data for showing the clinic to the owner. Every row it adds is marked, so it can be removed:
//   node scripts/demo-data.js seed    adds demo clients, bookings, chats, consents, and queued messages
//   node scripts/demo-data.js clear   removes only the demo rows
// Demo clients have notes = 'DEMO DATA', emails ending in @demo.example, and phone numbers starting with 0900.
const path = require('node:path');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* use real env vars */ }
const { openDb } = require('../src/db');
const { prepareDrafts } = require('../src/automations');

const MARK = 'DEMO DATA';
const TAG = 'demo-';

// Deterministic random numbers, so every seed run makes the same sample
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Maria', 'Paolo', 'Bea', 'Carlo', 'Ella', 'Ken', 'Nina', 'Dan', 'Pia', 'Vic', 'Liza', 'Joy', 'Mark', 'Ana', 'Rico', 'Sofia', 'Gabby', 'Miguel', 'Kris', 'Tricia', 'Jomar', 'Lara', 'Anton', 'Celine', 'Ben', 'Irene', 'Ryan', 'Mia', 'Enzo', 'Hana', 'Luis', 'Rhea', 'Basti', 'Yana', 'Noel', 'Cara', 'Jun', 'Faith', 'Diego', 'Ysa'];
const LAST = ['Garcia', 'Ramos', 'Lopez', 'Cruz', 'Tan', 'Uy', 'Sy', 'Lee', 'Reyes', 'Santos', 'Dela Cruz', 'Mendoza', 'Villanueva', 'Go', 'Ong', 'Bautista', 'Aquino', 'Torres', 'Flores', 'Castillo'];

const PATIENT_LINES = [
  'Hi, how much is Botox?', 'Do you have appointments this week?', 'What is the difference between Hydrafacial and a regular facial?',
  'Can I book a facial on Saturday?', 'How long does laser hair removal take?', 'Is thread lift painful?',
  'Magkano ang facial?', 'Can I reschedule my appointment?', 'Do you accept GCash?', 'Is there a consultation fee?',
];
const AI_LINES = [
  'Botox pricing depends on the area. Ask us for a quote at your consultation.',
  'Yes, we have open times this week. Tap Book appointment to choose one.',
  'A Hydrafacial cleanses, exfoliates, and hydrates in one session. A regular facial is gentler.',
  'Let me check. Tap Book appointment to pick a time on Saturday.',
  'Laser hair removal sessions take about 90 minutes.',
  'Thread lift is done with local anesthesia. Your practitioner will explain what to expect.',
  'Yes, you can reschedule by telling us here or calling the clinic.',
  'Sorry, I am not sure about payment methods. A staff member will follow up.',
];

async function seed(db) {
  const R = rng(20261102);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); // Manila date
  const addDays = (d, n) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const isSunday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
  const isoDaysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

  if (await db.one('SELECT 1 AS x FROM clients WHERE notes = ? LIMIT 1', [MARK])) {
    throw new Error('Demo data is already loaded. Run "clear" first if you want to reload it.');
  }

  const services = await db.all('SELECT id, name, duration_min FROM services WHERE active = 1 ORDER BY id');
  const dentists = await db.all('SELECT id, name FROM dentists WHERE active = 1 ORDER BY id');
  const svc = (name) => services.find((s) => s.name === name);
  const busy = new Set();
  let apptCount = 0;

  async function book(clientId, serviceRow, date, time, status, source, createdAt) {
    const dentist = pick(dentists);
    const key = `${dentist.id}|${date} ${time}`;
    if (busy.has(key)) return false;
    busy.add(key);
    const [h, m] = time.split(':').map(Number);
    const endMin = h * 60 + m + serviceRow.duration_min;
    const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
    await db.run(
      `INSERT INTO appointments (client_id, dentist_id, service_id, starts_at, ends_at, status, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [clientId, dentist.id, serviceRow.id, `${date} ${time}`, `${date} ${end}`, status, source, createdAt]
    );
    apptCount++;
    return true;
  }

  // 40 demo clients
  const clients = [];
  for (let i = 0; i < 40; i++) {
    const last = LAST[(i * 7) % LAST.length];
    const name = `${FIRST[i]} ${last}`;
    const phone = `0900${String(1000000 + i * 7919).slice(0, 7)}`;
    const email = R() < 0.85 ? `${FIRST[i].toLowerCase()}.${last.toLowerCase().replace(/ /g, '')}${i}@demo.example` : null;
    const birthday = R() < 0.7
      ? `${1975 + Math.floor(R() * 30)}-${String(1 + Math.floor(R() * 12)).padStart(2, '0')}-${String(1 + Math.floor(R() * 28)).padStart(2, '0')}`
      : null;
    const consent = R() < 0.6 ? 1 : 0;
    const created = isoDaysAgo(20 + Math.floor(R() * 170));
    const id = await db.insert(
      'INSERT INTO clients (full_name, phone, email, notes, created_at, birthday, promo_consent) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, phone, email, MARK, created, birthday, consent]
    );
    clients.push({ id, consent });
    if (consent) {
      await db.run('INSERT INTO consents (client_id, kind, granted, source, created_at) VALUES (?, ?, 1, ?, ?)',
        [id, 'marketing', 'website', created]);
    }
  }

  // Past visits: 1 to 4 per client
  const pastNames = ['Consultation', 'Facial', 'Hydrafacial', 'Botox', 'Fillers', 'Laser Hair Removal', 'Chemical Peel', 'Thread lift'];
  for (const c of clients) {
    const visits = 1 + Math.floor(R() * 4);
    for (let v = 0; v < visits; v++) {
      const date = addDays(today, -(10 + Math.floor(R() * 170)));
      if (isSunday(date)) continue;
      const time = `${String(9 + Math.floor(R() * 8)).padStart(2, '0')}:${R() < 0.5 ? '00' : '30'}`;
      const r = R();
      const status = r < 0.8 ? 'done' : r < 0.9 ? 'no_show' : 'cancelled';
      const source = R() < 0.5 ? 'staff' : R() < 0.8 ? 'website' : 'chat';
      const created = `${addDays(date, -(1 + Math.floor(R() * 14)))}T10:00:00.000Z`;
      await book(c.id, svc(pick(pastNames)), date, time, status, source, created);
    }
  }

  // Botox clients who are due for a 4-month check (for the recall list)
  for (const c of clients.slice(0, 6)) {
    const date = addDays(today, -(125 + Math.floor(R() * 40)));
    if (!isSunday(date)) await book(c.id, svc('Botox'), date, '10:00', 'done', 'staff', `${addDays(date, -5)}T10:00:00.000Z`);
  }

  // Upcoming bookings
  for (const c of clients.slice(0, 14)) {
    const date = addDays(today, 1 + Math.floor(R() * 20));
    if (isSunday(date)) continue;
    const time = `${String(9 + Math.floor(R() * 8)).padStart(2, '0')}:${R() < 0.5 ? '00' : '30'}`;
    await book(c.id, svc(pick(pastNames)), date, time, 'booked', R() < 0.5 ? 'website' : 'chat', isoDaysAgo(1 + Math.floor(R() * 5)));
  }
  // Bookings for today
  if (!isSunday(today)) {
    for (const [i, time] of ['10:00', '11:30', '13:00', '15:00'].entries()) {
      await book(clients[20 + i].id, svc(pick(pastNames)), today, time, 'booked', i % 2 ? 'website' : 'staff', isoDaysAgo(2));
    }
  }

  // Birthdays in the next few days, so the Birthdays page has something to show
  for (const [i, c] of clients.slice(30, 34).entries()) {
    const d = addDays(today, 1 + i * 2);
    await db.run('UPDATE clients SET birthday = ?, promo_consent = 1, email = COALESCE(email, ?) WHERE id = ?',
      [`1985-${d.slice(5)}`, `demo.birthday${i}@demo.example`, c.id]);
  }

  // A few clients withdrew consent, so the history shows a change
  for (const c of clients.slice(36, 39)) {
    await db.run('UPDATE clients SET promo_consent = 0 WHERE id = ?', [c.id]);
    await db.run('INSERT INTO consents (client_id, kind, granted, source, created_at) VALUES (?, ?, 0, ?, ?)',
      [c.id, 'marketing', 'staff', isoDaysAgo(3)]);
  }

  // Chats: some from patients, some from visitors who never gave their details
  for (let n = 0; n < 28; n++) {
    const reason = n < 4 ? 'medical' : n < 9 ? 'human_request' : n < 17 ? 'unclear' : '';
    const linked = R() < 0.5 ? clients[Math.floor(R() * clients.length)] : null;
    const created = isoDaysAgo(Math.floor(R() * 28));
    const conv = await db.insert(
      `INSERT INTO conversations (token, channel, client_id, ai_paused, needs_human, handoff_reason, last_message_at, created_at)
       VALUES (?, 'website', ?, ?, ?, ?, ?, ?)`,
      [`${TAG}${n}`, linked ? linked.id : null, reason === 'medical' || reason === 'human_request' ? 1 : 0,
        reason && n % 3 === 0 ? 1 : 0, reason, created, created]
    );
    const lines = 2 + Math.floor(R() * 3);
    for (let m = 0; m < lines; m++) {
      const at = new Date(Date.parse(created) + m * 60000).toISOString();
      const first = m === 0 && reason === 'medical' ? 'My face is swelling after the filler, what should I do?'
        : m === 0 && reason === 'human_request' ? 'I want to talk to a real person please'
        : m === 0 && reason === 'unclear' ? pick(['zxqv blorf', 'Can I bring my kid along?'])
        : pick(PATIENT_LINES);
      await db.run('INSERT INTO messages (conversation_id, direction, sender, text, created_at) VALUES (?, ?, ?, ?, ?)',
        [conv, 'in', 'patient', first, at]);
      await db.run('INSERT INTO messages (conversation_id, direction, sender, text, created_at) VALUES (?, ?, ?, ?, ?)',
        [conv, 'out', 'ai', pick(AI_LINES), at]);
    }
    if (reason === 'human_request' && n % 2 === 0) {
      await db.run('INSERT INTO messages (conversation_id, direction, sender, text, created_at) VALUES (?, ?, ?, ?, ?)',
        [conv, 'out', 'staff', 'Hi, this is the clinic. How can we help you?', isoDaysAgo(0)]);
    }
  }

  // Queue: messages for consented, due clients who have an email address
  const queued = await prepareDrafts(db);
  return { clients: clients.length, appointments: apptCount, queued };
}

async function clear(db) {
  const ids = (await db.all('SELECT id FROM clients WHERE notes = ?', [MARK])).map((r) => r.id);
  await db.transaction(async (tx) => {
    if (ids.length) {
      const list = ids.join(',');
      await tx.run(`DELETE FROM outbox WHERE client_id IN (${list})`);
      await tx.run(`DELETE FROM consents WHERE client_id IN (${list})`);
      await tx.run(`UPDATE conversations SET client_id = NULL WHERE client_id IN (${list})`);
      await tx.run(`DELETE FROM appointments WHERE client_id IN (${list})`);
      await tx.run(`DELETE FROM clients WHERE id IN (${list})`);
    }
    await tx.run('DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE token LIKE ?)', [`${TAG}%`]);
    await tx.run('DELETE FROM conversations WHERE token LIKE ?', [`${TAG}%`]);
  });
  return { clientsRemoved: ids.length };
}

(async () => {
  const cmd = process.argv[2];
  if (!['seed', 'clear'].includes(cmd)) {
    console.log('Usage: node scripts/demo-data.js seed | clear');
    process.exit(1);
  }
  const db = openDb(undefined, { max: 2 });
  try {
    const result = cmd === 'seed' ? await seed(db) : await clear(db);
    console.log(cmd === 'seed' ? 'Demo data added:' : 'Demo data removed:', JSON.stringify(result));
  } finally {
    await db.close();
  }
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
