import { S, esc, fmtDate, fetchStorageDataUrl } from '../api.js';

/* ================================================================
   LOGO — preload assets/Oficiency Black LOGO.gif as a data URL for PDF embedding
================================================================ */
let _logoPromise = null;

export function preloadLogo() {
    if (!_logoPromise) {
        _logoPromise = new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const c = document.createElement('canvas');
                    c.width  = img.naturalWidth  || 400;
                    c.height = img.naturalHeight || 150;
                    c.getContext('2d').drawImage(img, 0, 0);
                    resolve(c.toDataURL('image/png'));
                } catch { resolve(null); }
            };
            img.onerror = () => resolve(null);
            img.src = 'assets/Oficiency%20Black%20LOGO.gif';
        });
    }
    return _logoPromise;
}

/* ================================================================
   INTERNAL HELPERS
================================================================ */

/** Convert a remote URL to a data: URL for canvas embedding.
 *  Delegates to the Firebase Storage SDK fetch helper (auth-aware, CORS-immune). */
async function _fetchDataUrl(url) {
    return fetchStorageDataUrl(url);
}

/** Scan backward from (startY + pageH) for the nearest near-white pixel row
 *  so page breaks land in whitespace rather than through content. */
function _bestPageCut(canvas, startY, pageH) {
    const SCAN_LIMIT = 150;
    const THRESHOLD  = 248;
    const limit = Math.min(SCAN_LIMIT, Math.floor(pageH * 0.08));
    try {
        const ctx = canvas.getContext('2d');
        for (let dy = 0; dy < limit; dy++) {
            const scanY = startY + pageH - dy;
            if (scanY < 0 || scanY >= canvas.height) break;
            const data = ctx.getImageData(0, scanY, canvas.width, 1).data;
            let white = true;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i] < THRESHOLD || data[i + 1] < THRESHOLD || data[i + 2] < THRESHOLD) {
                    white = false; break;
                }
            }
            if (white) return pageH - dy;
        }
    } catch {}
    return pageH;
}

