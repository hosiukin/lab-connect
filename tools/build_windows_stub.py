#!/usr/bin/env python3
"""Rebuild assets/spark-install-stub.exe with NSIS.

The web build concatenates the configured PowerShell installer to this stub.
NSIS is only needed when the stub itself changes; the generated asset is
committed so normal page builds do not require a Windows toolchain.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NSI = ROOT / "tools" / "spark-install-stub.nsi"
OUT = ROOT / "assets" / "spark-install-stub.exe"


def main() -> None:
    makensis = shutil.which("makensis")
    if not makensis:
        raise SystemExit("makensis not found; install NSIS (e.g. apt install nsis)")
    env = os.environ.copy()
    if not env.get("NSISDIR") and not Path("/usr/share/nsis/Stubs").is_dir():
        print("hint: set NSISDIR to the directory containing Stubs/ and Include/")
    subprocess.run(
        [makensis, "-V2", f"-DOUTFILE={OUT}", str(NSI)],
        cwd=ROOT,
        env=env,
        check=True,
    )
    data = OUT.read_bytes()
    if data[:2] != b"MZ":
        raise SystemExit("makensis did not produce a Windows executable")
    print(f"wrote {OUT.relative_to(ROOT)}  {len(data) / 1024:.1f} KiB")


if __name__ == "__main__":
    main()
