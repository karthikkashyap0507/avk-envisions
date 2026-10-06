"""Kannada copies of the analysis PDFs, with the original design kept.

Every page keeps its boxes, colours, logo, diagrams and images exactly as they
are. Only the words change: each paragraph's English is taken off the page and
its Kannada is written into the same place, in Noto Sans Kannada - using the
room its box has to spare first, and only then a slightly smaller size.

Two steps, because the translating happens elsewhere (the website keeps the
sentence memory and talks to the engine):

    python pdf_kannada.py extract <in.pdf> <blocks.json>
        every visible paragraph on every page: an id, its English, its place

    python pdf_kannada.py render <in.pdf> <translations.json> <out.pdf> [<report.json>]
        translations.json is {"format": N, "translations": {"<id>": "<kannada>"}};
        paragraphs it does not mention are left exactly as they were

Extraction is deterministic for a given file and FORMAT, which is what lets
the render step find the paragraphs the ids refer to without being sent them
back. Everything used is open source: PDFium (BSD/Apache) reads and edits the
pages, HarfBuzz (MIT) shapes the Kannada and fpdf2 (LGPL) writes it.
"""

from __future__ import annotations

import ctypes
import json
import re
import statistics
import sys
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c

# Bump whenever a change here would split, join or number paragraphs
# differently - block ids, and so every stored translation plan, depend on it -
# or draw the copies differently: every copy made under an older number is made
# again.
FORMAT = 4

FONT_DIR = Path(__file__).resolve().parent / "fonts"

# For each character the first font that has it: Kannada, then Latin for the
# names and abbreviations that stay in English, then symbols (arrows, maths).
FONT_FILES = {
    "kn": ("NotoSansKannada-Regular.ttf", "NotoSansKannada-Bold.ttf"),
    "lat": ("NotoSans-Regular.ttf", "NotoSans-Bold.ttf"),
    "sym": ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf"),
}

# Kannada stacks vowel signs above the letters and consonants below them, so
# a line needs more height than Latin text of the same size.
ASCENT = 0.80
DESCENT = 0.40
LINE_HEIGHT = 1.35
# How far a paragraph may shrink before it is allowed to spill over.
MIN_SCALE = 0.62
MIN_SIZE = 4.6
# Resolution of the background patches laid over text that cannot be removed.
PATCH_SCALE = 3.0


# ---------------------------------------------------------------------------
# What is on a page
# ---------------------------------------------------------------------------


@dataclass
class Char:
    ch: str
    x0: float = 0.0
    top: float = 0.0
    x1: float = 0.0
    bottom: float = 0.0
    base: float = 0.0
    size: float = 0.0
    bold: bool = False
    color: tuple[int, int, int] = (0, 0, 0)
    obj: int = 0
    generated: bool = False


@dataclass
class Line:
    text: str
    x0: float
    top: float
    x1: float
    bottom: float
    base: float
    size: float
    bold: bool
    color: tuple[int, int, int]
    objs: set[int]


@dataclass
class Shape:
    """A drawn rectangle or image, in top-down page coordinates."""

    x0: float
    top: float
    x1: float
    bottom: float
    z: int
    kind: str  # "box", "image", "drawing", or "vrule" / "hrule" for a thin line
    fill: tuple[int, int, int] | None = None
    opaque: bool = False
    transparent: bool = False

    @property
    def area(self) -> float:
        return max(0.0, self.x1 - self.x0) * max(0.0, self.bottom - self.top)


@dataclass
class Block:
    """One paragraph: lines of the same text running on, in one box."""

    lines: list[Line]
    order: int = 0
    id: str = ""
    box: Shape | None = None
    objs: set[int] = field(default_factory=set)
    zmin: int = 0
    zmax: int = 0
    nested: bool = False
    # Where identical copies of this paragraph sit (some PDFs draw it twice).
    copies: list[tuple[float, float, float, float]] = field(default_factory=list)

    @property
    def text(self) -> str:
        return _join_lines([line.text for line in self.lines])

    @property
    def x0(self) -> float:
        return min(line.x0 for line in self.lines)

    @property
    def x1(self) -> float:
        return max(line.x1 for line in self.lines)

    @property
    def top(self) -> float:
        return min(line.top for line in self.lines)

    @property
    def bottom(self) -> float:
        return max(line.bottom for line in self.lines)

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        return (self.x0, self.top, self.x1, self.bottom)

    @property
    def size(self) -> float:
        return statistics.median(line.size for line in self.lines)

    @property
    def bold(self) -> bool:
        return _majority(line.bold for line in self.lines)

    @property
    def color(self) -> tuple[int, int, int]:
        return _majority(line.color for line in self.lines)

    @property
    def pitch(self) -> float:
        """Distance between baselines, or an ordinary one for a single line."""
        gaps = [b.base - a.base for a, b in zip(self.lines, self.lines[1:]) if b.base > a.base]
        return statistics.median(gaps) if gaps else self.size * 1.2


@dataclass
class Page:
    index: int
    width: float
    height: float
    origin: tuple[float, float]
    blocks: list[Block]
    shapes: list[Shape]
    # Text objects inside a form XObject, mapped to that form. PDFium cannot
    # write a form back, so these are painted over rather than removed.
    parents: dict[int, int]
    handles: dict[int, object]
    # Painted before any text: a watermark or a page background, not a figure.
    first_text_z: int = 0

    @property
    def content_left(self) -> float:
        return min((b.x0 for b in self.blocks), default=36.0)

    @property
    def content_right(self) -> float:
        return max((b.x1 for b in self.blocks), default=self.width - 36.0)


def _address(handle) -> int:
    return ctypes.cast(handle, ctypes.c_void_p).value or 0


def _majority(values):
    counts: dict = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return max(counts, key=counts.get)


def _is_bold(weight: int, name: str, flags: int) -> bool:
    return weight >= 600 or bool(re.search(r"bold|black|heavy|semibold|demi", name, re.I)) or bool(flags & 0x40000)


_SKIP = {"Cc", "Cf", "Co", "Cs", "Cn"}


