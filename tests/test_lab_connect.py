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
        self.assertEqual(config["target_port"], 22)
        self.assertEqual(config["forwards"][0]["remote_port"], 5900)

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

    def test_ssh_only_profile_has_no_forwards(self):
        config = lab_connect.validate_config(
            {
                "profile_name": "spark",
                "jump_host": "192.0.2.10",
                "jump_user": "jump",
                "target_host": "198.51.100.25",
                "target_user": "target",
                "service": "ssh-only",
                "remote_service_port": 22,
            }
        )
        self.assertEqual(config["forwards"], [])

    def test_multiple_forwards_generate_target_ssh_command(self):
        config = lab_connect.validate_config(
            {
                "profile_name": "spark",
                "jump_host": "192.0.2.10",
                "jump_user": "jump",
                "target_host": "198.51.100.25",
                "target_user": "target",
                "forwards": [
                    {
                        "name": "Web",
                        "local_port": 18080,
                        "remote_host": "127.0.0.1",
                        "remote_port": 8080,
                        "open_mode": "browser",
                    },
                    {
                        "name": "Jupyter",
                        "local_port": 18888,
                        "remote_host": "127.0.0.1",
                        "remote_port": 8888,
                        "open_mode": "browser",
                    },
                ],
            }
        )
        with mock.patch.object(lab_connect, "executable", return_value="ssh"):
            command = lab_connect.tunnel_command(config)
        self.assertIn("127.0.0.1:18080:127.0.0.1:8080", command)
        self.assertIn("127.0.0.1:18888:127.0.0.1:8888", command)
        self.assertEqual(command[-1], "spark")

    def test_duplicate_local_ports_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "used by more than one"):
            lab_connect.validate_config(
                {
                    "profile_name": "spark",
                    "jump_host": "192.0.2.10",
                    "jump_user": "jump",
                    "target_host": "198.51.100.25",
                    "target_user": "target",
                    "forwards": [
                        {
                            "name": "One",
                            "local_port": 18080,
                            "remote_port": 8080,
                        },
                        {
                            "name": "Two",
                            "local_port": 18080,
                            "remote_port": 8888,
                        },
                    ],
                }
            )

    def test_load_config_migrates_legacy_service(self):
        with tempfile.TemporaryDirectory() as folder:
            config_file = Path(folder) / "config.json"
            config_file.write_text(
                """
                {
                  "profile_name": "legacy",
                  "service": "custom",
                  "local_port": 18080,
                  "remote_service_port": 8080
                }
                """,
                encoding="utf-8",
            )
            with mock.patch.object(lab_connect, "CONFIG_FILE", config_file):
                config = lab_connect.load_config()
        self.assertEqual(config["forwards"][0]["local_port"], 18080)
        self.assertEqual(config["forwards"][0]["remote_port"], 8080)

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
