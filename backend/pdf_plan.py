"""PDF generator for rehab plan — with embedded exercise images + YouTube thumbnails + QR codes."""
import io
import re
from datetime import datetime, timezone
from typing import List, Dict, Optional
from urllib.parse import urlparse, parse_qs

import requests
import qrcode
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, KeepTogether
from reportlab.lib.enums import TA_LEFT


TERRACOTTA = colors.HexColor("#C96A52")
SAGE = colors.HexColor("#5B7566")
BONE = colors.HexColor("#FAF9F6")
CHARCOAL = colors.HexColor("#1A1A1A")
MUTED = colors.HexColor("#787672")
SECONDARY = colors.HexColor("#E8E2D9")


_YT_RE = re.compile(r"(?:youtube\.com/(?:watch\?v=|embed/|shorts/)|youtu\.be/)([A-Za-z0-9_-]{11})")


def _format_dose(item: dict) -> str:
    """Compose the dose label for an exercise item (sets×reps / hold / frequency)."""
    parts = []
    dur_str = (item.get("duration") or "").strip()
    if dur_str:
        # If the clinician supplied a unit assume it's already complete; else assume seconds.
        if any(u in dur_str.lower() for u in ("sec", "min", "s", "m")):
            parts.append(f"{dur_str} hold")
        else:
            parts.append(f"{dur_str}s hold")
    else:
        dur = item.get("duration_seconds") or 0
        if dur:
            if dur >= 60 and dur % 60 == 0:
                parts.append(f"{dur // 60} min hold")
            elif dur >= 60:
                parts.append(f"{dur // 60}m {dur % 60}s hold")
            else:
                parts.append(f"{dur}s hold")
    sets = item.get("sets")
    reps = item.get("reps")
    sets_s = str(sets).strip() if sets not in (None, "") else ""
    reps_s = str(reps).strip() if reps not in (None, "") else ""
    if sets_s and reps_s:
        parts.append(f"{sets_s}×{reps_s}")
    elif sets_s and not (dur_str or item.get("duration_seconds")):
        parts.append(f"{sets_s} sets")
    head = "<b>" + " · ".join(parts) + "</b>" if parts else ""
    freq = item.get("frequency") or "Daily"
    return f"{head} · {freq}" if head else freq


def youtube_id(url: str) -> Optional[str]:
    if not url:
        return None
    m = _YT_RE.search(url)
    if m:
        return m.group(1)
    try:
        u = urlparse(url)
        if u.hostname and "youtube" in u.hostname:
            v = parse_qs(u.query).get("v")
            if v:
                return v[0]
    except Exception:
        pass
    return None


def _fetch_bytes(url: str, timeout: int = 8) -> Optional[bytes]:
    try:
        r = requests.get(url, timeout=timeout)
        if r.status_code == 200:
            return r.content
    except Exception:
        return None
    return None


def _qr_png(data: str) -> bytes:
    img = qrcode.make(data)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _img_flowable(b: bytes, w: float, h: float):
    try:
        return Image(io.BytesIO(b), width=w, height=h)
    except Exception:
        return None


