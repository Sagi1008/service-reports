import { apiSubscribePendingRegistrations, apiApproveRegistration, apiRejectRegistration, apiGetApprovedUsers, apiRevokeUserAccess, apiSubscribeRecentHandoverLogs, apiBackfillTeamDirectory } from '../api.js';
import { toast } from '../ui.js';

/* ================================================================
   MANAGER PANEL  (sagi.tisson@oficiency.com only)
   Renders into TWO containers:
     #managerAdminPanel        – mobile (inside #tabHome)
     #managerAdminPanelDesktop – desktop (inside main.main)
   Recent logs are rendered separately into #homeRecentLogs via
   renderRecentLogsInto(), called from HomeTab.js.
================================================================ */
let _mgrPendingUnsub = null;
let _mgrLogsUnsub    = null;
let _mgrPending      = [];
let _mgrTeam         = [];
let _mgrLogs         = [];

function _esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _fmtDate(iso) {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
    } catch { return iso; }
}

function _getPanelContainers() {
    return [
        document.getElementById('managerAdminPanel'),
        document.getElementById('managerAdminPanelDesktop'),
    ].filter(Boolean);
}

function _renderPending() {
    for (const container of _getPanelContainers()) {
        const el = container.querySelector('[data-mgr-list="pending"]');
        if (!el) continue;

        if (!_mgrPending.length) {
            el.innerHTML = '<div class="mgr-empty">אין בקשות הרשמה ממתינות</div>';
        } else {
            el.innerHTML = _mgrPending.map(req => `
                <div class="mgr-user-row" data-mgrpend="${_esc(req.id)}">
                    <div class="mgr-user-info">
                        <div class="mgr-user-name">${_esc(req.name)}</div>
                        <div class="mgr-user-email">${_esc(req.email)}</div>
                    </div>
                    <div class="mgr-row-actions">
                        <button class="mgr-btn mgr-btn-approve" onclick="mgrApprove('${_esc(req.id)}')">אשר</button>
                        <button class="mgr-btn mgr-btn-block"   onclick="mgrReject('${_esc(req.id)}')">דחה</button>
                    </div>
                </div>`).join('');
        }

        const badge = container.querySelector('[data-mgr-badge="pending"]');
        if (badge) {
            badge.textContent = _mgrPending.length;
            badge.classList.toggle('hidden', _mgrPending.length === 0);
        }
    }
}

function _renderTeam() {
    for (const container of _getPanelContainers()) {
        const el = container.querySelector('[data-mgr-list="team"]');
        if (!el) continue;

        if (!_mgrTeam.length) {
            el.innerHTML = '<div class="mgr-empty">אין חברי צוות מאושרים עדיין</div>';
        } else {
            el.innerHTML = _mgrTeam.map(u => `
                <div class="mgr-user-row" data-mgrteam="${_esc(u.id)}">
                    <div class="mgr-user-info">
                        <div class="mgr-user-name">${_esc(u.name)}</div>
                        <div class="mgr-user-email">${_esc(u.email)}</div>
                    </div>
                    <button class="mgr-btn mgr-btn-revoke" onclick="mgrRevoke('${_esc(u.id)}','${_esc(u.name)}')">בטל גישה</button>
                </div>`).join('');
        }
    }
}

/* Exported so HomeTab.js can call it after re-rendering the dashboard */
export function renderRecentLogsInto(el) {
    if (!el) return;
    if (!_mgrLogs.length) {
        el.innerHTML = '<div class="home-logs-empty">אין תנועות ציוד עדיין</div>';
        return;
    }
    el.innerHTML = _mgrLogs.map(log => {
        const toolCount = (log.tools || []).length;
        const toolLabel = toolCount === 1
            ? _esc((log.tools[0] || {}).name || 'פריט')
            : `${toolCount} פריטים`;
        return `
            <div class="home-log-row">
                <div class="home-log-main">
                    <span class="home-log-from">${_esc(log.senderName || '—')}</span>
                    <span class="home-log-arrow">→</span>
                    <span class="home-log-to">${_esc(log.recipientName || '—')}</span>
                </div>
                <div class="home-log-meta">
                    <span class="home-log-tools">${toolLabel}</span>
                    <span class="home-log-date">${_fmtDate(log.timestamp)}</span>
                </div>
            </div>`;
    }).join('');
}

function _renderLogs() {
    renderRecentLogsInto(document.getElementById('homeRecentLogs'));
}

function _buildPanelHTML() {
    return `
        <div class="mgr-panel">
            <div class="mgr-panel-header">
                <span class="mgr-panel-title">פאנל ניהול מערכת</span>
                <span class="mgr-panel-badge">מנהל</span>
            </div>

            <div class="mgr-section">
                <div class="mgr-section-header">
                    <span class="mgr-section-title">בקשות הרשמה</span>
                    <span data-mgr-badge="pending" class="mgr-count-badge hidden">0</span>
                </div>
                <div data-mgr-list="pending" class="mgr-list">
                    <div class="mgr-empty">טוען...</div>
                </div>
            </div>

            <div class="mgr-section">
                <div class="mgr-section-header">
                    <span class="mgr-section-title">צוות פעיל</span>
                    <button class="mgr-refresh-btn" onclick="mgrRefreshTeam()">רענן</button>
                </div>
                <div data-mgr-list="team" class="mgr-list">
                    <div class="mgr-empty">טוען...</div>
                </div>
            </div>
        </div>`;
}

