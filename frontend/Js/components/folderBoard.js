import { S, esc, fmtDate } from '../api.js';

/* ================================================================
   FOLDER MAINTENANCE LOG BOARD
   Renders the chronological 3-column service history table for a folder.
================================================================ */
const ST_LABELS = {
    routine:   'תקופתי',
    fault:     'תקלה',
    extra:     'טיפול נוסף',
    other:     'אחר',
    daily_log:       'יומן עבודה',
    weld_inspection: 'ריתוך ויזואלי',
};

const INTERVAL_LABELS = {
    weekly:     'שבועי',
    bimonthly:  'דו-שבועי',
    monthly:    'חודשי',
    quarterly:  'רבעוני',
    semiannual: 'חצי שנתי',
    annual:     'שנתי',
};

export function buildLogBoard(folderName) {
    const ids     = (S.folders[folderName] || []).filter(id => S.reports[id]);
    const reports = ids
        .map(id => S.reports[id])
        .sort((a, b) => (b.visitDate || b.createdAt || '').localeCompare(a.visitDate || a.createdAt || ''));

    if (!reports.length) {
        return `<div class="dash-empty" style="min-height:160px"><p>אין דוחות לתצוגה בלוח הטיפולים.</p></div>`;
    }

    const rows = reports.map(r => {
        const safeId     = esc(r.id);
        const stLabel    = ST_LABELS[r.serviceType] || r.serviceType || '—';
        const interval   = (r.serviceType === 'routine' && r.periodicInterval)
            ? ` (${INTERVAL_LABELS[r.periodicInterval] || r.periodicInterval})`
            : '';
        const serviceStr = esc(stLabel + interval);
        return `<tr class="log-row" onclick="openReport('${safeId}');switchTab('reports')">
            <td class="log-td">${fmtDate(r.visitDate || r.createdAt) || '—'}</td>
            <td class="log-td">${esc(r.tech?.name || '—')}</td>
            <td class="log-td">${serviceStr}</td>
        </tr>`;
    }).join('');

    return `<div class="log-board">
        <table class="log-table">
            <thead><tr>
                <th class="log-th">תאריך טיפול</th>
                <th class="log-th">טכנאי מבצע</th>
                <th class="log-th">סוג טיפול</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>`;
}
