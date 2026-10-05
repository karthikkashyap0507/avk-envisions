"""Tests for pdf_kannada.py, on small PDFs built here.

    python -m unittest translator/test_pdf_kannada.py     (from the repo root)

The real analysis PDFs are checked end to end separately; these pin down the
rules: what counts as a paragraph, what is left alone, and that a Kannada copy
keeps everything but the words.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pypdfium2 as pdfium  # noqa: E402
from fpdf import FPDF  # noqa: E402

import pdf_kannada as pk  # noqa: E402

TEAL = (23, 140, 156)
CREAM = (255, 247, 228)


def sample_pdf(path: str) -> None:
    """A page shaped like the analysis documents: banners, boxes, bullets, options."""
    pdf = FPDF(unit="pt", format="A4")
    pdf.set_auto_page_break(False)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 13)
    pdf.set_text_color(30, 60, 100)
    pdf.set_xy(50, 50)
    pdf.cell(0, 16, "6. Arrange the following items in descending order")

    # Options, one per line.
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(40, 40, 40)
    for n, option in enumerate(["(1) A, C, D, B", "(2) A, C, B, D"]):
        pdf.set_xy(60, 80 + n * 13)
        pdf.cell(0, 12, option)

    # A teal banner with its white heading, and a cream box under it.
    pdf.set_fill_color(*TEAL)
    pdf.rect(50, 120, 495, 18, style="F")
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_text_color(255, 255, 255)
    pdf.set_xy(56, 123)
    pdf.cell(0, 12, "HOW TO SOLVE")

    pdf.set_fill_color(*CREAM)
    pdf.rect(50, 138, 495, 60, style="F")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(40, 40, 40)
    pdf.set_xy(56, 142)
    pdf.multi_cell(
        480,
        11,
        "Separate receipts from expenditure and revenue from capital; then compare the broad magnitudes "
        "before checking the code given in the options of this question.",
        align="L",
    )
    pdf.set_xy(56, 170)
    pdf.cell(0, 11, "- Revenue receipt -> non-debt receipt")
    pdf.set_xy(56, 182)
    pdf.cell(0, 11, "- Capital receipt -> debt receipt")

    # Text painted over by a white box: invisible, and must stay so.
    pdf.set_text_color(200, 0, 0)
    pdf.set_xy(50, 230)
    pdf.cell(0, 12, "An old heading that was covered up")
    pdf.set_fill_color(255, 255, 255)
    pdf.rect(45, 226, 300, 20, style="F")

    pdf.output(path)


def pixel(pdf_path: str, x: float, y: float) -> tuple[int, int, int]:
    doc = pdfium.PdfDocument(pdf_path)
    image = doc[0].render(scale=2).to_pil().convert("RGB")
    value = image.getpixel((int(x * 2), int(y * 2)))
    doc.close()
    return value


class ExtractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        cls.source = os.path.join(cls.dir, "sample.pdf")
        sample_pdf(cls.source)
        cls.data = pk.extract(cls.source)
        cls.texts = [b["text"] for b in cls.data["pages"][0]["blocks"]]

    def test_format_and_ids(self):
        self.assertEqual(self.data["format"], pk.FORMAT)
        ids = [b["id"] for b in self.data["pages"][0]["blocks"]]
        self.assertEqual(ids, [f"0-{n}" for n in range(len(ids))])

    def test_paragraph_lines_join_and_items_stay_apart(self):
        self.assertIn("6. Arrange the following items in descending order", self.texts)
        self.assertIn("(1) A, C, D, B", self.texts)
        self.assertIn("(2) A, C, B, D", self.texts)
        self.assertIn("HOW TO SOLVE", self.texts)
        joined = [t for t in self.texts if t.startswith("Separate receipts")]
        self.assertEqual(len(joined), 1)
        self.assertTrue(joined[0].endswith("options of this question."))
        self.assertIn("- Revenue receipt -> non-debt receipt", self.texts)
        self.assertIn("- Capital receipt -> debt receipt", self.texts)

    def test_hidden_text_is_not_a_paragraph(self):
        self.assertFalse(any("covered up" in t for t in self.texts))

    def test_extraction_is_deterministic(self):
        self.assertEqual(pk.extract(self.source), self.data)


class RenderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        cls.source = os.path.join(cls.dir, "sample.pdf")
        cls.output = os.path.join(cls.dir, "sample-kn.pdf")
        sample_pdf(cls.source)
        blocks = {b["text"]: b["id"] for b in pk.extract(cls.source)["pages"][0]["blocks"]}
        cls.translations = {
            blocks["HOW TO SOLVE"]: "ಬಿಡಿಸುವ ವಿಧಾನ",
            next(i for t, i in blocks.items() if t.startswith("Separate receipts")): (
                "ಸ್ವೀಕೃತಿಗಳನ್ನು ವೆಚ್ಚದಿಂದ ಮತ್ತು ಆದಾಯವನ್ನು ಬಂಡವಾಳದಿಂದ ಪ್ರತ್ಯೇಕಿಸಿ; ನಂತರ ಕೋಡ್ ಪರಿಶೀಲಿಸುವ "
                "ಮೊದಲು ವಿಶಾಲ ಪ್ರಮಾಣಗಳನ್ನು ಹೋಲಿಸಿ ಮತ್ತು ಈ ಪ್ರಶ್ನೆಯ ಆಯ್ಕೆಗಳಲ್ಲಿ ನೀಡಿರುವ ಸಂಕೇತವನ್ನು ನೋಡಿ."
            ),
            blocks["- Revenue receipt -> non-debt receipt"]: "- ಆದಾಯ ಸ್ವೀಕೃತಿ -> ಸಾಲೇತರ ಸ್ವೀಕೃತಿ",
        }
        cls.report = pk.render(cls.source, cls.translations, cls.output)
        doc = pdfium.PdfDocument(cls.output)
        cls.text = doc[0].get_textpage().get_text_range()
        cls.pages = len(doc)
        doc.close()

    def test_translated_paragraphs_are_kannada_and_the_english_is_gone(self):
        self.assertTrue(any("ಀ" <= ch <= "೿" for ch in self.text))
        self.assertNotIn("HOW TO SOLVE", self.text)
        self.assertNotIn("Separate receipts", self.text)
        self.assertNotIn("Revenue receipt", self.text)

    def test_everything_else_is_left_exactly_as_it_was(self):
        self.assertIn("(1) A, C, D, B", self.text)
        self.assertIn("Capital receipt -> debt receipt", self.text)
        self.assertIn("6. Arrange the following items", self.text)
        self.assertEqual(self.pages, 1)

    def test_boxes_keep_their_colours(self):
        # Far right of the banner and the box, where no text reaches.
        self.assertEqual(pixel(self.output, 540, 129), TEAL)
        self.assertEqual(pixel(self.output, 540, 195), CREAM)

    def test_hidden_text_stays_hidden(self):
        self.assertEqual(pixel(self.output, 60, 236), (255, 255, 255))

    def test_report(self):
        self.assertEqual(self.report["blocks"], 3)
        self.assertEqual(self.report["overflow"], [])
        self.assertGreaterEqual(self.report["minScale"], pk.MIN_SCALE)


class TypesetterTest(unittest.TestCase):
    def test_wraps_within_the_width_and_keeps_every_word(self):
        ts = pk.Typesetter()
        text = "ಸಂವಿಧಾನದ 86ನೇ ತಿದ್ದುಪಡಿ ಕಾಯಿದೆ ಮಕ್ಕಳಿಗೆ ಉಚಿತ ಮತ್ತು ಕಡ್ಡಾಯ ಶಿಕ್ಷಣದ ಮೂಲಭೂತ ಹಕ್ಕನ್ನು ನೀಡುತ್ತದೆ NALSA"
        lines = ts.wrap(text, False, 9, 120)
        self.assertGreater(len(lines), 1)
        self.assertEqual(" ".join(lines).split(), text.split())
        for line in lines:
            self.assertLessEqual(ts.width(line, False) * 9, 120.01)

    def test_drops_what_no_font_can_draw(self):
        ts = pk.Typesetter()
        self.assertEqual(ts.clean("ಕ‍ನ್ನಡ x"), "ಕನ್ನಡ x")


if __name__ == "__main__":
    unittest.main()
