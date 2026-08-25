import { S, esc, fmtDate } from '../api.js';
import { renderRecentLogsInto } from './ManagerPanel.js';
import { buildServiceTypeChart } from '../ui.js';

const _MANAGER_EMAILS = ['sagi.tisson@oficiency.com'];

/* ================================================================
   HOME DASHBOARD
================================================================ */

export function renderHomeDashboard() {
    const isMobile = window.innerWidth <= 768;
    const el = document.getElementById(isMobile ? 'homeDashboard' : 'desktopHomeDashboard');
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

            ${buildServiceTypeChart(monthReports, 'דו"חות החודש')}

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
