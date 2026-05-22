import { apiSubscribePendingRegistrations, apiApproveRegistration, apiRejectRegistration } from '../api.js';
import { showModal, toast } from '../ui.js';

/* ================================================================
   ADMIN PANEL  (sagi.tisson@oficiency.com only)
   Handles pending technician registration approvals.
================================================================ */
export const ADMIN_EMAIL = 'sagi.tisson@oficiency.com';

let _adminUnsub      = null;
let _pendingRequests = [];

function _esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _updateAdminBadge() {
    const badge = document.getElementById('adminBadge');
    if (!badge) return;
    if (_pendingRequests.length > 0) {
        badge.textContent = _pendingRequests.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function _renderRegistrationRequests() {
    const list = document.getElementById('adminRequestsList');
    if (!list) return;
    if (_pendingRequests.length === 0) {
        list.innerHTML = '<div class="reg-requests-empty">אין בקשות הרשמה ממתינות</div>';
        return;
    }
    list.innerHTML = _pendingRequests.map(req => `
        <div class="reg-request-card" id="req-${req.id}">
            <div class="reg-request-info">
                <div class="reg-request-name">${_esc(req.name)}</div>
                <div class="reg-request-email">${_esc(req.email)}</div>
            </div>
            <div class="reg-request-actions">
                <button class="btn-approve" onclick="approveRegistration('${req.id}')">אשר טכנאי</button>
                <button class="btn-reject"  onclick="rejectRegistration('${req.id}')">דחה</button>
            </div>
        </div>`).join('');
}

/* ================================================================
   PUBLIC API
================================================================ */
export function setupAdminPanel(userEmail) {
    if ((userEmail?.toLowerCase().trim()) !== ADMIN_EMAIL) return;
    const adminBtn = document.getElementById('adminPanelBtn');
    if (adminBtn) adminBtn.classList.remove('hidden');
    if (!_adminUnsub) {
        _adminUnsub = apiSubscribePendingRegistrations((requests) => {
            _pendingRequests = requests;
            _updateAdminBadge();
            const modal = document.getElementById('adminPanelModal');
            if (modal && !modal.classList.contains('hidden')) {
                _renderRegistrationRequests();
            }
        });
    }
}

export function cleanupAdminPanel() {
    if (_adminUnsub) { _adminUnsub(); _adminUnsub = null; }
}

/* ================================================================
   WINDOW HANDLERS
================================================================ */
window.showAdminPanel = function() {
    _renderRegistrationRequests();
    showModal('adminPanelModal');
};

window.approveRegistration = async function(docId) {
    const req  = _pendingRequests.find(r => r.id === docId);
    if (!req) { toast('הבקשה כבר טופלה', 'error'); return; }
    const card = document.getElementById(`req-${docId}`);
    if (card) card.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
        await apiApproveRegistration(docId, req.name, req.email, req.password);
        toast(`הטכנאי ${_esc(req.name)} אושר בהצלחה`, 'success');
    } catch (e) {
        console.error('[APPROVE]', e);
        toast('שגיאה באישור הטכנאי: ' + (e.message || ''), 'error');
        if (card) card.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
};

window.rejectRegistration = async function(docId) {
    const card = document.getElementById(`req-${docId}`);
    if (card) card.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
        await apiRejectRegistration(docId);
        toast('הבקשה נדחתה', 'success');
    } catch (e) {
        console.error('[REJECT]', e);
        toast('שגיאה בדחיית הבקשה', 'error');
        if (card) card.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
};
