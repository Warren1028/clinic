const { getSettings } = require('./db');
const {
  clinicNow, availableSlots, bookAppointment, findService, findDentist,
} = require('./booking');
const knowledge = require('./knowledge');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_TOOL_ROUNDS = 6;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const TOOLS = [
  {
    name: 'check_availability',
    description: 'List open appointment times for a date and service. Call this before offering any time to the patient.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date as YYYY-MM-DD' },
        service: { type: 'string', description: 'Service name exactly as listed in the clinic info' },
        dentist: { type: 'string', description: 'Optional practitioner name if the patient asked for one' },
      },
      required: ['date', 'service'],
    },
  },
  {
    name: 'book_appointment',
    description: 'Book an appointment. Only call after the patient has confirmed the service, date, time, full name, and phone number.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: '24-hour HH:MM, as returned by check_availability' },
        service: { type: 'string' },
        patient_name: { type: 'string', description: 'Patient full name' },
        phone: { type: 'string', description: 'Philippine mobile or landline number' },
        dentist: { type: 'string', description: 'Optional practitioner name' },
      },
      required: ['date', 'time', 'service', 'patient_name', 'phone'],
    },
  },
];

const EMERGENCY_WORDS = [
  'bleeding', 'dumudugo', 'swelling', 'namamaga', 'severe pain', 'sobrang sakit',
  'can\'t breathe', 'cannot breathe', 'hirap huminga', 'emergency', 'face is swollen',
];

function isEmergency(text) {
  const t = text.toLowerCase();
  return EMERGENCY_WORDS.some((w) => t.includes(w));
}

const HUMAN_WORDS = ['talk to a human', 'real person', 'speak to staff', 'talk to staff', 'kausap ang staff', 'tao naman', 'kausapin'];
function asksForHuman(text) {
  const t = text.toLowerCase();
  return HUMAN_WORDS.some((w) => t.includes(w));
}

const EMERGENCY_REPLY =
  'I\'m sorry you\'re going through this. Please call the clinic right away, or go to the nearest emergency room if you have trouble breathing or heavy bleeding or swelling. A staff member has been notified and will contact you.';

async function buildSystemPrompt(db) {
  const s = await getSettings(db);
  const now = clinicNow();
  const services = await db.all('SELECT name, duration_min, price, description FROM services WHERE active = 1 ORDER BY name');
  const dentists = await db.all('SELECT name FROM dentists WHERE active = 1 ORDER BY name');
  const openDays = s.openDays.map((d) => DAY_NAMES[d]).join(', ');

  return [
    `You are the virtual assistant for ${s.clinicName}. You chat with patients on the clinic website to answer questions and book appointments.`,
    '',
    `Today is ${now.date} (Philippine time). Current time is ${now.time}.`,
    '',
    'Clinic info:',
    `- Address: ${s.clinicAddress}`,
    `- Phone: ${s.clinicPhone}`,
    `- Open: ${openDays}, ${s.hoursOpen} to ${s.hoursClose}`,
    `- Practitioners: ${dentists.map((d) => d.name).join(', ') || 'none listed'}`,
    '- Services:',
    ...services.map((x) => `  - ${x.name} (${x.duration_min} min, ${x.price || 'price on request'})${x.description ? ': ' + x.description : ''}`),
    '',
    'Knowledge base (answer questions from this when it applies):',
    knowledge.asPromptText() || 'none',
    '',
    'Rules:',
    '- Patients can tap the "Book appointment" button in the chat to pick a service and time. When someone wants to book, tell them about that button.',
    '- Never give medical advice or diagnoses. For pain, swelling, bleeding, fever, allergic reactions, or trouble breathing, tell the patient to call the clinic or go to the nearest emergency room. Treatment suitability is decided by the practitioner at the consultation.',
    '- Use only the info above. Never invent prices, practitioners, or times. Use check_availability for any availability question.',
    '- To book, collect: service, date, time, full name, and phone number. Offer 2 to 4 times from check_availability, confirm all details with the patient, then call book_appointment.',
    '- After a successful booking, give a short confirmation with the date, time, service, and practitioner.',
    '- If the patient asks for a human, or you cannot help, say a staff member will follow up.',
    '- Keep replies short (about 60 words) unless listing options.',
    s.aiInstructions ? `- Clinic instructions: ${s.aiInstructions}` : '',
  ].filter((line) => line !== '').join('\n');
}

