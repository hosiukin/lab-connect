#!/usr/bin/env python3
"""Build the self-contained install.html from src/installer/*.

The page must work from file:// with no network access, so CSS, JS and icons
are all inlined.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src" / "installer"
ASSETS = ROOT / "assets"
OUT = ROOT / "install.html"

MODULES = [
    "zip.mjs",
    "config.mjs",
    "unix.mjs",
    "windows.mjs",
    "bundle.mjs",
    "ui.mjs",
]

IMPORT_RE = re.compile(r"^import\s+[^;]+;\n", re.M)
EXPORT_RE = re.compile(r"^export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)", re.M)
EXPORT_LIST_RE = re.compile(r"^export\s*\{[^}]*\};\s*$", re.M)


def strip_module(source: str) -> str:
    source = IMPORT_RE.sub("", source)
    source = EXPORT_RE.sub("", source)
    source = EXPORT_LIST_RE.sub("", source)
    return source


def read_asset(name: str) -> str:
    return base64.b64encode((ASSETS / name).read_bytes()).decode("ascii")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUT, help="output path (default: install.html)")
    args = parser.parse_args()
    out = args.out
    page = (SRC / "page.html").read_text(encoding="utf-8")
    css = (SRC / "installer.css").read_text(encoding="utf-8")

    parts = []
    for name in MODULES:
        code = strip_module((SRC / name).read_text(encoding="utf-8")).strip()
        if not code:
            raise SystemExit(f"empty module: {name}")
        parts.append(f"// ---- {name} ----\n{code}")
    js = "\n\n".join(parts)

    icons = {
        "png": read_asset("spark-dsh-256.png"),
        "ico": read_asset("spark-dsh.ico"),
    }
    build_time = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    js = f"globalThis.SPARK_ICONS = {json.dumps(icons)};\n\n{js}"
    js = js.replace("__BUILD_TIME__", build_time)

    if "__CSS__" not in page or "__JS__" not in page:
        raise SystemExit("page.html is missing injection markers")

    html = page.replace("/*__CSS__*/", css).replace("/*__JS__*/", js)
    if "/*__CSS__*/" in html or "/*__JS__*/" in html:
        raise SystemExit("failed to inject assets")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    try:
        label = out.relative_to(ROOT)
    except ValueError:
        label = out
    print(f"wrote {label}  {out.stat().st_size / 1024:.1f} KiB")


if __name__ == "__main__":
    main()
