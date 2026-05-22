import { S, esc, apiAddEquipment, apiUpdateEquipment, apiDeleteEquipment, apiLogEquipmentHandover, apiGetApprovedUsers } from '../api.js';
import { showModal, hideModal, toast } from '../ui.js';

const MANAGER_EMAIL = 'maor.menachem@oficiency.com';

/* ================================================================
   EQUIPMENT STATUS CONFIG
================================================================ */
export const EQUIP_STATUS_CONFIG = {
    storage: { label: 'פנוי במחסן', cls: 'eq-badge-storage' },
    active:  { label: 'בשימוש',     cls: 'eq-badge-active'  },
    repair:  { label: 'בתיקון',     cls: 'eq-badge-repair'  },
};

const _EQUIP_CATEGORIES = [
    'כלי עבודה ידניים',
    'ציוד לחץ וצנרת',
    'מכשירי בדיקה ומדידה',
    'חומרים וחוסרים',
    'ציוד בטיחות',
    'כלי עבודה חשמליים',
    'ציוד כללי',
];

/* ================================================================
   EQUIPMENT TAB RENDERER
================================================================ */
export function renderEquipmentTab() {
    const el = document.getElementById('tabEquipment');
    if (!el) return;

    const items = Object.values(S.equipment);
    const totalItems  = items.length;
    const activeItems = items.filter(i => i.status === 'active').length;
    const repairItems = items.filter(i => i.status === 'repair').length;

    const byCategory = {};
    items.forEach(item => {
        const cat = item.category || 'אחר';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(item);
    });

    let html = `
        <div class="eq-wrap">
            <div class="eq-topbar">
                <h2 class="eq-title">ניהול ציוד</h2>
                <div class="eq-topbar-actions">
                    <button class="eq-handover-btn" onclick="showHandoverModal()">העברת ציוד</button>
                    <button class="eq-add-btn" onclick="showAddEquipmentModal()">הוסף ציוד</button>
                </div>
            </div>

            <div class="eq-search-wrap">
                <input type="search" class="eq-search" id="equipSearch"
                       placeholder="חפש ציוד לפי שם / מספר סידורי..."
                       oninput="filterEquipment(this.value)">
            </div>

            <div class="eq-summary-row">
                <div class="eq-summary-chip eq-sum-total">
                    <span class="eq-sum-num">${totalItems}</span>
                    <span class="eq-sum-lbl">פריטים</span>
                </div>
                <div class="eq-summary-chip eq-sum-active">
                    <span class="eq-sum-num">${activeItems}</span>
                    <span class="eq-sum-lbl">בשימוש</span>
                </div>
                <div class="eq-summary-chip eq-sum-repair">
                    <span class="eq-sum-num">${repairItems}</span>
                    <span class="eq-sum-lbl">בתיקון</span>
                </div>
            </div>`;

    if (!totalItems) {
        html += `
            <div class="eq-empty">
                <div class="eq-empty-icon">🔧</div>
                <p>אין פריטי ציוד במערכת.<br>לחץ <strong>+ הוסף</strong> להוספה.</p>
            </div>`;
    } else {
        const orderedCats = _EQUIP_CATEGORIES.filter(c => byCategory[c]);
        const extraCats   = Object.keys(byCategory).filter(c => !_EQUIP_CATEGORIES.includes(c));
        const allCats     = [...orderedCats, ...extraCats];

        allCats.forEach(cat => {
            const catItems = byCategory[cat].slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
            html += `
                <div class="eq-category-section">
                    <div class="eq-category-label">${esc(cat)}</div>
                    <div class="eq-grid">
                        ${catItems.map(_buildEquipCard).join('')}
                    </div>
                </div>`;
        });
    }

    html += `</div>`;
    el.innerHTML = html;
}

function _buildEquipCard(item) {
    const sc     = EQUIP_STATUS_CONFIG[item.status] || EQUIP_STATUS_CONFIG.storage;
    const safeId = esc(item.id);
    return `
        <div class="eq-card" onclick="showEquipmentDetail('${safeId}')">
            <div class="eq-card-header">
                <div class="eq-card-name">${esc(item.name || 'ללא שם')}</div>
                <span class="eq-badge ${sc.cls}">${sc.label}</span>
            </div>
            ${item.model        ? `<div class="eq-card-model">${esc(item.model)}</div>` : ''}
            ${item.serialNumber ? `<div class="eq-card-serial">S/N: ${esc(item.serialNumber)}</div>` : ''}
            ${item.status === 'active' && item.currentHolder
                ? `<div class="eq-card-holder">אצל: ${esc(item.currentHolder)}</div>` : ''}
        </div>`;
}

