'use strict';

// In-memory registry of "reviewable" tables: scraped/imported content that
// needs an admin to approve/reject before it is shown publicly. Feature
// modules call registerReviewable() from their own route/db module files at
// require-time; server/routes/review.js reads this registry generically.
//
// NOTE: table/titleColumn values here are only ever set by trusted, hardcoded
// module code (never by end-user input), so building dynamic SQL from the
// `table` field elsewhere in the app is safe as long as callers only ever
// pass their own hardcoded table name -- never a value derived from a
// request.

const reviewables = [];

function registerReviewable({ key, table, titleColumn }) {
  if (reviewables.some((r) => r.key === key)) {
    console.warn(
      `[reviewRegistry] Duplicate reviewable key "${key}" -- skipping registration.`
    );
    return;
  }
  reviewables.push({ key, table, titleColumn });
}

function getReviewables() {
  return reviewables.slice();
}

module.exports = { registerReviewable, getReviewables };
