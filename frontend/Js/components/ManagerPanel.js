import { apiSubscribePendingRegistrations, apiApproveRegistration, apiRejectRegistration, apiGetApprovedUsers, apiRevokeUserAccess, apiSubscribeRecentHandoverLogs } from '../api.js';
import { toast } from '../ui.js';

/* ================================================================
   MANAGER PANEL  (maor.menachem@oficiency.com only)
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

function _renderPending() {
    const el = document.getElementById('mgrPendingList');
    if (!el) return;
    if (!_mgrPending.length) {
        el.innerHTML = '<div class="mgr-empty">אין בקשות הרשמה ממתינות</div>';
        return;
    }
    el.innerHTML = _mgrPending.map(req => `
        <div class="mgr-user-row" id="mgrpend-${_esc(req.id)}">
            <div class="mgr-user-info">
                <div class="mgr-user-name">${_esc(req.name)}</div>
                <div class="mgr-user-email">${_esc(req.email)}</div>
            </div>
            <div class="mgr-row-actions">
                <button class="mgr-btn mgr-btn-approve" onclick="mgrApprove('${_esc(req.id)}')">אשר</button>
                <button class="mgr-btn mgr-btn-block"   onclick="mgrReject('${_esc(req.id)}')">חסום</button>
            </div>
        </div>`).join('');

    const badge = document.getElementById('mgrPendingBadge');
    if (badge) {
        badge.textContent = _mgrPending.length;
        badge.classList.toggle('hidden', _mgrPending.length === 0);
    }
}

function _renderTeam() {
    const el = document.getElementById('mgrTeamList');
    if (!el) return;
    if (!_mgrTeam.length) {
        el.innerHTML = '<div class="mgr-empty">אין חברי צוות מאושרים עדיין</div>';
        return;
    }
    el.innerHTML = _mgrTeam.map(u => `
        <div class="mgr-user-row" id="mgrteam-${_esc(u.id)}">
            <div class="mgr-user-info">
                <div class="mgr-user-name">${_esc(u.name)}</div>
                <div class="mgr-user-email">${_esc(u.email)}</div>
            </div>
            <button class="mgr-btn mgr-btn-revoke" onclick="mgrRevoke('${_esc(u.id)}','${_esc(u.name)}')">בטל גישה</button>
        </div>`).join('');
}

function _renderLogs() {
    const el = document.getElementById('mgrLogsList');
    if (!el) return;
    if (!_mgrLogs.length) {
        el.innerHTML = '<div class="mgr-empty">אין לוגים עדיין</div>';
        return;
    }
    el.innerHTML = _mgrLogs.map(log => {
        const toolCount = (log.tools || []).length;
        const toolLabel = toolCount === 1
            ? _esc((log.tools[0] || {}).name || 'פריט')
            : `${toolCount} פריטים`;
        return `
            <div class="mgr-log-row">
                <div class="mgr-log-main">
                    <span class="mgr-log-from">${_esc(log.senderName || '—')}</span>
                    <span class="mgr-log-arrow">→</span>
                    <span class="mgr-log-to">${_esc(log.recipientName || '—')}</span>
                </div>
                <div class="mgr-log-meta">
                    <span class="mgr-log-tools">${toolLabel}</span>
                    <span class="mgr-log-date">${_fmtDate(log.timestamp)}</span>
                </div>
            </div>`;
    }).join('');
}

function _buildPanelHTML() {
    return `
        <div class="mgr-panel">
            <div class="mgr-panel-header">
                <svg class="mgr-lock-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0110 0v4"/>
                </svg>
                <span class="mgr-panel-title">פאנל ניהול מערכת</span>
                <span class="mgr-panel-badge">מנהל</span>
            </div>

            <div class="mgr-section">
                <div class="mgr-section-header">
                    <span class="mgr-section-title">בקשות הרשמה</span>
                    <span id="mgrPendingBadge" class="mgr-count-badge hidden">0</span>
                </div>
                <div id="mgrPendingList" class="mgr-list">
                    <div class="mgr-empty">טוען...</div>
                </div>
            </div>

            <div class="mgr-section">
                <div class="mgr-section-header">
                    <span class="mgr-section-title">צוות פעיל</span>
                    <button class="mgr-refresh-btn" onclick="mgrRefreshTeam()">רענן</button>
                </div>
                <div id="mgrTeamList" class="mgr-list">
                    <div class="mgr-empty">טוען...</div>
                </div>
            </div>

            <div class="mgr-section">
                <div class="mgr-section-header">
                    <span class="mgr-section-title">תנועות ציוד אחרונות</span>
                </div>
                <div id="mgrLogsList" class="mgr-list">
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
        const el = document.getElementById('mgrTeamList');
        if (el) el.innerHTML = '<div class="mgr-empty">שגיאה בטעינת הצוות</div>';
    }
}

/* ================================================================
   PUBLIC API
================================================================ */
export async function setupManagerPanel() {
    const panel = document.getElementById('managerAdminPanel');
    if (!panel) return;
    panel.classList.remove('hidden');
    panel.innerHTML = _buildPanelHTML();

    _mgrPendingUnsub = apiSubscribePendingRegistrations((reqs) => {
        _mgrPending = reqs;
        _renderPending();
    });

    _mgrLogsUnsub = apiSubscribeRecentHandoverLogs(10, (logs) => {
        _mgrLogs = logs;
        _renderLogs();
    });

    await _fetchTeam();
}

export function cleanupManagerPanel() {
    if (_mgrPendingUnsub) { _mgrPendingUnsub(); _mgrPendingUnsub = null; }
    if (_mgrLogsUnsub)    { _mgrLogsUnsub();    _mgrLogsUnsub    = null; }
    _mgrPending = [];
    _mgrTeam    = [];
    _mgrLogs    = [];
}

/* ================================================================
   WINDOW HANDLERS
================================================================ */
window.mgrApprove = async function(docId) {
    const req = _mgrPending.find(r => r.id === docId);
    if (!req) { toast('הבקשה כבר טופלה', 'error'); return; }
    const row = document.getElementById(`mgrpend-${docId}`);
    if (row) row.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
        await apiApproveRegistration(docId, req.name, req.email, req.password);
        toast(`${_esc(req.name)} אושר בהצלחה ✓`, 'success');
        await _fetchTeam();
    } catch (e) {
        console.error('[MGR APPROVE]', e);
        toast('שגיאה באישור: ' + (e.message || ''), 'error');
        if (row) row.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
};

window.mgrReject = async function(docId) {
    const row = document.getElementById(`mgrpend-${docId}`);
    if (row) row.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
        await apiRejectRegistration(docId);
        toast('הבקשה נדחתה', 'success');
    } catch (e) {
        console.error('[MGR REJECT]', e);
        toast('שגיאה בדחיית הבקשה', 'error');
        if (row) row.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
};

window.mgrRevoke = async function(docId, name) {
    if (!confirm(`לבטל את גישת "${name}" למערכת?`)) return;
    const row = document.getElementById(`mgrteam-${docId}`);
    if (row) row.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
        await apiRevokeUserAccess(docId);
        toast(`גישת ${name} בוטלה`, 'success');
        await _fetchTeam();
    } catch (e) {
        console.error('[MGR REVOKE]', e);
        toast('שגיאה בביטול הגישה', 'error');
        if (row) row.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
};

window.mgrRefreshTeam = async function() {
    const btn = document.querySelector('.mgr-refresh-btn');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    await _fetchTeam();
    if (btn) { btn.disabled = false; btn.textContent = 'רענן'; }
};
