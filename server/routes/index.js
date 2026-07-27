'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

router.use(require('./auth'));
router.use(require('./attachments'));
router.use(require('./review'));
router.use(require('./search'));

// ---------------------------------------------------------------------------
// Auto-mount every route module dropped into server/routes/modules/*.js
//
// Sorted alphabetically for deterministic mount order. Each file must
// `module.exports` an express.Router(). This is what lets the five feature
// modules be built independently and mounted without ever editing this file.
// ---------------------------------------------------------------------------
const modulesDir = path.join(__dirname, 'modules');
if (fs.existsSync(modulesDir)) {
  const moduleFiles = fs
    .readdirSync(modulesDir)
    .filter((f) => f.endsWith('.js'))
    .sort();

  for (const file of moduleFiles) {
    router.use(require(path.join(modulesDir, file)));
  }
}

module.exports = router;