// Stored messages -> Gemini contents. Staff messages go in as model text,
// consecutive same-role messages are merged, and the list starts with a user turn.
function toApiMessages(history) {
  const out = [];
  for (const m of history) {
    const role = m.sender === 'patient' ? 'user' : 'model';
    const text = m.sender === 'staff' ? `[Clinic staff] ${m.text}` : m.text;
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts[0].text += `\n${text}`;
    else out.push({ role, parts: [{ text }] });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

async function executeTool(db, name, input, ctx) {
  if (name === 'check_availability') {
    const service = await findService(db, input.service);
    if (!service) throw new Error(`Unknown service "${input.service}". Use one of the listed services.`);
    const dentist = input.dentist ? await findDentist(db, input.dentist) : null;
    if (input.dentist && !dentist) throw new Error(`Unknown dentist "${input.dentist}".`);
    const slots = await availableSlots(db, input.date, { serviceId: service.id, dentistId: dentist ? dentist.id : null });
    return {
      date: input.date,
      service: service.name,
      slots: slots.slice(0, 20).map((s) => ({ time: s.time, dentist: s.dentistName })),
      note: slots.length ? undefined : 'No open times on this date. Suggest another date.',
    };
  }
  if (name === 'book_appointment') {
    const booking = await bookAppointment(db, {
      date: input.date,
      time: input.time,
      serviceName: input.service,
      dentistName: input.dentist,
      patientName: input.patient_name,
      phone: input.phone,
      source: ctx.channel,
      conversationId: ctx.conversationId,
    });
    return { booked: true, ...booking };
  }
  throw new Error(`Unknown tool ${name}`);
}

function textOf(parts) {
  return parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('\n').trim();
}

// Gemini expects upper-case type names in function schemas
function toGeminiSchema(schema) {
  const out = { ...schema, type: schema.type.toUpperCase() };
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)])
    );
  }
  return out;
}

const FUNCTION_DECLARATIONS = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: toGeminiSchema(t.input_schema),
}));

async function callGemini(model, body) {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  return res.json();
}

// Returns { text, needsHuman }
async function respond(db, { history, conversationId, channel = 'website' }) {
  const text = history.length ? history[history.length - 1].text : '';
  if (isEmergency(text)) return { text: EMERGENCY_REPLY, needsHuman: true, pause: true, reason: 'medical' };
  if (asksForHuman(text)) {
    return { text: 'Of course. I\'ve asked a staff member to reply to you here shortly.', needsHuman: true, pause: true, reason: 'human_request' };
  }

  if (!process.env.GEMINI_API_KEY) return fallbackReply(db, text);

  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const contents = toApiMessages(history);
  if (contents.length === 0) return { text: 'Hi! How can I help you today?', needsHuman: false };

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const resp = await callGemini(model, {
        systemInstruction: { parts: [{ text: await buildSystemPrompt(db) }] },
        tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
        generationConfig: { maxOutputTokens: 1024 },
        contents,
      });
      const candidate = (resp.candidates || [])[0];
      const parts = (candidate && candidate.content && candidate.content.parts) || [];
      const calls = parts.filter((p) => p.functionCall);
      if (calls.length === 0) {
        return { text: textOf(parts) || 'Sorry, could you say that again?', needsHuman: false };
      }
      contents.push({ role: 'model', parts });
      const responses = [];
      for (const { functionCall } of calls) {
        try {
          const out = await executeTool(db, functionCall.name, functionCall.args || {}, { conversationId, channel });
          responses.push({ functionResponse: { name: functionCall.name, response: { result: out } } });
        } catch (err) {
          responses.push({ functionResponse: { name: functionCall.name, response: { error: err.message } } });
        }
      }
      contents.push({ role: 'user', parts: responses });
    }
    return { text: 'Sorry, I could not finish that. A staff member will follow up.', needsHuman: true, pause: false, reason: 'unclear' };
  } catch (err) {
    console.error('[ai] error:', err.message);
    return { text: 'Sorry, I am having trouble right now. A staff member will follow up with you.', needsHuman: true, pause: false, reason: 'unclear' };
  }
}

// Used when no API key is configured. Answers basic questions only; booking needs the AI.
async function fallbackReply(db, text) {
  const t = text.toLowerCase();
  const s = await getSettings(db);
  const services = await db.all('SELECT name, price FROM services WHERE active = 1 ORDER BY name');

  if (/price|magkano|presyo|cost|how much/.test(t)) {
    return {
      text: 'Our prices:\n' + services.map((x) => `• ${x.name}: ${x.price || 'on request'}`).join('\n'),
      needsHuman: false,
    };
  }
  if (/hour|oras|open|bukas|sarado|schedule/.test(t)) {
    return { text: `We are open ${s.hoursOpen} to ${s.hoursClose}, ${s.openDays.map((d) => DAY_NAMES[d]).join(', ')}.`, needsHuman: false };
  }
  if (/where|address|saan|location/.test(t)) {
    return { text: `${s.clinicName}, ${s.clinicAddress}. Phone: ${s.clinicPhone}.`, needsHuman: false };
  }
  if (/service|treatment|anong|what do you/.test(t)) {
    return { text: 'We offer: ' + services.map((x) => x.name).join(', ') + '.', needsHuman: false };
  }
  if (/^(hi|hello|hey|good (morning|afternoon|evening)|kumusta|magandang)/.test(t.trim())) {
    return { text: 'Hi! How can I help you today? Ask me about our services, or tap Book appointment to choose a time.', needsHuman: false };
  }
  if (/book|appointment|magpa/.test(t)) {
    return { text: 'Tap Book appointment in this chat to choose a service and time.', needsHuman: false };
  }
  const named = services.find((x) => t.includes(x.name.toLowerCase()));
  if (named) {
    return { text: `${named.name}: ${named.price || 'price on request'}. Tap Book appointment to choose a time, or ask me anything else about it.`, needsHuman: false };
  }
  const answer = knowledge.findAnswer(t);
  if (answer) return { text: answer, needsHuman: false };
  return { text: 'Thanks for your message! A staff member will reply shortly.', needsHuman: true, reason: 'unclear' };
}

module.exports = { respond, isEmergency, buildSystemPrompt, toApiMessages, executeTool, TOOLS };
