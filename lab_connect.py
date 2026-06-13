#!/usr/bin/env python3
"""Local web UI for configuring SSH jump-host connections and tunnels."""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


APP_NAME = "Lab Connect"
APP_DIR = Path.home() / ".lab-connect"
CONFIG_FILE = APP_DIR / "config.json"
LOG_FILE = APP_DIR / "lab-connect.log"
SSH_DIR = Path.home() / ".ssh"
SSH_CONFIG = SSH_DIR / "config"
MANAGED_SSH_CONFIG = SSH_DIR / "lab-connect.conf"
IS_WINDOWS = os.name == "nt"
DEFAULT_IDENTITY = SSH_DIR / "id_ed25519_lab"
ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"


def now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def redact(text: str, secrets_to_hide: list[str] | None = None) -> str:
    value = text
    for secret in secrets_to_hide or []:
        if secret:
            value = value.replace(secret, "[REDACTED]")
    value = re.sub(
        r"(?i)(password|passphrase|secret)(\s*[=:]\s*)\S+",
        r"\1\2[REDACTED]",
        value,
    )
    value = re.sub(r"(?i)([?&]token=)[A-Za-z0-9_-]+", r"\1[REDACTED]", value)
    return value


def log(message: str, secrets_to_hide: list[str] | None = None) -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    clean = redact(message, secrets_to_hide)
    with LOG_FILE.open("a", encoding="utf-8") as handle:
        handle.write(f"{now()} {clean.rstrip()}\n")


def default_config() -> dict:
    return {
        "profile_name": "lab-computer",
        "jump_host": "",
        "jump_port": 22,
        "jump_user": "",
        "target_host": "",
        "target_port": 22,
        "target_user": "",
        "forwards": [
            {
                "name": "Screen Sharing",
                "local_port": 15901,
                "remote_host": "127.0.0.1",
                "remote_port": 5900,
                "open_mode": "vnc",
            }
        ],
        "identity_file": str(DEFAULT_IDENTITY),
    }


def load_config() -> dict:
    config = default_config()
    if CONFIG_FILE.exists():
        try:
            stored = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            if isinstance(stored, dict):
                config.update(stored)
                if "forwards" not in stored:
                    service = stored.get("service", "screen-sharing")
                    if service == "ssh-only":
                        config["forwards"] = []
                    else:
                        config["forwards"] = [
                            {
                                "name": "Screen Sharing" if service == "screen-sharing" else "Custom service",
                                "local_port": int(stored.get("local_port", 15901)),
                                "remote_host": "127.0.0.1",
                                "remote_port": int(stored.get("remote_service_port", 5900)),
                                "open_mode": "vnc" if service == "screen-sharing" else "browser",
                            }
                        ]
        except (OSError, json.JSONDecodeError) as exc:
            log(f"Failed to read config: {exc}")
    return config


def validate_config(raw: dict) -> dict:
    config = default_config()
    allowed_text = (
        "profile_name",
        "jump_host",
        "jump_user",
        "target_host",
        "target_user",
        "identity_file",
    )
    for key in allowed_text:
        if key in raw:
            config[key] = str(raw[key]).strip()
    for key in ("jump_port", "target_port"):
        if key in raw:
            config[key] = int(raw[key])
        if not 1 <= config[key] <= 65535:
            raise ValueError(f"{key} must be between 1 and 65535")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", config["profile_name"]):
        raise ValueError("Profile name may only contain letters, numbers, ., _, and -")
    for key in ("jump_host", "jump_user", "target_host", "target_user"):
        if not config[key] or any(char.isspace() for char in config[key]):
            raise ValueError(f"{key} is required and cannot contain spaces")
    identity = Path(os.path.expandvars(os.path.expanduser(config["identity_file"])))
    config["identity_file"] = str(identity)
    raw_forwards = raw.get("forwards")
    if raw_forwards is None:
        service = str(raw.get("service", "screen-sharing"))
        if service == "ssh-only":
            raw_forwards = []
        else:
            raw_forwards = [
                {
                    "name": "Screen Sharing" if service == "screen-sharing" else "Custom service",
                    "local_port": raw.get("local_port", 15901),
                    "remote_host": "127.0.0.1",
                    "remote_port": raw.get("remote_service_port", 5900),
                    "open_mode": "vnc" if service == "screen-sharing" else "browser",
                }
            ]
    if not isinstance(raw_forwards, list):
        raise ValueError("forwards must be a list")
    forwards = []
    local_ports: set[int] = set()
    for index, item in enumerate(raw_forwards):
        if not isinstance(item, dict):
            raise ValueError(f"Forward #{index + 1} must be an object")
        name = str(item.get("name", "")).strip() or f"Forward {index + 1}"
        local_port = int(item.get("local_port", 0))
        remote_port = int(item.get("remote_port", 0))
        remote_host = str(item.get("remote_host", "127.0.0.1")).strip()
        open_mode = str(item.get("open_mode", "browser")).strip()
        if not 1 <= local_port <= 65535 or not 1 <= remote_port <= 65535:
            raise ValueError(f"Forward '{name}' ports must be between 1 and 65535")
        if local_port in local_ports:
            raise ValueError(f"Local port {local_port} is used by more than one forward")
        if not remote_host or any(char.isspace() for char in remote_host):
            raise ValueError(f"Forward '{name}' has an invalid remote host")
        if open_mode not in {"browser", "vnc", "rdp", "none"}:
            raise ValueError(f"Forward '{name}' has an invalid open mode")
        local_ports.add(local_port)
        forwards.append(
            {
                "name": name,
                "local_port": local_port,
                "remote_host": remote_host,
                "remote_port": remote_port,
                "open_mode": open_mode,
            }
        )
    config["forwards"] = forwards
    return config