def build_plan_pdf(
    plan: dict,
    patient: dict,
    exercises_by_id: Dict[str, dict],
    clinician_name: str = "",
    media_resolver=None,  # callable(media_url_or_id) -> bytes or None
) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        rightMargin=0.6 * inch, leftMargin=0.6 * inch,
        topMargin=0.6 * inch, bottomMargin=0.6 * inch,
        title=f"{plan.get('title','Rehab Plan')} – {patient.get('name','')}",
    )
    styles = getSampleStyleSheet()
    h_style = ParagraphStyle("h_style", parent=styles["Heading1"], fontName="Helvetica-Bold",
                             fontSize=24, leading=28, textColor=CHARCOAL, spaceAfter=4)
    label_style = ParagraphStyle("label", parent=styles["Normal"], fontName="Helvetica-Bold",
                                 fontSize=8, textColor=MUTED, spaceAfter=2)
    body_style = ParagraphStyle("body", parent=styles["Normal"], fontName="Helvetica",
                                fontSize=10, leading=14, textColor=CHARCOAL)
    small_style = ParagraphStyle("small", parent=styles["Normal"], fontName="Helvetica",
                                 fontSize=8, leading=11, textColor=MUTED)
    link_style = ParagraphStyle("link", parent=body_style, textColor=TERRACOTTA, fontName="Helvetica-Bold")
    ex_name_style = ParagraphStyle("exname", parent=styles["Heading3"], fontName="Helvetica-Bold",
                                   fontSize=13, leading=16, textColor=CHARCOAL, spaceAfter=2)
    instr_style = ParagraphStyle("instr", parent=styles["Normal"], fontName="Helvetica",
                                 fontSize=10, leading=14, textColor=CHARCOAL, alignment=TA_LEFT)

    elements: List = []

    # Header
    header_tbl = Table([
        [Paragraph("<b>PAWPRINT</b>", small_style),
         Paragraph(datetime.now(timezone.utc).strftime("%B %d, %Y"), small_style)],
    ], colWidths=[4.5 * inch, 2.6 * inch])
    header_tbl.setStyle(TableStyle([("ALIGN", (1, 0), (1, 0), "RIGHT"),
                                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    elements.append(header_tbl)
    elements.append(Spacer(1, 0.05 * inch))
    line = Table([[""]], colWidths=[7.1 * inch], rowHeights=[2])
    line.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), TERRACOTTA)]))
    elements.append(line)
    elements.append(Spacer(1, 0.25 * inch))

    elements.append(Paragraph(plan.get("title", "Rehab Plan"), h_style))
    full_pet_name = patient.get('name','')
    if patient.get('last_name'):
        full_pet_name = f"{full_pet_name} {patient['last_name']}"
    elements.append(Paragraph(f"Personalised plan for <b>{full_pet_name}</b>", body_style))
    elements.append(Spacer(1, 0.25 * inch))

    info = [
        [Paragraph("BREED", label_style), Paragraph("AGE", label_style),
         Paragraph("WEIGHT", label_style), Paragraph("CONDITION", label_style)],
        [Paragraph(patient.get("breed") or "—", body_style),
         Paragraph(f"{patient.get('age_years','—')} yrs" if patient.get("age_years") not in (None, "") else "—", body_style),
         Paragraph(f"{patient.get('weight_kg','—')} kg" if patient.get("weight_kg") not in (None, "") else "—", body_style),
         Paragraph(patient.get("condition") or "—", body_style)],
    ]
    info_tbl = Table(info, colWidths=[1.6 * inch, 1.6 * inch, 1.6 * inch, 2.3 * inch])
    info_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BONE),
        ("BOX", (0, 0), (-1, -1), 0.5, SECONDARY),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, SECONDARY),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    elements.append(info_tbl)

    if plan.get("notes"):
        elements.append(Spacer(1, 0.2 * inch))
        elements.append(Paragraph("CLINICIAN NOTES", label_style))
        elements.append(Paragraph(plan["notes"], body_style))

    weekly_schedule = plan.get("weekly_schedule") or []
    if any((d.get("categories") or d.get("rest")) for d in weekly_schedule):
        elements.append(Spacer(1, 0.25 * inch))
        elements.append(Paragraph("WEEKLY SCHEDULE", label_style))
        elements.append(Spacer(1, 0.06 * inch))
        by_day = {d.get("day_number"): d for d in weekly_schedule}
        rows = [[Paragraph("DAY", label_style), Paragraph("FOCUS", label_style)]]
        for n in range(1, 8):
            d = by_day.get(n, {})
            if d.get("rest"):
                focus = "Rest day"
            else:
                cats = d.get("categories") or []
                focus = ", ".join(cats) if cats else "—"
            rows.append([Paragraph(f"Day {n}", body_style), Paragraph(focus, body_style)])
        sched_tbl = Table(rows, colWidths=[1.1 * inch, 6.0 * inch])
        sched_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), SECONDARY),
            ("BOX", (0, 0), (-1, -1), 0.5, SECONDARY),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, SECONDARY),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        elements.append(sched_tbl)

    elements.append(Spacer(1, 0.35 * inch))
    elements.append(Paragraph("EXERCISES", label_style))
    elements.append(Spacer(1, 0.1 * inch))

    for idx, item in enumerate(plan.get("items", []), start=1):
        ex = exercises_by_id.get(item.get("exercise_id"), {})

        # Title row
        title_row = Table([[
            Paragraph(f"{idx}. {ex.get('name', item.get('exercise_id','?'))}", ex_name_style),
            Paragraph(_format_dose(item),
                      ParagraphStyle("right", parent=body_style, alignment=2, textColor=TERRACOTTA, fontName="Helvetica-Bold")),
        ]], colWidths=[5.0 * inch, 2.1 * inch])
        title_row.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))

        # Body: media on left (if any), text on right
        text_blocks: List = []
        if ex.get("category"):
            text_blocks.append(Paragraph(ex["category"].upper(), small_style))
        if ex.get("description"):
            text_blocks.append(Paragraph(ex["description"], body_style))
        if ex.get("instructions"):
            text_blocks.append(Spacer(1, 0.04 * inch))
            text_blocks.append(Paragraph(f"<i>How to:</i> {ex['instructions']}", instr_style))
        if item.get("notes"):
            text_blocks.append(Spacer(1, 0.04 * inch))
            text_blocks.append(Paragraph(f"<b>Note:</b> {item['notes']}", body_style))

        # Resolve image media (uploaded image)
        img_bytes: Optional[bytes] = None
        if ex.get("media_url") and ex.get("media_type") == "image" and media_resolver:
            try:
                img_bytes = media_resolver(ex["media_url"])
            except Exception:
                img_bytes = None

        # Resolve YouTube thumbnail
        yt_id = youtube_id(ex.get("video_url", ""))
        if not img_bytes and yt_id:
            # Try maxres first (larger, more crisp), fall back to hq
            img_bytes = _fetch_bytes(f"https://img.youtube.com/vi/{yt_id}/maxresdefault.jpg")
            if not img_bytes:
                img_bytes = _fetch_bytes(f"https://img.youtube.com/vi/{yt_id}/hqdefault.jpg")

        media_cell = []
        if img_bytes:
            ifl = _img_flowable(img_bytes, 1.6 * inch, 1.2 * inch)
            if ifl:
                media_cell.append(ifl)

        # Video link + QR
        vid_url = ex.get("video_url", "")
        if vid_url:
            link_label = "▶ Watch on YouTube" if yt_id else "▶ Watch demo video"
            text_blocks.append(Spacer(1, 0.04 * inch))
            text_blocks.append(Paragraph(f'<a href="{vid_url}">{link_label}</a>', link_style))
            try:
                qr = _qr_png(vid_url)
                qr_fl = _img_flowable(qr, 0.85 * inch, 0.85 * inch)
                if qr_fl:
                    media_cell.append(Spacer(1, 0.05 * inch))
                    media_cell.append(qr_fl)
                    media_cell.append(Paragraph("Scan to watch", small_style))
            except Exception:
                pass

        if media_cell:
            row = Table([[media_cell, text_blocks]], colWidths=[1.7 * inch, 5.4 * inch])
            row.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
            ]))
            elements.append(KeepTogether([title_row, Spacer(1, 0.05 * inch), row]))
        else:
            elements.append(KeepTogether([title_row, *text_blocks]))

        elements.append(Spacer(1, 0.12 * inch))
        rule = Table([[""]], colWidths=[7.1 * inch], rowHeights=[1])
        rule.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), SECONDARY)]))
        elements.append(rule)
        elements.append(Spacer(1, 0.18 * inch))

    elements.append(Spacer(1, 0.25 * inch))
    elements.append(Paragraph(
        f"Prepared by {clinician_name or 'your clinician'} · PawPrint Rx",
        small_style,
    ))
    elements.append(Paragraph(
        "Always work within your dog's pain-free range of motion. Stop and contact your clinician if pain ≥ 6/10.",
        small_style,
    ))

    doc.build(elements)
    return buf.getvalue()