def _chars(textpage, height: float, origin: tuple[float, float]) -> list[Char]:
    """Every character, in reading order, with its style and place.

    Coordinates are turned top-down here, once, so that everything after
    reads the way the page does.
    """
    tp = textpage.raw
    rect = pdfium_c.FS_RECTF()
    ox, oy = ctypes.c_double(), ctypes.c_double()
    r, g, b, a = ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint()
    flags = ctypes.c_int()
    name = ctypes.create_string_buffer(256)
    matrix = pdfium_c.FS_MATRIX()
    bold_of: dict[int, bool] = {}
    x_origin, y_origin = origin
    page_top = height + y_origin

    chars: list[Char] = []
    for i in range(pdfium_c.FPDFText_CountChars(tp)):
        code = pdfium_c.FPDFText_GetUnicode(tp, i)
        if pdfium_c.FPDFText_IsGenerated(tp, i) == 1:
            chars.append(Char(ch="\n" if code in (10, 13) else " ", generated=True))
            continue
        if code in (0, 0xFFFE, 0xFFFF) or code > 0x10FFFF:
            continue
        ch = chr(code)
        if ch in "\r\n":
            chars.append(Char(ch="\n", generated=True))
            continue
        if unicodedata.category(ch) in _SKIP and ch != "\t":
            continue

        obj = pdfium_c.FPDFText_GetTextObject(tp, i)
        key = _address(obj)
        if key not in bold_of:
            length = pdfium_c.FPDFText_GetFontInfo(tp, i, name, 256, flags)
            font_name = name.value.decode("latin-1", "replace") if length else ""
            bold_of[key] = _is_bold(pdfium_c.FPDFText_GetFontWeight(tp, i), font_name, flags.value)
        pdfium_c.FPDFText_GetLooseCharBox(tp, i, rect)
        pdfium_c.FPDFText_GetCharOrigin(tp, i, ox, oy)
        pdfium_c.FPDFText_GetFillColor(tp, i, r, g, b, a)
        # The size the text is set at, times however much the page scales it:
        # a page placed into another at 75% reports its own, larger, size.
        scale = 1.0
        if pdfium_c.FPDFText_GetMatrix(tp, i, matrix):
            scale = abs(matrix.a * matrix.d - matrix.b * matrix.c) ** 0.5 or 1.0
        chars.append(
            Char(
                ch=" " if ch in "\t " else ch,
                x0=rect.left - x_origin,
                top=page_top - rect.top,
                x1=rect.right - x_origin,
                bottom=page_top - rect.bottom,
                base=page_top - oy.value,
                size=pdfium_c.FPDFText_GetFontSize(tp, i) * scale,
                bold=bold_of[key],
                color=(r.value, g.value, b.value),
                obj=key,
            )
        )
    return chars


def _make_line(chars: list[Char]) -> Line | None:
    text = re.sub(r"[ \t]+", " ", "".join(c.ch for c in chars)).strip()
    ink = [c for c in chars if not c.generated and c.ch.strip()]
    if not text or not ink:
        return None
    return Line(
        text=text,
        x0=min(c.x0 for c in ink),
        top=min(c.top for c in ink),
        x1=max(c.x1 for c in ink),
        bottom=max(c.bottom for c in ink),
        base=statistics.median(c.base for c in ink),
        size=statistics.median(c.size for c in ink),
        bold=_majority(c.bold for c in ink),
        color=_majority(c.color for c in ink),
        objs={c.obj for c in ink},
    )


def _crosses_rule(last: Char, c: Char, vrules: list[Shape]) -> bool:
    """A table's vertical border runs between these two characters."""
    for rule in vrules:
        x = (rule.x0 + rule.x1) / 2
        if last.x1 - 0.5 <= x <= c.x0 + 0.5 and rule.top <= c.base and rule.bottom >= c.base - 0.5 * c.size:
            return True
    return False


def _lines(chars: list[Char], vrules: list[Shape] | None = None) -> list[Line]:
    """Characters into lines, at every break and at every big jump sideways.

    A jump of a few letters' width on one baseline starts a new piece too: a
    header's left and right halves, or the cells of a table row, only happen
    to share a baseline. So does a table border between two characters, however
    close together the cells are set.
    """
    vrules = vrules or []
    lines: list[Line] = []
    current: list[Char] = []
    last: Char | None = None

    def flush():
        nonlocal current, last
        line = _make_line(current)
        if line:
            lines.append(line)
        current, last = [], None

    for c in chars:
        if c.generated:
            if c.ch == "\n":
                flush()
            elif current:
                current.append(c)
            continue
        if last is not None:
            size = max(c.size, last.size, 1.0)
            if (
                abs(c.base - last.base) > 0.6 * size
                or c.x0 < last.x0 - 2 * size
                or c.x0 - last.x1 > 2.4 * size
                or (vrules and c.x0 >= last.x1 - 0.5 and _crosses_rule(last, c, vrules))
            ):
                flush()
        if c.ch == " " and not current:
            continue
        current.append(c)
        if c.ch.strip():
            last = c
    flush()
    return lines


def _join_lines(texts: list[str]) -> str:
    out = ""
    for text in texts:
        if not out:
            out = text
        elif re.search(r"[A-Za-z]-$", out) and re.match(r"[a-z]", text):
            out = out[:-1] + text  # a word broken across two lines
        else:
            out += " " + text
    return out


# A line that opens a new item rather than carrying on the one above.
_MARKER = re.compile(
    r"^(?:[•●▪◦■►▸✓✔\-–—*]\s|\(?\d{1,3}[.)]\s|\([A-Za-z]\)\s|[A-Za-z][.)]\s|\((?:[ivxIVX]{1,4})\)\s|"
    r"(?:[ivx]{1,4}|[IVX]{1,4})[.)]\s|Q\.?\s?\d+[.:)]?\s|Option\s+\d|Statement\s+\d)"
)


def _close(a: tuple[int, int, int], b: tuple[int, int, int], tolerance: int = 40) -> bool:
    return sum(abs(x - y) for x, y in zip(a, b)) <= tolerance


def _inside(shape: Shape, box: tuple[float, float, float, float], slack: float = 1.5) -> bool:
    x0, top, x1, bottom = box
    return shape.x0 - slack <= x0 and shape.top - slack <= top and shape.x1 + slack >= x1 and shape.bottom + slack >= bottom


