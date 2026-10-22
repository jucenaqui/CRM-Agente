import { assertConfig, getDbPath, getPort, loadEnv } from './config.js';

loadEnv();
assertConfig();

const { getDb } = await import('./db.js');
const db = getDb(); // open + run migrations at startup
const { app } = await import('./app.js');

const port = getPort();
app.listen(port, () => {
  console.log(`NEWCRM API listening on http://localhost:${port} (db: ${getDbPath()}, driver: ${db.driver})`);
});
