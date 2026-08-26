const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { google } = require('googleapis');
const { logger } = require('firebase-functions');

initializeApp();
const db = getFirestore();

const REGION           = 'us-central1';
const DOC_NUMBERING_SHEET_ID = '1Np-vejxU9uFB_b-hNCQ08b4FcHpG8JrUBzQofzkKmzI';

const SERVICE_TYPE_LABELS = {
  routine: 'ביקור תקופתי', fault: 'תקלה', extra: 'טיפול נוסף', other: 'אחר',
  daily_log: 'יומן עבודה', weld_inspection: 'בדיקת ריתוך ויזואלי',
};
const PERIODIC_INTERVAL_LABELS = {
  weekly: 'שבועי', bimonthly: 'דו-שבועי', monthly: 'חודשי',
  quarterly: 'רבעוני', semiannual: 'חצי שנתי', annual: 'שנתי',
};

function pad3(n) { return String(n).padStart(3, '0'); }

function formatSheetDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  if (!y || !m || !d) return isoDate;
  return `${d}.${m}.${y.slice(2)}`;
}

let _sheetsClientPromise = null;
async function _sheetsClient() {
  if (!_sheetsClientPromise) {
    _sheetsClientPromise = (async () => {
      const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
      const client = await auth.getClient();
      return google.sheets({ version: 'v4', auth: client });
    })();
  }
  return _sheetsClientPromise;
}

/** Resolves the spreadsheet's first tab name — never hardcoded, so a
 *  renamed/reordered tab on the sheet doesn't silently break writes. */
async function _firstSheetTitle(sheets) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: DOC_NUMBERING_SHEET_ID,
    fields: 'sheets.properties.title',
  });
  const title = meta.data.sheets?.[0]?.properties?.title;
  if (!title) throw new Error('Doc-numbering spreadsheet has no sheets');
  return title;
}

const HEADER_ANCHOR_TEXT = 'שם הלקוח';

/** Locates the real header row (NOT necessarily row 1 — this sheet has a
 *  merged title banner + blank spacer rows above the actual column headers)
 *  by scanning for the row containing a known anchor header. Also returns
 *  the anchor column letter, since column A is entirely empty throughout
 *  this sheet's real data and can't be used to find "the end of the table"
 *  (values.append's own table-detection relies on the target range's own
 *  column having data, which silently breaks against a sparse column A —
 *  this is what caused the very first numbered row to go missing). */
async function _locateHeaders(sheets, title) {
  const scanRes = await sheets.spreadsheets.values.get({
    spreadsheetId: DOC_NUMBERING_SHEET_ID,
    range: `${title}!A1:Z10`,
  });
  const scanRows = scanRes.data.values || [];
  const headerRowIdx = scanRows.findIndex(row => row.some(cell => (cell || '').includes(HEADER_ANCHOR_TEXT)));
  if (headerRowIdx === -1) throw new Error(`Could not find header row (looked for "${HEADER_ANCHOR_TEXT}" in the first 10 rows)`);
  const headers = scanRows[headerRowIdx];
  const anchorColIdx = headers.findIndex(h => (h || '').includes(HEADER_ANCHOR_TEXT));
  return {
    headers,
    headerRowNumber: headerRowIdx + 1,
    anchorColLetter: String.fromCharCode(65 + anchorColIdx),
    lastColLetter: String.fromCharCode(65 + headers.length - 1),
  };
}

/** Writes one row into the exact next data row — computed from the anchor
 *  column's real fill count, not from values.append's table-guessing
 *  (unreliable here, see _locateHeaders) — placing each value under the
 *  header column whose text matches (tolerant of hand-reordered columns). */