/* ================================================================
   PRINT LAYOUT — self-contained A4 HTML for html2canvas
   dir=rtl, Heebo font, no external stylesheet dependencies.
================================================================ */
function _buildPrintLayout(r, logoDataUrl, sigTech, sigCust, imgSrcs) {
    const tasks     = r.tasks || [];
    const realTasks = tasks.filter(t => t.type !== 'section');
    const nPerf   = realTasks.filter(t => t.status === 'performed' || t.status === 'in_range').length;
    const nNot    = realTasks.filter(t => t.status === 'not_performed' || t.status === 'out_of_range').length;
    const nReview = realTasks.filter(t => t.status === 'under_review').length;
    const nPend   = realTasks.filter(t => t.status === 'pending').length;
    const docNum = r.number ? esc(r.number) : ('#' + r.id.slice(-8).toUpperCase());

    const STATUS_MAP = {
        performed:     { label: 'תקין',    bg: '#dcfce7', fg: '#166534' },
        not_performed: { label: 'לא תקין', bg: '#fee2e2', fg: '#991b1b' },
        under_review:  { label: 'בבדיקה',  bg: '#fef9c3', fg: '#854d0e' },
        pending:       { label: 'ממתין',   bg: '#f1f5f9', fg: '#64748b' },
        in_range:      { label: 'בטווח',   bg: '#dcfce7', fg: '#166534' },
        out_of_range:  { label: 'חריג',    bg: '#fee2e2', fg: '#991b1b' },
    };

    let rowN = 0;
    const taskRows = tasks.map(t => {
        if (t.type === 'section') {
            return `<tr><td colspan="4" style="
                padding:22px 14px 9px;
                background:#e8edf5;
                border-top:2px solid #c5d0e0;
                border-bottom:1px solid #c5d0e0;
                border-right:5px solid #f59e0b;
                border-left:none;
                font-weight:800;
                font-size:13px;
                color:#1a2640;
                letter-spacing:0.3px;
            ">${esc(t.title || t.label || '')}</td></tr>`;
        }
        rowN++;
        const rowBg = rowN % 2 === 0 ? '#f9fafb' : '#ffffff';

        if (t.type === 'range') {
            const s        = STATUS_MAP[t.status] || STATUS_MAP.pending;
            const reading  = t.reading != null && t.reading !== '' ? String(t.reading) : '—';
            const rangeStr = `${t.minValue ?? '?'}–${t.maxValue ?? '?'}${t.unit ? ' ' + t.unit : ''}`;
            return `<tr style="background:${rowBg};">
              <td style="border:1px solid #e2e8f0;padding:7px 8px;text-align:center;font-size:11px;color:#94a3b8;white-space:nowrap;">${rowN}</td>
              <td style="border:1px solid #e2e8f0;padding:7px 10px;font-size:12px;">
                <bdi style="unicode-bidi:isolate;">${esc(t.description || '')}</bdi>
                <span style="font-size:9.5px;color:#94a3b8;margin-right:5px;unicode-bidi:isolate;display:inline-block;">(${esc(rangeStr)})</span></td>
              <td style="border:1px solid #e2e8f0;padding:7px 8px;text-align:center;">
                <span style="background:${s.bg};color:${s.fg};padding:2px 9px;border-radius:99px;font-size:10px;font-weight:700;white-space:nowrap;">${reading}</span></td>
              <td style="border:1px solid #e2e8f0;padding:7px 10px;font-size:11px;color:#475569;">${esc(t.comments || '')}</td>
            </tr>`;
        }

        const s = STATUS_MAP[t.status] || STATUS_MAP.pending;
        return `<tr style="background:${rowBg};">
          <td style="border:1px solid #e2e8f0;padding:7px 8px;text-align:center;font-size:11px;color:#94a3b8;white-space:nowrap;">${rowN}</td>
          <td style="border:1px solid #e2e8f0;padding:7px 10px;font-size:12px;"><bdi style="unicode-bidi:isolate;">${esc(t.description || '')}</bdi></td>
          <td style="border:1px solid #e2e8f0;padding:7px 8px;text-align:center;">
            <span style="background:${s.bg};color:${s.fg};padding:2px 9px;border-radius:99px;font-size:10px;font-weight:700;white-space:nowrap;">${s.label}</span></td>
          <td style="border:1px solid #e2e8f0;padding:7px 10px;font-size:11px;color:#475569;">${esc(t.comments || '')}</td>
        </tr>`;
    }).join('');

    const PDF_ST_LABELS  = { routine: 'תקופתי', fault: 'תקלה', extra: 'טיפול נוסף', other: 'אחר', daily_log: 'יומן עבודה יומי', weld_inspection: 'בדיקת ריתוך ויזואלי' };
    const PDF_INT_LABELS = { weekly: 'שבועי', bimonthly: 'דו-שבועי', monthly: 'חודשי', quarterly: 'רבעוני', semiannual: 'חצי שנתי', annual: 'שנתי' };
    const stDisp  = PDF_ST_LABELS[r.serviceType] || '';
    const intDisp = (r.serviceType === 'routine' && r.periodicInterval)
        ? ` (${PDF_INT_LABELS[r.periodicInterval] || r.periodicInterval})`
        : '';
    const serviceTypeDisplay = stDisp ? stDisp + intDisp : '';

    const metaItems = [
        ['לקוח',        r.customer],
        ['אתר',         r.site],
        ['טכנאי',       r.tech?.name],
        ['תאריך ביקור', fmtDate(r.visitDate)],
        ['סוג טיפול',   serviceTypeDisplay],
        ['שעת התחלה',   r.startTime],
        ['שעת סיום',    r.endTime],
        ['שעות עבודה',  r.totalHours],
    ].filter(([, v]) => v);

    const statusBadgesHtml = r.serviceType === 'routine'
        ? `<div style="background:#f8fafc;padding:7px 36px;display:flex;gap:10px;flex-direction:row-reverse;justify-content:flex-end;border-bottom:1px solid #e2e8f0;flex-wrap:wrap;">
        <span style="background:#dcfce7;color:#166534;padding:3px 11px;border-radius:99px;font-size:10px;font-weight:700;">&#x2713; &#x05EA;&#x05E7;&#x05D9;&#x05DF;: ${nPerf}</span>
        <span style="background:#fee2e2;color:#991b1b;padding:3px 11px;border-radius:99px;font-size:10px;font-weight:700;">&#x2717; &#x05DC;&#x05D0; &#x05EA;&#x05E7;&#x05D9;&#x05DF;: ${nNot}</span>
        <span style="background:#fef9c3;color:#854d0e;padding:3px 11px;border-radius:99px;font-size:10px;font-weight:700;">&#x23F3; &#x05D1;&#x05D1;&#x05D3;&#x05D9;&#x05E7;&#x05D4;: ${nReview}</span>
        <span style="background:#f1f5f9;color:#475569;padding:3px 11px;border-radius:99px;font-size:10px;font-weight:700;">&#x23F3; &#x05DE;&#x05DE;&#x05EA;&#x05D9;&#x05DF;: ${nPend}</span>
        <span style="background:#e0e7ff;color:#3730a3;padding:3px 11px;border-radius:99px;font-size:10px;font-weight:700;">&#x05E1;&#x05D4;&#x05F4;&#x05DB;: ${realTasks.length}</span>
      </div>`
        : '';

    // Logo block — string concat avoids nested template literal inside outer return
    const logoHtml = logoDataUrl
        ? '<div style="margin-bottom:4px;"><img src="' + logoDataUrl + '" style="height:42px;max-height:42px;width:auto;max-width:180px;object-fit:contain;display:block;flex-shrink:0;"></div>'
        : '<div style="font-size:26px;font-weight:800;letter-spacing:-.5px;color:#1a2640;white-space:nowrap;">Oficiency</div>';

    // General notes — pre-computed so the return template stays flat
    const permCommentsHtml = r.permComments
        ? '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px 14px;margin-bottom:16px;">'
            + '<div style="font-size:10px;font-weight:700;color:#92400e;margin-bottom:3px;">הערות כלליות</div>'
            + '<div style="font-size:11px;color:#78350f;">' + esc(r.permComments).replace(/\n/g, '<br>') + '</div>'
            + '</div>'
        : '';

    // Tasks table — defensive guard: renders cleanly whether tasks is empty or populated
    const tasksHtml = tasks.length
        ? '<div style="margin-bottom:20px;">'
            + '<div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.5px;text-transform:uppercase;border-bottom:2px solid #1a2640;padding-bottom:5px;margin-bottom:8px;">משימות</div>'
            + '<table style="width:100%;border-collapse:collapse;">'
            + '<thead><tr style="background:#1a2640;color:#fff;">'
            + '<th style="border:1px solid #334155;padding:8px;text-align:center;width:32px;font-size:10px;">#</th>'
            + '<th style="border:1px solid #334155;padding:8px 10px;text-align:right;font-size:10px;">תיאור</th>'
            + '<th style="border:1px solid #334155;padding:8px;text-align:center;width:80px;font-size:10px;">סטטוס</th>'
            + '<th style="border:1px solid #334155;padding:8px 10px;text-align:right;width:175px;font-size:10px;">הערות</th>'
            + '</tr></thead>'
            + '<tbody>' + taskRows + '</tbody>'
            + '</table></div>'
        : '<div style="width:850px !important;min-width:850px !important;height:1px;background:transparent;display:block;clear:both;"></div>';

    // Final comments — pre-computed
    const finalCommentsHtml = r.finalComments
        ? '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 14px;margin-bottom:16px;">'
            + '<div style="font-size:10px;font-weight:700;color:#334155;margin-bottom:4px;">הערות סיום</div>'
            + '<div style="font-size:11px;">' + esc(r.finalComments).replace(/\n/g, '<br>') + '</div>'
            + '</div>'
        : '';

    const validSrcs = imgSrcs.filter(Boolean);
    const imgStyle  = 'width:calc(50% - 6px);max-width:calc(50% - 6px);height:auto;border-radius:6px;border:1px solid #e2e8f0;display:block;';

    const imagesHtml = validSrcs.length
        ? '<div style="margin-top:28px;">'
            + '<div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.5px;text-transform:uppercase;border-bottom:2px solid #1a2640;padding-bottom:5px;margin-bottom:12px;">תמונות</div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:12px;">'
            + validSrcs.map(src => '<img src="' + src + '" style="' + imgStyle + '">').join('')
            + '</div></div>'
        : '<div style="width:850px !important;min-width:850px !important;height:50px;display:block;clear:both;"></div>';

    // Signature box — string concat, no nested template literals
    const sigBox = function(sig, label, name, date) {
        const imgHtml  = sig  ? '<img src="' + sig + '" style="max-height:62px;max-width:180px;object-fit:contain;">' : '';
        const dateHtml = date ? '<div style="font-size:10px;color:#94a3b8;">' + date + '</div>' : '';
        return '<div style="flex:1;min-width:0;text-align:center;">'
            + '<div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:8px;">' + label + '</div>'
            + '<div style="height:72px;border:1px solid #cbd5e1;border-radius:6px;display:flex;align-items:center;justify-content:center;background:#f8fafc;">'
            + imgHtml
            + '</div>'
            + '<div style="margin-top:6px;font-size:12px;font-weight:600;color:#1a2640;">' + esc(name || '') + '</div>'
            + dateHtml
            + '</div>';
    };

    return `
    <div style="width:850px !important;min-width:850px !important;padding:0 !important;margin:0 !important;box-sizing:border-box !important;direction:rtl !important;font-family:Heebo,Arial,sans-serif;color:#1a1a2e;background:#fff;overflow:visible;">

      <!-- HEADER -->
      <div style="background:#ffffff;color:#1a2640;padding:22px 36px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #e2e8f0;">
        <div>
          ${logoHtml}
          <div style="font-size:10px;color:#64748b;margin-top:2px;font-weight:500;white-space:nowrap;">מערכת דוחות שירות</div>
        </div>
        <div style="text-align:left;white-space:nowrap;">
          <div style="font-size:9px;color:#64748b;font-weight:600;margin-bottom:2px;white-space:nowrap;">מספר דוח</div>
          <div style="font-size:16px;font-weight:700;color:#1a2640;white-space:nowrap;">${docNum}</div>
        </div>
      </div>

      <!-- META STRIP -->
      <div style="background:#eef2f9;padding:10px 36px;display:flex;gap:28px;flex-direction:row-reverse;justify-content:flex-end;border-bottom:1px solid #d1dae8;flex-wrap:wrap;">
        ${metaItems.map(([k, v]) => `
          <div style="width:170px !important;white-space:nowrap !important;word-break:keep-all !important;flex-shrink:0;">
            <div style="font-size:9px;color:#64748b;font-weight:600;white-space:nowrap !important;word-break:keep-all !important;">${k}</div>
            <div style="font-size:12px;font-weight:700;color:#1a2640;white-space:nowrap !important;word-break:keep-all !important;">${esc(v)}</div>
          </div>`).join('')}
      </div>

      <!-- STATUS BADGES — only for periodic visits which have a predefined checklist -->
      ${statusBadgesHtml}

      <!-- MAIN CONTENT -->
      <div style="padding:24px 36px;">

        <div style="font-size:17px;font-weight:800;color:#1a2640;margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid #1a2640;">
          ${esc(r.title || '')}
        </div>

        ${permCommentsHtml}

        ${tasksHtml}

        ${finalCommentsHtml}

        ${imagesHtml}

        <!-- SIGNATURES -->
        <div style="display:flex;gap:24px;margin-top:36px;padding-top:20px;border-top:2px solid #e2e8f0;">
          ${sigBox(sigTech, 'חתימת טכנאי', r.tech?.name, fmtDate(r.tech?.compDate))}
          ${sigBox(sigCust, 'חתימת לקוח',  r.customer,   '')}
        </div>

      </div>

      <!-- FOOTER -->
      <div style="background:#f1f5f9;border-top:1px solid #e2e8f0;padding:8px 36px;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8;">
        <span>Oficiency © ${new Date().getFullYear()}</span>
        <span>הופק: ${new Date().toLocaleDateString('he-IL')}</span>
      </div>

    </div>`;
}