/* ================================================================
   EQUIPMENT CRUD HANDLERS
================================================================ */
function _equipToggleHolder() {
    const status = document.getElementById('equipStatus').value;
    document.getElementById('equipHolderFg').style.display = status === 'active' ? '' : 'none';
}

window.onEquipStatusChange = _equipToggleHolder;

window.filterEquipment = function(query) {
    const q = (query || '').trim().toLowerCase();
    document.querySelectorAll('.eq-card').forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = (!q || text.includes(q)) ? '' : 'none';
    });
    document.querySelectorAll('.eq-category-section').forEach(section => {
        const anyVisible = Array.from(section.querySelectorAll('.eq-card'))
            .some(c => c.style.display !== 'none');
        section.style.display = anyVisible ? '' : 'none';
    });
};

window.showAddEquipmentModal = function() {
    document.getElementById('equipFormTitle').textContent = 'הוסף ציוד חדש';
    document.getElementById('equipFormId').value     = '';
    document.getElementById('equipName').value       = '';
    document.getElementById('equipModel').value      = '';
    document.getElementById('equipSerial').value     = '';
    document.getElementById('equipCategory').value   = 'כלי עבודה ידניים';
    document.getElementById('equipStatus').value     = 'storage';
    document.getElementById('equipHolder').value     = '';
    document.getElementById('equipNotes').value      = '';
    document.getElementById('equipDeleteBtn').style.display = 'none';
    _equipToggleHolder();
    showModal('equipFormModal');
};

window.showEquipmentDetail = function(id) {
    const item = S.equipment[id];
    if (!item) return;
    document.getElementById('equipFormTitle').textContent = 'ערוך כלי';
    document.getElementById('equipFormId').value     = id;
    document.getElementById('equipName').value       = item.name       || '';
    document.getElementById('equipModel').value      = item.model      || '';
    document.getElementById('equipSerial').value     = item.serialNumber || '';
    document.getElementById('equipCategory').value   = item.category   || 'כלי עבודה ידניים';
    document.getElementById('equipStatus').value     = item.status     || 'storage';
    document.getElementById('equipHolder').value     = item.currentHolder || '';
    document.getElementById('equipNotes').value      = item.notes      || '';
    document.getElementById('equipDeleteBtn').style.display = '';
    _equipToggleHolder();
    showModal('equipFormModal');
};

window.saveEquipment = async function() {
    const id   = document.getElementById('equipFormId').value;
    const name = document.getElementById('equipName').value.trim();
    if (!name) { toast('יש להזין שם לפריט', 'error'); return; }

    const status = document.getElementById('equipStatus').value;
    const data = {
        name,
        model:         document.getElementById('equipModel').value.trim(),
        serialNumber:  document.getElementById('equipSerial').value.trim(),
        category:      document.getElementById('equipCategory').value,
        status,
        currentHolder: status === 'active' ? document.getElementById('equipHolder').value.trim() : '',
        notes:         document.getElementById('equipNotes').value.trim(),
    };

    try {
        if (id) {
            await apiUpdateEquipment(id, data);
            S.equipment[id] = { ...S.equipment[id], ...data };
            toast('הציוד עודכן ✓', 'success');
        } else {
            const item = await apiAddEquipment(data);
            S.equipment[item.id] = item;
            toast('הציוד נוסף ✓', 'success');
        }
        hideModal('equipFormModal');
        renderEquipmentTab();
    } catch (e) {
        console.error('[EQUIP] save error:', e);
        toast('שגיאה בשמירה', 'error');
    }
};

window.deleteEquipmentPrompt = function() {
    const id   = document.getElementById('equipFormId').value;
    const name = document.getElementById('equipName').value || 'פריט זה';
    if (!confirm(`למחוק את "${name}" מהמלאי?`)) return;
    _deleteEquipment(id);
};

async function _deleteEquipment(id) {
    try {
        await apiDeleteEquipment(id);
        delete S.equipment[id];
        hideModal('equipFormModal');
        toast('הפריט נמחק', 'error');
        renderEquipmentTab();
    } catch (e) {
        console.error('[EQUIP] delete error:', e);
        toast('שגיאה במחיקה', 'error');
    }
}

/* ================================================================
   HANDOVER MODAL HANDLERS
================================================================ */
let _handoverAllItems = [];

function _renderHandoverList(filterText) {
    const q    = (filterText || '').trim().toLowerCase();
    const list = document.getElementById('handoverItemList');
    if (!list) return;
    const filtered = q
        ? _handoverAllItems.filter(item =>
            (item.name || '').toLowerCase().includes(q) ||
            (item.serialNumber || '').toLowerCase().includes(q))
        : _handoverAllItems;
    if (!filtered.length) {
        list.innerHTML = '<div class="handover-empty">אין פריטים תואמים</div>';
        return;
    }
    list.innerHTML = filtered.map(item => {
        const sc = EQUIP_STATUS_CONFIG[item.status] || EQUIP_STATUS_CONFIG.storage;
        return `
            <label class="handover-row">
                <input type="checkbox" class="handover-check" data-id="${esc(item.id)}">
                <div class="handover-item-info">
                    <span class="handover-item-name">${esc(item.name || 'ללא שם')}</span>
                    ${item.serialNumber ? `<span class="handover-item-serial">S/N: ${esc(item.serialNumber)}</span>` : ''}
                </div>
                <span class="eq-badge ${sc.cls}">${sc.label}</span>
            </label>`;
    }).join('');
}

