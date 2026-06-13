import tempfile
import unittest
from pathlib import Path
from unittest import mock

import lab_connect


class ConfigTests(unittest.TestCase):
    def test_validate_config(self):
        config = lab_connect.validate_config(
            {
                "profile_name": "lab-mac",
                "jump_host": "192.0.2.10",
                "jump_user": "jump-user",
                "target_host": "198.51.100.25",
                "target_user": "mac-user",
                "local_port": 15901,
            }
        )
        self.assertEqual(config["remote_service_port"], 5900)
        self.assertEqual(config["target_port"], 22)

    def test_rejects_bad_profile_name(self):
        with self.assertRaises(ValueError):
            lab_connect.validate_config(
                {
                    "profile_name": "bad name",
                    "jump_host": "192.0.2.10",
                    "jump_user": "user",
                    "target_host": "10.0.0.2",
                    "target_user": "user",
                }
            )

    def test_ssh_config_contains_proxy_jump(self):
        config = lab_connect.validate_config(
            {
                "profile_name": "lab-mac",
                "jump_host": "192.0.2.10",
                "jump_user": "jump",
                "target_host": "198.51.100.25",
                "target_user": "target",
            }
        )
        text = lab_connect.ssh_config_text(config)
        self.assertIn("Host lab-mac-jump", text)
        self.assertIn("ProxyJump lab-mac-jump", text)

    def test_redacts_passwords(self):
        text = lab_connect.redact(
            "password=hunter2 secret: abc /?token=session-token",
            ["hunter2"],
        )
        self.assertNotIn("hunter2", text)
        self.assertNotIn("abc", text)
        self.assertNotIn("session-token", text)

    def test_install_ssh_config_preserves_existing_content(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            ssh_dir = root / ".ssh"
            ssh_dir.mkdir()
            existing = ssh_dir / "config"
            existing.write_text("Host existing\n    HostName example.org\n", encoding="utf-8")
            config = lab_connect.validate_config(
                {
                    "profile_name": "lab-mac",
                    "jump_host": "192.0.2.10",
                    "jump_user": "jump",
                    "target_host": "198.51.100.25",
                    "target_user": "target",
                }
            )
            with (
                mock.patch.object(lab_connect, "APP_DIR", root / ".lab-connect"),
                mock.patch.object(lab_connect, "LOG_FILE", root / ".lab-connect" / "lab-connect.log"),
                mock.patch.object(lab_connect, "SSH_DIR", ssh_dir),
                mock.patch.object(lab_connect, "SSH_CONFIG", existing),
                mock.patch.object(lab_connect, "MANAGED_SSH_CONFIG", ssh_dir / "lab-connect.conf"),
            ):
                lab_connect.install_ssh_config(config)
            written = existing.read_text(encoding="utf-8")
            self.assertIn("Host existing", written)
            self.assertIn("Include", written)


if __name__ == "__main__":
    unittest.main()