def save_config(config: dict) -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(
        json.dumps(config, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if not IS_WINDOWS:
        CONFIG_FILE.chmod(0o600)
    log(f"Saved profile {config['profile_name']}")


def executable(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise RuntimeError(f"Required command not found: {name}")
    return path


def run(
    args: list[str],
    *,
    timeout: int = 30,
    env: dict | None = None,
    secrets_to_hide: list[str] | None = None,
) -> dict:
    printable = " ".join(args)
    log(f"RUN {printable}", secrets_to_hide)
    started = time.monotonic()
    try:
        completed = subprocess.run(
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=timeout,
            env=env,
            creationflags=subprocess.CREATE_NO_WINDOW if IS_WINDOWS else 0,
        )
        output = redact(completed.stdout or "", secrets_to_hide)
        result = {
            "ok": completed.returncode == 0,
            "code": completed.returncode,
            "output": output.strip(),
            "duration_ms": round((time.monotonic() - started) * 1000),
        }
    except subprocess.TimeoutExpired as exc:
        output = redact((exc.stdout or "") + (exc.stderr or ""), secrets_to_hide)
        result = {
            "ok": False,
            "code": 124,
            "output": f"Timed out after {timeout}s\n{output}".strip(),
            "duration_ms": round((time.monotonic() - started) * 1000),
        }
    log(
        f"RESULT code={result['code']} duration_ms={result['duration_ms']}\n"
        f"{result['output']}",
        secrets_to_hide,
    )
    return result


def tcp_check(host: str, port: int, timeout: float = 5.0) -> dict:
    started = time.monotonic()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return {
                "ok": True,
                "output": f"Connected to {host}:{port}",
                "duration_ms": round((time.monotonic() - started) * 1000),
            }
    except OSError as exc:
        return {
            "ok": False,
            "output": f"Cannot connect to {host}:{port}: {exc}",
            "duration_ms": round((time.monotonic() - started) * 1000),
        }


def ssh_aliases(config: dict) -> tuple[str, str]:
    profile = config["profile_name"]
    return f"{profile}-jump", profile


def ssh_config_text(config: dict) -> str:
    jump_alias, target_alias = ssh_aliases(config)
    identity = config["identity_file"].replace("\\", "/")
    use_keychain = "    UseKeychain yes\n" if platform.system() == "Darwin" else ""
    return f"""# Managed by Lab Connect. Edit through the Lab Connect UI.
Host {jump_alias}
    HostName {config["jump_host"]}
    User {config["jump_user"]}
    Port {config["jump_port"]}
    IdentityFile "{identity}"
    IdentitiesOnly yes
    AddKeysToAgent yes
{use_keychain}    ConnectTimeout 20
    ServerAliveInterval 60
    ServerAliveCountMax 3

Host {target_alias}
    HostName {config["target_host"]}
    User {config["target_user"]}
    Port {config["target_port"]}
    ProxyJump {jump_alias}
    IdentityFile "{identity}"
    IdentitiesOnly yes
    AddKeysToAgent yes
{use_keychain}    ConnectTimeout 20
    ServerAliveInterval 60
    ServerAliveCountMax 3
"""


def backup(path: Path) -> Path | None:
    if not path.exists():
        return None
    destination = path.with_name(f"{path.name}.backup-{datetime.now():%Y%m%d-%H%M%S}")
    shutil.copy2(path, destination)
    return destination


def install_ssh_config(config: dict) -> dict:
    SSH_DIR.mkdir(parents=True, exist_ok=True)
    if not IS_WINDOWS:
        SSH_DIR.chmod(0o700)
    backups = []
    managed_backup = backup(MANAGED_SSH_CONFIG)
    if managed_backup:
        backups.append(str(managed_backup))
    MANAGED_SSH_CONFIG.write_text(ssh_config_text(config), encoding="utf-8")
    include_line = f'Include "{MANAGED_SSH_CONFIG}"'
    existing = SSH_CONFIG.read_text(encoding="utf-8") if SSH_CONFIG.exists() else ""
    if include_line not in existing:
        config_backup = backup(SSH_CONFIG)
        if config_backup:
            backups.append(str(config_backup))
        SSH_CONFIG.write_text(include_line + "\n\n" + existing, encoding="utf-8")
    if not IS_WINDOWS:
        MANAGED_SSH_CONFIG.chmod(0o600)
        SSH_CONFIG.chmod(0o600)
    log(f"Installed SSH config; backups={backups}")
    return {"ok": True, "output": "SSH config installed.", "backups": backups}


def ensure_key(config: dict) -> dict:
    identity = Path(config["identity_file"])
    public_key = Path(str(identity) + ".pub")
    if identity.exists() and public_key.exists():
        return {"ok": True, "output": f"Using existing key: {identity}"}
    identity.parent.mkdir(parents=True, exist_ok=True)
    result = run(
        [
            executable("ssh-keygen"),
            "-t",
            "ed25519",
            "-f",
            str(identity),
            "-N",
            "",
            "-C",
            "lab-connect",
        ]
    )
    if result["ok"] and not IS_WINDOWS:
        identity.chmod(0o600)
        public_key.chmod(0o644)
    return result


def askpass_environment(password: str) -> tuple[dict, tempfile.TemporaryDirectory]:
    temp_dir = tempfile.TemporaryDirectory(prefix="lab-connect-askpass-")
    folder = Path(temp_dir.name)
    env = os.environ.copy()
    env["LAB_CONNECT_PASSWORD"] = password
    env["SSH_ASKPASS_REQUIRE"] = "force"
    env["DISPLAY"] = env.get("DISPLAY", "lab-connect")
    if IS_WINDOWS:
        helper = folder / "askpass.cmd"
        helper.write_text("@echo off\r\necho %LAB_CONNECT_PASSWORD%\r\n", encoding="utf-8")
    else:
        helper = folder / "askpass.sh"
        helper.write_text('#!/bin/sh\nprintf "%s\\n" "$LAB_CONNECT_PASSWORD"\n', encoding="utf-8")
        helper.chmod(0o700)
    env["SSH_ASKPASS"] = str(helper)
    return env, temp_dir


def deploy_key(config: dict, destination: str, password: str) -> dict:
    if not password:
        raise ValueError("Password is required for first-time key installation")
    key_result = ensure_key(config)
    if not key_result["ok"]:
        return key_result
    install_ssh_config(config)
    jump_alias, target_alias = ssh_aliases(config)
    alias = jump_alias if destination == "jump" else target_alias
    public_key = Path(config["identity_file"] + ".pub").read_text(encoding="utf-8").strip()
    remote = (
        "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; "
        f"grep -qxF {shell_quote(public_key)} ~/.ssh/authorized_keys || "
        f"printf '%s\\n' {shell_quote(public_key)} >> ~/.ssh/authorized_keys"
    )
    env, temp_dir = askpass_environment(password)
    try:
        return run(
            [
                executable("ssh"),
                "-o",
                "PreferredAuthentications=password,keyboard-interactive",
                "-o",
                "PubkeyAuthentication=no",
                "-o",
                "NumberOfPasswordPrompts=1",
                "-o",
                "StrictHostKeyChecking=accept-new",
                alias,
                remote,
            ],
            timeout=40,
            env=env,
            secrets_to_hide=[password],
        )
    finally:
        temp_dir.cleanup()


def shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\"'\"'") + "'"


def control_path(config: dict) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", config["profile_name"])
    suffix = ".ctl" if not IS_WINDOWS else ".pid"
    return APP_DIR / f"{safe}-tunnels{suffix}"


def legacy_control_path(config: dict) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", config["profile_name"])
    suffix = ".ctl" if not IS_WINDOWS else ".pid"
    return APP_DIR / f"{safe}-screen{suffix}"


def active_control_path(config: dict) -> tuple[Path, bool]:
    current = control_path(config)
    legacy = legacy_control_path(config)
    if not current.exists() and legacy.exists():
        return legacy, True
    return current, False


def tunnel_command(config: dict) -> list[str]:
    _, target_alias = ssh_aliases(config)
    command = [
        executable("ssh"),
        "-NT",
        "-o",
        "BatchMode=yes",
        "-o",
        "ExitOnForwardFailure=yes",
        "-o",
        "ServerAliveInterval=60",
        "-o",
        "ServerAliveCountMax=3",
    ]
    for forward in config["forwards"]:
        command.extend(
            [
                "-L",
                f"127.0.0.1:{forward['local_port']}:{forward['remote_host']}:{forward['remote_port']}",
            ]
        )
    command.append(target_alias)
    return command


def tunnel_status(config: dict) -> dict:
    marker, legacy = active_control_path(config)
    endpoints = [
        {
            **forward,
            "endpoint": f"127.0.0.1:{forward['local_port']}",
        }
        for forward in config["forwards"]
    ]
    if IS_WINDOWS:
        if not marker.exists():
            return {
                "ok": False,
                "running": False,
                "legacy": False,
                "output": "Tunnel is stopped.",
                "endpoints": endpoints,
            }
        pid = None
        try:
            pid = int(marker.read_text(encoding="ascii").strip())
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                capture_output=True,
                text=True,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            running = str(pid) in result.stdout and "No tasks" not in result.stdout
        except (OSError, ValueError):
            running = False
        if not running:
            marker.unlink(missing_ok=True)
        return {
            "ok": running,
            "running": running,
            "legacy": legacy and running,
            "output": f"Tunnel {'is running' if running else 'is stopped'}"
            + (f" (PID {pid})." if running else "."),
            "endpoints": endpoints,
        }
    jump_alias, target_alias = ssh_aliases(config)
    control_alias = jump_alias if legacy else target_alias
    result = run(
        [executable("ssh"), "-S", str(marker), "-O", "check", control_alias],
        timeout=5,
    )
    return {
        "ok": result["ok"],
        "running": result["ok"],
        "legacy": legacy and result["ok"],
        "output": result["output"] or ("Tunnel is running." if result["ok"] else "Tunnel is stopped."),
        "endpoints": endpoints,
    }


def start_tunnel(config: dict) -> dict:
    if not config["forwards"]:
        _, target_alias = ssh_aliases(config)
        return {
            "ok": False,
            "running": False,
            "output": f"No port forwards are configured. SSH is ready: ssh {target_alias}",
            "endpoints": [],
        }
    install_ssh_config(config)
    current = tunnel_status(config)
    if current["running"]:
        stopped = stop_tunnel(config)
        if not stopped["ok"]:
            return {
                **stopped,
                "running": True,
                "output": "The existing tunnel could not be restarted.\n" + stopped.get("output", ""),
            }
    for forward in config["forwards"]:
        local_check = tcp_check("127.0.0.1", forward["local_port"], timeout=0.4)
        if local_check["ok"]:
            return {
                "ok": False,
                "running": False,
                "output": f"Local port {forward['local_port']} for '{forward['name']}' is already in use.",
                "endpoints": [],
            }
    marker = control_path(config)
    marker.unlink(missing_ok=True)
    args = tunnel_command(config)
    if IS_WINDOWS:
        creationflags = (
            subprocess.CREATE_NEW_PROCESS_GROUP
            | subprocess.DETACHED_PROCESS
            | subprocess.CREATE_NO_WINDOW
        )
        process = subprocess.Popen(
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
        )
        marker.write_text(str(process.pid), encoding="ascii")
    else:
        _, target_alias = ssh_aliases(config)
        args = [
            executable("ssh"),
            "-fNT",
            "-M",
            "-S",
            str(marker),
            "-o",
            "BatchMode=yes",
            "-o",
            "ExitOnForwardFailure=yes",
            "-o",
            "ServerAliveInterval=60",
            "-o",
            "ServerAliveCountMax=3",
        ]
        for forward in config["forwards"]:
            args.extend(
                [
                    "-L",
                    f"127.0.0.1:{forward['local_port']}:{forward['remote_host']}:{forward['remote_port']}",
                ]
            )
        args.append(target_alias)
        result = run(args, timeout=25)
        if not result["ok"]:
            return {**result, "running": False}
    time.sleep(0.8)
    return tunnel_status(config)


def stop_tunnel(config: dict) -> dict:
    marker, legacy = active_control_path(config)
    if IS_WINDOWS:
        status = tunnel_status(config)
        if not status["running"]:
            return status
        pid = marker.read_text(encoding="ascii").strip()
        result = run(["taskkill", "/PID", pid, "/T", "/F"], timeout=10)
        marker.unlink(missing_ok=True)
        return {**result, "running": False}
    jump_alias, target_alias = ssh_aliases(config)
    control_alias = jump_alias if legacy else target_alias
    result = run(
        [executable("ssh"), "-S", str(marker), "-O", "exit", control_alias],
        timeout=10,
    )
    marker.unlink(missing_ok=True)
    return {**result, "running": False}


def open_client(config: dict, forward_index: int = 0) -> dict:
    if not config["forwards"]:
        _, target_alias = ssh_aliases(config)
        return {"ok": True, "output": f"No port forward is configured. Connect with: ssh {target_alias}"}
    if not 0 <= forward_index < len(config["forwards"]):
        raise ValueError("Invalid port-forward index")
    forward = config["forwards"][forward_index]
    address = f"127.0.0.1:{forward['local_port']}"
    system = platform.system()
    if forward["open_mode"] == "vnc":
        if system == "Darwin":
            subprocess.Popen(["open", f"vnc://{address}"])
            return {"ok": True, "output": f"Opened Screen Sharing at vnc://{address}"}
        if system == "Windows":
            vnc = shutil.which("vncviewer") or shutil.which("tvnviewer")
            if vnc:
                subprocess.Popen([vnc, address])
                return {"ok": True, "output": f"Opened VNC viewer at {address}"}
            return {
                "ok": False,
                "output": "Tunnel is ready, but no VNC viewer was found. Install a VNC client and connect to "
                + address,
            }
    if forward["open_mode"] == "rdp":
        if system == "Windows":
            subprocess.Popen(["mstsc", f"/v:{address}"])
            return {"ok": True, "output": f"Opened Remote Desktop at {address}"}
        return {"ok": True, "output": f"Open an RDP client and connect to {address}"}
    if forward["open_mode"] == "browser":
        url = f"http://{address}"
        webbrowser.open(url)
        return {"ok": True, "output": f"Opened {url}"}
    return {"ok": True, "output": f"Tunnel endpoint: {address}"}


def diagnose(config: dict) -> list[dict]:
    checks: list[dict] = []
    for command in ("ssh", "ssh-keygen"):
        path = shutil.which(command)
        checks.append(
            {
                "name": f"Command: {command}",
                "ok": bool(path),
                "output": path or f"{command} was not found in PATH",
            }
        )
    jump_tcp = tcp_check(config["jump_host"], config["jump_port"])
    checks.append({"name": "Jump host TCP", **jump_tcp})
    install_ssh_config(config)
    jump_alias, target_alias = ssh_aliases(config)
    checks.append(
        {
            "name": "Jump host key authentication",
            **run(
                [
                    executable("ssh"),
                    "-o",
                    "BatchMode=yes",
                    "-o",
                    "ConnectTimeout=12",
                    jump_alias,
                    "true",
                ],
                timeout=18,
            ),
        }
    )
    checks.append(
        {
            "name": "Target SSH through jump host",
            **run(
                [
                    executable("ssh"),
                    "-o",
                    "BatchMode=yes",
                    "-o",
                    "ConnectTimeout=15",
                    target_alias,
                    "true",
                ],
                timeout=22,
            ),
        }
    )
    if not config["forwards"]:
        checks.append(
            {
                "name": "Port forwards",
                "ok": True,
                "output": "No port forwards are configured. Target SSH connectivity already passed.",
            }
        )
    else:
        for forward in config["forwards"]:
            remote_check_command = (
                f"python3 -c \"import socket;s=socket.create_connection("
                f"('{forward['remote_host']}',{forward['remote_port']}),5);s.close()\""
            )
            remote_result = run(
                [
                    executable("ssh"),
                    "-o",
                    "BatchMode=yes",
                    "-o",
                    "ConnectTimeout=15",
                    target_alias,
                    remote_check_command,
                ],
                timeout=22,
            )
            if not remote_result["ok"]:
                remote_result["output"] = (
                    f"'{forward['name']}' is not reachable from the target computer at "
                    f"{forward['remote_host']}:{forward['remote_port']}.\n"
                    "SSH connectivity succeeded. Check that the application is running and "
                    "listening on the configured host and port.\n\n"
                    f"Technical output:\n{remote_result['output']}"
                )
            checks.append({"name": f"Forward: {forward['name']}", **remote_result})
    log("Diagnostic completed")
    return checks


class AppServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], token: str):
        super().__init__(address, AppHandler)
        self.token = token


