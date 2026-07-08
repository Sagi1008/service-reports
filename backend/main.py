import base64
import io
import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Generator, Optional
from urllib.parse import quote

import requests as _requests

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

# ── PDF generation ────────────────────────────────────────────────
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# Register a Unicode-capable font (with bold variant) that renders Hebrew
_PDF_FONT      = "Helvetica"
_PDF_FONT_BOLD = "Helvetica-Bold"

_FONT_PAIRS = [
    (r"C:\Windows\Fonts\arial.ttf",   r"C:\Windows\Fonts\arialbd.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
     "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("/System/Library/Fonts/Arial.ttf", "/System/Library/Fonts/Arial Bold.ttf"),
]
for _reg, _bold in _FONT_PAIRS:
    if Path(_reg).exists():
        try:
            pdfmetrics.registerFont(TTFont("ReportFont", _reg))
            _PDF_FONT = "ReportFont"
        except Exception:
            pass
        if Path(_bold).exists():
            try:
                pdfmetrics.registerFont(TTFont("ReportFontBold", _bold))
                _PDF_FONT_BOLD = "ReportFontBold"
            except Exception:
                pass
        break

# Pre-load logo for PDF header (place logo.png in the backend/ folder)
_PDF_LOGO = None
_LOGO_PATH = Path(__file__).parent / "logo.png"
if _LOGO_PATH.exists():
    try:
        _PDF_LOGO = ImageReader(str(_LOGO_PATH))
    except Exception:
        pass

try:
    from bidi.algorithm import get_display as _bidi
    def _rtl(s) -> str:
        return _bidi(str(s)) if s else ""
except ImportError:
    def _rtl(s) -> str:
        return str(s) if s else ""

from models import AppConfig, Attachment, Base, ServiceReport
from schemas import AttachmentResponse, ReportCreate, ReportResponse

# Hardcoded absolute paths — identical regardless of launch directory
_DB_PATH   = Path(r"C:\TechnicianReports\backend\reports.db")
UPLOAD_DIR = Path(r"C:\TechnicianReports\backend\uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

print(f"[DB INFO] Using database at: {_DB_PATH}")
print(f"[DB INFO] Upload directory : {UPLOAD_DIR}")

# ── Database setup ────────────────────────────────────────────────
DATABASE_URL = f"sqlite:///{_DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},  # required for SQLite
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)   # creates tables on startup

# ── FastAPI app ───────────────────────────────────────────────────
app = FastAPI(title="TechnicianReports API")
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

# ── Static frontend ───────────────────────────────────────────────
_FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="static")

@app.get("/")
def root():
    return RedirectResponse(url="/static/index.html")

# ── DB dependency ─────────────────────────────────────────────────
def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ── Endpoints ─────────────────────────────────────────────────────

