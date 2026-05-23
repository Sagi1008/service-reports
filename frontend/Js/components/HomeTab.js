import { S, esc, fmtDate } from '../api.js';
import { renderRecentLogsInto } from './ManagerPanel.js';

const _MANAGER_EMAILS = ['sagi.tisson@oficiency.com', 'maor.menachem@oficiency.com'];

/* ================================================================
   HOME DASHBOARD
================================================================ */
function _reportStatus(r) {
    const tasks = (r.tasks || []).filter(t => t.type !== 'section');
    const done  = tasks.filter(t => t.status === 'performed').length;
    if (!tasks.length || done === 0) return 'pending';
    if (done === tasks.length)       return 'completed';
    return 'in_progress';
}

export function renderHomeDashboard() {
    const el = document.getElementById('homeDashboard');
    if (!el) return;

    const user     = S.currentUser;
    const rawName  = user?.displayName || user?.email?.split('@')[0] || 'טכנאי';
    const userName = esc(rawName);

    const hour     = new Date().getHours();
    const greeting = hour < 12 ? 'בוקר טוב' : hour < 17 ? 'שלום' : 'ערב טוב';
    const nowDate  = new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const allReports   = Object.values(S.reports).filter(r => r.id);
    const monthStr     = new Date().toISOString().slice(0, 7);
    const monthReports = allReports.filter(r => (r.createdAt || '').startsWith(monthStr));
    const thisMonth    = monthReports.length;
    const active       = allReports.filter(r => { const s = _reportStatus(r); return s === 'pending' || s === 'in_progress'; }).length;
    const validFolders = new Set(Object.keys(S.folders));
    const procTotal    = Object.entries(S.procedures)
        .filter(([key]) => validFolders.has(key))
        .reduce((n, [, arr]) => n + arr.length, 0);

    const SERVICE_TYPES = [
        { val: 'routine', label: 'ביקור תקופתי', color: 'blue'  },
        { val: 'fault',   label: 'תקלה',          color: 'red'   },
        { val: 'extra',   label: 'טיפול נוסף',    color: 'amber' },
        { val: 'other',   label: 'אחר',            color: 'slate' },
    ];
    const knownVals  = new Set(SERVICE_TYPES.map(t => t.val));
    const typeCounts = {};
    SERVICE_TYPES.forEach(t => { typeCounts[t.val] = 0; });
    monthReports.forEach(r => {
        const v = r.serviceType && knownVals.has(r.serviceType) ? r.serviceType : 'other';
        typeCounts[v]++;
    });

    const latest = allReports
        .filter(r => r.title)
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];

    const isManager = _MANAGER_EMAILS.includes(user?.email?.toLowerCase().trim());

    el.innerHTML = `
        <div class="hd-wrap">

            <div class="hd-header">
                <div class="hd-greeting">${greeting},</div>
                <div class="hd-name">${userName}</div>
                <div class="hd-date">${nowDate}</div>
            </div>

            <div class="hd-month-bar">
                <span class="hd-month-label">דו״חות החודש</span>
                <span class="hd-month-total">${thisMonth}</span>
            </div>

            <div class="hd-chart-wrap">
                <div class="hd-bar-track">
                    ${thisMonth > 0
                        ? SERVICE_TYPES.filter(t => typeCounts[t.val] > 0).map(t =>
                            `<div class="hd-bar-seg hd-bar-${t.color}" style="flex:${typeCounts[t.val]}"></div>`
                          ).join('')
                        : '<div class="hd-bar-empty"></div>'}
                </div>
                <div class="hd-legend">
                    ${SERVICE_TYPES.map(t => `
                        <div class="hd-legend-item">
                            <span class="hd-legend-dot hd-bar-${t.color}"></span>
                            <span class="hd-legend-label">${t.label}</span>
                            <span class="hd-legend-count">${typeCounts[t.val]}</span>
                        </div>`).join('')}
                </div>
            </div>

            <div class="hd-kpi-grid">
                <div class="hd-kpi-card hd-kpi-amber">
                    <div class="hd-kpi-value">${active}</div>
                    <div class="hd-kpi-label">דו״חות בטיפול</div>
                </div>
                <div class="hd-kpi-card hd-kpi-green">
                    <div class="hd-kpi-value">${procTotal}</div>
                    <div class="hd-kpi-label">נהלים במערכת</div>
                </div>
            </div>

            <div class="hd-section-label">המשך עבודה מהיר</div>
            ${latest ? `
                <div class="hd-resume-card" onclick="openReport('${esc(latest.id)}');switchTab('reports')">
                    <div class="hd-resume-info">
                        <div class="hd-resume-title">${esc(latest.title)}</div>
                        ${latest.customer ? `<div class="hd-resume-meta">${esc(latest.customer)}</div>` : ''}
                        <div class="hd-resume-meta">${fmtDate(latest.updatedAt || latest.createdAt)}</div>
                    </div>
                    <button class="hd-resume-btn">המשך</button>
                </div>
            ` : `
                <div class="hd-resume-empty">אין דוחות עדיין. לחץ + ליצירת דוח חדש.</div>
            `}

            ${isManager ? `
            <div class="home-logs-section">
                <div class="home-logs-title">תנועות ציוד אחרונות</div>
                <div id="homeRecentLogs" class="home-logs-list">
                    <div class="home-logs-empty">טוען...</div>
                </div>
            </div>` : ''}

        </div>`;

    if (isManager) {
        renderRecentLogsInto(document.getElementById('homeRecentLogs'));
    }
}