def _overlap(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    return w * h if w > 0 and h > 0 else 0.0


def _box_for(shapes: list[Shape], box: tuple[float, float, float, float], below_z: int) -> Shape | None:
    """The smallest rectangle drawn underneath the text that holds it."""
    best = None
    for shape in shapes:
        if shape.kind != "box" or shape.z >= below_z or shape.area <= 0 or not _inside(shape, box):
            continue
        if best is None or shape.area < best.area:
            best = shape
    return best


def _cell_for(line: Line, vrules: list[Shape], hrules: list[Shape], page_width: float) -> Shape | None:
    """The table cell a line sits in, from the thin lines drawn around it.

    Tables are often drawn as lines rather than boxes. A line of text with a
    border on each side is in a cell, and its words belong to that cell alone:
    they neither run into the next one nor join the text of another.
    """
    def spans(rule: Shape) -> bool:
        return rule.top <= line.base and rule.bottom >= line.base - 0.5 * line.size

    lefts = [(r.x0 + r.x1) / 2 for r in vrules if (r.x0 + r.x1) / 2 <= line.x0 + 1.0 and spans(r)]
    rights = [(r.x0 + r.x1) / 2 for r in vrules if (r.x0 + r.x1) / 2 >= line.x1 - 1.0 and spans(r)]
    if not lefts or not rights:
        return None
    left, right = max(lefts), min(rights)
    if right - left > 0.9 * page_width:
        return None
    sides = [r for r in vrules if (r.x0 + r.x1) / 2 in (left, right) and spans(r)]

    def across(rule: Shape) -> bool:
        return rule.x0 <= left + 1.0 and rule.x1 >= right - 1.0

    tops = [(r.top + r.bottom) / 2 for r in hrules if (r.top + r.bottom) / 2 <= line.top + 1.0 and across(r)]
    bottoms = [(r.top + r.bottom) / 2 for r in hrules if (r.top + r.bottom) / 2 >= line.bottom - 1.0 and across(r)]
    top = max(tops) if tops else max(r.top for r in sides)
    bottom = min(bottoms) if bottoms else min(r.bottom for r in sides)
    return Shape(x0=left, top=top, x1=right, bottom=bottom, z=0, kind="box")


def _same_box(a: Shape | None, b: Shape | None) -> bool:
    if a is None or b is None:
        return a is b
    return all(abs(p - q) <= 0.5 for p, q in ((a.x0, b.x0), (a.top, b.top), (a.x1, b.x1), (a.bottom, b.bottom)))


def _continues(block: Block, line: Line, line_box: Shape | None, column_right: float) -> bool:
    last = block.lines[-1]
    size = max(line.size, last.size, 1.0)
    if line.bold != last.bold or not _close(line.color, last.color):
        return False
    if abs(line.size - last.size) > 0.12 * size or not _same_box(line_box, block.box):
        return False
    # By baselines, not boxes: a font's box runs well above and below its
    # letters, so tightly set lines have boxes that overlap.
    pitch = line.base - last.base
    if pitch < 0.75 * size or pitch > 2.0 * size:
        return False
    if line.x0 > block.x1 or line.x1 < block.x0:
        return False
    indent = line.x0 - block.x0
    if indent < -1.6 * size or indent > 3.2 * size or _MARKER.match(line.text):
        return False
    # The line above stopped well short of the right edge, so it ended its
    # paragraph: a capital letter here starts the next one.
    box = block.box
    right = box.x1 - max(block.x0 - box.x0, 0.0) if box else column_right
    if last.x1 < right - max(8 * size, 0.25 * (right - block.x0)) and line.text[:1].isupper():
        return False
    return True


def _walk(container, matrix, form: bool, z: list[int], out: dict, height: float, origin) -> None:
    """Every object, through nested forms, in the order it is painted."""
    count = pdfium_c.FPDFFormObj_CountObjects(container) if form else pdfium_c.FPDFPage_CountObjects(container)
    left, bottom, right, top = ctypes.c_float(), ctypes.c_float(), ctypes.c_float(), ctypes.c_float()
    fill_mode, stroke = ctypes.c_int(), ctypes.c_int()
    r, g, b, a = ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint()
    for i in range(count):
        obj = pdfium_c.FPDFFormObj_GetObject(container, i) if form else pdfium_c.FPDFPage_GetObject(container, i)
        z[0] += 1
        kind = pdfium_c.FPDFPageObj_GetType(obj)
        if kind == pdfium_c.FPDF_PAGEOBJ_FORM:
            m = pdfium_c.FS_MATRIX()
            pdfium_c.FPDFPageObj_GetMatrix(obj, m)
            _walk(obj, _compose((m.a, m.b, m.c, m.d, m.e, m.f), matrix), True, z, out, height, origin)
            continue
        if kind == pdfium_c.FPDF_PAGEOBJ_TEXT:
            key = _address(obj)
            out["z"][key] = z[0]
            out["handles"][key] = obj
            if form:
                out["parents"][key] = container
            if pdfium_c.FPDFPageObj_GetBounds(obj, left, bottom, right, top):
                bx0, by0, bx1, by1 = _transform_box((left.value, bottom.value, right.value, top.value), matrix)
                out["text_boxes"][key] = (bx0 - origin[0], height + origin[1] - by1, bx1 - origin[0], height + origin[1] - by0)
            continue
        if kind not in (pdfium_c.FPDF_PAGEOBJ_PATH, pdfium_c.FPDF_PAGEOBJ_IMAGE):
            continue
        if not pdfium_c.FPDFPageObj_GetBounds(obj, left, bottom, right, top):
            continue
        x0, y0, x1, y1 = _transform_box((left.value, bottom.value, right.value, top.value), matrix)
        shape = Shape(
            x0=x0 - origin[0],
            top=height + origin[1] - y1,
            x1=x1 - origin[0],
            bottom=height + origin[1] - y0,
            z=z[0],
            kind="image",
        )
        transparent = bool(pdfium_c.FPDFPageObj_HasTransparency(obj))
        shape.transparent = transparent
        if kind == pdfium_c.FPDF_PAGEOBJ_IMAGE:
            shape.opaque = not transparent
            out["shapes"].append(shape)
            continue
        if not pdfium_c.FPDFPath_GetDrawMode(obj, fill_mode, stroke):
            continue
        filled = bool(fill_mode.value) and bool(pdfium_c.FPDFPageObj_GetFillColor(obj, r, g, b, a)) and a.value > 0
        if filled:
            shape.fill = (r.value, g.value, b.value)
            shape.opaque = a.value >= 250 and not transparent
        width, tall = shape.x1 - shape.x0, shape.bottom - shape.top
        if (filled or stroke.value) and width > 12 and tall > 6:
            shape.kind = "box"
        elif width < 2 and tall > 4:
            shape.kind = "vrule"  # a border; between table cells, a wall
        elif tall < 2 and width > 4:
            shape.kind = "hrule"
        elif width < 2 or tall < 2:
            continue
        else:
            shape.kind = "drawing"
        out["shapes"].append(shape)


def _compose(m, outer):
    if outer is None:
        return m
    a, b, c, d, e, f = m
    A, B, C, D, E, F = outer
    return (a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F)


def _transform_box(box, matrix):
    if matrix is None:
        return box
    x0, y0, x1, y1 = box
    a, b, c, d, e, f = matrix
    points = [(a * x + c * y + e, b * x + d * y + f) for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))]
    return min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)


