import { S, esc } from '../api.js';

/* ================================================================
   TASK COUNT
================================================================ */
export function taskCount() {
    return document.querySelectorAll('#tasksList .task-item').length;
}

export function updateTaskCount() {
    const n = taskCount();
    document.getElementById('taskCountBadge').textContent = n + ' משימות';
}

/* ================================================================
   RENDER TASKS LIST
================================================================ */
export function renderTasks(tasks) {
    document.getElementById('tasksList').innerHTML = '';
    let taskNum = 0;
    tasks.forEach(t => {
        if (t.type === 'section') { appendSectionTitle(t); taskNum = 0; }
        else appendTask(t, ++taskNum);
    });
    updateTaskCount();
    setTimeout(() => {
        document.querySelectorAll('#tasksList .task-desc').forEach(ta => {
            if (window.autoExpand) window.autoExpand(ta);
        });
    }, 30);
}

/* ================================================================
   ADD TASK SHORTCUTS (called by UI buttons)
================================================================ */
export function addTask() {
    const id = 'tk_' + (++S.taskCounter);
    appendTask({ id, type: 'task', description: '', status: 'pending', comments: '' }, taskCount() + 1);
    window.markUnsaved?.();
    updateTaskCount();
    setTimeout(() => {
        const last = document.querySelector('#tasksList .task-item:last-child .task-desc');
        if (last) { if (window.autoExpand) window.autoExpand(last); last.focus(); }
    }, 40);
}

export function addRangeTask() {
    const id = 'tk_' + (++S.taskCounter);
    appendTask({ id, type: 'range', description: '', minValue: null, maxValue: null, unit: '', reading: null, status: 'pending', comments: '' }, taskCount() + 1);
    window.markUnsaved?.();
    updateTaskCount();
    setTimeout(() => {
        const last = document.querySelector('#tasksList .task-item:last-child .task-desc');
        if (last) { if (window.autoExpand) window.autoExpand(last); last.focus(); }
    }, 40);
}

export function addSectionTitle() {
    const id = 'sec_' + (++S.taskCounter);
    appendSectionTitle({ id, type: 'section', title: '' });
    window.markUnsaved?.();
    setTimeout(() => {
        const last = document.querySelector('#tasksList .section-title-item:last-of-type .section-title-input');
        if (last) last.focus();
    }, 40);
}

/* ================================================================
   DOM BUILDERS
================================================================ */
export function appendSectionTitle(t) {
    const list = document.getElementById('tasksList');
    const div  = document.createElement('div');
    div.className    = 'section-title-item';
    div.dataset.id   = t.id;
    div.dataset.type = 'section';
    div.innerHTML = `
        <div class="drag-handle" title="גרור לשינוי סדר">⋮⋮</div>
        <input type="text" class="section-title-input" value="${esc(t.title||'')}"
               placeholder="שם האזור / קטגוריה..." oninput="markUnsaved()">
        <button class="section-del-btn" onclick="this.closest('.section-title-item').remove();markUnsaved()">✕</button>
    `;
    list.appendChild(div);
}

