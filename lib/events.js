/**
 * events.js — anonymous, fire-and-forget event recording.
 *
 * WHAT LEAVES THE DEVICE
 *   a salary rounded to the nearest 100, the pay period, which mode was used,
 *   the rate-table version, the referring host, one optional survey answer,
 *   and two derived booleans about return visits.
 *
 * WHAT NEVER LEAVES THE DEVICE
 *   any identifier. There is no user id, no session token, no device
 *   fingerprint, no user agent, no full URL. The first-visit date lives in
 *   localStorage and stays there — only the *derived* facts (have you been
 *   here before, how many days ago was the first time) are transmitted, so
 *   two rows can never be linked to each other.
 *
 * Every function here is safe to call before, during or after anything else.
 * Nothing throws. Nothing blocks rendering. If the network is gone, or
 * storage is blocked, or the project is unconfigured, the page is unaffected.
 */

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Fill these in for your project. The anon key is designed to be public —
 * it is the key the browser is supposed to hold, and RLS is what protects
 * the table. With no policy for SELECT, this key cannot read anything.
 *
 * Left blank, every call becomes a no-op and logs to the console instead,
 * so the page works identically while unconfigured.
 */
export const CONFIG = {
  url: 'https://fhcowwnpdvqjsrrhfhfa.supabase.co',
  anonKey: 'sb_publishable_ti6eVGMkou37JNugRR1a_Q_4vlqbKst',
  table: 'decoder_events',
};

const configured = () => Boolean(CONFIG.url && CONFIG.anonKey);

/* ------------------------------------------------------------------ */
/* Local, private state                                                */
/* ------------------------------------------------------------------ */

const LS_FIRST = 'sc.first';     // ISO date of first visit
const LS_ANSWERED = 'sc.asked';  // question keys already answered

function ls(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch { return fallback; }
}

function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

/**
 * Return-visit facts, computed here and only here.
 * Establishes the first-visit date on first run.
 */
export function visitFacts() {
  const today = new Date().toISOString().slice(0, 10);
  const first = ls(LS_FIRST, null);

  if (!first) {
    lsSet(LS_FIRST, today);
    return { is_return: false, days_since_first: 0 };
  }

  const days = Math.round(
    (Date.parse(today) - Date.parse(first)) / 86400000
  );
  const safe = Number.isFinite(days) && days >= 0 ? Math.min(days, 3650) : null;
  return { is_return: safe !== 0, days_since_first: safe };
}

/** Which questions this device has already answered. */
export function answeredKeys() {
  try { return JSON.parse(ls(LS_ANSWERED, '[]')) || []; } catch { return []; }
}

export function markAnswered(key) {
  const set = new Set(answeredKeys());
  set.add(key);
  lsSet(LS_ANSWERED, JSON.stringify([...set]));
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

/** Referring host only. Never the path, never the query string. */
function sourceHost() {
  try {
    const p = new URLSearchParams(location.search).get('utm_source');
    if (p) return p.slice(0, 64);
    if (!document.referrer) return null;
    const h = new URL(document.referrer).hostname;
    return h === location.hostname ? null : h.slice(0, 64);
  } catch { return null; }
}

/** Nearest 100. Enough for a distribution, not enough for a fingerprint. */
function blur(peso) {
  const n = Number(peso);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n / 100) * 100;
}

/**
 * Record one calculation. Fire and forget — the returned promise is for
 * tests only, and it never rejects.
 *
 * @param {object} e
 * @param {number} e.gross   all cash for the period
 * @param {number} [e.basic]  basic pay behind it
 * @param {'monthly'|'semiMonthly'} e.period
 * @param {boolean} [e.isMwe]
 * @param {'take'|'rev'|'cmp'} [e.mode]
 * @param {string} e.ratesVersion
 * @param {string} [e.answerKey]
 * @param {string} [e.answerValue]
 */
export async function track(e) {
  const row = {
    gross_php: blur(e.gross),
    // Basic pay behind the gross. Without it an allowance-heavy package and a
    // plain salary of the same size are indistinguishable, and a salary
    // database that cannot tell them apart is misleading rather than useful.
    basic_php: e.basic == null ? null : blur(e.basic),
    period: e.period === 'semiMonthly' ? 'semiMonthly' : 'monthly',
    is_mwe: Boolean(e.isMwe),
    mode: ['take', 'rev', 'cmp'].includes(e.mode) ? e.mode : 'take',
    rates_version: String(e.ratesVersion || 'unknown').slice(0, 32),
    answer_key: e.answerKey || null,
    answer_value: e.answerValue ? String(e.answerValue).slice(0, 40) : null,
    source: sourceHost(),
    ...visitFacts(),
  };

  if (!configured()) {
    // Unconfigured is a valid state, not an error. Show what would have gone.
    if (typeof console !== 'undefined') console.info('[events] would send', row);
    return { ok: false, reason: 'unconfigured', row };
  }

  try {
    const res = await fetch(`${CONFIG.url}/rest/v1/${CONFIG.table}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: CONFIG.anonKey,
        Authorization: `Bearer ${CONFIG.anonKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
      keepalive: true, // survives the user navigating away mid-flight
    });
    return { ok: res.ok, status: res.status, row };
  } catch {
    // A failed insert must never be visible to the user. Their payslip
    // breakdown does not depend on our analytics working.
    return { ok: false, reason: 'network', row };
  }
}

/* ------------------------------------------------------------------ */
/* The rotated question                                                */
/* ------------------------------------------------------------------ */

/**
 * Four questions, asked one at a time, never more than one per visit.
 *
 * A naked salary is weak data; a salary plus one attribute is a bucketed
 * observation. Asking all four at once is a form, and forms are where
 * curiosity goes to die. Asking one, and remembering which, means a repeat
 * visitor eventually supplies all four — without ever facing a form.
 *
 * Ordered by how much variance each explains, so the most valuable question
 * is the one a one-time visitor sees.
 */
export const QUESTIONS = [
  {
    key: 'job_family',
    prompt: 'What kind of work do you do?',
    options: [
      'BPO / support', 'Accounting / finance', 'Software / IT', 'Sales',
      'Marketing', 'Operations', 'HR / admin', 'Engineering',
      'Healthcare', 'Education', 'Other',
    ],
  },
  {
    key: 'years',
    prompt: 'How long have you been working?',
    options: ['Under a year', '1–2 years', '3–5 years', '6+ years'],
  },
  {
    key: 'employer_type',
    prompt: 'What kind of company?',
    options: [
      'BPO', 'Big 4 / professional services', 'Bank', 'Tech', 'Conglomerate',
      'Startup', 'Government', 'Shared service / GCC', 'Other',
    ],
  },
  {
    key: 'region',
    prompt: 'Where do you work?',
    options: ['Metro Manila', 'Rest of Luzon', 'Visayas', 'Mindanao', 'Fully remote'],
  },
];

/**
 * The next question this device has not answered, or null when it has
 * answered them all. A person who has given everything is never asked again.
 */
export function nextQuestion() {
  const done = new Set(answeredKeys());
  return QUESTIONS.find(q => !done.has(q.key)) || null;
}
