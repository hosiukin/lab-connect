# Lab Connect

Lab Connect is a local, cross-platform web wizard for connections of the form:

```text
your computer -> EasyConnect -> SSH jump host -> lab computer
```

It configures OpenSSH, deploys public keys, runs diagnostics, manages a
background TCP tunnel, opens macOS Screen Sharing when available, and records
redacted diagnostic logs.

Choose the service type that matches the target:

- **macOS Screen Sharing / VNC** for a Mac with Screen Sharing enabled.
- **SSH only** for Linux servers, Spark nodes, or terminal-only access.
- **Custom TCP service** for another forwarded port.

## Requirements

- EasyConnect must already be connected.
- Python 3.10 or newer.
- OpenSSH client (`ssh` and `ssh-keygen`).
- SSH enabled on the target computer.
- Screen Sharing or VNC enabled when forwarding port 5900.
- The jump host must permit TCP forwarding.

## Start

macOS:

1. Double-click `start-macos.command`.
2. If macOS blocks it, right-click it and choose Open.

Windows:

1. Download and extract the complete repository ZIP. Do not download only the
   BAT file.
2. Install Python 3.10 or newer. The launcher can install Python 3.12 through
   `winget` when Python is missing.
3. Confirm that `start-windows.bat` and `lab_connect.py` are in the same
   directory.
4. Double-click `start-windows.bat`.
5. Keep the launcher window open while using the setup page.
6. Allow the local Python process if Windows Firewall asks. The server binds
   only to `127.0.0.1`.

If Windows shows a SmartScreen warning, choose **More info** and then
**Run anyway**. The launcher now keeps the window open when startup fails and
records launcher errors in:

```text
%USERPROFILE%\.lab-connect\launcher.log
```

You can also start it from Command Prompt to see all output:

```bat
cd C:\path\to\lab-connect
start-windows.bat
```

The launcher opens a local browser page. Closing the launcher window stops the
configuration UI but does not stop an already running SSH tunnel.

## Security

- Passwords are used only for the current public-key deployment request.
- Passwords are never written to configuration or logs.
- Persistent settings are stored in `~/.lab-connect/config.json`.
- Generated SSH settings are stored in `~/.ssh/lab-connect.conf`.
- The existing `~/.ssh/config` is backed up before adding an `Include` line.
- The web server listens only on localhost and uses a random session token.

## Windows screen sharing

Windows does not include a VNC viewer by default. Install a viewer such as
TigerVNC, then connect it to the displayed local endpoint, for example:

```text
127.0.0.1:15901
```

The remote Mac still listens on port 5900. Port 15901 is only the local end of
the SSH tunnel.

## Logs

Logs are stored at:

```text
~/.lab-connect/lab-connect.log
```

Use **Download redacted logs** in the UI when asking for troubleshooting help.
Review logs before sharing them because hostnames and usernames are retained.