def _unchanged_without(page: pdfium.PdfPage, blocks: list[Block], handles: dict[int, object]) -> set[int]:
    """The paragraphs whose spot looks the same with all of these made invisible.

    The page is drawn twice - as it is, and with these paragraphs' text made
    transparent - and compared where each one sits. Drawing order alone cannot
    say what a reader sees: a shape painted later may be clipped away and
    cover nothing, and a copy painted later may be the one that is hidden.
    """
    import numpy as np

    before = np.asarray(page.render(scale=1.0, draw_annots=False).to_pil().convert("L"), dtype=np.int16)
    saved = []
    colour = [ctypes.c_uint() for _ in range(4)]
    for block in blocks:
        for obj in block.objs:
            handle = handles.get(obj)
            if handle is None or not pdfium_c.FPDFPageObj_GetFillColor(handle, *colour):
                continue
            saved.append((handle, [c.value for c in colour]))
            pdfium_c.FPDFPageObj_SetFillColor(handle, colour[0].value, colour[1].value, colour[2].value, 0)
    try:
        after = np.asarray(page.render(scale=1.0, draw_annots=False).to_pil().convert("L"), dtype=np.int16)
    finally:
        for handle, (r, g, b, a) in saved:
            pdfium_c.FPDFPageObj_SetFillColor(handle, r, g, b, a)

    unchanged = set()
    rows, cols = before.shape
    for block in blocks:
        # The middle of each line, where the letters are: loose boxes overlap
        # the lines above and below, which would count as a change here.
        x0, top, x1, bottom = _core(block)
        region = (
            slice(max(0, int(top)), min(rows, int(bottom) + 1)),
            slice(max(0, int(x0)), min(cols, int(x1) + 1)),
        )
        changed = int((np.abs(before[region] - after[region]) > 30).sum())
        area = max(1, (region[0].stop - region[0].start) * (region[1].stop - region[1].start))
        if changed <= max(2, 0.01 * area):
            unchanged.add(id(block))
    return unchanged


def _core(block: Block) -> tuple[float, float, float, float]:
    """The middle of a paragraph's lines, where its letters are."""
    x0, top, x1, bottom = block.bbox
    inset = (bottom - top) * (0.25 if len(block.lines) == 1 else 0.1)
    return (x0, top + inset, x1, bottom - inset)


def _hidden_blocks(
    page: pdfium.PdfPage, blocks: list[Block], handles: dict[int, object], shapes: list[Shape]
) -> set[int]:
    """Paragraphs already invisible in the PDF - painted over, or clipped away.

    One pass with everything taken away finds what never showed. That pass
    cannot see text under other text, though: a patched PDF paints a new
    paragraph, on its own background, over an old one, and taking both away
    changes the spot either way. So any paragraph with something opaque
    painted over it afterwards, or sharing its spot with different words, is
    then checked on its own - together with any copies of itself, since a
    paragraph drawn twice is only hidden if every copy is.
    """
    hidden = _unchanged_without(page, blocks, handles)
    rest = [b for b in blocks if id(b) not in hidden]

    groups: list[list[Block]] = []
    for block in rest:
        reach = 1.5 * block.size
        for group in groups:
            first = group[0]
            if (
                first.text == block.text
                and abs((first.x0 + first.x1) / 2 - (block.x0 + block.x1) / 2) <= reach
                and abs((first.top + first.bottom) / 2 - (block.top + block.bottom) / 2) <= reach
            ):
                group.append(block)
                break
        else:
            groups.append([block])

    def covered_later(block: Block) -> bool:
        core = _core(block)
        area = max(1e-6, (core[2] - core[0]) * (core[3] - core[1]))
        return any(
            shape.opaque
            and shape.kind in ("box", "image")
            and shape.z > block.zmax
            and _overlap(core, (shape.x0, shape.top, shape.x1, shape.bottom)) > 0.15 * area
            for shape in shapes
        )

    def shares_spot(group: list[Block]) -> bool:
        for block in group:
            area = max(1e-6, (block.x1 - block.x0) * (block.bottom - block.top))
            for other in rest:
                if other.text == block.text:
                    continue
                other_area = max(1e-6, (other.x1 - other.x0) * (other.bottom - other.top))
                if _overlap(block.bbox, other.bbox) > 0.5 * min(area, other_area):
                    return True
        return False

    for group in groups:
        if any(covered_later(b) for b in group) or shares_spot(group):
            unchanged = _unchanged_without(page, group, handles)
            if all(id(b) in unchanged for b in group):
                hidden |= {id(b) for b in group}
    return hidden


def _object_text(handle, textpage) -> str:
    size = pdfium_c.FPDFTextObj_GetText(handle, textpage.raw, None, 0)
    if size <= 2:
        return ""
    buffer = ctypes.create_string_buffer(size)
    pdfium_c.FPDFTextObj_GetText(handle, textpage.raw, ctypes.cast(buffer, ctypes.POINTER(pdfium_c.FPDF_WCHAR)), size)
    return buffer.raw[: size - 2].decode("utf-16-le", errors="ignore")


def _claim_duplicates(lines: list[Line], found: dict, textpage) -> None:
    """Give each line the copies of its text that PDFium's reading skipped.

    Text drawn twice in the same place - a patched PDF redraws a corrected
    paragraph exactly over the old one - is read only once, from the first
    copy; the later copy, the one on top, belongs to no character at all. It
    must still go with its line: to be taken off the page along with it, and
    to count when deciding whether the line can be seen.
    """
    owner: dict[int, Line] = {}
    for line in lines:
        for obj in line.objs:
            owner[obj] = line
    boxes = found["text_boxes"]
    # Read objects by where they start, to find a twin without comparing every pair.
    spots: dict[tuple[int, int], list[int]] = {}
    for obj in owner:
        if obj in boxes:
            spots.setdefault((round(boxes[obj][0]), round(boxes[obj][1])), []).append(obj)
    for key, handle in found["handles"].items():
        box = boxes.get(key)
        if key in owner or box is None:
            continue
        # Exactly where an object that was read sits: the same text, redrawn.
        # (PDFium reports no text at all for such a copy.)
        near = [
            obj
            for dx in (-1, 0, 1)
            for dy in (-1, 0, 1)
            for obj in spots.get((round(box[0]) + dx, round(box[1]) + dy), [])
        ]
        twin = next(
            (owner[obj] for obj in near if all(abs(p - q) <= 0.6 for p, q in zip(boxes[obj], box))),
            None,
        )
        if twin is None:
            text = " ".join(_object_text(handle, textpage).split())
            area = max(1e-6, (box[2] - box[0]) * (box[3] - box[1]))
            twin = next(
                (
                    line
                    for line in lines
                    if text
                    and _overlap(box, (line.x0, line.top, line.x1, line.bottom)) >= 0.6 * area
                    and text in " ".join(line.text.split())
                ),
                None,
            )
        if twin is not None:
            twin.objs.add(key)


