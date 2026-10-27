"""Static and reproducibility checks for the single-file installer."""

from __future__ import annotations

import re
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "install.html"
TIME_RE = re.compile(r"20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00")


class InstallHtmlTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = HTML.read_text(encoding="utf-8")

    def test_single_file_and_no_external_assets(self) -> None:
        self.assertGreater(len(self.text), 100_000)
        self.assertLess(len(self.text), 500_000)
        self.assertIn('<html lang="zh-CN">', self.text)
        self.assertIn("<title>Spark DSH 安装器", self.text)
        self.assertIn("spark-install.exe", self.text)
        self.assertIn("spark-install.desktop", self.text)
        self.assertNotRegex(self.text, r"<script[^>]+src=")
        self.assertNotRegex(self.text, r"<link[^>]+rel=\"stylesheet\"")
        self.assertNotIn("https://", self.text)
        self.assertNotRegex(self.text, r"(?:src|href)=\"https?://")
        # The only absolute http URLs left are loopback defaults and the Apple plist DTD.
        external = [
            m.group(0)
            for m in re.finditer(r"http://[^\s\"'<>]+", self.text)
            if not m.group(0).startswith("http://127.0.0.1")
            and m.group(0) != "http://www.apple.com/DTDs/PropertyList-1.0.dtd"
        ]
        self.assertEqual(external, [])
        self.assertNotIn("__CSS__", self.text)
        self.assertNotIn("__JS__", self.text)
        self.assertNotIn("__BUILD_TIME__", self.text)
        self.assertNotIn("@@", self.text)

    def test_dom_ids_used_by_ui_exist(self) -> None:
        ids = set(re.findall(r'id="([^"]+)"', self.text))
        used = set(re.findall(r'\$\("#([A-Za-z0-9_-]+)"\)', self.text))
        self.assertEqual(used - ids, set())
        for required in [
            "installer-form",
            "os-tabs",
            "jump-fields",
            "chain-field",
            "summary",
            "btn-zip",
            "errors",
            "toast",
        ]:
            self.assertIn(required, ids)

    def test_javascript_syntax(self) -> None:
        match = re.search(r'<script type="module">(.*?)</script>', self.text, re.S)
        self.assertIsNotNone(match)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bundle.mjs"
            path.write_text(match.group(1), encoding="utf-8")
            result = subprocess.run(
                ["node", "--check", str(path)], capture_output=True, text=True
            )
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_built_file_matches_sources(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "install.html"
            result = subprocess.run(
                ["python3", str(ROOT / "build_installer.py"), "--out", str(out)],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            fresh = TIME_RE.sub("__TIME__", out.read_text(encoding="utf-8"))
            committed = TIME_RE.sub("__TIME__", self.text)
            if fresh != committed:
                index = next((i for i, (a, b) in enumerate(zip(fresh, committed)) if a != b), min(len(fresh), len(committed)))
                self.fail(
                    "install.html is stale; run build_installer.py. "
                    f"First difference at byte {index}: fresh={fresh[index:index+80]!r} "
                    f"committed={committed[index:index+80]!r}"
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)