window.filterHandoverItems = function(val) {
    _renderHandoverList(val);
};

window.onHandoverTechSelect = function(sel) {
    const val     = sel.value;
    const holderEl = document.getElementById('handoverHolder');
    const emailEl  = document.getElementById('handoverRecipientEmail');
    if (val) {
        try {
            const parsed = JSON.parse(val);
            if (holderEl) holderEl.value = parsed.name  || '';
            if (emailEl)  emailEl.value  = parsed.email || '';
        } catch (_) {}
    } else {
        if (holderEl) holderEl.value = '';
        if (emailEl)  emailEl.value  = '';
    }
};

window.showHandoverModal = async function() {
    _handoverAllItems = Object.values(S.equipment)
        .slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));

    const holderEl = document.getElementById('handoverHolder');
    const emailEl  = document.getElementById('handoverRecipientEmail');
    const searchEl = document.getElementById('handoverSearch');
    const selEl    = document.getElementById('handoverTechSelect');
    if (holderEl) holderEl.value = '';
    if (emailEl)  emailEl.value  = '';
    if (searchEl) searchEl.value = '';
    if (selEl)    selEl.value    = '';

    _renderHandoverList('');

    if (selEl) {
        selEl.innerHTML = '<option value="">בחר טכנאי מהרשימה...</option>';
        try {
            const users = await apiGetApprovedUsers();
            users.forEach(u => {
                const opt = document.createElement('option');
                opt.value = JSON.stringify({ name: u.name, email: u.email });
                opt.textContent = `${u.name} — ${u.email}`;
                selEl.appendChild(opt);
            });
        } catch (e) {
            console.warn('[HANDOVER] could not load approved users:', e.message);
        }
    }

    showModal('handoverModal');
};

window.confirmHandover = async function() {
    const holder         = (document.getElementById('handoverHolder')?.value || '').trim();
    const recipientEmail = (document.getElementById('handoverRecipientEmail')?.value || '').trim();
    if (!holder) { toast('יש לבחור או להזין שם טכנאי', 'error'); return; }
    const checked = Array.from(document.querySelectorAll('.handover-check:checked'));
    if (!checked.length) { toast('יש לבחור לפחות פריט אחד', 'error'); return; }

    const tools = checked.map(cb => {
        const item = S.equipment[cb.dataset.id] || {};
        return { id: cb.dataset.id, name: item.name || 'ציוד', serialNumber: item.serialNumber || '' };
    });

    try {
        await Promise.all(checked.map(cb => {
            const id     = cb.dataset.id;
            const update = { status: 'active', currentHolder: holder };
            S.equipment[id] = { ...S.equipment[id], ...update };
            return apiUpdateEquipment(id, update);
        }));

        const senderName = S.currentUser?.displayName || S.currentUser?.email || 'מנהל המערכת';
        await apiLogEquipmentHandover({ senderName, recipientName: holder, recipientEmail, tools });

        const now = new Date().toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
        const toolLines = tools.map(t =>
            `• ${t.name}${t.serialNumber ? ' - S/N: ' + t.serialNumber : ''}`
        ).join('\n');
        const bodyText = [
            'שלום,',
            '',
            'להלן פרטי תנועת ציוד שבוצעה במערכת Oficiency:',
            '',
            `מוסר: ${senderName}`,
            `מקבל: ${holder}`,
            `תאריך ושעה: ${now}`,
            '',
            'ציוד שהועבר:',
            toolLines,
            '',
            '---',
            'Oficiency | מערכת ניהול ותחזוקה',
        ].join('\n');

        const toField = [recipientEmail, MANAGER_EMAIL].filter(Boolean).join(',');
        const mailUrl = `mailto:${toField}?subject=${encodeURIComponent('עדכון תנועת ציוד במערכת - Oficiency')}&body=${encodeURIComponent(bodyText)}`;
        window.open(mailUrl, '_blank');

        hideModal('handoverModal');
        toast(`${tools.length} פריטים הועברו ל-${holder} — הלוג נשמר ✓`, 'success');
        renderEquipmentTab();
    } catch (e) {
        console.error('[HANDOVER] error:', e);
        toast('שגיאה בהעברה — נסה שוב', 'error');
    }
};