/* ================================================================
   DAILY LOG PDF LAYOUT
================================================================ */
function _buildDailyLogLayout(r, logoDataUrl, sigTech, sigCust, imgSrcs) {
    const dl     = r.dailyLog || {};
    const docNum = r.number ? esc(r.number) : ('#' + r.id.slice(-8).toUpperCase());

    const logoHtml = logoDataUrl
        ? '<img src="' + logoDataUrl + '" style="height:38px;max-height:38px;width:auto;max-width:150px;object-fit:contain;display:block;">'
        : '<div style="font-size:22px;font-weight:800;color:#1a2640;">Oficiency</div>';

    // Table builder
    const tblSection = function(title) {
        return '<div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.5px;text-transform:uppercase;border-bottom:2px solid #1a2640;padding-bottom:4px;margin:18px 0 8px;">' + title + '</div>';
    };
    // Columns that should stay narrow and not wrap — auto-size to their content
    const NO_WRAP_HDRS = new Set(['שם + משפחה', 'מקצוע', 'כמות', 'קבלן משנה', 'שם / סוג ציוד']);
    const buildTbl = function(headers, rows) {
        const ths = headers.map(function(h, i, arr) {
            const isFirst = i === 0;
            const isLast  = i === arr.length - 1 && h === 'חתימה';
            let extra;
            if (isFirst)           extra = 'width:30px;text-align:center;white-space:nowrap;';
            else if (isLast)       extra = 'width:54px;text-align:center;white-space:nowrap;';
            else if (NO_WRAP_HDRS.has(h)) extra = 'white-space:nowrap;';
            else                   extra = 'min-width:160px;';
            return '<th style="background:#1a2640;color:#fff;padding:6px 8px;border:1px solid #334155;font-size:10px;text-align:right;' + extra + '">' + h + '</th>';
        }).join('');
        const trs = rows.length ? rows.map(function(cells, ri) {
            const bg = ri % 2 === 0 ? '#ffffff' : '#f9fafb';
            const tds = cells.map(function(cell, ci, arr) {
                const isNum      = ci === 0;
                const h          = headers[ci];
                const isLastCol  = ci === arr.length - 1;
                const isMark     = isLastCol && h === 'חתימה';
                const isNoWrap   = !isNum && !isMark && NO_WRAP_HDRS.has(h);
                let extraStyle;
                if (isNum)         extraStyle = 'text-align:center;font-weight:700;color:#94a3b8;width:30px;';
                else if (isMark)   extraStyle = 'text-align:center;font-size:14px;color:#166534;font-weight:700;width:54px;';
                else if (isNoWrap) extraStyle = 'white-space:nowrap;';
                else               extraStyle = 'word-break:break-word;white-space:normal;word-wrap:break-word;overflow-wrap:break-word;min-width:160px;';
                return '<td style="border:1px solid #e2e8f0;padding:6px 8px;font-size:11.5px;' + extraStyle + '"><bdi style="unicode-bidi:isolate;">' + esc(cell || '') + '</bdi></td>';
            }).join('');
            return '<tr style="background:' + bg + ';">' + tds + '</tr>';
        }).join('') : '<tr><td colspan="' + headers.length + '" style="border:1px solid #e2e8f0;padding:10px 8px;text-align:center;color:#94a3b8;font-size:11px;">אין נתונים</td></tr>';
        return '<table style="width:100%;border-collapse:collapse;table-layout:auto;"><thead><tr>' + ths + '</tr></thead><tbody>' + trs + '</tbody></table>';
    };

    const actRows  = (dl.activities   || []).map(function(a, i) { return [String(i+1), a.contractTask, a.notes, a.signed ? '✓' : '']; });
    const dwRows   = (dl.dailyWorkers  || []).map(function(w, i) { return [String(i+1), w.name, w.profession, w.notes]; });
    const swRows   = (dl.subWorkers    || []).map(function(w, i) { return [String(i+1), w.contractor, w.profession, w.notes]; });
    const eqRows   = (dl.equipment     || []).map(function(e, i) { return [String(i+1), e.name, e.quantity, e.notes]; });

    const notesBox = function(text) {
        return text ? '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 14px;min-height:44px;font-size:11.5px;color:#1a2640;white-space:pre-wrap;">' + esc(text).replace(/\n/g, '<br>') + '</div>' : '';
    };

    const sigBox = function(sig, label, name) {
        const img = sig ? '<img src="' + sig + '" style="max-height:58px;max-width:160px;object-fit:contain;">' : '<div style="height:48px;display:flex;align-items:center;justify-content:center;color:#cbd5e1;font-size:10px;">אין חתימה</div>';
        return '<div style="flex:1;min-width:0;text-align:center;padding:10px 18px;">'
            + '<div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:6px;">' + label + '</div>'
            + '<div style="height:66px;border:1px solid #cbd5e1;border-radius:6px;display:flex;align-items:center;justify-content:center;background:#f8fafc;margin-bottom:5px;">' + img + '</div>'
            + '<div style="font-size:11.5px;font-weight:600;color:#1a2640;">' + esc(name || '') + '</div>'
            + '</div>';
    };

    // Images — identical logic to _buildPrintLayout (proven working)
    const validSrcs = imgSrcs.filter(Boolean);
    const imgStyle  = 'width:calc(50% - 6px);max-width:calc(50% - 6px);height:auto;border-radius:6px;border:1px solid #e2e8f0;display:block;';
    const imagesHtml = validSrcs.length
        ? '<div style="margin-top:28px;">'
            + '<div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.5px;text-transform:uppercase;border-bottom:2px solid #1a2640;padding-bottom:5px;margin-bottom:12px;">תמונות</div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:12px;">'
            + validSrcs.map(src => '<img src="' + src + '" style="' + imgStyle + '">').join('')
            + '</div></div>'
        : '';

    return `
    <div style="width:850px !important;min-width:850px !important;padding:0 !important;margin:0 !important;box-sizing:border-box !important;direction:rtl !important;font-family:Heebo,Arial,sans-serif;color:#1a1a2e;background:#fff;overflow:visible;">

      <!-- HEADER -->
      <div style="background:#fff;padding:18px 36px;display:flex;align-items:center;border-bottom:3px solid #1a2640;">
        <div style="flex:1;">${logoHtml}<div style="font-size:9px;color:#64748b;margin-top:3px;font-weight:500;">מערכת דוחות שירות</div></div>
        <div style="text-align:center;">
          <div style="font-size:19px;font-weight:800;color:#1a2640;letter-spacing:0.4px;">יומן עבודה - יומי</div>
          <div style="font-size:10px;color:#64748b;margin-top:2px;">${esc(r.customer||'')}${r.site ? ' | ' + esc(r.site) : ''}</div>
        </div>
        <div style="flex:1;text-align:left;">
          <div style="font-size:9px;color:#64748b;font-weight:600;margin-bottom:2px;">מספר יומן</div>
          <div style="font-size:14px;font-weight:700;color:#1a2640;">${docNum}</div>
        </div>
      </div>

      <!-- META TABLE -->
      <table style="width:100%;border-collapse:collapse;border-bottom:1px solid #e2e8f0;">
        <tr>
          <td style="border:1px solid #e2e8f0;padding:7px 10px;font-size:10px;font-weight:600;color:#64748b;background:#eef2f9;width:72px;">תאריך</td>
          <td style="border:1px solid #e2e8f0;padding:7px 10px;font-size:12px;font-weight:700;">${esc(r.visitDate||'')}</td>
          <td style="border:1px solid #e2e8f0;padding:7px 10px;font-size:10px;font-weight:600;color:#64748b;background:#eef2f9;width:76px;">יום בשבוע</td>
          <td style="border:1px solid #e2e8f0;padding:7px 10px;font-size:12px;font-weight:700;">${esc(dl.dayOfWeek||'')}</td>
          <td style="border:1px solid #e2e8f0;padding:7px 10px;font-size:10px;font-weight:600;color:#64748b;background:#eef2f9;width:68px;">מזג אוויר</td>
          <td style="border:1px solid #e2e8f0;padding:7px 10px;font-size:12px;font-weight:700;">${esc(dl.weather||'')}</td>
          <td style="border:1px solid #e2e8f0;padding:7px 10px;font-size:10px;font-weight:600;color:#64748b;background:#eef2f9;width:88px;">מנהל עבודה</td>
          <td style="border:1px solid #e2e8f0;padding:7px 10px;font-size:12px;font-weight:700;">${esc(r.tech?.name||'')}</td>
        </tr>
      </table>

      <!-- CONTENT -->
      <div style="padding:14px 36px 24px;">

        ${dl.projectDesc ? tblSection('תיאור הפעילות בפרויקט / מקטע / מגרש') + '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 14px;font-size:11.5px;color:#1a2640;white-space:pre-wrap;margin-bottom:4px;">' + esc(dl.projectDesc) + '</div>' : ''}

        ${tblSection('פעילות')}
        ${buildTbl(['#', 'פעילות / משימה (על פי חוזה)', 'הערות', 'חתימה'], actRows)}

        ${tblSection("פועלים ב'יומית'")}
        ${buildTbl(['#', 'שם + משפחה', 'מקצוע', 'הערות'], dwRows)}

        ${tblSection('פועלים לקבלני משנה')}
        ${buildTbl(['#', 'קבלן משנה', 'מקצוע', 'הערות'], swRows)}

        ${tblSection('ציוד מכאני הנדסי')}
        ${buildTbl(['#', 'שם / סוג ציוד', 'כמות', 'הערות'], eqRows)}

        ${dl.generalNotes ? tblSection('הערות כלליות') + notesBox(dl.generalNotes) : ''}

        ${dl.supervisorNotes ? tblSection('הערות מפקח') + notesBox(dl.supervisorNotes) : ''}

        ${imagesHtml}

        <!-- SIGNATURES -->
        <div style="margin-top:24px;padding-top:14px;border-top:2px solid #1a2640;">
          <div style="font-size:11px;font-weight:800;color:#1a2640;margin-bottom:10px;letter-spacing:0.3px;">אישור ליומן עבודה יומי (חתימות)</div>
          <div style="display:flex;gap:0;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;">
            ${sigBox(sigTech, 'חתימת מנהל עבודה', r.tech?.name)}
            <div style="width:1px;background:#e2e8f0;flex-shrink:0;"></div>
            ${sigBox(sigCust, 'חתימת מפקח', '')}
          </div>
        </div>

      </div>

      <!-- FOOTER -->
      <div style="background:#f1f5f9;border-top:1px solid #e2e8f0;padding:8px 36px;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8;">
        <span>Oficiency \xA9 ${new Date().getFullYear()}</span>
        <span>הופק: ${new Date().toLocaleDateString('he-IL')}</span>
      </div>

    </div>`;
}