async function _fetchTeam() {
    try {
        _mgrTeam = await apiGetApprovedUsers();
        _renderTeam();
    } catch (e) {
        for (const container of _getPanelContainers()) {
            const el = container.querySelector('[data-mgr-list="team"]');
            if (el) el.innerHTML = '<div class="mgr-empty">שגיאה בטעינת הצוות</div>';
        }
    }
}

/* ================================================================
   PUBLIC API
================================================================ */
export async function setupManagerPanel() {
    if (_mgrPendingUnsub) return;
    console.log('[MGR PANEL] setting up manager panel');
    const panelHtml = _buildPanelHTML();

    for (const container of _getPanelContainers()) {
        container.classList.remove('hidden');
        container.innerHTML = panelHtml;
    }

    _mgrPendingUnsub = apiSubscribePendingRegistrations((reqs) => {
        _mgrPending = reqs;
        _renderPending();
    });

    _mgrLogsUnsub = apiSubscribeRecentHandoverLogs(10, (logs) => {
        _mgrLogs = logs;
        _renderLogs();
    });

    // Keeps the password-free team_directory collection in sync with
    // already-approved users (one-time-per-login, idempotent) so the
    // equipment handover picker shows the full team to non-admins too.
    await apiBackfillTeamDirectory().catch(e => console.warn('[MGR] team directory backfill failed:', e.message));

    await _fetchTeam();
}

export function cleanupManagerPanel() {
    if (_mgrPendingUnsub) { _mgrPendingUnsub(); _mgrPendingUnsub = null; }
    if (_mgrLogsUnsub)    { _mgrLogsUnsub();    _mgrLogsUnsub    = null; }
    _mgrPending = [];
    _mgrTeam    = [];
    _mgrLogs    = [];
    for (const container of _getPanelContainers()) {
        container.classList.add('hidden');
        container.innerHTML = '';
    }
    const homeLogsEl = document.getElementById('homeRecentLogs');
    if (homeLogsEl) homeLogsEl.innerHTML = '';
}

/* ================================================================
   WINDOW HANDLERS
================================================================ */
window.mgrApprove = async function(docId) {
    const req = _mgrPending.find(r => r.id === docId);
    if (!req) { toast('הבקשה כבר טופלה', 'error'); return; }
    document.querySelectorAll(`[data-mgrpend="${docId}"]`).forEach(row => {
        row.querySelectorAll('button').forEach(b => { b.disabled = true; });
    });
    try {
        await apiApproveRegistration(docId, req.name, req.email, req.password);
        toast(`${_esc(req.name)} אושר בהצלחה`, 'success');
        await _fetchTeam();
    } catch (e) {
        console.error('[MGR APPROVE]', e);
        toast('שגיאה באישור: ' + (e.message || ''), 'error');
        document.querySelectorAll(`[data-mgrpend="${docId}"]`).forEach(row => {
            row.querySelectorAll('button').forEach(b => { b.disabled = false; });
        });
    }
};

window.mgrReject = async function(docId) {
    document.querySelectorAll(`[data-mgrpend="${docId}"]`).forEach(row => {
        row.querySelectorAll('button').forEach(b => { b.disabled = true; });
    });
    try {
        await apiRejectRegistration(docId);
        toast('הבקשה נדחתה', 'success');
    } catch (e) {
        console.error('[MGR REJECT]', e);
        toast('שגיאה בדחיית הבקשה', 'error');
        document.querySelectorAll(`[data-mgrpend="${docId}"]`).forEach(row => {
            row.querySelectorAll('button').forEach(b => { b.disabled = false; });
        });
    }
};

window.mgrRevoke = async function(docId, name) {
    if (!confirm(`לבטל את גישת "${name}" למערכת?`)) return;
    document.querySelectorAll(`[data-mgrteam="${docId}"]`).forEach(row => {
        row.querySelectorAll('button').forEach(b => { b.disabled = true; });
    });
    try {
        await apiRevokeUserAccess(docId);
        toast(`גישת ${name} בוטלה`, 'success');
        await _fetchTeam();
    } catch (e) {
        console.error('[MGR REVOKE]', e);
        toast('שגיאה בביטול הגישה', 'error');
        document.querySelectorAll(`[data-mgrteam="${docId}"]`).forEach(row => {
            row.querySelectorAll('button').forEach(b => { b.disabled = false; });
        });
    }
};

window.mgrRefreshTeam = async function() {
    document.querySelectorAll('.mgr-refresh-btn').forEach(btn => {
        btn.disabled = true; btn.textContent = '...';
    });
    await _fetchTeam();
    document.querySelectorAll('.mgr-refresh-btn').forEach(btn => {
        btn.disabled = false; btn.textContent = 'רענן';
    });
};
