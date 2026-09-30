"""The translation engine as a small HTTP service on the same machine.

Loads the model once and answers the website over loopback:

    GET  /health     -> {"ok": true, "model": "...", "threads": n}
    POST /translate  {"texts": ["...", ...]}  ->  {"translations": [...], "ms": n}

It only listens on 127.0.0.1: nothing outside the server can reach it, and it
needs no key. Translations run one request at a time behind a lock - the model
already uses the cores it is given, and two requests racing would only slow
both - while /health stays answerable during a long translation.

Configured by environment:

    TRANSLATOR_MODEL_DIR   the ONNX bundle (required)
    TRANSLATOR_PORT        default 8911
    TRANSLATOR_THREADS     ONNX Runtime threads, default 1 (the website
                           shares the machine)
    TRANSLATOR_LOW_MEMORY  "1" (default) trades speed for about half the
                           memory; "0" for a machine with room to spare
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from engine import KannadaTranslator

# Guards against a runaway request; the website sends far smaller batches.
MAX_TEXTS = 200
MAX_TEXT_CHARS = 4000

MODEL_DIR = os.environ.get("TRANSLATOR_MODEL_DIR", "")
PORT = int(os.environ.get("TRANSLATOR_PORT", "8911"))
THREADS = int(os.environ.get("TRANSLATOR_THREADS", "1"))
LOW_MEMORY = os.environ.get("TRANSLATOR_LOW_MEMORY", "1") != "0"

_lock = threading.Lock()
_translator: KannadaTranslator | None = None


class Handler(BaseHTTPRequestHandler):
    server_version = "avk-translator/1"

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - http.server naming
        if self.path == "/health":
            self._send(200, {"ok": _translator is not None, "model": os.path.basename(MODEL_DIR), "threads": THREADS})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/translate":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            texts = payload.get("texts")
            if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
                raise ValueError("texts must be a list of strings")
            if len(texts) > MAX_TEXTS:
                raise ValueError(f"at most {MAX_TEXTS} texts per request")
            if any(len(t) > MAX_TEXT_CHARS for t in texts):
                raise ValueError(f"each text must be under {MAX_TEXT_CHARS} characters")
        except (ValueError, json.JSONDecodeError) as error:
            self._send(400, {"error": str(error)})
            return

        started = time.time()
        try:
            with _lock:
                translations = _translator.translate(texts, batch_size=4 if LOW_MEMORY else 8)  # type: ignore[union-attr]
        except Exception as error:  # the website falls back to English on any failure
            self._send(500, {"error": f"translation failed: {error}"})
            return
        self._send(200, {"translations": translations, "ms": int((time.time() - started) * 1000)})

    def log_message(self, fmt: str, *args) -> None:
        # One line per request to the journal, without the default timestamp noise.
        sys.stderr.write("%s %s\n" % (self.command, fmt % args))


def main() -> None:
    global _translator
    if not MODEL_DIR:
        sys.exit("TRANSLATOR_MODEL_DIR is not set")
    started = time.time()
    _translator = KannadaTranslator(MODEL_DIR, threads=THREADS, low_memory=LOW_MEMORY)
    sys.stderr.write(f"model loaded in {time.time() - started:.1f}s; listening on 127.0.0.1:{PORT}\n")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