@app.post("/api/reports", response_model=ReportResponse, status_code=201)
def create_report(payload: ReportCreate, db: Session = Depends(get_db)):
    """Save a new service report to the database."""
    report = ServiceReport(
        technician_name  = payload.technician_name,
        customer_name    = payload.customer_name,
        work_description = payload.work_description,
        status           = payload.status,
        report_data      = json.dumps(payload.report_data, ensure_ascii=False)
                           if payload.report_data is not None else None,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return _deserialise(report)


@app.get("/api/reports", response_model=list[ReportResponse])
def get_reports(db: Session = Depends(get_db)):
    """Return all service reports, newest first."""
    reports = db.query(ServiceReport).order_by(ServiceReport.created_at.desc()).all()
    return [_deserialise(r) for r in reports]


@app.get("/api/reports/{report_id}", response_model=ReportResponse)
def get_report(report_id: int, db: Session = Depends(get_db)):
    """Return a single report by ID."""
    report = db.query(ServiceReport).filter(ServiceReport.id == report_id).first()
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return _deserialise(report)


@app.get("/api/config/{key}")
def get_config(key: str, db: Session = Depends(get_db)):
    """Return the stored JSON value for a config key, or {} if not set."""
    row = db.query(AppConfig).filter(AppConfig.key == key).first()
    return json.loads(row.value) if row else {}


@app.put("/api/config/{key}")
async def set_config(key: str, request: Request, db: Session = Depends(get_db)):
    """Upsert a JSON value for a config key."""
    body = await request.json()
    row  = db.query(AppConfig).filter(AppConfig.key == key).first()
    if row:
        row.value = json.dumps(body, ensure_ascii=False)
    else:
        db.add(AppConfig(key=key, value=json.dumps(body, ensure_ascii=False)))
    db.commit()
    return {"ok": True}


@app.delete("/api/reports/{frontend_uid}", status_code=204)
def delete_report(frontend_uid: str, db: Session = Depends(get_db)):
    """Delete ALL saved rows for a given frontend UID."""
    print(f"[DELETE] Removing all rows for frontend UID: {frontend_uid}")
    db.execute(
        text("DELETE FROM service_reports WHERE json_extract(report_data, '$.id') = :uid"),
        {"uid": frontend_uid},
    )
    db.commit()


# ── Upload ────────────────────────────────────────────────────────

@app.post("/api/upload", response_model=AttachmentResponse, status_code=201)
async def upload_file(
    file:        UploadFile = File(...),
    folder_id:   str        = Form(""),
    template_id: str        = Form(""),
    db:          Session    = Depends(get_db),
):
    """Save an uploaded file to disk and record it in the database."""
    print(f"[UPLOAD] Received: '{file.filename}'  type='{file.content_type}'  folder='{folder_id}'  template='{template_id}'")

    ext        = Path(file.filename).suffix
    saved_name = uuid.uuid4().hex + ext
    dest       = UPLOAD_DIR / saved_name

    with open(dest, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    print(f"[UPLOAD] Saved to: {dest.resolve()}")

    attachment = Attachment(
        filename    = file.filename,
        file_path   = f"/uploads/{saved_name}",
        file_type   = file.content_type or "",
        folder_id   = folder_id or None,
        template_id = template_id or None,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment


@app.get("/api/attachments", response_model=list[AttachmentResponse])
def get_attachments(folder: str = "", db: Session = Depends(get_db)):
    """Return attachments, optionally filtered by folder name."""
    q = db.query(Attachment)
    if folder:
        q = q.filter(Attachment.folder_id == folder)
    return q.order_by(Attachment.created_at.desc()).all()


@app.get("/api/uploads", response_model=list[AttachmentResponse])
def get_uploads(folder: str = "", db: Session = Depends(get_db)):
    """Return uploaded files for a folder (folder name passed as ?folder=)."""
    q = db.query(Attachment)
    if folder:
        q = q.filter(Attachment.folder_id == folder)
    return q.order_by(Attachment.created_at.desc()).all()


# ── Delete attachment ─────────────────────────────────────────────

@app.delete("/api/attachments/{attachment_id}", status_code=204)
def delete_attachment(attachment_id: int, db: Session = Depends(get_db)):
    """Delete an attachment record and its file from disk."""
    att = db.query(Attachment).filter(Attachment.id == attachment_id).first()
    if att is None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    file_on_disk = UPLOAD_DIR / Path(att.file_path).name
    if file_on_disk.exists():
        file_on_disk.unlink()
    db.delete(att)
    db.commit()


# ── PDF export ───────────────────────────────────────────────────

@app.get("/api/reports/{report_id}/pdf")
def download_pdf(report_id: int, db: Session = Depends(get_db)):
    """Generate a PDF for a single report and stream it to the browser."""
    row = db.query(ServiceReport).filter(ServiceReport.id == report_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")

    r = json.loads(row.report_data) if row.report_data else {}

    # Collect image file paths from the report's folder attachments
    att_images: list[str] = []
    folder_name = r.get("folder") or ""
    if folder_name:
        try:
            for a in db.query(Attachment).filter(Attachment.folder_id == folder_name).all():
                if "image" in (a.file_type or "").lower():
                    fp = UPLOAD_DIR / Path(a.file_path).name
                    if fp.exists():
                        att_images.append(str(fp))
        except Exception:
            pass

    buf = _build_pdf(r, att_images)

    safe_title = (r.get("title") or "report").replace("/", "-").replace("\\", "-")
    filename   = quote(safe_title + ".pdf", safe="")
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )


def _build_pdf(r: dict, att_images: list | None = None) -> io.BytesIO:  # noqa: C901
    """Build a professional Hebrew-RTL PDF and return a seeked BytesIO."""

    # ── Page geometry ─────────────────────────────────────────────
    W, H  = A4           # 595.27 × 841.89 pt
    MH    = 38           # horizontal margin
    RIGHT = W - MH       # right anchor for RTL text
    LEFT  = MH
    CW    = W - 2 * MH   # usable content width ≈ 519 pt
    FOOT_Y = 18          # footer baseline from page bottom

    FR   = _PDF_FONT        # regular
    FB   = _PDF_FONT_BOLD   # bold

    # ── Colour palette ────────────────────────────────────────────
    NAVY   = (0.06, 0.15, 0.32)
    BLUE   = (0.14, 0.33, 0.62)
    GREEN  = (0.05, 0.58, 0.24)
    RED    = (0.82, 0.10, 0.10)
    AMBER  = (0.72, 0.42, 0.00)
    GREY   = (0.48, 0.48, 0.54)
    LGREY  = (0.93, 0.93, 0.95)
    MGREY  = (0.78, 0.78, 0.82)
    BLACK  = (0.10, 0.10, 0.15)
    WHITE  = (1.00, 1.00, 1.00)

    buf = io.BytesIO()
    c   = rl_canvas.Canvas(buf, pagesize=(W, H))
    page = [1]

    # ── Primitive helpers ─────────────────────────────────────────
    def rgb(*col):
        c.setFillColorRGB(*col)

    def srgb(*col):
        c.setStrokeColorRGB(*col)

    def frect(lx, by, rw, rh, fc, sc=None, sw=0.4):
        """Filled (and optionally stroked) rectangle."""
        rgb(*fc)
        if sc:
            srgb(*sc)
            c.setLineWidth(sw)
            c.rect(lx, by, rw, rh, fill=1, stroke=1)
        else:
            c.rect(lx, by, rw, rh, fill=1, stroke=0)

    def hline(y, lx=None, rx=None, col=MGREY, lw=0.5):
        srgb(*col)
        c.setLineWidth(lw)
        c.line(lx or LEFT, y, rx or RIGHT, y)

    def rstr(text, x, y, f=None, sz=10, col=BLACK):
        """Right-anchored, bidi-processed string."""
        rgb(*col)
        c.setFont(f or FR, sz)
        c.drawRightString(x, y, _rtl(str(text)) if text else "")

    def lstr(text, x, y, f=None, sz=10, col=BLACK):
        """Left-anchored plain string."""
        rgb(*col)
        c.setFont(f or FR, sz)
        c.drawString(x, y, str(text) if text else "")

    # ── Footer (drawn on each page before showPage) ────────────────
    def draw_footer():
        c.saveState()
        hline(FOOT_Y + 14, LEFT, RIGHT, MGREY, 0.5)
        c.setFont(FR, 7); rgb(*GREY)
        c.drawCentredString(LEFT + CW / 2, FOOT_Y + 4, f"Oficiency \u00a9 {datetime.now().year}")
        rstr(f"עמוד {page[0]}", RIGHT, FOOT_Y + 4, f=FR, sz=7, col=GREY)
        c.restoreState()

    SAFE_BOTTOM = FOOT_Y + 30   # y must stay above this line

    def check_y(y, needed=20):
        if y < SAFE_BOTTOM + needed:
            draw_footer()
            c.showPage()
            page[0] += 1
            return H - 50   # fresh y after page break (no repeated header)
        return y

    # ════════════════════════════════════════════════════════════════
    # HEADER  (full-width navy banner)
    # ════════════════════════════════════════════════════════════════
    HDR_H = 70
    HDR_Y = H - HDR_H          # bottom-left y of the header rect

    frect(0, HDR_Y, W, HDR_H, NAVY)
    # ── Logo — top-right corner (≈40 mm wide) ─────────────────────
    LW, LH = 106, 58          # ~37 mm × ~20 mm at 72 dpi
    lx = RIGHT - LW
    ly = HDR_Y + (HDR_H - LH) / 2
    if _PDF_LOGO:
        iw, ih = _PDF_LOGO.getSize()
        scale   = min(LW / iw, LH / ih)
        dw, dh  = iw * scale, ih * scale
        c.drawImage(_PDF_LOGO,
                    lx + (LW - dw) / 2, ly + (LH - dh) / 2,
                    dw, dh, mask="auto", preserveAspectRatio=True)
    else:
        srgb(0.45, 0.58, 0.78); c.setLineWidth(0.8); c.setDash(4, 3)
        c.rect(lx, ly, LW, LH, fill=0, stroke=1); c.setDash()
        rgb(0.55, 0.70, 0.88); c.setFont(FR, 7)
        c.drawCentredString(lx + LW / 2, ly + LH / 2 - 3, "LOGO")

    # ── Company name — left side ───────────────────────────────────
    c.setFont(FB, 22); rgb(*WHITE)
    c.drawString(LEFT + 4, HDR_Y + 36, "Oficiency")
    c.setFont(FR, 7.5); rgb(0.68, 0.80, 0.96)
    rstr("מערכת דוחות שירות", lx - 10, HDR_Y + 11)

    y = HDR_Y - 2

    # ── Report-title bar (blue strip below header) ────────────────
    TB_H = 30
    frect(0, y - TB_H, W, TB_H, BLUE)

    report_title = r.get("title") or "דוח שירות"
    c.setFont(FB, 13); rgb(*WHITE)
    c.drawRightString(RIGHT - 6, y - TB_H + (TB_H - 13) / 2, _rtl(report_title))

    y -= TB_H + 10

    # ════════════════════════════════════════════════════════════════
    # INFO TABLE  (4 columns: לקוח | אתר | תאריך ביקור | מספר דוח)
    # ════════════════════════════════════════════════════════════════
    info_cells = [
        ("מספר דוח",    r.get("number")    or "—"),
        ("תאריך ביקור", r.get("visitDate") or "—"),
        ("אתר",         r.get("site")      or "—"),
        ("לקוח",        r.get("customer")  or "—"),
    ]
    CELL_H = 36
    cell_w = CW / 4

    for i, (label, val) in enumerate(info_cells):
        cx = LEFT + i * cell_w
        bg = (0.96, 0.97, 0.99) if i % 2 == 0 else WHITE
        frect(cx, y - CELL_H, cell_w, CELL_H, bg, MGREY, 0.4)
        # Coloured top accent
        frect(cx, y - 3, cell_w, 3, BLUE)
        # Label
        rstr(label, cx + cell_w - 5, y - 13, f=FR, sz=7.5, col=GREY)
        # Value
        rstr(str(val), cx + cell_w - 5, y - CELL_H + 8, f=FB, sz=9.5, col=BLACK)

    y -= CELL_H + 8

    # ════════════════════════════════════════════════════════════════
    # STATUS SUMMARY BAR
    # ════════════════════════════════════════════════════════════════
    tasks_all  = r.get("tasks") or []
    real_tasks = [t for t in tasks_all if t.get("type") != "section"]
    n_perf  = sum(1 for t in real_tasks if t.get("status") == "performed")
    n_not   = sum(1 for t in real_tasks if t.get("status") == "not_performed")
    n_pend  = sum(1 for t in real_tasks if t.get("status") == "pending")
    n_total = len(real_tasks)

    badges = [
        (f"V  תקין: {n_perf}",          GREEN, (0.92, 1.00, 0.94)),
        (f"X  לא תקין: {n_not}",        RED,   (1.00, 0.93, 0.93)),
        (f"...  ממתין: {n_pend}",        GREY,  (0.94, 0.94, 0.96)),
        (f'סה"כ: {n_total}',             NAVY,  (0.92, 0.95, 1.00)),
    ]
    BADGE_H = 26
    badge_w = CW / 4

    for i, (label, accent, bg) in enumerate(badges):
        bx = LEFT + i * badge_w
        frect(bx + 1, y - BADGE_H, badge_w - 2, BADGE_H, bg, MGREY, 0.4)
        frect(bx + badge_w - 5, y - BADGE_H, 4, BADGE_H, accent)   # right-edge accent
        c.setFont(FB, 8.5)
        rgb(*accent)
        c.drawRightString(bx + badge_w - 8, y - BADGE_H + 8, _rtl(label))

    y -= BADGE_H + 12

    # ════════════════════════════════════════════════════════════════
    # PERMANENT NOTES  (small strip above tasks, shown if present)
    # ════════════════════════════════════════════════════════════════
    perm = (r.get("permComments") or "").strip()
    if perm:
        y = check_y(y, 30)
        frect(LEFT, y - 22, CW, 22, (0.99, 0.98, 0.93), (0.90, 0.82, 0.50), 0.6)
        c.setFont(FB, 7.5);  rgb(*AMBER)
        c.drawRightString(RIGHT - 6, y - 8, _rtl("📌 הערות קבועות"))
        # Inline text — truncate to one visible line here; full text only in final box
        preview = perm.splitlines()[0][:90]
        c.setFont(FR, 8);  rgb(*BLACK)
        c.drawRightString(RIGHT - 6, y - 17, _rtl(preview + ("…" if len(perm) > 90 else "")))
        y -= 26

    # ════════════════════════════════════════════════════════════════
    # TASKS
    # ════════════════════════════════════════════════════════════════
    if tasks_all:
        y = check_y(y, 40)

        # Section heading bar
        frect(0, y - 26, W, 26, NAVY)
        c.setFont(FB, 11)
        rgb(*WHITE)
        c.drawRightString(RIGHT - 6, y - 17, _rtl("רשימת משימות"))
        y -= 32

        for t in tasks_all:
            if t.get("type") == "section":
                # ── Section separator ─────────────────────────
                y = check_y(y, 24)
                frect(LEFT, y - 22, CW, 22, LGREY, MGREY, 0.5)
                # Amber left-edge accent
                frect(LEFT, y - 22, 4, 22, AMBER)
                c.setFont(FB, 9.5)
                rgb(*AMBER)
                c.drawRightString(RIGHT - 8, y - 14, _rtl(t.get("title") or ""))
                y -= 24

            else:
                # ── Task row ──────────────────────────────────
                status   = t.get("status", "pending")
                desc     = (t.get("description") or "").strip()
                comments = (t.get("comments") or "").strip()

                # Wrap text — left margin widened to clear pill + label area
                TEXT_W = CW - 75
                desc_lines = simpleSplit(_rtl(desc), FR, 9,   TEXT_W) if desc else [""]
                comm_lines = simpleSplit(_rtl(comments), FR, 7.5, TEXT_W) if comments else []

                row_h = max(22, len(desc_lines) * 12 + len(comm_lines) * 10 + 10)
                y = check_y(y, row_h + 3)

                if status == "performed":
                    bg, accent = (0.94, 1.00, 0.96), GREEN
                    mark  = "V"
                    label = _rtl("תקין")
                elif status == "not_performed":
                    bg, accent = (1.00, 0.94, 0.94), RED
                    mark  = "X"
                    label = _rtl("לא תקין")
                else:
                    bg, accent = WHITE, GREY
                    mark  = ""
                    label = ""

                frect(LEFT, y - row_h, CW, row_h, bg, MGREY, 0.3)
                frect(LEFT, y - row_h, 5, row_h, accent)    # left accent bar

                # Icon pill (small — mark only)
                pill_w, pill_h = 18, 15
                pill_x = LEFT + 8
                pill_y = y - row_h / 2 - pill_h / 2
                frect(pill_x, pill_y, pill_w, pill_h, accent)
                c.setFont(FB, 8); rgb(*WHITE)
                c.drawCentredString(pill_x + pill_w / 2, pill_y + 4, mark)

                # Status label in accent colour, right of the pill
                if label:
                    c.setFont(FB, 7.5); rgb(*accent)
                    c.drawString(pill_x + pill_w + 4, pill_y + 4.5, label)

                # Description lines (right-anchored)
                ty = y - 10
                for dl in desc_lines:
                    rgb(*BLACK)
                    c.setFont(FR, 9)
                    c.drawRightString(RIGHT - 6, ty, dl)
                    ty -= 12

                # Comment lines (smaller, grey)
                for cl in comm_lines:
                    rgb(*GREY)
                    c.setFont(FR, 7.5)
                    c.drawRightString(RIGHT - 6, ty, cl)
                    ty -= 10

                y -= row_h + 2

    # ════════════════════════════════════════════════════════════════
    # FINAL / SUMMARY NOTES  (bottom section — uses finalComments,
    #   falls back to permComments for reports saved before this field)
    # ════════════════════════════════════════════════════════════════
    perm = (r.get("finalComments") or r.get("permComments") or "").strip()
    if perm:
        y = check_y(y, 60)
        y -= 8

        # Section heading
        frect(0, y - 26, W, 26, (0.95, 0.93, 0.84))
        hline(y,      0, W, AMBER, 1.5)
        hline(y - 26, 0, W, AMBER, 1.5)
        frect(RIGHT - 5, y - 26, 5, 26, AMBER)   # right accent
        c.setFont(FB, 10)
        rgb(*AMBER)
        c.drawRightString(RIGHT - 10, y - 17, _rtl("הערות וסיכום"))
        y -= 32

        # Notes content box
        note_lines = []
        for raw_line in perm.splitlines():
            if raw_line.strip():
                note_lines.extend(simpleSplit(_rtl(raw_line), FR, 9, CW - 16))
            else:
                note_lines.append("")

        box_h = max(50, len(note_lines) * 13 + 16)
        y = check_y(y, box_h + 10)
        frect(LEFT, y - box_h, CW, box_h, (1.00, 0.99, 0.95), AMBER, 0.7)

        ty = y - 12
        for nl in note_lines:
            if ty < y - box_h + 6:
                break
            rgb(*BLACK)
            c.setFont(FR, 9)
            c.drawRightString(RIGHT - 8, ty, nl)
            ty -= 13

        y -= box_h + 10

    # ════════════════════════════════════════════════════════════════
    # TECHNICIAN  +  SIGNATURE
    # ════════════════════════════════════════════════════════════════
    tech = r.get("tech") or {}
    if tech.get("name") or tech.get("compDate"):
        y = check_y(y, 80)
        y -= 10
        hline(y, LEFT, RIGHT, MGREY, 1)
        y -= 6

        half = CW / 2 - 6

        # Right half — technician details
        if tech.get("name"):
            c.setFont(FR, 7.5);  rgb(*GREY)
            c.drawRightString(RIGHT - 4, y - 8,  _rtl("שם טכנאי"))
            c.setFont(FB, 10);   rgb(*BLACK)
            c.drawRightString(RIGHT - 4, y - 21, _rtl(tech.get("name", "")))
        if tech.get("compDate"):
            c.setFont(FR, 7.5);  rgb(*GREY)
            c.drawRightString(RIGHT - 4, y - 34, _rtl("תאריך סיום עבודה"))
            c.setFont(FB, 10);   rgb(*BLACK)
            c.drawRightString(RIGHT - 4, y - 47, _rtl(tech.get("compDate", "")))

        # Left half — signature box
        sig_h  = 60
        sig_bx = LEFT
        sig_by = y - sig_h - 2
        frect(sig_bx, sig_by, half, sig_h, (0.97, 0.97, 0.99), MGREY, 0.6)

        # Label above the box
        c.setFont(FR, 7.5); rgb(*GREY)
        c.drawCentredString(sig_bx + half / 2, sig_by + sig_h + 3, _rtl("חתימת טכנאי"))

        sig_data = (tech.get("sig") or "").strip()
        if sig_data:
            try:
                if sig_data.startswith("http://") or sig_data.startswith("https://"):
                    resp = _requests.get(sig_data, timeout=15)
                    resp.raise_for_status()
                    sig_buf = io.BytesIO(resp.content)
                elif "," in sig_data:
                    sig_buf = io.BytesIO(base64.b64decode(sig_data.split(",", 1)[1]))
                else:
                    sig_buf = None
                if sig_buf:
                    sig_img   = ImageReader(sig_buf)
                    iw, ih    = sig_img.getSize()
                    pad       = 6
                    scale     = min((half - 2 * pad) / iw, (sig_h - 2 * pad) / ih)
                    dw, dh    = iw * scale, ih * scale
                    c.drawImage(sig_img,
                                sig_bx + (half - dw) / 2,
                                sig_by + (sig_h - dh) / 2,
                                dw, dh, mask="auto")
            except Exception as _e:
                print(f"[PDF] tech sig render failed: {_e}")  # box already drawn; leave blank

        y -= sig_h + 20

    # ════════════════════════════════════════════════════════════════
    # CUSTOMER SIGNATURE  (always shown when there is a tech section,
    # or whenever a signature is present — empty box if unsigned)
    # ════════════════════════════════════════════════════════════════
    cust_sig_data = (r.get("customerSig") or "").strip()
    if cust_sig_data or tech.get("name") or tech.get("compDate"):
        y = check_y(y, 90)
        hline(y, LEFT, RIGHT, MGREY, 0.5)
        y -= 10

        half    = CW / 2 - 6
        cust_h  = 60

        # Left half — descriptive text
        c.setFont(FR, 7.5); rgb(*GREY)
        c.drawRightString(LEFT + half - 4, y - 8,  _rtl("אישור קבלת עבודה / חתימת לקוח"))
        c.setFont(FR, 9);   rgb(*BLACK)
        c.drawRightString(LEFT + half - 4, y - 21, _rtl("אני מאשר/ת קבלת העבודה המתוארת בדוח זה"))

        # Right half — customer signature box
        cust_bx = LEFT + half + 12
        cust_bw = CW / 2 - 12
        cust_by = y - cust_h - 2

        # Light-green tint to visually distinguish from tech sig box
        frect(cust_bx, cust_by, cust_bw, cust_h, (0.96, 0.99, 0.96), MGREY, 0.6)
        c.setFont(FR, 7.5); rgb(*GREY)
        c.drawCentredString(cust_bx + cust_bw / 2, cust_by + cust_h + 3, _rtl("חתימת לקוח"))

        if cust_sig_data:
            try:
                if cust_sig_data.startswith("http://") or cust_sig_data.startswith("https://"):
                    resp = _requests.get(cust_sig_data, timeout=15)
                    resp.raise_for_status()
                    cust_buf = io.BytesIO(resp.content)
                elif "," in cust_sig_data:
                    cust_buf = io.BytesIO(base64.b64decode(cust_sig_data.split(",", 1)[1]))
                else:
                    cust_buf = None
                if cust_buf:
                    cust_img = ImageReader(cust_buf)
                    iw, ih   = cust_img.getSize()
                    pad      = 6
                    scale    = min((cust_bw - 2 * pad) / iw, (cust_h - 2 * pad) / ih)
                    dw, dh   = iw * scale, ih * scale
                    c.drawImage(cust_img,
                                cust_bx + (cust_bw - dw) / 2,
                                cust_by + (cust_h  - dh) / 2,
                                dw, dh, mask="auto")
            except Exception as _e:
                print(f"[PDF] customer sig render failed: {_e}")  # box already drawn; leave blank

        y -= cust_h + 20

    # ════════════════════════════════════════════════════════════════
    # IMAGES & ATTACHMENTS  (dedicated page)
    # ════════════════════════════════════════════════════════════════
    report_images = [img for img in (r.get("images") or []) if img]
    all_images    = report_images + (att_images or [])

    if all_images:
        draw_footer()
        c.showPage()
        page[0] += 1
        y = H - 50

        # Section heading
        frect(0, y - 26, W, 26, NAVY)
        c.setFont(FB, 11); rgb(*WHITE)
        c.drawRightString(RIGHT - 6, y - 17, _rtl("נספחים ותמונות מהשטח"))
        y -= 36

        IMG_COLS = 2
        IMG_GAP  = 10
        IMG_W    = (CW - (IMG_COLS - 1) * IMG_GAP) / IMG_COLS   # ≈ 254 pt
        IMG_H    = 185
        col_idx  = 0

        for src in all_images:
            if col_idx == 0:
                y = check_y(y, IMG_H + 12)
            try:
                if isinstance(src, str) and src.startswith("data:") and "," in src:
                    raw = base64.b64decode(src.split(",", 1)[1])
                    img_reader = ImageReader(io.BytesIO(raw))
                elif isinstance(src, str) and (src.startswith("http://") or src.startswith("https://")):
                    resp = _requests.get(src, timeout=15)
                    resp.raise_for_status()
                    img_reader = ImageReader(io.BytesIO(resp.content))
                else:
                    img_reader = ImageReader(src)

                iw, ih  = img_reader.getSize()
                scale   = min(IMG_W / iw, IMG_H / ih)
                dw, dh  = iw * scale, ih * scale
                ix      = LEFT + col_idx * (IMG_W + IMG_GAP)
                iy      = y - IMG_H + (IMG_H - dh) / 2

                # light grey frame
                frect(ix, y - IMG_H, IMG_W, IMG_H, (0.93, 0.93, 0.95), MGREY, 0.4)
                c.drawImage(img_reader, ix + (IMG_W - dw) / 2, iy, dw, dh, mask="auto")

                col_idx += 1
                if col_idx >= IMG_COLS:
                    col_idx = 0
                    y -= IMG_H + IMG_GAP
            except Exception as _e:
                print(f"[PDF] image render failed ({str(src)[:80]}): {_e}")

        if col_idx > 0:
            y -= IMG_H + IMG_GAP  # finish the last partial row

    # ── Footer on last page ───────────────────────────────────────
    draw_footer()

    c.save()
    buf.seek(0)
    return buf


# ── Helpers ───────────────────────────────────────────────────────

def _safe_attachments(report: ServiceReport) -> list:
    """Return attachment dicts, or [] if the table schema is out of date."""
    try:
        return [
            {
                "id":          a.id,
                "filename":    a.filename,
                "file_path":   a.file_path,
                "file_type":   a.file_type,
                "folder_id":   a.folder_id,
                "template_id": a.template_id,
                "report_id":   a.report_id,
                "created_at":  a.created_at,
            }
            for a in report.attachments
        ]
    except Exception as exc:
        print(f"[WARN] attachments unavailable for report {report.id}: {exc}")
        print("[WARN] Run: python migrate_attachments.py  then restart the server.")
        return []


def _deserialise(report: ServiceReport) -> dict:
    """Convert the ORM row to a dict, parsing report_data back to JSON."""
    data = {
        "id":               report.id,
        "technician_name":  report.technician_name,
        "customer_name":    report.customer_name,
        "work_description": report.work_description,
        "status":           report.status,
        "created_at":       report.created_at,
        "report_data":  json.loads(report.report_data)
                        if report.report_data else None,
        "attachments":  _safe_attachments(report),
    }
    return data
