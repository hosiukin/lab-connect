"""Checks for the optional Windows -> iPad LAN gateway helper."""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "tools" / "spark-ipad-gateway.ps1"


class IpadGatewayTest(unittest.TestCase):
    def test_script_is_utf8_with_bom(self) -> None:
        raw = SCRIPT.read_bytes()
        self.assertTrue(raw.startswith(b"\xef\xbb\xbf"), "PowerShell 5.1 needs a UTF-8 BOM")
        text = raw.decode("utf-8-sig")
        self.assertIn("netsh interface portproxy add v4tov4", text)
        self.assertIn("New-NetFirewallRule", text)
        self.assertIn("-RemoteAddress LocalSubnet", text)
        self.assertIn("-Verb RunAs", text)
        self.assertIn("Get-LanAddresses", text)
        self.assertIn("-Remove", text)

    def test_powershell_parser_accepts_script(self) -> None:
        pwsh = shutil.which("pwsh")
        if not pwsh:
            self.skipTest("pwsh is not installed")
        command = (
            "$errors = $null; "
            f"[System.Management.Automation.Language.Parser]::ParseFile('{SCRIPT.as_posix()}', "
            "[ref]$null, [ref]$errors) > $null; "
            "if ($errors) { $errors | ForEach-Object { $_.Message }; exit 1 }"
        )
        check = subprocess.run(
            [pwsh, "-NoLogo", "-NoProfile", "-Command", command],
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(check.returncode, 0, check.stderr or check.stdout)


if __name__ == "__main__":
    unittest.main()
