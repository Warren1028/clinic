const fs = require('node:fs');
const path = require('node:path');

// Clinic knowledge base: questions and answers the assistant can use.
// Edit knowledge/faq.json, then restart the server.
const FILE = path.join(__dirname, '..', 'knowledge', 'faq.json');

function load() {
  try {
    const items = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(items) ? items.filter((x) => x && x.q && x.a) : [];
  } catch (err) {
    console.warn('[warn] Could not read knowledge/faq.json:', err.message);
    return [];
  }
}

const items = load();

// Best answer for a patient's message, by keyword matches. Null if nothing matches.
function findAnswer(text) {
  const t = String(text || '').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const item of items) {
    const score = (item.keywords || []).filter((k) => t.includes(k.toLowerCase())).length;
    if (score > bestScore) { best = item; bestScore = score; }
  }
  return best ? best.a : null;
}

// Text for the AI system prompt
function asPromptText() {
  return items.map((x) => `Q: ${x.q}\nA: ${x.a}`).join('\n');
}

module.exports = { findAnswer, asPromptText };