def _pin_colours(page: pdfium.PdfPage) -> None:
    """Write every shape's and text's colour back as plain RGB before PDFium
    rewrites the page.

    PDFium's rewrite drops colours given in an ICC colour space - which many
    PDF makers use for every colour - and leaves them black: a page's white
    background came out solid black, its text unreadable on top. Setting the
    same colour again, as RGB, makes PDFium write it out.
    """
    r, g, b, a = ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint()
    for i in range(pdfium_c.FPDFPage_CountObjects(page.raw)):
        obj = pdfium_c.FPDFPage_GetObject(page.raw, i)
        if pdfium_c.FPDFPageObj_GetType(obj) not in (pdfium_c.FPDF_PAGEOBJ_PATH, pdfium_c.FPDF_PAGEOBJ_TEXT):
            continue
        if pdfium_c.FPDFPageObj_GetFillColor(obj, r, g, b, a):
            pdfium_c.FPDFPageObj_SetFillColor(obj, r.value, g.value, b.value, a.value)
        if pdfium_c.FPDFPageObj_GetStrokeColor(obj, r, g, b, a):
            pdfium_c.FPDFPageObj_SetStrokeColor(obj, r.value, g.value, b.value, a.value)


def page_box(page: pdfium.PdfPage) -> tuple[float, float, float, float]:
    """The part of the page that is shown: left, bottom, right, top.

    Not get_mediabox(): a PDF may set its page size once for every page, and
    that call then answers with a default Letter page instead.
    """
    rect = pdfium_c.FS_RECTF()
    if pdfium_c.FPDF_GetPageBoundingBox(page.raw, rect):
        return rect.left, rect.bottom, rect.right, rect.top
    width, height = page.get_size()
    return 0.0, 0.0, width, height


def read_page(pdf: pdfium.PdfDocument, index: int) -> tuple[Page, pdfium.PdfPage]:
    page = pdf[index]
    mx0, my0, mx1, my1 = page_box(page)
    width, height, origin = mx1 - mx0, my1 - my0, (mx0, my0)

    found = {"z": {}, "handles": {}, "parents": {}, "shapes": [], "text_boxes": {}}
    _walk(page.raw, None, False, [0], found, height, origin)
    shapes: list[Shape] = found["shapes"]
    zorder: dict[int, int] = found["z"]
    vrules = [s for s in shapes if s.kind == "vrule"]
    hrules = [s for s in shapes if s.kind == "hrule"]
    textpage = page.get_textpage()
    try:
        lines = _lines(_chars(textpage, height, origin), vrules)
        _claim_duplicates(lines, found, textpage)
    finally:
        textpage.close()

    column_right = max((line.x1 for line in lines), default=width)
    blocks: list[Block] = []
    for line in lines:
        zmin = min((zorder.get(o, 0) for o in line.objs), default=0)
        line_box = _box_for(shapes, (line.x0, line.top, line.x1, line.bottom), zmin)
        cell = _cell_for(line, vrules, hrules, width) if vrules else None
        if cell is not None and (line_box is None or cell.area < line_box.area):
            line_box = cell
        if blocks and _continues(blocks[-1], line, line_box, column_right):
            blocks[-1].lines.append(line)
            continue
        blocks.append(Block(lines=[line], order=len(blocks), box=line_box))

    for block in blocks:
        block.objs = set().union(*(line.objs for line in block.lines))
        zs = [zorder.get(o, 0) for o in block.objs]
        block.zmin, block.zmax = min(zs), max(zs)
        block.nested = any(o in found["parents"] for o in block.objs)

    hidden = _hidden_blocks(page, blocks, found["handles"], shapes) if blocks else set()
    blocks = _dedupe([b for b in blocks if id(b) not in hidden], page, found["handles"])
    for n, block in enumerate(blocks):
        block.id = f"{index}-{n}"
    info = Page(index, width, height, origin, blocks, shapes, found["parents"], found["handles"])
    info.first_text_z = min(zorder.values(), default=0)
    return info, page


def _dedupe(blocks: list[Block], page: pdfium.PdfPage, handles: dict[int, object]) -> list[Block]:
    """One paragraph per place, however many times the PDF happens to draw it.

    Copies are drawn exactly on top of each other, or a few points apart.
    The one kept is the copy the reader actually sees, and the others' text
    objects go with it, so that all of them are taken off the page together.
    """
    groups: list[list[Block]] = []
    for block in blocks:
        cx, cy = (block.x0 + block.x1) / 2, (block.top + block.bottom) / 2
        reach = 1.5 * block.size
        for group in groups:
            first = group[0]
            if (
                first.text == block.text
                and abs((first.x0 + first.x1) / 2 - cx) <= reach
                and abs((first.top + first.bottom) / 2 - cy) <= reach
            ):
                group.append(block)
                break
        else:
            groups.append([block])

    def spots(group: list[Block]) -> list[list[Block]]:
        found: dict[tuple[int, int], list[Block]] = {}
        for block in group:
            found.setdefault((round(block.x0), round(block.top)), []).append(block)
        return sorted(found.values(), key=len, reverse=True)

    # Where copies sit in different places, the most common place may be the
    # one painted over: check by drawing the page without it.
    split = [g for g in groups if len(spots(g)) > 1]
    unseen: set[int] = set()
    if split:
        majority = [spots(g)[0] for g in split]
        hidden = _unchanged_without(page, [b for spot in majority for b in spot], handles)
        for spot in majority:
            if all(id(b) in hidden for b in spot):
                unseen.add(id(spot[0]))

    kept: list[Block] = []
    for group in groups:
        places = spots(group)
        main = places[0][0]
        if id(main) in unseen and len(places) > 1:
            main = places[1][0]
        for block in group:
            if block is not main:
                main.objs |= block.objs
                main.nested = main.nested or block.nested
                main.copies.append(block.bbox)
        kept.append(main)
    return sorted(kept, key=lambda b: b.order)


def extract(pdf_path: str) -> dict:
    pdf = pdfium.PdfDocument(pdf_path)
    try:
        pages = []
        for index in range(len(pdf)):
            info, page = read_page(pdf, index)
            pages.append(
                {
                    "index": index,
                    "width": round(info.width, 2),
                    "height": round(info.height, 2),
                    "blocks": [
                        {
                            "id": block.id,
                            "text": block.text,
                            "bbox": [round(v, 2) for v in block.bbox],
                            "size": round(block.size, 2),
                            "bold": block.bold,
                        }
                        for block in info.blocks
                    ],
                }
            )
            page.close()
        return {"format": FORMAT, "pages": pages}
    finally:
        pdf.close()


# ---------------------------------------------------------------------------
# Setting Kannada
# ---------------------------------------------------------------------------