class AppHandler(BaseHTTPRequestHandler):
    server: AppServer

    def log_message(self, format_string: str, *args: object) -> None:
        log("HTTP " + (format_string % args))

    def send_bytes(self, data: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'")
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, payload: object, status: int = 200) -> None:
        self.send_bytes(
            json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            "application/json; charset=utf-8",
            status,
        )

    def authorized(self) -> bool:
        token = self.headers.get("X-Lab-Connect-Token", "")
        return secrets.compare_digest(token, self.server.token)

    def body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 1_000_000:
            raise ValueError("Request is too large")
        raw = self.rfile.read(length)
        return json.loads(raw or b"{}")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/":
            query = parse_qs(parsed.query)
            token = query.get("token", [""])[0]
            if not secrets.compare_digest(token, self.server.token):
                self.send_error(HTTPStatus.FORBIDDEN)
                return
            html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
            html = html.replace("__LAB_CONNECT_TOKEN__", self.server.token)
            self.send_bytes(html.encode("utf-8"), "text/html; charset=utf-8")
            return
        if parsed.path == "/app.js":
            self.send_bytes((STATIC_DIR / "app.js").read_bytes(), "text/javascript; charset=utf-8")
            return
        if parsed.path == "/styles.css":
            self.send_bytes((STATIC_DIR / "styles.css").read_bytes(), "text/css; charset=utf-8")
            return
        if parsed.path == "/api/logs":
            if not self.authorized():
                self.send_error(HTTPStatus.FORBIDDEN)
                return
            data = LOG_FILE.read_bytes() if LOG_FILE.exists() else b"No logs yet.\n"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="lab-connect.log"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        if not self.authorized():
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        try:
            payload = self.body()
            path = urlparse(self.path).path
            if path == "/api/state":
                config = load_config()
                self.send_json(
                    {
                        "ok": True,
                        "config": config,
                        "platform": platform.system(),
                        "python": sys.version.split()[0],
                        "ssh": shutil.which("ssh"),
                        "tunnel": tunnel_status(config),
                    }
                )
                return
            config = validate_config(payload.get("config", payload))
            if path == "/api/save":
                save_config(config)
                result = install_ssh_config(config)
            elif path == "/api/key/create":
                save_config(config)
                result = ensure_key(config)
            elif path == "/api/key/deploy":
                save_config(config)
                result = deploy_key(
                    config,
                    str(payload.get("destination", "")),
                    str(payload.get("password", "")),
                )
            elif path == "/api/diagnose":
                save_config(config)
                result = {"ok": True, "checks": diagnose(config)}
            elif path == "/api/tunnel/start":
                save_config(config)
                result = start_tunnel(config)
            elif path == "/api/tunnel/stop":
                result = stop_tunnel(config)
            elif path == "/api/tunnel/status":
                result = tunnel_status(config)
            elif path == "/api/client/open":
                result = open_client(config, int(payload.get("forward_index", 0)))
            else:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            self.send_json(result)
        except Exception as exc:
            log(f"ERROR {type(exc).__name__}: {exc}")
            self.send_json(
                {"ok": False, "output": f"{type(exc).__name__}: {exc}"},
                HTTPStatus.BAD_REQUEST,
            )


def main() -> int:
    parser = argparse.ArgumentParser(description=APP_NAME)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    APP_DIR.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(24)
    server = AppServer(("127.0.0.1", args.port), token)
    host, port = server.server_address
    url = f"http://{host}:{port}/?token={token}"
    log(f"Started {APP_NAME} on 127.0.0.1:{port}, platform={platform.system()}")
    print(f"{APP_NAME} is running at:\n{url}")
    print("Close this window or press Ctrl+C to stop the setup UI.")
    if not args.no_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        log(f"Stopped {APP_NAME}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
