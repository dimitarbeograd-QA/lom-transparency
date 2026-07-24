'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Entrypoint for `npm run sync`. Auto-requires and runs every scraper module
// in server/scraper/modules/*.js (sorted alphabetically). Each module must
// export a default async function that returns either nothing, a number
// (records upserted), or an object like { upserted: number }.
//
// A failure in one module is logged and does not abort the others.
// ---------------------------------------------------------------------------

async function runAll() {
  const modulesDir = path.join(__dirname, 'modules');
  const results = [];

  if (!fs.existsSync(modulesDir)) {
    console.log('[runAll] No scraper modules directory found, nothing to do.');
    return results;
  }

  const moduleFiles = fs
    .readdirSync(modulesDir)
    .filter((f) => f.endsWith('.js'))
    .sort();

  if (moduleFiles.length === 0) {
    console.log('[runAll] No scraper modules registered yet.');
    return results;
  }

  for (const file of moduleFiles) {
    const modName = file.replace(/\.js$/, '');
    const modPath = path.join(modulesDir, file);

    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const mod = require(modPath);
      const fn = typeof mod === 'function' ? mod : mod.default;

      if (typeof fn !== 'function') {
        throw new Error(`${file} does not export a default async function`);
      }

      const outcome = await fn();
      const upserted =
        typeof outcome === 'number'
          ? outcome
          : outcome && typeof outcome.upserted === 'number'
          ? outcome.upserted
          : 0;

      results.push({ module: modName, upserted, error: null });
    } catch (err) {
      console.error(`[runAll] Module "${modName}" failed:`, err.message);
      results.push({ module: modName, upserted: 0, error: err.message });
    }
  }

  console.log('\n=== Scrape summary ===');
  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.module}: FAILED (${r.error})`);
    } else {
      console.log(`  ${r.module}: ${r.upserted} record(s) upserted`);
    }
  }
  console.log('======================\n');

  return results;
}

if (require.main === module) {
  runAll().then(() => process.exit(0));
}

module.exports = runAll;