class Typesetter:
    """Measures and wraps text exactly as fpdf2 will draw it.

    fpdf2 picks, for each character, the first of the fonts that has it and
    shapes each run with HarfBuzz; this does the same, so a line measured
    here is the line that gets drawn.
    """

    def __init__(self) -> None:
        import uharfbuzz as hb
        from fontTools.ttLib import TTFont

        self._hb = hb
        self.fonts: dict[tuple[str, bool], tuple[object, set[int], int]] = {}
        for family, files in FONT_FILES.items():
            for bold, file in zip((False, True), files):
                path = str(FONT_DIR / file)
                tt = TTFont(path, lazy=True)
                cmap = set(tt.getBestCmap().keys())
                upem = tt["head"].unitsPerEm
                tt.close()
                font = hb.Font(hb.Face(hb.Blob.from_file_path(path)))
                self.fonts[(family, bold)] = (font, cmap, upem)

    def family_for(self, ch: str, bold: bool) -> str | None:
        for family in FONT_FILES:
            if ord(ch) in self.fonts[(family, bold)][1]:
                return family
        return None

    def clean(self, text: str) -> str:
        """Only what one of the fonts can draw; joiners would split a run."""
        text = text.replace("‌", "").replace("‍", "")
        return "".join(ch for ch in text if ch == " " or self.family_for(ch, False) is not None)

    @lru_cache(maxsize=200_000)
    def width(self, text: str, bold: bool) -> float:
        """Width in points at size 1."""
        total = 0.0
        for family, run in self._runs(text, bold):
            font, _, upem = self.fonts[(family, bold)]
            buf = self._hb.Buffer()
            buf.add_str(run)
            buf.guess_segment_properties()
            self._hb.shape(font, buf)
            total += sum(p.x_advance for p in buf.glyph_positions) / upem
        return total

    def _runs(self, text: str, bold: bool):
        family, start = None, 0
        for i, ch in enumerate(text):
            # A space belongs to the run it sits in, as it does in fpdf2.
            this = family if ch == " " and family else self.family_for(ch, bold) or "kn"
            if this != family:
                if family is not None and i > start:
                    yield family, text[start:i]
                family, start = this, i
        if family is not None and start < len(text):
            yield family, text[start:]

    def wrap(self, text: str, bold: bool, size: float, width: float, indent: float = 0.0) -> list[str]:
        """Greedy line breaking at spaces; a word wider than a line is cut."""
        words = text.split()
        space = self.width(" ", bold) * size
        lines: list[str] = []
        current = ""
        current_width = 0.0
        for word in words:
            available = width - (indent if lines else 0.0)
            w = self.width(word, bold) * size
            if not current:
                if w <= available:
                    current, current_width = word, w
                    continue
                pieces = self._cut(word, bold, size, available)
                lines.extend(pieces[:-1])
                current = pieces[-1]
                current_width = self.width(current, bold) * size
                continue
            if current_width + space + w <= available:
                current += " " + word
                current_width += space + w
                continue
            lines.append(current)
            available = width - indent
            if w <= available:
                current, current_width = word, w
            else:
                pieces = self._cut(word, bold, size, available)
                lines.extend(pieces[:-1])
                current = pieces[-1]
                current_width = self.width(current, bold) * size
        if current:
            lines.append(current)
        return lines

    def _cut(self, word: str, bold: bool, size: float, width: float) -> list[str]:
        import regex

        clusters = regex.findall(r"\X", word)
        pieces, current = [], ""
        for cluster in clusters:
            if current and self.width(current + cluster, bold) * size > width:
                pieces.append(current)
                current = cluster
            else:
                current += cluster
        if current:
            pieces.append(current)
        return pieces or [word]


@dataclass
class Placement:
    lines: list[str]
    size: float
    line_height: float
    x: float
    right: float
    top: float
    align: str
    indent: float
    scale: float
    overflow: bool


def _is_figure(shape: Shape, page: Page) -> bool:
    """Something on the page text must not run into: a picture or a diagram.

    Watermarks and page backgrounds are not - they are painted before any
    text, or see-through, or cover most of the page.
    """
    if shape.kind not in ("image", "drawing") or shape.transparent or shape.z < page.first_text_z:
        return False
    return shape.area < 0.25 * page.width * page.height


def _area(block: Block, page: Page) -> tuple[float, float, float, float, str]:
    """The room a paragraph may use: left, right, top, bottom, and alignment."""
    box = block.box
    obstacles = [
        (o.x0, o.top, o.x1, o.bottom)
        for o in page.blocks
        if o is not block
    ] + [
        (s.x0, s.top, s.x1, s.bottom)
        for s in page.shapes
        if _is_figure(s, page) and _overlap(block.bbox, (s.x0, s.top, s.x1, s.bottom)) == 0
    ]

    if box is not None:
        pad = min(max(block.x0 - box.x0, 2.0), 24.0)
        left_limit, right_limit = box.x0 + pad, box.x1 - pad
        top_limit = min(block.top, box.top + 1.5)
        bottom_limit = max(block.bottom, box.bottom - 1.5)
    else:
        left_limit, right_limit = page.content_left, max(page.content_right, block.x1)
        top_limit, bottom_limit = block.top, page.height - 18.0
        # Boxes below are walls too.
        for shape in page.shapes:
            if shape.kind == "box" and shape.top >= block.bottom - 0.5 and shape.x1 > block.x0 and shape.x0 < right_limit:
                obstacles.append((shape.x0, shape.top, shape.x1, shape.bottom))

    for ox0, otop, ox1, obottom in obstacles:
        beside = otop < block.bottom and obottom > block.top
        if beside:
            if ox0 >= block.x1 - 0.5:
                right_limit = min(right_limit, ox0 - 3.0)
            elif ox1 <= block.x0 + 0.5:
                left_limit = max(left_limit, ox1 + 3.0)
    for ox0, otop, ox1, obottom in obstacles:
        across = ox0 < right_limit and ox1 > block.x0
        if not across:
            continue
        if otop >= block.bottom - 0.5:
            bottom_limit = min(bottom_limit, otop - 1.5)
        elif obottom <= block.top + 0.5:
            top_limit = max(top_limit, obottom + 1.0)

    right_limit = max(right_limit, block.x1)
    left_limit = min(left_limit, block.x0)
    top_limit = min(top_limit, block.top)
    bottom_limit = max(bottom_limit, block.bottom)

    # Alignment, for single lines that were clearly centred or set right.
    align = "L"
    container_left = box.x0 if box else page.content_left
    container_right = box.x1 if box else page.content_right
    span = max(container_right - container_left, 1.0)
    left_gap, right_gap = block.x0 - container_left, container_right - block.x1
    if len(block.lines) == 1:
        if left_gap > 0.15 * span and abs(left_gap - right_gap) <= max(3.0, 0.03 * span):
            align = "C"
        elif right_gap <= max(3.0, 0.02 * span) and left_gap > 0.4 * span:
            align = "R"
    elif all(abs((l.x0 + l.x1) / 2 - (block.x0 + block.x1) / 2) <= 2.0 for l in block.lines) and left_gap > 0.1 * span:
        align = "C"
    return left_limit, right_limit, top_limit, bottom_limit, align