/* ================================================================
   WELD INSPECTION PDF LAYOUT
================================================================ */
function _buildWeldInspectionLayout(r, logoDataUrl, sigTech, sigCust, imgSrcs) {
    const wi     = r.weldInspection || {};
    const docNum = r.number ? esc(r.number) : ('#' + r.id.slice(-8).toUpperCase());

    const logoHtml = logoDataUrl
        ? '<img src="' + logoDataUrl + '" style="height:48px;width:auto;display:block;">'
        : '<div style="height:48px;width:48px;background:#1a2640;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:18px;">O</div>';

    const metaRow = (label, value) =>
        '<tr><td style="background:#f8fafc;border:1px solid #e2e8f0;padding:5px 8px;font-size:9px;font-weight:700;color:#64748b;white-space:nowrap;">' + label + '</td>'
        + '<td style="border:1px solid #e2e8f0;padding:5px 8px;font-size:10.5px;color:#1a2640;">' + esc(value || '—') + '</td></tr>';

    const metaTbl = (rows) =>
        '<table style="border-collapse:collapse;width:100%;">' + rows + '</table>';

    const badge = (val) => {
        const styles = {
            AS: 'background:#dcfce7;color:#166534;',
            NR: 'background:#fef9c3;color:#92400e;',
            NT: 'background:#fee2e2;color:#991b1b;',
        };
        if (!val) return '<span style="color:#94a3b8;">—</span>';
        return '<span style="display:inline-block;padding:1px 7px;border-radius:10px;font-size:9.5px;font-weight:700;' + (styles[val] || '') + '">' + esc(val) + '</span>';
    };

    const rows = wi.rows || [];
    const inspRows = rows.map((row, i) =>
        '<tr style="background:' + (i % 2 === 0 ? '#fff' : '#f8fafc') + ';">'
        + '<td style="border:1px solid #e2e8f0;padding:4px 5px;text-align:center;font-size:10px;font-weight:700;color:#94a3b8;">' + (i + 1) + '</td>'
        + '<td style="border:1px solid #e2e8f0;padding:4px 5px;font-size:10px;">' + esc(row.kp || '') + '</td>'
        + '<td style="border:1px solid #e2e8f0;padding:4px 5px;font-size:10px;">' + esc(row.itemName || '') + '</td>'
        + '<td style="border:1px solid #e2e8f0;padding:4px 5px;font-size:10px;">' + esc(row.weldNo || '') + '</td>'
        + '<td style="border:1px solid #e2e8f0;padding:4px 5px;font-size:10px;">' + esc(row.heatNo || '') + '</td>'
        + '<td style="border:1px solid #e2e8f0;padding:4px 5px;font-size:10px;">' + esc(row.pipeLength || '') + '</td>'
        + '<td style="border:1px solid #e2e8f0;padding:4px 5px;text-align:center;">' + badge(row.fitUp) + '</td>'
        + '<td style="border:1px solid #e2e8f0;padding:4px 5px;text-align:center;">' + badge(row.welderStamp) + '</td>'
        + '<td style="border:1px solid #e2e8f0;padding:4px 5px;text-align:center;">' + badge(row.visualRoot) + '</td>'
        + '<td style="border:1px solid #e2e8f0;padding:4px 5px;text-align:center;">' + badge(row.visualHot) + '</td>'
        + '<td style="border:1px solid #e2e8f0;padding:4px 5px;text-align:center;">' + badge(row.visualFillCap) + '</td>'
        + '</tr>'
    ).join('') || '<tr><td colspan="11" style="border:1px solid #e2e8f0;padding:10px;text-align:center;color:#94a3b8;font-size:10px;">אין שורות בדיקה</td></tr>';

    const thStyle = 'background:#1a2640;color:#fff;border:1px solid #1a2640;padding:5px 4px;font-size:9px;text-align:center;white-space:nowrap;';

    const validSrcs = imgSrcs.filter(Boolean);
    const imgStyle  = 'width:calc(50% - 6px);max-width:calc(50% - 6px);height:auto;border-radius:6px;border:1px solid #e2e8f0;display:block;';
    const imagesHtml = validSrcs.length
        ? '<div style="margin-top:28px;">'
            + '<div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.5px;text-transform:uppercase;border-bottom:2px solid #1a2640;padding-bottom:5px;margin-bottom:12px;">תמונות</div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:12px;">'
            + validSrcs.map(src => '<img src="' + src + '" style="' + imgStyle + '">').join('')
            + '</div></div>'
        : '';

    const sigBox = (sig, label, name) =>
        '<div style="flex:1;padding:14px 16px;">'
        + '<div style="font-size:9px;font-weight:700;color:#64748b;margin-bottom:6px;">' + label + '</div>'
        + (sig ? '<img src="' + sig + '" style="height:52px;max-width:100%;object-fit:contain;display:block;margin-bottom:6px;">' : '<div style="height:52px;border-bottom:1px solid #cbd5e1;margin-bottom:6px;"></div>')
        + '<div style="font-size:11.5px;font-weight:600;color:#1a2640;">' + esc(name || '') + '</div>'
        + '</div>';

    return `<div style="direction:ltr;font-family:'Heebo',Arial,sans-serif;background:#fff;min-height:297mm;">

      <!-- HEADER -->
      <div style="background:#1a2640;padding:18px 36px;display:flex;align-items:center;justify-content:space-between;">
        <div>${logoHtml}</div>
        <div style="text-align:center;">
          <div style="color:#fff;font-size:17px;font-weight:900;letter-spacing:0.3px;">Pipeline Welding Visual Inspection Report</div>
          <div style="color:#94a3b8;font-size:10px;margin-top:3px;">OFCY-WELD-03-03-A | בדיקת ריתוך ויזואלי</div>
        </div>
        <div style="text-align:right;">
          <div style="color:#fff;font-size:11px;font-weight:700;">Report No.</div>
          <div style="color:#e2e8f0;font-size:13px;font-weight:900;">${esc(wi.reportNo || docNum)}</div>
          <div style="color:#94a3b8;font-size:10px;margin-top:2px;">${esc(wi.date || '')}</div>
        </div>
      </div>

      <!-- BODY -->
      <div style="padding:20px 36px;">

        <!-- Project info (2-col meta tables) -->
        <div style="display:flex;gap:14px;margin-bottom:16px;">
          <div style="flex:1;">
            ${metaTbl(
              metaRow('Company', wi.company) +
              metaRow('Job', wi.job) +
              metaRow('Area', wi.area) +
              metaRow('Plant Location', wi.plantLocation) +
              metaRow('QC Code', wi.qcCode) +
              metaRow('Project Title', wi.projectTitle)
            )}
          </div>
          <div style="flex:1;">
            ${metaTbl(
              metaRow('Alignment Sheet No.', wi.alignmentSheetNo) +
              metaRow('Thickness', wi.thickness) +
              metaRow('Diameter', wi.diameter) +
              metaRow('WPS No.', wi.wpsNo) +
              metaRow('Material', wi.material) +
              metaRow('Welding Process', wi.weldingProcess)
            )}
          </div>
        </div>

        <!-- Section header -->
        <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.5px;text-transform:uppercase;border-bottom:2px solid #1a2640;padding-bottom:5px;margin-bottom:10px;">Weld Inspection Log</div>

        <!-- Inspection table -->
        <table style="border-collapse:collapse;width:100%;table-layout:fixed;">
          <colgroup>
            <col style="width:22px;"><col style="width:48px;"><col style="width:96px;">
            <col style="width:64px;"><col style="width:64px;"><col style="width:58px;">
            <col style="width:72px;"><col style="width:76px;">
            <col style="width:70px;"><col style="width:70px;"><col>
          </colgroup>
          <thead><tr>
            <th style="${thStyle}">#</th>
            <th style="${thStyle}">K.P.</th>
            <th style="${thStyle}">Item Name (1/2)</th>
            <th style="${thStyle}">Weld No.</th>
            <th style="${thStyle}">Heat No.</th>
            <th style="${thStyle}">Pipe Length</th>
            <th style="${thStyle}">Fit-up &amp; Align.</th>
            <th style="${thStyle}">Welder STAMP</th>
            <th style="${thStyle}">Visual Root</th>
            <th style="${thStyle}">Visual Hot</th>
            <th style="${thStyle}">Visual Fill &amp; Cap</th>
          </tr></thead>
          <tbody>${inspRows}</tbody>
        </table>

        ${wi.remarks ? '<div style="margin-top:16px;"><div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin-bottom:8px;">Remarks / הערות</div><div style="font-size:11px;color:#1a2640;padding:8px 10px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;white-space:pre-wrap;">' + esc(wi.remarks) + '</div></div>' : ''}

        ${imagesHtml}

        <!-- Signatures -->
        <div style="margin-top:24px;padding-top:14px;border-top:2px solid #1a2640;">
          <div style="font-size:11px;font-weight:800;color:#1a2640;margin-bottom:10px;">Signatures / חתימות</div>
          <!-- Reviewed/Witnessed By (text only) -->
          <div style="display:flex;gap:14px;margin-bottom:12px;">
            <div style="flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;">
              <div style="font-size:9px;font-weight:700;color:#64748b;margin-bottom:6px;">Reviewed / Witnessed By</div>
              <div style="height:36px;border-bottom:1px solid #cbd5e1;margin-bottom:4px;"></div>
              <div style="font-size:11px;color:#1a2640;">${esc(wi.reviewedByName || '')}</div>
              <div style="font-size:10px;color:#64748b;margin-top:2px;">${esc(wi.reviewedByDate || '')}</div>
            </div>
          </div>
          <!-- Prepared By / Approved By (with sig pads) -->
          <div style="display:flex;gap:0;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;">
            ${sigBox(sigTech, 'Prepared By — ' + (r.tech?.name || ''), wi.approvedByDate ? '' : r.tech?.name)}
            <div style="width:1px;background:#e2e8f0;flex-shrink:0;"></div>
            ${sigBox(sigCust, 'Reviewed / Approved By', (wi.approvedByName || '') + (wi.approvedByDate ? '  ' + wi.approvedByDate : ''))}
          </div>
        </div>

      </div>

      <!-- FOOTER -->
      <div style="background:#f1f5f9;border-top:1px solid #e2e8f0;padding:8px 36px;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8;">
        <span>Oficiency \xA9 ${new Date().getFullYear()}</span>
        <span>Generated: ${new Date().toLocaleDateString('en-GB')}</span>
      </div>

    </div>`;
}

