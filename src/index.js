const path = require('node:path');
const { start } = require('./server');

// Load .env if present (Node 20.12+ built-in, no package needed)
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* no .env file, use real env vars */ }

start({ port: Number(process.env.PORT) || 3000 }).catch((err) => {
  console.error('Could not start the app:', err.message);
  process.exit(1);
});