export function appendTask(t, num) {
    const list     = document.getElementById('tasksList');
    const isReport = S.currentMode === 'report';
    const div      = document.createElement('div');
    div.dataset.id = t.id;

    if (t.type === 'range') {
        const inputCls   = t.status === 'in_range' ? 'in-range' : t.status === 'out_of_range' ? 'out-of-range' : '';
        const minV       = t.minValue ?? '';
        const maxV       = t.maxValue ?? '';
        const unitStr    = t.unit || '';
        const readingVal = (t.reading != null && t.reading !== '') ? esc(String(t.reading)) : '';
        div.className      = 'task-item';
        div.dataset.type   = 'range';
        div.dataset.status = t.status || 'pending';
        div.innerHTML = `
            <div class="task-row">
                <div class="drag-handle" title="גרור לשינוי סדר">⋮⋮</div>
                <span class="task-num">${num}</span>
                <textarea class="task-desc" rows="1" placeholder="תיאור המשימה..." oninput="markUnsaved();if(window.autoExpand)window.autoExpand(this)">${esc(t.description || '')}</textarea>
                <button class="task-del-btn" onclick="removeTask(this)">✕</button>
            </div>
            <div class="task-range-config">
                <div class="task-range-bounds-group">
                    <span class="task-range-bounds-lbl">ערך מינימום</span>
                    <input type="number" step="any" class="task-range-min" value="${minV !== '' ? esc(String(minV)) : ''}" placeholder="מינ׳" oninput="markUnsaved()">
                </div>
                <span class="task-range-sep">–</span>
                <div class="task-range-bounds-group">
                    <span class="task-range-bounds-lbl">ערך מקסימום</span>
                    <input type="number" step="any" class="task-range-max" value="${maxV !== '' ? esc(String(maxV)) : ''}" placeholder="מקס׳" oninput="markUnsaved()">
                </div>
                <div class="task-range-bounds-group">
                    <span class="task-range-bounds-lbl">יחידה</span>
                    <input type="text" class="task-range-unit" value="${esc(unitStr)}" placeholder="°C" oninput="markUnsaved()">
                </div>
                <div class="task-range-bounds-group task-reading-wrap" style="${isReport ? '' : 'display:none'}">
                    <span class="task-range-bounds-lbl">קריאה בפועל</span>
                    <input type="number" step="any" class="task-reading-input ${inputCls}"
                           value="${readingVal}"
                           placeholder="הכנס קריאה"
                           oninput="if(window.setRangeReading)window.setRangeReading(this)">
                </div>
            </div>
            <textarea class="task-comment" placeholder="הערות למשימה זו..." oninput="markUnsaved()">${esc(t.comments || '')}</textarea>
        `;
    } else {
        const cls = t.status === 'performed' ? 'performed' : t.status === 'not_performed' ? 'not-performed' : t.status === 'under_review' ? 'under-review' : '';
        div.className      = 'task-item ' + cls;
        div.dataset.type   = 'task';
        div.dataset.status = t.status;
        div.innerHTML = `
            <div class="task-row">
                <div class="drag-handle" title="גרור לשינוי סדר">⋮⋮</div>
                <span class="task-num">${num}</span>
                <textarea class="task-desc" rows="1" placeholder="תיאור המשימה..." oninput="markUnsaved();if(window.autoExpand)window.autoExpand(this)">${esc(t.description)}</textarea>
                <div class="status-btns" style="${isReport ? '' : 'display:none'}">
                    <button class="sbtn sbtn-yes    ${t.status==='performed'   ?'active':''}" onclick="setStatus(this,'performed')">✓ תקין</button>
                    <button class="sbtn sbtn-review ${t.status==='under_review'?'active':''}" onclick="setStatus(this,'under_review')">⏳ בבדיקה</button>
                    <button class="sbtn sbtn-no     ${t.status==='not_performed'?'active':''}" onclick="setStatus(this,'not_performed')">✗ לא תקין</button>
                </div>
                <button class="task-del-btn" onclick="removeTask(this)">✕</button>
            </div>
            <textarea class="task-comment" placeholder="הערות למשימה זו..." oninput="markUnsaved()">${esc(t.comments)}</textarea>
        `;
    }
    list.appendChild(div);
}

/* ================================================================
   TASK INTERACTIONS
================================================================ */
export function setStatus(btn, status) {
    const item   = btn.closest('.task-item');
    const toggled = item.dataset.status === status ? 'pending' : status;
    item.dataset.status = toggled;
    item.querySelectorAll('.sbtn').forEach(b => b.classList.remove('active'));
    if (toggled !== 'pending') btn.classList.add('active');
    item.classList.remove('performed', 'not-performed', 'under-review');
    if (toggled === 'performed')     item.classList.add('performed');
    if (toggled === 'not_performed') item.classList.add('not-performed');
    if (toggled === 'under_review')  item.classList.add('under-review');
    window.markUnsaved?.();
}

export function removeTask(btn) {
    btn.closest('.task-item').remove();
    let num = 0;
    document.querySelectorAll('#tasksList .task-item').forEach(el => {
        el.querySelector('.task-num').textContent = ++num;
    });
    window.markUnsaved?.();
    updateTaskCount();
}

/* ================================================================
   COLLECT TASKS FROM DOM
================================================================ */
export function collectTasks() {
    const items = document.querySelectorAll('#tasksList .task-item, #tasksList .section-title-item');
    return Array.from(items).map(el => {
        if (el.dataset.type === 'section') {
            return {
                id:    el.dataset.id,
                type:  'section',
                title: el.querySelector('.section-title-input').value,
            };
        }
        if (el.dataset.type === 'range') {
            const inp     = el.querySelector('.task-reading-input');
            const minInp  = el.querySelector('.task-range-min');
            const maxInp  = el.querySelector('.task-range-max');
            const unitInp = el.querySelector('.task-range-unit');
            const rawVal  = inp?.value;
            const rawMin  = minInp?.value;
            const rawMax  = maxInp?.value;
            return {
                id:          el.dataset.id,
                type:        'range',
                description: el.querySelector('.task-desc').value,
                minValue:    rawMin !== '' && rawMin != null ? Number(rawMin) : null,
                maxValue:    rawMax !== '' && rawMax != null ? Number(rawMax) : null,
                unit:        unitInp?.value.trim() || '',
                reading:     rawVal !== '' && rawVal != null ? Number(rawVal) : null,
                status:      el.dataset.status || 'pending',
                comments:    el.querySelector('.task-comment').value,
            };
        }
        return {
            id:          el.dataset.id,
            type:        'task',
            description: el.querySelector('.task-desc').value,
            status:      el.dataset.status || 'pending',
            comments:    el.querySelector('.task-comment').value,
        };
    });
}

