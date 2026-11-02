const crypto = require('node:crypto');
const { respond } = require('./ai');
const booking = require('./booking');
const { normalizePhone } = booking;

const MAX_HISTORY = 30;
const MAX_TEXT = 1000;

function nowIso() {
  return new Date().toISOString();
}

// Returns the trimmed address, or null if it's blank or not a valid email
function cleanEmail(raw) {
  const e = String(raw || '').trim().toLowerCase().slice(0, 120);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

// Website visitors must send the conversation's token to continue it.
async function getOrCreateConversation(db, { conversationId, token }, channel) {
  if (conversationId) {
    const existing = await db.one('SELECT * FROM conversations WHERE id = ?', [Number(conversationId)]);
    if (existing && token && existing.token === token) return existing;
  }
  const newToken = crypto.randomBytes(16).toString('hex');
  const id = await db.insert(
    'INSERT INTO conversations (token, channel, last_message_at, created_at) VALUES (?, ?, ?, ?)',
    [newToken, channel, nowIso(), nowIso()]
  );
  return db.one('SELECT * FROM conversations WHERE id = ?', [id]);
}

async function saveMessage(db, conversationId, { direction, sender, text }) {
  const now = nowIso();
  await db.run(
    'INSERT INTO messages (conversation_id, direction, sender, text, created_at) VALUES (?, ?, ?, ?, ?)',
    [conversationId, direction, sender, text, now]
  );
  await db.run('UPDATE conversations SET last_message_at = ? WHERE id = ?', [now, conversationId]);
}

// Saves email and marketing consent for a client. Each change to consent is kept in the consents history.
async function saveClientDetails(db, clientId, { email, marketingConsent, source = 'website' }) {
  const client = await db.one('SELECT promo_consent FROM clients WHERE id = ?', [clientId]);
  const consent = marketingConsent ? 1 : 0;
  await db.transaction(async (tx) => {
    await tx.run('UPDATE clients SET email = COALESCE(?, email), promo_consent = ? WHERE id = ?', [email || null, consent, clientId]);
    if (client.promo_consent !== consent) {
      await tx.run(
        'INSERT INTO consents (client_id, kind, granted, source, created_at) VALUES (?, ?, ?, ?, ?)',
        [clientId, 'marketing', consent, source, nowIso()]
      );
    }
  });
}

// Handles one patient message from any channel and returns the reply to show.
async function handlePatientMessage(db, { conversationId, token, text, channel = 'website' }) {
  const clean = String(text || '').trim().slice(0, MAX_TEXT);
  if (!clean) throw new Error('Message is empty.');

  const conv = await getOrCreateConversation(db, { conversationId, token }, channel);
  await saveMessage(db, conv.id, { direction: 'in', sender: 'patient', text: clean });

  // Staff has taken over: keep the message for staff, don't answer
  if (conv.ai_paused) {
    await db.run('UPDATE conversations SET needs_human = 1 WHERE id = ?', [conv.id]);
    return { conversationId: conv.id, reply: null, paused: true };
  }

  const history = (await db.all(
    'SELECT sender, text FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?',
    [conv.id, MAX_HISTORY]
  )).reverse();

  const { text: aiText, needsHuman, pause, reason } = await respond(db, { history, conversationId: conv.id, channel });

  // After the first message from a visitor who isn't a known client, the widget shows a details form
  let askDetails = false;
  if (!conv.client_id && !needsHuman) {
    const patientCount = (await db.one(
      "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender = 'patient'",
      [conv.id]
    )).n;
    askDetails = patientCount === 1;
  }

  await saveMessage(db, conv.id, { direction: 'out', sender: 'ai', text: aiText });
  if (needsHuman) {
    // Emergencies and requests for a human pause the AI. Unclear cases are only flagged.
    await db.run(
      'UPDATE conversations SET needs_human = 1, ai_paused = ?, handoff_reason = ? WHERE id = ?',
      [pause ? 1 : 0, reason || 'unclear', conv.id]
    );
  }
  return { conversationId: conv.id, token: conv.token, reply: aiText, paused: false, askDetails };
}

// The details form in the chat: name and phone are required, email and consent are optional.
async function saveDetailsFromChat(db, { conversationId, token, name, phone, email, marketingConsent }) {
  const conv = await db.one('SELECT * FROM conversations WHERE id = ?', [Number(conversationId)]);
  if (!conv || !token || conv.token !== token) throw new booking.BookingError('This chat could not be found. Please refresh the page.');

  const cleanName = String(name || '').trim().slice(0, 80);
  if (cleanName.length < 2) throw new booking.BookingError('Please enter your full name.');
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone) throw new booking.BookingError('Phone number must be 10 to 11 digits.');
  const mail = cleanEmail(email);
  if (String(email || '').trim() && !mail) throw new booking.BookingError('Please enter a valid email address, or leave it blank.');

  let client = await db.one('SELECT * FROM clients WHERE phone = ?', [cleanPhone]);
  if (!client) {
    const id = await db.insert('INSERT INTO clients (full_name, phone, created_at) VALUES (?, ?, ?)', [cleanName, cleanPhone, nowIso()]);
    client = { id };
  }
  await db.run('UPDATE conversations SET client_id = ? WHERE id = ?', [client.id, conv.id]);
  await saveClientDetails(db, client.id, { email: mail, marketingConsent: Boolean(marketingConsent), source: 'website' });
  await saveMessage(db, conv.id, {
    direction: 'out', sender: 'ai',
    text: `Thank you, ${cleanName.split(/\s+/)[0]}. Your details are saved.`,
  });
  return { clientId: client.id };
}

