"""English -> Kannada translation with IndicTrans2, on the CPU, with no API.

The model is AI4Bharat's IndicTrans2 En-Indic distilled 200M (MIT), exported
to ONNX and int8-quantised by naklitechie
(https://huggingface.co/naklitechie/indictrans2-en-indic-dist-200M-ONNX-int8,
MIT). It runs on ONNX Runtime alone - no PyTorch, no GPU - in about 400 MB of
memory, which is what makes it fit beside the website on a 2 GB machine.

IndicTrans2 does not translate raw text. It was trained on text prepared in a
specific way, and it answers in Devanagari whatever the target language, so
the preparation below is copied from AI4Bharat's ``IndicProcessor`` (via
IndicTransToolkit, MIT, (c) Varun Gumma) rather than reinvented: a
reimplementation that drifts from the training-time preprocessing produces
fluent Kannada that says the wrong thing, which is worse than an error. Only
the English-source path is kept, since nothing here translates the other way.

Two things are added for exam text, and both are marked where they happen:

* Statement and option letters ("A", "B and D only", "II") are protected with
  the same placeholder mechanism the model already uses for numbers, so they
  come back as the Latin letters the options refer to.
* Sentences are translated in batches rather than one at a time.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import onnxruntime as ort
import regex
import sacremoses
from indicnlp.tokenize import indic_detokenize
from tokenizers import Tokenizer

SRC_LANG = "eng_Latn"
TGT_LANG = "kan_Knda"

# IndicTrans2's position table is 256 long; a longer input is cut, not refused.
MAX_SOURCE_TOKENS = 256

# ---------------------------------------------------------------------------
# Preprocessing, from IndicTransToolkit's IndicProcessor (English source only)
# ---------------------------------------------------------------------------

# Ways the model has been seen to mangle the literal "ID" inside a placeholder,
# kept verbatim from upstream - including the missing comma on the tenth entry,
# which Python concatenates, so the maps stay identical to the original.
_INDIC_FAILURE_CASES = [
    "آی ڈی ", "ꯑꯥꯏꯗꯤ", "आईडी", "आई . डी . ", "आई . डी .", "आई. डी. ",
    "आई. डी.", "आय. डी. ", "आय. डी.", "आय . डी . ", "आय . डी ."
    "आइ . डी . ", "आइ . डी .", "आइ. डी. ", "आइ. डी.", "ऐटि", "آئی ڈی ",
    "ᱟᱭᱰᱤ ᱾", "आयडी", "ऐडि", "आइडि", "ᱟᱭᱰᱤ",
]

_PUNC_REPLACEMENTS = [
    (regex.compile(r"\r"), ""),
    (regex.compile(r"\(\s*"), "("),
    (regex.compile(r"\s*\)"), ")"),
    (regex.compile(r"\s:\s?"), ":"),
    (regex.compile(r"\s;\s?"), ";"),
    (regex.compile(r"[`´‘‚’]"), "'"),
    (regex.compile(r"[„“”«»]"), '"'),
    (regex.compile(r"[–—]"), "-"),
    (regex.compile(r"\.\.\."), "..."),
    (regex.compile(r" %"), "%"),
    (regex.compile(r"nº "), "nº "),
    (regex.compile(r" ºC"), " ºC"),
    (regex.compile(r" [?!;]"), lambda m: m.group(0).strip()),
    (regex.compile(r", "), ", "),
]
_MULTISPACE = regex.compile(r"[ ]{2,}")
_END_BRACKET_SPACE_PUNC = regex.compile(r"\) ([\.!:?;,])")
_DIGIT_SPACE_PERCENT = regex.compile(r"(\d) %")
_DOUBLE_QUOT_PUNC = regex.compile(r"\"([,\.]+)")
_DIGIT_NBSP_DIGIT = regex.compile(r"(\d) (\d)")
_WHITESPACE = regex.compile(r"\s+")

_URL = regex.compile(
    r"\b(?<![\w/.])(?:(?:https?|ftp)://)?(?:(?:[\w-]+\.)+(?!\.))"
    r"(?:[\w/\-?#&=%.]+)+(?!\.\w+)\b")
_NUMERAL = regex.compile(
    r"(~?\d+\.?\d*\s?%?\s?-?\s?~?\d+\.?\d*\s?%|~?\d+%|"
    r"\d+[-\/.,:']\d+[-\/.,:'+]\d+(?:\.\d+)?|\d+[-\/.:'+]\d+(?:\.\d+)?)")
_EMAIL = regex.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}")
_OTHER = regex.compile(r"[A-Za-z0-9]*[#|@]\w+")

# Added for exam text: a statement or option label standing on its own -
# "Statement C", "A and D only", "Reason (R)", columns P/Q/R/S, "II and III".
#
# A single capital letter on its own is a label in exam text, with two
# exceptions: "A" is also the article and "I" the pronoun. Those two count only
# where an article or pronoun could not stand: in a list ("A, B"), before a
# conjunction or "only" ("A and D only"), or in brackets. A letter followed by
# ".x" is an abbreviation ("U.S."), not a label.
_LABEL = regex.compile(
    r"(?<![\w'’.-])"
    r"(?:"
    r"(?:[B-HJ-Z]|II|III|IV|VI|VII|VIII|IX|XI|XII)(?![\w'’-]|\.\w)"
    r"|(?:A|I)(?=\s*(?:,|/|\)|\s(?:and|or|only|nor|are|is|were|was)\b|$))"
    r"|(?<=\()(?:A|I)(?![\w'’-])"
    # Lowercase list markers inside a line - "... in 2014? i. Hudhud ii. ..."
    # and "(a)" - which the engine otherwise drops.
    r"|(?:i{1,3}|iv|vi{0,3}|ix)(?=[.)](?:\s|$))"
    r"|(?<=\()[a-h](?=\))"
    r")")

# How the model spells a letter out in Kannada when it will not copy it - used
# only to turn such a spelling back into the label the English had.
_LETTER_NAMES = {
    "A": "ಎ", "B": "ಬಿ", "C": "ಸಿ", "D": "ಡಿ", "E": "ಇ", "F": "ಎಫ್", "G": "ಜಿ",
    "H": "ಎಚ್", "J": "ಜೆ", "K": "ಕೆ", "L": "ಎಲ್", "M": "ಎಂ", "N": "ಎನ್", "O": "ಒ",
    "P": "ಪಿ", "Q": "ಕ್ಯೂ", "R": "ಆರ್", "S": "ಎಸ್", "T": "ಟಿ", "U": "ಯು", "V": "ವಿ",
    "W": "ಡಬ್ಲ್ಯು", "X": "ಎಕ್ಸ್", "Y": "ವೈ", "Z": "ಝಡ್",
}


def _relabel(kannada: str, source: str) -> str:
    """Turn a label the model spelled out ("ಸಿ") back into the letter ("C").

    Only for letters that were labels in this sentence's English, and only
    where the spelling stands alone, so a syllable inside a word is never hit.
    """
    for letter in {m.group(0) for m in _LABEL.finditer(source)}:
        name = _LETTER_NAMES.get(letter)
        if name:
            kannada = regex.sub(rf"(?<![\p{{L}}\p{{M}}]){regex.escape(name)}(?![\p{{L}}\p{{M}}])", letter, kannada)
    return kannada


def _punc_norm(text: str) -> str:
    for pattern, replacement in _PUNC_REPLACEMENTS:
        text = pattern.sub(replacement, text)
    text = _MULTISPACE.sub(" ", text)
    text = _END_BRACKET_SPACE_PUNC.sub(r")\1", text)
    text = _DIGIT_SPACE_PERCENT.sub(r"\1%", text)
    text = _DOUBLE_QUOT_PUNC.sub(r'\1"', text)
    text = _DIGIT_NBSP_DIGIT.sub(r"\1.\2", text)
    return text.strip()


def _placeholder_spellings(serial: int) -> List[str]:
    """Every spelling of ``<IDn>`` the model has been seen to emit."""
    spellings = [t.format(n=serial) for t in (
        "<ID{n}>", "< ID{n} >", "[ID{n}]", "[ ID{n} ]", "[ID {n}]", "<ID{n}]",
        "< ID{n}]", "<ID{n} ]", "<id{n}>", "< id{n} >", "[id{n}]", "[ id{n} ]",
        "[id {n}]", "<id{n}]", "< id{n}]", "<id{n} ]")]
    for case in _INDIC_FAILURE_CASES:
        spellings += [t.format(c=case, n=serial) for t in (
            "<{c}{n}>", "< {c}{n} >", "< {c} {n} >", "<{c} {n}]", "< {c} {n} ]",
            "[{c}{n}]", "[{c} {n}]", "[ {c}{n} ]", "[ {c} {n} ]", "{c} {n}",
            "{c}{n}")]
    return spellings


class Placeholders:
    """What was swapped out of one sentence, so it can be put back."""

    def __init__(self) -> None:
        self.spellings: Dict[str, str] = {}
        self.by_serial: Dict[int, str] = {}

    def add(self, serial: int, original: str) -> None:
        self.by_serial[serial] = original
        for spelling in _placeholder_spellings(serial):
            self.spellings[spelling] = original


def _wrap_with_placeholders(text: str, protect_labels: bool = True) -> Tuple[str, Placeholders]:
    """URLs, emails, numerals, handles - and exam labels - become ``<IDn>``.

    The model is not asked to translate these; it is asked to move a short
    opaque token, which it does far more reliably.
    """
    serial = 1
    held = Placeholders()

    for pattern in (_EMAIL, _URL, _NUMERAL, _OTHER):
        for match in set(pattern.findall(text)):
            if pattern is _URL and len(match.replace(".", "")) < 4:
                continue
            if pattern is _NUMERAL:
                if len(match.replace(" ", "").replace(".", "").replace(":", "")) < 4:
                    continue
            held.add(serial, match)
            text = text.replace(match, f"<ID{serial}>")
            serial += 1

    # Labels last, one occurrence at a time, so "A and D" gets two placeholders
    # and a label inside an already-placed URL is never touched.
    if protect_labels:
        def protect(match: "regex.Match[str]") -> str:
            nonlocal serial
            held.add(serial, match.group(0))
            token = f"<ID{serial}>"
            serial += 1
            return token

        text = _LABEL.sub(protect, text)

    text = _WHITESPACE.sub(" ", text).replace(">/", ">").replace("]/", "]")
    return text, held


# ---------------------------------------------------------------------------
# Postprocessing
# ---------------------------------------------------------------------------

# indic_nlp_library's UnicodeIndicTransliterator, reduced to the one pair used
# here. The Brahmic blocks share a layout, so Devanagari -> Kannada is an offset
# over the coordinated range, skipping the two dandas. Inlined rather than
# imported because that module pulls in pandas to load tables this pair never
# reads.
_DEVANAGARI_START, _KANNADA_START = 0x0900, 0x0C80
_COORDINATED_END = 0x6F


def _devanagari_to_kannada(text: str) -> str:
    out = []
    for ch in text:
        offset = ord(ch) - _DEVANAGARI_START
        if 0 <= offset <= _COORDINATED_END and ch not in ("\u0964", "\u0965"):
            out.append(chr(_KANNADA_START + offset))
        else:
            out.append(ch)
    return "".join(out)


# A placeholder the model has respelled in a way upstream's list does not know,
# e.g. "<ऐ. डी. 1>": a bracket, a short run of non-Latin letters or "ID", and
# the serial number.
_MANGLED = regex.compile(
    r"[<\[]\s*"
    r"(?:(?:[Ii]\s*\.?\s*[Dd]|[\p{Devanagari}\p{Kannada}\p{Arabic}\p{Ol_Chiki}\p{Meetei_Mayek}]+)\s*\.?\s*){1,3}"
    r"(\d{1,3})\s*[>\]]")
# Anything still looking like a placeholder after restoring is a failure.
_LEFTOVER = regex.compile(r"[<\[]\s*[^<>\[\]]{0,16}?\d{1,3}\s*[>\]]")


def _restore(text: str, held: Placeholders) -> str:
    # Longest spellings first, so "<ID12>" is never read as "<ID1>" + "2".
    for spelling in sorted(held.spellings, key=len, reverse=True):
        text = text.replace(spelling, held.spellings[spelling])

    def repair(match: "regex.Match[str]") -> str:
        return held.by_serial.get(int(match.group(1)), match.group(0))

    return _MANGLED.sub(repair, text)


def _complete(text: str, held: Placeholders) -> bool:
    """Every swapped-out token came back, and nothing placeholder-like is left."""
    if _LEFTOVER.search(text):
        return False
    remaining = text
    for original in held.by_serial.values():
        if original not in remaining:
            return False
        remaining = remaining.replace(original, "", 1)
    return True


def _fix_colons(kannada: str, source: str) -> str:
    """Put back colons the model wrote as visarga.

    The model writes ":" as the Devanagari visarga, which becomes Kannada "ಃ"
    once transliterated - so "Consider the following statements:" ends in
    "ಪರಿಗಣಿಸಿಃ". A visarga that ends a word where the English had a colon is
    turned back, as many times as the English had colons; a real visarga
    inside a word ("ದುಃಖ") is never touched.
    """
    wanted = source.count(":")
    if wanted == 0:
        return kannada

    def swap(match: "regex.Match[str]") -> str:
        nonlocal wanted
        if wanted == 0:
            return match.group(0)
        wanted -= 1
        return ":"

    return regex.sub(r"ಃ(?=\s|$)", swap, kannada)


def _fix_dashes(kannada: str, source: str) -> str:
    """Put back the spaces around a dash that separated two clauses.

    Normalisation turns "—" and "–" into "-", and the Kannada comes back with
    the two sides glued: "1857 — which pair" becomes "1857-ಯಾವ". Where the
    English had a spaced dash, the first as many hyphens between words (not
    between digits, where a hyphen is a range) become " — " again.
    """
    wanted = len(regex.findall(r"\s[–—-]\s", source))
    if wanted == 0:
        return kannada

    def swap(match: "regex.Match[str]") -> str:
        nonlocal wanted
        text = match.string
        before = text[match.start() - 1] if match.start() > 0 else ""
        after = text[match.end()] if match.end() < len(text) else ""
        # Digit-hyphen-digit is a range ("2009-2014"), not a clause break.
        if wanted == 0 or (before.isdigit() and after.isdigit()):
            return match.group(0)
        wanted -= 1
        return " — "

    return regex.sub(r"(?<=\S)\s?-\s?(?=\S)", swap, kannada)


# ---------------------------------------------------------------------------
# The model
# ---------------------------------------------------------------------------

class KannadaTranslator:
    """Loads the ONNX bundle once and translates lists of English sentences."""

    def __init__(self, model_dir: str | os.PathLike, threads: int | None = None, low_memory: bool = False):
        model = Path(model_dir)

        options = ort.SessionOptions()
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # On the 2-vCPU server the website shares the machine, so the thread
        # count is set by the caller rather than grabbing every core.
        options.intra_op_num_threads = threads or 0
        options.inter_op_num_threads = 1
        if low_memory:
            # ONNX Runtime's arena keeps every allocation it ever made and
            # grows by doubling: about 1.6 GB held after one long batch,
            # against about 0.85 GB without it, at roughly twice the time per
            # sentence. On a 2 GB machine shared with the website, memory wins.
            options.enable_cpu_mem_arena = False
        providers = ["CPUExecutionProvider"]

        self._encoder = ort.InferenceSession(str(model / "encoder_model.onnx"), options, providers=providers)
        self._decoder = ort.InferenceSession(str(model / "decoder_model.onnx"), options, providers=providers)
        self._decoder_past = ort.InferenceSession(
            str(model / "decoder_with_past_model.onnx"), options, providers=providers)
        # One logits tensor, then four KV tensors per layer.
        self._layers = (len(self._decoder.get_outputs()) - 1) // 4

        self._src_tok = Tokenizer.from_file(str(model / "tokenizer_src.json"))
        self._tgt_tok = Tokenizer.from_file(str(model / "tokenizer_tgt.json"))
        meta = json.loads((model / "tokenizer_meta.json").read_text(encoding="utf-8"))
        self._src_vocab = int(meta["src_dict_size"])
        self._tgt_vocab = int(meta["tgt_dict_size"])
        self._unk = int(meta["unk_id"])

        generation = json.loads((model / "generation_config.json").read_text(encoding="utf-8"))
        self._start_id = int(generation.get("decoder_start_token_id", 2))
        self._eos_id = int(generation.get("eos_token_id", 2))
        self._pad_id = int(generation.get("pad_token_id", 1))

        self._moses_norm = sacremoses.MosesPunctNormalizer()
        self._moses_tok = sacremoses.MosesTokenizer(lang="en")

    # -- one sentence in, one tagged sentence out -------------------------

    def _prepare(self, sentence: str, protect_labels: bool = True) -> Tuple[List[int], Placeholders]:
        text = _punc_norm(sentence)
        text, held = _wrap_with_placeholders(text, protect_labels)
        normed = self._moses_norm.normalize(text.strip())
        processed = " ".join(self._moses_tok.tokenize(normed, escape=False)).strip()
        ids = self._src_tok.encode(f"{SRC_LANG} {TGT_LANG} {processed}").ids
        ids = [i if i < self._src_vocab else self._unk for i in ids]
        if len(ids) > MAX_SOURCE_TOKENS:
            ids = ids[: MAX_SOURCE_TOKENS - 1] + [self._eos_id]
        return ids, held

    def _finish(self, ids: List[int], held: Placeholders, source: str) -> Tuple[str, bool]:
        """Token ids -> Kannada, and whether every placeholder came back."""
        safe = [i if i < self._tgt_vocab else self._unk for i in ids]
        text = self._tgt_tok.decode(safe, skip_special_tokens=True)
        text = _restore(text, held)
        ok = _complete(text, held)
        text = _devanagari_to_kannada(text)
        text = indic_detokenize.trivial_detokenize(text, "kn")
        return _fix_dashes(_fix_colons(text, source), source), ok

    # -- batched greedy decoding ------------------------------------------

    def _generate(self, batch: List[List[int]]) -> List[List[int]]:
        size = len(batch)
        width = max(len(ids) for ids in batch)
        input_ids = np.full((size, width), self._pad_id, dtype=np.int64)
        mask = np.zeros((size, width), dtype=np.int64)
        for row, ids in enumerate(batch):
            input_ids[row, : len(ids)] = ids
            mask[row, : len(ids)] = 1

        hidden = self._encoder.run(["last_hidden_state"], {"input_ids": input_ids, "attention_mask": mask})[0]

        # Kannada runs to roughly twice the English token count; cap generously.
        limit = min(MAX_SOURCE_TOKENS, 2 * width + 16)
        step_ids = np.full((size, 1), self._start_id, dtype=np.int64)
        outputs: List[List[int]] = [[] for _ in range(size)]
        done = np.zeros(size, dtype=bool)
        past: List[np.ndarray] = []

        for step in range(limit):
            if step == 0:
                result = self._decoder.run(None, {
                    "input_ids": step_ids,
                    "encoder_hidden_states": hidden,
                    "encoder_attention_mask": mask,
                })
            else:
                feed = {"input_ids": step_ids, "encoder_attention_mask": mask}
                for layer in range(self._layers):
                    base = layer * 4
                    feed[f"past_key_values.{layer}.decoder.key"] = past[base]
                    feed[f"past_key_values.{layer}.decoder.value"] = past[base + 1]
                    feed[f"past_key_values.{layer}.encoder.key"] = past[base + 2]
                    feed[f"past_key_values.{layer}.encoder.value"] = past[base + 3]
                result = self._decoder_past.run(None, feed)

            past = result[1:]
            next_ids = result[0][:, -1, :].argmax(axis=-1)
            for row in range(size):
                if not done[row]:
                    token = int(next_ids[row])
                    if token == self._eos_id:
                        done[row] = True
                    else:
                        outputs[row].append(token)
            if done.all():
                break
            # A finished row keeps being fed EOS; its output is already closed.
            step_ids = np.where(done, self._eos_id, next_ids).astype(np.int64).reshape(size, 1)

        return outputs

    def _run(self, items: List[Tuple[int, List[int], Placeholders]], sentences: List[str],
             batch_size: int) -> Dict[int, Tuple[str, bool]]:
        done: Dict[int, Tuple[str, bool]] = {}
        # Similar lengths batched together waste the least padding.
        items = sorted(items, key=lambda item: len(item[1]))
        for start in range(0, len(items), batch_size):
            chunk = items[start : start + batch_size]
            generated = self._generate([ids for _, ids, _ in chunk])
            for (index, _, held), ids in zip(chunk, generated):
                done[index] = self._finish(ids, held, sentences[index])
        return done

    def translate(self, sentences: List[str], batch_size: int = 8) -> List[str]:
        """Translate each sentence; empty input comes back empty.

        A sentence whose placeholders did not all come back - a dropped "C" in
        "Statement C is correct", or a respelling nothing could repair - is
        tried again on its own, and then once more with its labels left as
        plain text. The last result is kept whatever it is: a label the model
        wrote in Kannada letters is better than one it dropped.
        """
        results = [""] * len(sentences)
        items = [
            (index, *self._prepare(sentence))
            for index, sentence in enumerate(sentences)
            if sentence and sentence.strip()
        ]

        first = self._run(items, sentences, batch_size)
        retry = []
        for index, _, _ in items:
            text, ok = first[index]
            results[index] = text
            if not ok:
                retry.append(index)

        if retry:
            alone = self._run([(i, *self._prepare(sentences[i])) for i in retry], sentences, 1)
            still = []
            for index in retry:
                text, ok = alone[index]
                if ok:
                    results[index] = text
                else:
                    still.append(index)
            if still:
                plain = self._run(
                    [(i, *self._prepare(sentences[i], protect_labels=False)) for i in still], sentences, 1)
                for index in still:
                    results[index] = _relabel(plain[index][0], sentences[index])

        return results
