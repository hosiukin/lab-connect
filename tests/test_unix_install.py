"""End-to-end test of the generated Unix installer in a fake HOME."""

from __future__ import annotations

import base64
import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def write_shim(path: Path, body: str) -> None:
    path.write_text("#!/usr/bin/env bash\n" + body, encoding="utf-8")
    path.chmod(0o755)


class UnixInstallerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="spark-install-test-"))
        self.home = self.tmp / "home"
        (self.home / "Desktop").mkdir(parents=True)
        (self.home / ".ssh").mkdir()
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        self.log = self.home / "shims.log"
        self._make_shims()
        (self.home / ".ssh" / "config").write_text(
            "Host other\n    HostName example.org\n", encoding="utf-8"
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _make_shims(self) -> None:
        shim = self.bin
        write_shim(
            shim / "ssh",
            'echo "ssh $*" >>"$HOME/shims.log"\n'
            'for a in "$@"; do if [ "$a" = "-O" ]; then [ -f "$HOME/.tunnel" ] && exit 0; exit 1; fi; done\n'
            'case " $* " in *" -fNT "*) touch "$HOME/.tunnel" "$HOME/.ssh/spark-dsh-tunnel.sock"; exit 0 ;; esac\n'
            'last="${!#}"\n'
            'if [ "$last" = "true" ]; then alias="${@: -2:1}"; [ -f "$HOME/.deployed.$alias" ] && exit 0; exit 1; fi\n'
            "exit 0\n",
        )
        write_shim(
            shim / "ssh-copy-id",
            'echo "ssh-copy-id $*" >>"$HOME/shims.log"\n'
            'alias="${!#}"; touch "$HOME/.deployed.$alias"; exit 0\n',
        )
        write_shim(
            shim / "curl",
            'echo "curl $*" >>"$HOME/shims.log"\n[ -f "$HOME/.tunnel" ] && { echo \'{"ok":true}\'; exit 0; }\nexit 7\n',
        )
        write_shim(shim / "xdg-open", 'echo "xdg-open $*" >>"$HOME/shims.log"\n')
        write_shim(shim / "gio", 'echo "gio $*" >>"$HOME/shims.log"\n')
        write_shim(shim / "xdg-user-dir", 'echo "$HOME/Desktop"\n')

    def _generate(self, config: dict, target: Path, icons: dict | None = None) -> None:
        script = """
import {withDefaults} from './src/installer/config.mjs';
import {buildUnixInstaller} from './src/installer/unix.mjs';
import {writeFileSync} from 'node:fs';
const cfg = withDefaults(JSON.parse(process.env.SPARK_TEST_CONFIG));
const icons = JSON.parse(process.env.SPARK_TEST_ICONS || '{}');
writeFileSync(process.argv[1], buildUnixInstaller(cfg, icons));
"""
        env = dict(os.environ)
        env["SPARK_TEST_CONFIG"] = json.dumps(config)
        env["SPARK_TEST_ICONS"] = json.dumps(icons or {})
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script, str(target)],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        target.chmod(0o755)

    def _run(self, script: Path) -> subprocess.CompletedProcess:
        env = dict(os.environ)
        env.update(
            HOME=str(self.home),
            PATH=f"{self.bin}:/usr/local/bin:/usr/bin:/bin",
            TMPDIR=str(self.tmp),
        )
        return subprocess.run(
            ["bash", str(script)],
            cwd=self.tmp,
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )

    def _config(self) -> str:
        return (self.home / ".ssh" / "config").read_text(encoding="utf-8")

    def test_jump_install_is_idempotent_and_uninstalls(self) -> None:
        script = self.tmp / "install.sh"
        self._generate({"sparkUser": "alice", "jumpUser": "alice"}, script)
        result = self._run(script)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        config = self._config()
        self.assertEqual(config.count("# >>> spark-dsh installer managed start >>>"), 1)
        self.assertIn("Host other", config)
        self.assertIn("Host spark-jump", config)
        self.assertIn("ProxyJump spark-jump", config)
        self.assertIn("IdentityFile ~/.ssh/id_ed25519_spark", config)
        self.assertIn("Host spark\n    HostName 10.33.250.29", config)

        key = self.home / ".ssh" / "id_ed25519_spark"
        self.assertTrue(key.exists())
        self.assertEqual(stat.S_IMODE(key.stat().st_mode), 0o600)
        self.assertTrue(Path(str(key) + ".pub").exists())

        launcher = self.home / ".spark-dsh" / "launch.sh"
        self.assertEqual(stat.S_IMODE(launcher.stat().st_mode), 0o755)
        launcher_text = launcher.read_text(encoding="utf-8")
        self.assertIn("http://127.0.0.1:18090/", launcher_text)
        self.assertIn("-L \"127.0.0.1:$LOCAL_PORT:127.0.0.1:$REMOTE_PORT\"", launcher_text)

        desktop = self.home / "Desktop" / "spark-dsh.desktop"
        self.assertTrue(desktop.exists())
        self.assertEqual(stat.S_IMODE(desktop.stat().st_mode), 0o755)
        desktop_text = desktop.read_text(encoding="utf-8")
        self.assertIn(f'Exec="{launcher}"', desktop_text)
        self.assertIn("Name=Spark DSH", desktop_text)
        self.assertTrue((self.home / ".local/share/applications/spark-dsh.desktop").exists())
        self.assertTrue((self.home / ".local/bin/spark-dsh").is_symlink())

        log = self.log.read_text(encoding="utf-8")
        self.assertIn("ssh-copy-id", log)
        self.assertIn("spark-jump", log)
        self.assertIn(" -fNT ", log)
        self.assertIn("127.0.0.1:18090:127.0.0.1:8090", log)
        self.assertIn("gio set", log)
        self.assertIn("xdg-open http://127.0.0.1:18090/", log)

        # No literal "$HOME" directory should be created anywhere.
        self.assertFalse((self.tmp / "$HOME").exists())

        before = config
        result = self._run(script)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self._config(), before)

        uninstall = self.home / ".spark-dsh" / "uninstall.sh"
        env = dict(os.environ)
        env.update(HOME=str(self.home), PATH=f"{self.bin}:/usr/bin:/bin")
        result = subprocess.run(
            ["bash", str(uninstall)], env=env, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        config = self._config()
        self.assertNotIn("spark-dsh installer managed", config)
        self.assertIn("Host other", config)
        self.assertFalse(desktop.exists())
        self.assertFalse((self.home / ".local/share/applications/spark-dsh.desktop").exists())
        self.assertFalse((self.home / ".local/bin/spark-dsh").exists())
        self.assertTrue(key.exists())
        uninstall_log = self.log.read_text(encoding="utf-8")
        self.assertIn("-O exit spark", uninstall_log)
        self.assertFalse((self.home / ".spark-dsh").exists())


    def _make_key(self, key: Path, passphrase: str = "") -> None:
        subprocess.run(
            ["ssh-keygen", "-q", "-t", "ed25519", "-N", passphrase, "-C", "test", "-f", str(key)],
            check=True,
            capture_output=True,
        )

    def test_valid_key_with_open_permissions_is_reused(self) -> None:
        key = self.home / ".ssh" / "id_ed25519_spark"
        self._make_key(key)
        key.chmod(0o644)
        script = self.tmp / "install.sh"
        self._generate({"sparkUser": "alice", "jumpUser": "alice"}, script)
        result = self._run(script)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("复用已有密钥", result.stdout)
        self.assertEqual(stat.S_IMODE(key.stat().st_mode), 0o600)
        self.assertFalse(list(key.parent.glob("id_ed25519_spark.bak.*")))

    def test_stale_public_key_is_rebuilt_from_private_key(self) -> None:
        key = self.home / ".ssh" / "id_ed25519_spark"
        self._make_key(key)
        pub = Path(str(key) + ".pub")
        pub.write_text("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKey test\n", encoding="utf-8")
        script = self.tmp / "install.sh"
        self._generate({"sparkUser": "alice", "jumpUser": "alice"}, script)
        result = self._run(script)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        expected = subprocess.check_output(
            ["ssh-keygen", "-y", "-P", "", "-f", str(key)], text=True
        ).strip()
        self.assertEqual(pub.read_text(encoding="utf-8").strip(), expected)
        self.assertIn("已校准公钥文件", result.stdout)
        self.assertTrue(list(key.parent.glob("id_ed25519_spark.pub.bak.*")))

    def test_encrypted_custom_key_is_not_overwritten(self) -> None:
        key = self.tmp / "custom_spark_key"
        self._make_key(key, "secret")
        before = key.read_bytes()
        script = self.tmp / "install.sh"
        self._generate(
            {"sparkUser": "alice", "jumpUser": "alice", "keyFile": str(key)}, script
        )
        result = self._run(script)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("无法无口令读取", result.stdout + result.stderr)
        self.assertEqual(key.read_bytes(), before)

    def test_encrypted_default_key_is_backed_up_and_regenerated(self) -> None:
        key = self.home / ".ssh" / "id_ed25519_spark"
        self._make_key(key, "secret")
        script = self.tmp / "install.sh"
        self._generate({"sparkUser": "alice", "jumpUser": "alice"}, script)
        result = self._run(script)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("已备份为", result.stdout)
        self.assertTrue(list(key.parent.glob("id_ed25519_spark.bak.*")))
        check = subprocess.run(
            ["ssh-keygen", "-y", "-P", "", "-f", str(key)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(check.returncode, 0, check.stderr)

    def test_broken_default_key_is_backed_up_and_regenerated(self) -> None:
        key = self.home / ".ssh" / "id_ed25519_spark"
        key.write_text("this is not a private key\n", encoding="utf-8")
        Path(str(key) + ".pub").write_text("stale public key\n", encoding="utf-8")
        script = self.tmp / "install.sh"
        self._generate({"sparkUser": "alice", "jumpUser": "alice"}, script)
        result = self._run(script)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("已备份为", result.stdout)
        self.assertTrue(list(key.parent.glob("id_ed25519_spark.bak.*")))
        check = subprocess.run(
            ["ssh-keygen", "-y", "-P", "", "-f", str(key)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(check.returncode, 0, check.stderr)
        self.assertEqual(
            Path(str(key) + ".pub").read_text(encoding="utf-8").strip(),
            check.stdout.strip(),
        )

    def test_embedded_icon_is_decoded(self) -> None:
        png = (ROOT / "assets" / "spark-dsh-256.png").read_bytes()
        script = self.tmp / "install.sh"
        self._generate(
            {"sparkUser": "alice", "jumpUser": "alice"},
            script,
            {"png": base64.b64encode(png).decode("ascii")},
        )
        result = self._run(script)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        installed = self.home / ".spark-dsh" / "spark-dsh.png"
        self.assertEqual(installed.read_bytes(), png)
        self.assertEqual(
            (self.home / ".local/share/icons/hicolor/256x256/apps/spark-dsh.png").read_bytes(),
            png,
        )

    def test_macos_branch_creates_app_bundle(self) -> None:
        write_shim(self.bin / "uname", "echo Darwin\n")
        write_shim(self.bin / "open", 'echo "open $*" >>"$HOME/shims.log"\n')
        write_shim(self.bin / "osascript", "exit 0\n")
        script = self.tmp / "install.sh"
        self._generate({"sparkUser": "carol", "jumpUser": "carol"}, script)
        result = self._run(script)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        app = self.home / "Applications" / "Spark DSH.app"
        launch = app / "Contents" / "MacOS" / "launch"
        self.assertTrue(launch.exists())
        self.assertEqual(stat.S_IMODE(launch.stat().st_mode), 0o755)
        plist = (app / "Contents" / "Info.plist").read_text(encoding="utf-8")
        self.assertIn("<string>lab.spark.dsh.launcher</string>", plist)
        self.assertIn("<string>launch</string>", plist)
        self.assertIn("<key>LSUIElement</key><true/>", plist)
        self.assertTrue((self.home / "Desktop" / "Spark DSH.app").is_symlink())
        log = self.log.read_text(encoding="utf-8")
        self.assertIn("open http://127.0.0.1:18090/", log)
        self.assertNotIn("xdg-open", log)

        uninstall = self.home / ".spark-dsh" / "uninstall.sh"
        env = dict(os.environ)
        env.update(HOME=str(self.home), PATH=f"{self.bin}:/usr/bin:/bin")
        result = subprocess.run(["bash", str(uninstall)], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(app.exists())
        self.assertFalse((self.home / "Desktop" / "Spark DSH.app").exists())

    def test_direct_mode_skips_jump(self) -> None:
        script = self.tmp / "install.sh"
        self._generate(
            {"sparkUser": "bob", "mode": "direct", "localPort": 18111},
            script,
        )
        result = self._run(script)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        config = self._config()
        self.assertNotIn("spark-jump", config)
        self.assertNotIn("ProxyJump", config)
        self.assertIn("User bob", config)
        launcher = (self.home / ".spark-dsh" / "launch.sh").read_text(encoding="utf-8")
        self.assertIn("LOCAL_PORT='18111'", launcher)
        self.assertIn("http://127.0.0.1:18111/", launcher)
        log = self.log.read_text(encoding="utf-8")
        self.assertIn("127.0.0.1:18111:127.0.0.1:8090", log)
        self.assertNotIn("spark-jump", log)


if __name__ == "__main__":
    unittest.main(verbosity=2)