/* ================================================================
   TEMPLATE TASK EDITOR
================================================================ */
export function renderTplTasks(tasks) {
    const list = document.getElementById('tplTaskList');
    list.innerHTML = '';
    let num = 0;
    tasks.forEach(t => {
        if (t.type === 'section')  appendTplSection(t);
        else if (t.type === 'range') appendTplRangeTask(t, ++num);
        else appendTplTask(t, ++num);
    });
}

export function appendTplTask(t, num) {
    const list = document.getElementById('tplTaskList');
    const row  = document.createElement('div');
    row.className    = 'tpl-task-row';
    row.dataset.type = 'task';
    row.innerHTML = `
        <div class="drag-handle" title="גרור לשינוי סדר">⋮⋮</div>
        <span style="font-size:10.5px;font-weight:800;color:var(--slate-400);min-width:20px;text-align:center;flex-shrink:0;">${num}</span>
        <input type="text" class="tpl-task-input" value="${esc(t.description||'')}" placeholder="תיאור משימה...">
        <button class="tpl-task-del" onclick="this.parentElement.remove();renumberTplTasks()">✕</button>
    `;
    list.appendChild(row);
}

export function appendTplSection(t) {
    const list = document.getElementById('tplTaskList');
    const div  = document.createElement('div');
    div.className    = 'section-title-item';
    div.dataset.type = 'section';
    div.innerHTML = `
        <div class="drag-handle" title="גרור לשינוי סדר">⋮⋮</div>
        <input type="text" class="section-title-input" value="${esc(t.title||'')}" placeholder="שם האזור / קטגוריה...">
        <button class="section-del-btn" onclick="this.closest('.section-title-item').remove()">✕</button>
    `;
    list.appendChild(div);
}

export function addTplTask() {
    appendTplTask({ description: '' }, tplTaskCount() + 1);
    setTimeout(() => {
        const last = document.getElementById('tplTaskList').querySelector('.tpl-task-row:last-child .tpl-task-input');
        if (last) last.focus();
    }, 40);
}

export function addTplSection() {
    appendTplSection({ type: 'section', title: '' });
    setTimeout(() => {
        const last = document.getElementById('tplTaskList').querySelector('.section-title-item:last-of-type .section-title-input');
        if (last) last.focus();
    }, 40);
}

export function appendTplRangeTask(t, num) {
    const list = document.getElementById('tplTaskList');
    const row  = document.createElement('div');
    row.className    = 'tpl-task-row';
    row.dataset.type = 'range';
    row.innerHTML = `
        <div class="drag-handle" title="גרור לשינוי סדר">⋮⋮</div>
        <span style="font-size:10.5px;font-weight:800;color:var(--slate-400);min-width:20px;text-align:center;flex-shrink:0;">${num}</span>
        <div class="tpl-range-fields">
            <input type="text" class="tpl-task-input tpl-range-desc" value="${esc(t.description||'')}" placeholder="תיאור מדד...">
            <input type="number" step="any" class="tpl-task-input tpl-range-min" value="${t.minValue ?? ''}" placeholder="מינ׳" title="ערך מינימום">
            <input type="number" step="any" class="tpl-task-input tpl-range-max" value="${t.maxValue ?? ''}" placeholder="מקס׳" title="ערך מקסימום">
            <input type="text" class="tpl-task-input tpl-range-unit" value="${esc(t.unit||'')}" placeholder="יחידה">
        </div>
        <span style="font-size:9px;font-weight:700;color:var(--slate-400);flex-shrink:0;padding:2px 6px;border:1px solid var(--border-low);border-radius:4px;">מדד</span>
        <button class="tpl-task-del" onclick="this.parentElement.remove();renumberTplTasks()">✕</button>
    `;
    list.appendChild(row);
}

export function addTplRangeTask() {
    appendTplRangeTask({ description: '', minValue: null, maxValue: null, unit: '' }, tplTaskCount() + 1);
    setTimeout(() => {
        const last = document.getElementById('tplTaskList').querySelector('.tpl-task-row:last-child .tpl-range-desc');
        if (last) last.focus();
    }, 40);
}

export function tplTaskCount() {
    return document.querySelectorAll('#tplTaskList .tpl-task-row').length;
}

export function renumberTplTasks() {
    let num = 0;
    document.querySelectorAll('#tplTaskList .tpl-task-row').forEach(row => {
        row.querySelector('span').textContent = ++num;
    });
}