async function _writeNumberingRow(fields) {
  const sheets = await _sheetsClient();
  const title  = await _firstSheetTitle(sheets);
  const { headers, anchorColLetter, lastColLetter } = await _locateHeaders(sheets, title);

  const anchorColRes = await sheets.spreadsheets.values.get({
    spreadsheetId: DOC_NUMBERING_SHEET_ID,
    range: `${title}!${anchorColLetter}:${anchorColLetter}`,
  });
  const nextRow = (anchorColRes.data.values || []).length + 1;

  const row = headers.map(h => fields[(h || '').trim()] ?? '');

  await sheets.spreadsheets.values.update({
    spreadsheetId: DOC_NUMBERING_SHEET_ID,
    range: `${title}!A${nextRow}:${lastColLetter}${nextRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}

/** Read-only live estimate of the next document number for a folder — does
 *  NOT reserve/increment anything. Shown to the technician the moment a
 *  report is opened, before it's genuinely saved, purely as a preview; it
 *  can shift if someone else's report gets saved first. The real, binding
 *  number is only reserved by assignReportNumber, called on the report's
 *  first real save — never on creation — so a report that's created and
 *  discarded without ever being saved doesn't burn a number. */
exports.peekNextReportNumber = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required');
  const { folderName } = request.data || {};
  if (!folderName) throw new HttpsError('invalid-argument', 'folderName is required');

  const codeSnap = await db.collection('site_codes').doc(folderName).get();
  const code = codeSnap.exists ? codeSnap.data().code : null;
  if (!code) return { number: null };

  const counterSnap = await db.collection('counters').doc(`${code}_SER`).get();
  const next = counterSnap.exists ? counterSnap.data().next : 1;
  return { number: `OFIC-${code}-SER-${pad3(next)}` };
});

/** Assigns the next sequential document number for a report, scoped to its
 *  folder's site code (see site_codes/{folderName} in Firestore — admin-set,
 *  see CLAUDE.md / SRS for the OFIC-<code>-SER-<n> format). Returns
 *  { number: null } untouched if the folder has no site code configured yet
 *  — callers keep the existing manual/blank behavior in that case, they
 *  never fail the report creation itself. Mirrors a best-effort row into
 *  the shared doc-numbering Google Sheet; a Sheets hiccup is logged but
 *  never blocks the number assignment, since Firestore is the source of
 *  truth for uniqueness. */
exports.assignReportNumber = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required');
  const { folderName, customer, site, visitDate, title, serviceType, periodicInterval } = request.data || {};
  if (!folderName) throw new HttpsError('invalid-argument', 'folderName is required');

  const codeSnap = await db.collection('site_codes').doc(folderName).get();
  const code = codeSnap.exists ? codeSnap.data().code : null;
  if (!code) return { number: null };

  const counterRef = db.collection('counters').doc(`${code}_SER`);
  const assigned = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const next = snap.exists ? snap.data().next : 1;
    tx.set(counterRef, { next: next + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return next;
  });

  const docNumber = `OFIC-${code}-SER-${pad3(assigned)}`;

  try {
    await _writeNumberingRow({
      'שם הלקוח המלא בעברית': folderName,
      'סימון Oficiency': 'OFIC',
      'סימון לקוח': code,
      'סוג מסמך': 'SER',
      'מספר מסמך': assigned,
      'תאריך': formatSheetDate(visitDate),
      'שם נציג מטעם האתר\\לקוח': customer || '',
      'סוג הטיפול': SERVICE_TYPE_LABELS[serviceType] || serviceType || '',
      'תדירות': PERIODIC_INTERVAL_LABELS[periodicInterval] || '',
      'שם דו"ח סופי': title || '',
    });
  } catch (e) {
    logger.error('[assignReportNumber] Sheets sync failed (number already assigned, continuing)', e);
  }

  return { number: docNumber };
});

// One-time migration: seeds site_codes + starting counters from the
// pre-existing manual numbering sheet, so automatic numbering resumes from
// each site's last used document number instead of restarting at 1. Safe to
// call more than once — never lowers/overwrites a counter that's already
// past its seed value (e.g. if reports were already created after seeding).
const SEED_SITE_CODES = {
  'נשר מלט':                 { code: 'NES',  lastUsed: 45 },
  'IDE':                     { code: 'IDE',  lastUsed: 38 },
  'ברום':                    { code: 'BRO',  lastUsed: 24 },
  'דור כימיקלים':            { code: 'DOR',  lastUsed: 17 },
  'דשנים':                   { code: 'DSH',  lastUsed: 3  },
  'ים המלח - מתקן הצחנה':    { code: 'ICL',  lastUsed: 2  },
  'מצות יהודה ירושלים':      { code: 'YMJ',  lastUsed: 2  },
  'נשר משאב':                { code: 'NESM', lastUsed: 9  },
  'עוף הנגב':                { code: 'OFH',  lastUsed: 2  },
  'פוליביד':                 { code: 'POL',  lastUsed: 4  },
  'פניציה':                  { code: 'PHO',  lastUsed: 25 },
  'פריקלאס':                 { code: 'PER',  lastUsed: 19 },
};

exports.seedSiteCodes = onCall({ region: REGION }, async (request) => {
  if ((request.auth?.token?.email || '').toLowerCase() !== 'sagi.tisson@oficiency.com') {
    throw new HttpsError('permission-denied', 'Admin only');
  }
  const results = [];
  for (const [folderName, { code, lastUsed }] of Object.entries(SEED_SITE_CODES)) {
    await db.collection('site_codes').doc(folderName).set({ code }, { merge: true });
    const counterRef = db.collection('counters').doc(`${code}_SER`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists ? snap.data().next : 1;
      if (current <= lastUsed) {
        tx.set(counterRef, { next: lastUsed + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    });
    results.push(folderName + ' → ' + code);
  }
  return { seeded: results };
});

/** Read-only diagnostic: confirms the Cloud Function's service account can
 *  actually reach the doc-numbering spreadsheet (i.e. it's been shared with
 *  it), without writing anything. Admin-only. */
exports.checkSheetsAccess = onCall({ region: REGION }, async (request) => {
  if ((request.auth?.token?.email || '').toLowerCase() !== 'sagi.tisson@oficiency.com') {
    throw new HttpsError('permission-denied', 'Admin only');
  }
  let runtimeServiceAccount = null;
  try {
    const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email', {
      headers: { 'Metadata-Flavor': 'Google' },
    });
    runtimeServiceAccount = await res.text();
  } catch (e) {
    runtimeServiceAccount = 'lookup failed: ' + e.message;
  }
  try {
    const sheets = await _sheetsClient();
    const title  = await _firstSheetTitle(sheets);
    const { headers, headerRowNumber, anchorColLetter } = await _locateHeaders(sheets, title);
    const anchorColRes = await sheets.spreadsheets.values.get({
      spreadsheetId: DOC_NUMBERING_SHEET_ID,
      range: `${title}!${anchorColLetter}:${anchorColLetter}`,
    });
    const nextRow = (anchorColRes.data.values || []).length + 1;
    return {
      ok: true,
      sheetTitle: title,
      headers,
      headerRowNumber,
      nextWriteRow: nextRow,
      runtimeServiceAccount,
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message,
      status: e.code || e.response?.status,
      googleErrors: e.errors || e.response?.data?.error || null,
      runtimeServiceAccount,
    };
  }
});

/** Manual admin correction tool — directly sets a counter's next value.
 *  For fixing drift caused by non-production calls (testing/debugging)
 *  that consumed real numbers without a matching real report — NOT a
 *  general "renumber" feature, and never called automatically. */
exports.setCounter = onCall({ region: REGION }, async (request) => {
  if ((request.auth?.token?.email || '').toLowerCase() !== 'sagi.tisson@oficiency.com') {
    throw new HttpsError('permission-denied', 'Admin only');
  }
  const { counterId, next } = request.data || {};
  if (!counterId || !Number.isInteger(next) || next < 1) {
    throw new HttpsError('invalid-argument', 'counterId (string) and next (positive integer) are required');
  }
  await db.collection('counters').doc(counterId).set({ next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, counterId, next };
});

// Scaffolding placeholder — proves the deploy/emulator pipeline works.
exports.ping = onCall({ region: REGION }, () => {
  return { ok: true, time: new Date().toISOString() };
});