_LEAD = re.compile(r"^(\s*(?:[•●▪◦■►▸✓✔*–-]|\(?\d{1,3}[.)]|\([A-Za-z]\)|[A-Za-z][.)]|\([ivxIVX]{1,4}\)|[ivxIVX]{1,4}[.)])\s+)")


def place(block: Block, page: Page, text: str, ts: Typesetter) -> Placement:
    """Where and how big a paragraph's Kannada goes.

    It keeps the paragraph's own size when it fits in the room around it -
    a box usually has space to the right of a line - and otherwise steps the
    size down until it does, never below MIN_SCALE of the original.
    """
    left_limit, right_limit, top_limit, bottom_limit, align = _area(block, page)
    bold, s0 = block.bold, block.size

    if align == "L":
        x, width = block.x0, right_limit - block.x0
    elif align == "R":
        x, width = left_limit, block.x1 - left_limit
    else:
        centre = (block.x0 + block.x1) / 2
        half = min(centre - left_limit, right_limit - centre)
        x, width = centre - half, 2 * half
    width = max(width, block.x1 - block.x0)

    # A hanging indent: continuation lines start under the text after "•" or "(1)".
    indent = 0.0
    if len(block.lines) > 1 and block.lines[1].x0 - block.lines[0].x0 > 1.0:
        indent = block.lines[1].x0 - block.lines[0].x0
    else:
        lead = _LEAD.match(text)
        if lead:
            indent = ts.width(lead.group(1), bold) * s0

    room = bottom_limit - top_limit

    def layout(size: float) -> tuple[list[str], float, float]:
        lines = ts.wrap(text, bold, size, width, indent * size / s0)
        line_height = max(block.pitch * size / s0, LINE_HEIGHT * size) if len(lines) > 1 else LINE_HEIGHT * size
        height = (len(lines) - 1) * line_height + (ASCENT + DESCENT) * size
        return lines, line_height, height

    floor = max(s0 * MIN_SCALE, min(MIN_SIZE, s0))
    lines, line_height, height = layout(s0)
    size = s0
    if height > room:
        lo, hi = floor, s0
        best = None
        for _ in range(9):
            mid = (lo + hi) / 2
            trial = layout(mid)
            if trial[2] <= room:
                best, lo = (mid, trial), mid
            else:
                hi = mid
        if best is None:
            size = floor
            lines, line_height, height = layout(floor)
        else:
            size, (lines, line_height, height) = best

    overflow = height > room + 0.5
    centre_y = (block.top + block.bottom) / 2
    top = centre_y - height / 2
    top = max(top_limit, min(top, bottom_limit - height))
    if overflow:
        top = top_limit
    return Placement(
        lines=lines,
        size=size,
        line_height=line_height,
        x=x,
        right=x + width,
        top=top,
        align=align,
        indent=indent * size / s0,
        scale=size / s0,
        overflow=overflow,
    )


# ---------------------------------------------------------------------------
# Writing the Kannada copy
# ---------------------------------------------------------------------------


def _overlay_pdf():
    from fpdf import FPDF

    pdf = FPDF(unit="pt")
    pdf.set_auto_page_break(False)
    pdf.set_margins(0, 0, 0)
    pdf.c_margin = 0
    for family, (regular, bold) in FONT_FILES.items():
        pdf.add_font(family, "", str(FONT_DIR / regular))
        pdf.add_font(family, "B", str(FONT_DIR / bold))
    pdf.set_fallback_fonts(["lat", "sym"], exact_match=False)
    pdf.set_text_shaping(True)
    return pdf


def _draw_line(pdf, text: str, family: str, bold: bool, size: float, color, x: float, baseline: float, width: float):
    # fpdf2 puts a cell's baseline at y + h/2 + 0.3 * size; with h = size
    # that is y + 0.8 * size.
    pdf.set_font(family, "B" if bold else "", size)
    pdf.set_text_color(*color)
    pdf.set_xy(x, baseline - 0.8 * size)
    pdf.cell(w=width + 2, h=size, text=text)


def _draw_block(pdf, block: Block, placement: Placement, ts: Typesetter) -> None:
    bold = block.bold
    for n, line in enumerate(placement.lines):
        baseline = placement.top + ASCENT * placement.size + n * placement.line_height
        line_width = ts.width(line, bold) * placement.size
        if placement.align == "R":
            x = placement.right - line_width
        elif placement.align == "C":
            x = (placement.x + placement.right) / 2 - line_width / 2
        else:
            x = placement.x + (placement.indent if n > 0 else 0.0)
        _draw_line(pdf, line, "kn", bold, placement.size, block.color, x, baseline, line_width)


def _redraw_original(pdf, block: Block, ts: Typesetter) -> None:
    """A paragraph that shared a text object with a translated one, as it was."""
    for line in block.lines:
        text = ts.clean(line.text)
        width = ts.width(text, line.bold) * line.size
        _draw_line(pdf, text, "lat", line.bold, line.size, line.color, line.x0, line.base, width)


def render(pdf_path: str, translations: dict[str, str], out_path: str) -> dict:
    """Write the Kannada copy, and check every changed page came out as meant.

    PDFium rewrites a page's drawing instructions when text is taken off it,
    and a rewrite can lose what PDFium does not fully support - a gradient, a
    pattern, a colour it cannot express. So each changed page is drawn as it
    should look, the saved file is drawn too, and any page that differs is
    made again a safer way: its background as an image of the page with the
    English taken off, and the Kannada over it. Nothing on such a page is
    rewritten, so nothing can be lost.
    """
    report, intended = _build(pdf_path, translations, out_path, set())
    misdrawn = _misdrawn(out_path, intended)
    if misdrawn:
        report, intended = _build(pdf_path, translations, out_path, misdrawn)
        report["imaged"] = sorted(misdrawn)
        report["misdrawn"] = sorted(_misdrawn(out_path, intended))
    return report


def _snapshot(page: pdfium.PdfPage):
    import numpy as np

    return np.asarray(page.render(scale=0.5, draw_annots=False).to_pil().convert("L"), dtype=np.uint8)


