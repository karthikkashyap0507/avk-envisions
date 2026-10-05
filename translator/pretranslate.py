"""Translate a list of sentences in bulk, for the shipped translation memory.

    python pretranslate.py <model_dir> <sentences.json> <out.jsonl> [threads] [lean|fast] [batch]

Reads the JSON array written by scripts/kannada-memory-export.mts (or
scripts/kannada-doc-sentences.mts) and appends one {"s": english, "t": kannada}
line per sentence to out.jsonl. Safe to stop and run again: sentences already
in out.jsonl are skipped.

A sentence the engine answers without any Kannada - a bare name, a code - is
written with its English as the "translation": the engine gives the same
answer every time, and a server that inherited nothing for it would spend
minutes asking again.

Runs the fast configuration unless "lean" is given, which uses about half the
memory for somewhat less speed - for a computer that is also in use. On a
four-core laptop, 4 threads with batches of 32 measured twice as fast as 8
threads with batches of 8: more threads than cores only fight each other.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from engine import KannadaTranslator

CHUNK = 128


def main() -> None:
    model_dir, sentences_path, out_path = sys.argv[1:4]
    threads = int(sys.argv[4]) if len(sys.argv) > 4 else 0
    lean = len(sys.argv) > 5 and sys.argv[5] == "lean"
    batch = int(sys.argv[6]) if len(sys.argv) > 6 else 8

    sentences = json.loads(Path(sentences_path).read_text(encoding="utf-8"))
    out = Path(out_path)
    done = set()
    if out.exists():
        for line in out.read_text(encoding="utf-8").splitlines():
            if line.strip():
                done.add(json.loads(line)["s"])
    todo = [s for s in sentences if s not in done]
    print(f"{len(todo)} to translate, {len(done)} already done", flush=True)

    # A long run on someone's own computer: give way to everything else on it.
    try:
        import psutil

        psutil.Process().nice(psutil.BELOW_NORMAL_PRIORITY_CLASS if sys.platform == "win32" else 10)
    except Exception:
        pass

    translator = KannadaTranslator(model_dir, threads=threads or None, low_memory=lean)
    started = time.time()
    written = 0
    with out.open("a", encoding="utf-8") as sink:
        for start in range(0, len(todo), CHUNK):
            chunk = todo[start : start + CHUNK]
            for source, target in zip(chunk, translator.translate(chunk, batch_size=batch)):
                if not any("ಀ" <= ch <= "೿" for ch in target):
                    target = source
                sink.write(json.dumps({"s": source, "t": target}, ensure_ascii=False) + "\n")
                written += 1
            sink.flush()
            finished = start + len(chunk)
            rate = finished / max(time.time() - started, 1e-6)
            remaining = (len(todo) - finished) / max(rate, 1e-6)
            print(f"{finished}/{len(todo)}  {rate:.2f}/s  ~{remaining / 60:.0f} min left", flush=True)

    print(f"done: {written} written in {(time.time() - started) / 60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
