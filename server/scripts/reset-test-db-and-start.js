'use strict';

// Playwright starts `webServer` BEFORE running `globalSetup` (the opposite
// of what the name suggests -- confirmed via the Playwright docs and via
// DEBUG=pw:webserver during this repo's build). That means a globalSetup
// step trying to delete the test DB file always loses a race against this
// server already having it open, which is silently tolerated on POSIX
// (unlinking an open file is allowed) but fails with EBUSY on Windows.
//
// Fix: do the delete-before-open HERE, inside the same process that is
// about to open the DB, strictly before requiring server.js (which is what
// actually opens it via server/db/index.js). No cross-process race is
// possible this way. See playwright.config.js's webServer.command.

const fs = require('fs');

const dbPath = process.env.LOM_DB_PATH;
if (dbPath) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}

// server.js only calls app.listen() when it's the Node entrypoint
// (require.main === module) -- true when Playwright/production runs it
// directly, but false here since THIS script is the entrypoint and
// server.js is merely required by it. So start it explicitly instead of
// relying on that check.
const { app } = require('../server.js');
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`lom-transparency server listening on port ${port}`);
});
