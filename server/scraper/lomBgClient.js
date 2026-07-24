'use strict';

const cheerio = require('cheerio');
const pdfParse = require('pdf-parse');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 LomTransparencyBot/1.0';

const FETCH_TIMEOUT_MS = 15000;
const POLITE_DELAY_MS = 300;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a URL politely: realistic User-Agent, ~15s timeout, throws a clear
 * error on non-2xx responses, and waits a short delay before returning so we
 * don't hammer the target site with back-to-back requests.
 */
async function politeFetch(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Timed out fetching ${url} after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw new Error(`Failed to fetch ${url}: ${err.message}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(
      `Non-2xx response fetching ${url}: ${response.status} ${response.statusText}`
    );
  }

  await delay(POLITE_DELAY_MS);

  return response;
}

function parseHtml(html) {
  return cheerio.load(html);
}

async function extractPdfText(buffer) {
  try {
    const data = await pdfParse(buffer);
    return data.text;
  } catch (err) {
    console.warn('[lomBgClient] Failed to parse PDF:', err.message);
    return '';
  }
}

function resolveUrl(base, relative) {
  return new URL(relative, base).toString();
}

module.exports = { politeFetch, parseHtml, extractPdfText, resolveUrl };