def _misdrawn(out_path: str, intended: dict[int, object]) -> set[int]:
    """Pages of the saved file that do not look as they were meant to."""
    import numpy as np

    bad: set[int] = set()
    saved = pdfium.PdfDocument(out_path)
    try:
        for index, expected in intended.items():
            page = saved[index]
            actual = _snapshot(page)
            page.close()
            if actual.shape != expected.shape:
                bad.add(index)
                continue
            if int((np.abs(actual.astype(np.int16) - expected) > 40).sum()) > 0.005 * actual.size:
                bad.add(index)
    finally:
        saved.close()
    return bad


def _build(pdf_path: str, translations: dict[str, str], out_path: str, imaged: set[int]) -> tuple[dict, dict[int, object]]:
    """One pass at the Kannada copy; `imaged` pages get the image background."""
    ts = Typesetter()
    overlay = _overlay_pdf()
    source = pdfium.PdfDocument(pdf_path)
    report = {"pages": len(source), "blocks": 0, "shrunk": 0, "overflow": [], "minScale": 1.0, "patched": 0}
    # Pages with English taken off, kept open: the change lives only in
    # PDFium's model of a page until it is written, and closing would lose it.
    held: dict[int, pdfium.PdfPage] = {}
    intended: dict[int, object] = {}

    try:
        pages_with_work = {key.split("-", 1)[0] for key, value in translations.items() if value.strip()}
        for index in range(len(source)):
            if str(index) not in pages_with_work:
                # Nothing to change here: no need to read the page at all.
                page = source[index]
                x0, y0, x1, y1 = page_box(page)
                overlay.add_page(format=(x1 - x0, y1 - y0))
                page.close()
                continue
            info, page = read_page(source, index)
            overlay.add_page(format=(info.width, info.height))
            wanted = {b.id: b for b in info.blocks if translations.get(b.id, "").strip()}
            if not wanted:
                page.close()
                continue

            # A text object shared with a paragraph that is staying English
            # takes that paragraph with it, to be redrawn as it was.
            owner: dict[int, list[Block]] = {}
            for block in info.blocks:
                for obj in block.objs:
                    owner.setdefault(obj, []).append(block)
            redraw = dict(wanted)
            changed = True
            while changed:
                changed = False
                for block in list(redraw.values()):
                    for obj in block.objs:
                        for other in owner.get(obj, []):
                            if other.id not in redraw:
                                redraw[other.id] = other
                                changed = True

            placements: dict[str, Placement] = {}
            for block in redraw.values():
                if block.id in wanted:
                    placements[block.id] = place(block, info, ts.clean(translations[block.id]), ts)

            image_background = index in imaged
            # Taken off PDFium's model of the page only; the page is written
            # out once, at the end, after its Kannada is in place.
            nested_blocks = []
            for block in redraw.values():
                for obj in block.objs:
                    handle = info.handles.get(obj)
                    if handle is None:
                        continue
                    parent = info.parents.get(obj)
                    if parent is not None:
                        if pdfium_c.FPDFFormObj_RemoveObject(parent, handle):
                            pdfium_c.FPDFPageObj_Destroy(handle)
                    elif pdfium_c.FPDFPage_RemoveObject(page.raw, handle):
                        pdfium_c.FPDFPageObj_Destroy(handle)
                if block.nested:
                    nested_blocks.append(block)

            if image_background:
                # The page as it now draws, English gone, becomes its own
                # background; everything else on it is taken off, so the
                # rewrite below has nothing left to get wrong.
                clean = page.render(scale=PATCH_SCALE, draw_annots=False).to_pil().convert("RGB")
                overlay.image(clean, x=0, y=0, w=info.width, h=info.height)
                for i in reversed(range(pdfium_c.FPDFPage_CountObjects(page.raw))):
                    obj = pdfium_c.FPDFPage_GetObject(page.raw, i)
                    if pdfium_c.FPDFPage_RemoveObject(page.raw, obj):
                        pdfium_c.FPDFPageObj_Destroy(obj)
            else:
                if nested_blocks:
                    # PDFium cannot write a form back, so text inside one stays
                    # in the file. Lay the clean background over it instead: the
                    # page as it now renders, with that text gone, cut to each spot.
                    clean = page.render(scale=PATCH_SCALE, draw_annots=False).to_pil().convert("RGB")
                    for block in nested_blocks:
                        boxes = [block.bbox, *block.copies]
                        x0 = max(0.0, min(b[0] for b in boxes) - 1.0)
                        top = max(0.0, min(b[1] for b in boxes) - 1.0)
                        x1 = min(info.width, max(b[2] for b in boxes) + 1.0)
                        bottom = min(info.height, max(b[3] for b in boxes) + 1.0)
                        crop = clean.crop(
                            (int(x0 * PATCH_SCALE), int(top * PATCH_SCALE), int(x1 * PATCH_SCALE + 0.999), int(bottom * PATCH_SCALE + 0.999))
                        )
                        overlay.image(crop, x=x0, y=top, w=x1 - x0, h=bottom - top)
                        report["patched"] += 1
            held[index] = page

            for block in redraw.values():
                if block.id in placements:
                    placement = placements[block.id]
                    _draw_block(overlay, block, placement, ts)
                    report["blocks"] += 1
                    report["minScale"] = min(report["minScale"], round(placement.scale, 3))
                    if placement.scale < 0.95:
                        report["shrunk"] += 1
                    if placement.overflow:
                        report["overflow"].append(block.id)
                else:
                    _redraw_original(overlay, block, ts)

        layer = pdfium.PdfDocument(bytes(overlay.output()))
        keep = []
        for index in sorted(held):
            page = held.pop(index)
            x0, y0, _, _ = page_box(page)
            xobject = layer.page_as_xobject(index, source)
            obj = xobject.as_pageobject()
            if x0 or y0:
                obj.transform(pdfium.PdfMatrix().translate(x0, y0))
            page.insert_obj(obj)
            # What this page is meant to look like, from PDFium's model of it
            # before anything is written - to hold the saved file against.
            intended[index] = _snapshot(page)
            _pin_colours(page)
            page.gen_content()
            keep.append(xobject)
            page.close()
        source.save(out_path)
        for xobject in keep:
            xobject.close()
        layer.close()
    finally:
        for page in held.values():
            page.close()
        source.close()
    return report, intended


# ---------------------------------------------------------------------------


def main(argv: list[str]) -> int:
    if len(argv) >= 3 and argv[0] == "extract":
        result = extract(argv[1])
        Path(argv[2]).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        return 0
    if len(argv) >= 4 and argv[0] == "render":
        request = json.loads(Path(argv[2]).read_text(encoding="utf-8"))
        if request.get("format") != FORMAT:
            print(f"translations were made for format {request.get('format')}, this is {FORMAT}", file=sys.stderr)
            return 3
        report = render(argv[1], request.get("translations", {}), argv[3])
        if len(argv) >= 5:
            Path(argv[4]).write_text(json.dumps(report), encoding="utf-8")
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