// Messages newer than `afterId`, for a visitor's open chat window.
async function messagesForVisitor(db, { conversationId, token, afterId = 0 }) {
  const conv = await db.one('SELECT * FROM conversations WHERE id = ?', [Number(conversationId)]);
  if (!conv || !token || conv.token !== token) return null;
  return db.all(
    `SELECT id, sender, text, created_at FROM messages
     WHERE conversation_id = ? AND id > ? AND sender != 'patient' ORDER BY id`,
    [conv.id, Number(afterId) || 0]
  );
}

// Staff reply from the admin inbox. Pauses the AI so it doesn't answer over them.
async function staffReply(db, conversationId, text) {
  const clean = String(text || '').trim().slice(0, MAX_TEXT);
  if (!clean) throw new Error('Message is empty.');
  const conv = await db.one('SELECT * FROM conversations WHERE id = ?', [conversationId]);
  if (!conv) throw new Error('Conversation not found.');
  await saveMessage(db, conv.id, { direction: 'out', sender: 'staff', text: clean });
  await db.run('UPDATE conversations SET ai_paused = 1 WHERE id = ?', [conv.id]);
}

// Booking from the chat's Book button. Uses the same rules as staff and AI bookings,
// links the chat to the client, saves email and consent if given, and posts the confirmation.
async function bookFromChat(db, { conversationId, token, date, time, service, name, phone, email, marketingConsent }) {
  const conv = await db.one('SELECT * FROM conversations WHERE id = ?', [Number(conversationId)]);
  if (!conv || !token || conv.token !== token) throw new booking.BookingError('This chat could not be found. Please refresh the page.');
  const mail = cleanEmail(email);
  if (String(email || '').trim() && !mail) throw new booking.BookingError('Please enter a valid email address, or leave it blank.');

  const appt = await booking.bookAppointment(db, {
    date, time, serviceName: service, patientName: name, phone, source: 'chat', conversationId: conv.id,
  });
  if (mail || marketingConsent) {
    await saveClientDetails(db, appt.clientId, { email: mail, marketingConsent: Boolean(marketingConsent), source: 'website' });
  }
  const when = `${appt.startsAt.slice(0, 10)} at ${appt.startsAt.slice(11)}`;
  await saveMessage(db, conv.id, {
    direction: 'out', sender: 'ai',
    text: `Booked: ${appt.service} with ${appt.dentist} on ${when}. See you then.`,
  });
  return appt;
}

module.exports = { handlePatientMessage, staffReply, messagesForVisitor, bookFromChat, saveDetailsFromChat, cleanEmail };