/* ================================================================
   PDF DOWNLOAD
   Calls window.saveReport to avoid a circular import with reports.js.
   window.saveReport is registered by app.js before any user interaction.
================================================================ */
export async function downloadPDF(returnBlob = false) {
    if (!S.currentId) { window.toast?.('אין דוח פתוח', 'error'); return null; }
    const r = S.reports[S.currentId];
    if (!r) { window.toast?.('הדוח לא נמצא – רענן את הדף', 'error'); return null; }

    await window.saveReport?.();

    const overlay    = document.getElementById('loadingOverlay');
    const overlayMsg = document.getElementById('loadingMsg');
    if (overlayMsg) overlayMsg.textContent = 'מייצר PDF...';
    overlay?.classList.remove('hidden');

    console.log('[PDF] report fields — tech.sig:', r.tech?.sig?.slice(0,60),
        '| customerSig:', r.customerSig?.slice(0,60),
        '| images:', (r.images || []).length);

    try {
        const [logoDataUrl, sigTech, sigCust, ...imgSrcs] = await Promise.all([
            preloadLogo(),
            _fetchDataUrl(r.tech?.sig),
            _fetchDataUrl(r.customerSig),
            ...(r.images || []).filter(Boolean).map(_fetchDataUrl),
        ]);
        console.log('[PDF] resolved — sigTech len:', sigTech?.length,
            '| sigCust len:', sigCust?.length,
            '| imgSrcs:', imgSrcs.map(s => s?.length));

        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:absolute;top:0;left:0;width:850px;min-width:850px;box-sizing:border-box;overflow:visible;background:#fff;font-family:Heebo,Arial,sans-serif;';
        wrap.innerHTML = r.serviceType === 'daily_log'
            ? _buildDailyLogLayout(r, logoDataUrl, sigTech, sigCust, imgSrcs)
            : r.serviceType === 'weld_inspection'
            ? _buildWeldInspectionLayout(r, logoDataUrl, sigTech, sigCust, imgSrcs)
            : _buildPrintLayout(r, logoDataUrl, sigTech, sigCust, imgSrcs);
        document.body.appendChild(wrap);

        await Promise.all(
            Array.from(wrap.querySelectorAll('img[src]')).map(img => {
                const p = img.decode
                    ? img.decode().catch(() => {})
                    : new Promise(resolve => {
                        if (img.complete && img.naturalHeight > 0) { resolve(); return; }
                        img.onload = img.onerror = () => resolve();
                    });
                return Promise.race([p, new Promise(res => setTimeout(res, 8000))]).catch(() => {});
            })
        ).catch(() => {});
        await document.fonts.ready;

        const rect = wrap.getBoundingClientRect();
        const canvas = await html2canvas(wrap, {
            scale: 2,
            useCORS: true,
            allowTaint: false,
            backgroundColor: '#ffffff',
            windowWidth: 850,
            width: 850,
            scrollX: 0,
            scrollY: 0,
            logging: false,
        });
        document.body.removeChild(wrap);

        const { jsPDF } = window.jspdf;
        const pdfW = 210;
        const pdfH = Math.ceil((canvas.height / canvas.width) * pdfW);
        const pdf  = new jsPDF({ orientation: 'p', unit: 'mm', format: [pdfW, pdfH] });
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, pdfW, pdfH);

        const filename = `${r.title || 'דוח'}.pdf`;
        if (returnBlob) return pdf.output('blob');
        pdf.save(filename);
        window.toast?.('PDF הורד ✓', 'success');
        return null;
    } catch (err) {
        console.error('[PDF]', err);
        window.toast?.('שגיאה ביצירת PDF', 'error');
        return null;
    } finally {
        overlay?.classList.add('hidden');
    }
}
