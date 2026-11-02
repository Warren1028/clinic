const fs = require('node:fs');
const path = require('node:path');
const { Pool, types } = require('pg');

// bigint ids and counts come back from Postgres as numbers, not strings
types.setTypeParser(20, (v) => parseInt(v, 10));

const SCHEMA_FILE = path.join(__dirname, '..', 'supabase', 'schema.sql');

// The app writes '?' placeholders; Postgres wants $1, $2, ...
function toPg(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

// Query helpers, used with the pool or with one client inside a transaction
function helpers(runner) {
  return {
    async all(sql, params = []) {
      return (await runner.query(toPg(sql), params)).rows;
    },
    async one(sql, params = []) {
      return (await runner.query(toPg(sql), params)).rows[0] || null;
    },
    async run(sql, params = []) {
      const r = await runner.query(toPg(sql), params);
      return { changes: r.rowCount };
    },
    // INSERT and return the new row's id
    async insert(sql, params = []) {
      const r = await runner.query(`${toPg(sql)} RETURNING id`, params);
      return r.rows[0].id;
    },
  };
}

// `schema` is only used by the tests, so they run in their own throwaway schema
function openDb(url = process.env.DATABASE_URL, { schema = null, max = 5 } = {}) {
  if (!url) throw new Error('DATABASE_URL is not set. Add it to clinic-app/.env');
  const options = schema ? `-c search_path=${schema}` : undefined;
  const pool = new Pool({ connectionString: url, max, ssl: { rejectUnauthorized: false }, options });
  return {
    ...helpers(pool),
    pool,
    // Runs fn(tx) with one client so BEGIN and COMMIT stay together
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ ...helpers(client), transaction: undefined });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close() {
      return pool.end();
    },
  };
}

// Creates the tables and sample data the first time the app runs against an empty database
async function ensureSchema(db) {
  const r = await db.one("SELECT to_regclass('services') AS t"); // looks in the current search_path
  if (r && r.t) return false;
  await db.pool.query(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  return true;
}

async function getSettings(db) {
  const rows = await db.all('SELECT key, value FROM settings');
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    clinicName: s.clinic_name,
    clinicAddress: s.clinic_address,
    clinicPhone: s.clinic_phone,
    hoursOpen: s.hours_open,
    hoursClose: s.hours_close,
    openDays: s.open_days.split(',').map(Number),
    slotMinutes: Number(s.slot_minutes),
    aiInstructions: s.ai_instructions,
    winbackDays: Number(s.winback_days || 90),
  };
}

module.exports = { openDb, ensureSchema, getSettings, toPg };
