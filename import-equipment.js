'use strict';
/**
 * Bulk-imports the Oficiency equipment inventory CSV into Firestore.
 * Uses the Firestore REST API — no service account needed (rules: allow write: if true).
 */
const fs   = require('fs');
const path = require('path');

const PROJECT_ID     = 'oficiency-1bbf9';
const API_KEY        = 'AIzaSyCcqnXeV1VXdMODF0E0wiqGNjkdCVFBHbU';
const COLLECTION_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/equipment?key=${API_KEY}`;
const CSV_FILE       = path.join(__dirname, 'ציוד Oficiency - בקרה ומלאי - List.csv');

/* ──────────────────────────────────────────────────────────
   CSV parser — handles quoted fields, escaped "" inside
────────────────────────────────────────────────────────── */
function parseCSVLine(line) {
    const fields = [];
    let field = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
            if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
            else if (ch === '"')                   { inQ = false; }
            else                                   { field += ch; }
        } else {
            if      (ch === '"') { inQ = true; }
            else if (ch === ',') { fields.push(field.trim()); field = ''; }
            else                 { field += ch; }
        }
    }
    fields.push(field.trim());
    return fields;
}

/* ──────────────────────────────────────────────────────────
   Categorisation rules (keyword-based, ordered by specificity)
────────────────────────────────────────────────────────── */
function categorize(name) {
    if (/^(מד |בודק |גלאי |פלוק|פלס ד|קליבר|משדר )/.test(name)) return 'מכשירי בדיקה ומדידה';
    if (/^(אימפקט|מטען סוללות)/.test(name))                        return 'כלי עבודה חשמליים';
    if (/^(חבל בטיחות|חליפות|כובעים|מסכות|קסדה|רתמה)/.test(name)) return 'ציוד בטיחות';
    if (/^(אטם|ברז|ווסת לחץ|מוטות הברגה|מעבר|מערכת חינ|פלנצ|צינורות|קלאס|ארגז THT|ANSI|ASME|Klingersil|FB FS)/.test(name)) return 'ציוד לחץ וצנרת';
    if (/^(מפתח|מברג|גרניק|טורק|לום|ראצ|ערכת ראצ|ידית מברז|מומנט|מכופף|מתאם שוודי|בוקסה|סט ביטים|ארגז כלים|ארגז ערכת|ארגז ברגים)/.test(name)) return 'כלי עבודה ידניים';
    if (/^(אנטי|גריז|מדלל|מסקינטייפ|סבון גריז|סמרטוטים|ספירט|ספריי|צבע|WD-40|שק פחם|ברזנט)/.test(name)) return 'חומרים וחוסרים';
    return 'ציוד כללי';
}

/* ──────────────────────────────────────────────────────────
   Holder → status mapping
────────────────────────────────────────────────────────── */
function parseHolder(holderStr) {
    if (!holderStr || holderStr.includes('maor.menachem@oficiency.com')) {
        return { status: 'storage', currentHolder: '' };
    }
    const nameMatch = holderStr.match(/^([^(]+)/);
    const name = (nameMatch ? nameMatch[1] : holderStr).trim();
    return { status: 'active', currentHolder: name };
}

/* ──────────────────────────────────────────────────────────
   Firestore REST helpers
────────────────────────────────────────────────────────── */
function toFsDoc(obj) {
    const fields = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v === null || v === undefined) continue;
        if (typeof v === 'string')  fields[k] = { stringValue: v };
        else if (typeof v === 'number') fields[k] = { integerValue: String(v) };
        else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    }
    return { fields };
}

async function addDoc(item) {
    const res = await fetch(COLLECTION_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(toFsDoc(item)),
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 300)}`);
    }
    return res.json();
}

/* ──────────────────────────────────────────────────────────
   MAIN
────────────────────────────────────────────────────────── */
async function main() {
    console.log('Reading CSV…');
    const raw  = fs.readFileSync(CSV_FILE, 'utf8');
    const lines = raw.split(/\r?\n/).filter(l => l.trim());

    // Skip rows 0 (empty header) and 1 (column names)
    const dataLines = lines.slice(2);

    // Expand into individual items
    const items = [];
    let seqNum = 1;
    const now  = new Date().toISOString();

    for (const line of dataLines) {
        const cols   = parseCSVLine(line);
        const name   = cols[1] || '';
        const qtyRaw = cols[2] || '';
        const holder = cols[3] || '';
        const notes  = cols[5] || '';
        if (!name) continue;

        const qty     = /^\d+$/.test(qtyRaw) ? parseInt(qtyRaw, 10) : 1;
        const cat     = categorize(name);
        const { status, currentHolder } = parseHolder(holder);

        for (let i = 0; i < qty; i++) {
            const serial = `OFC-2026-${String(seqNum).padStart(3, '0')}`;
            items.push({
                name,
                model:        '',
                serialNumber: serial,
                category:     cat,
                status,
                currentHolder,
                notes:        notes || '',
                updatedAt:    now,
            });
            seqNum++;
        }
    }

    console.log(`Parsed ${items.length} items from ${dataLines.length} CSV rows.`);
    console.log('Importing to Firestore…\n');

    // Batch with concurrency 6
    let ok = 0, fail = 0;
    const BATCH = 6;
    for (let i = 0; i < items.length; i += BATCH) {
        const batch = items.slice(i, i + BATCH);
        const results = await Promise.allSettled(batch.map(addDoc));
        for (const r of results) {
            if (r.status === 'fulfilled') { ok++;   }
            else                          { fail++;  console.error('  FAIL:', r.reason.message); }
        }
        const pct = Math.round(((i + batch.length) / items.length) * 100);
        process.stdout.write(`  ${Math.min(i + BATCH, items.length)}/${items.length} (${pct}%)\r`);
    }

    console.log(`\n\nDone. ${ok} imported, ${fail} failed.`);

    // Print category summary
    const byCat = {};
    for (const it of items) byCat[it.category] = (byCat[it.category] || 0) + 1;
    console.log('\nCategory breakdown:');
    Object.entries(byCat).sort((a,b)=>b[1]-a[1]).forEach(([c,n])=>console.log(`  ${c}: ${n}`));
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
