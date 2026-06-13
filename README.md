# Lab Connect

Lab Connect is a local, cross-platform web wizard for connections of the form:

```text
your computer -> EasyConnect -> SSH jump host -> lab computer
```

It configures OpenSSH, deploys public keys, runs diagnostics, manages multiple
background TCP forwards, opens supported local clients, and records redacted
diagnostic logs.

Each profile can have zero or more named port forwards. Examples:

- Web application: local `18080` to target `127.0.0.1:8080`
- Jupyter: local `18888` to target `127.0.0.1:8888`
- vLLM API: local `18000` to target `127.0.0.1:8000`
- macOS Screen Sharing: local `15901` to target `127.0.0.1:5900`
- RDP: local `13389` to target `127.0.0.1:3389`

All forwards terminate through the target SSH host, not the jump host. This
means applications may remain bound to `127.0.0.1` on the target computer.

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

## Connect from PowerShell or VS Code

For a Linux server, Spark node, or another terminal target, save the profile.
Port forwards are optional and do not affect normal SSH access.

The value entered in **Profile name** becomes the SSH host alias. For example,
if the profile name is:

```text
spark
```

connect from PowerShell, Command Prompt, Windows Terminal, macOS Terminal, or
Linux with:

```powershell
ssh spark
```

Lab Connect generates the equivalent OpenSSH configuration:

```sshconfig
Host spark-jump
    HostName <jump-host-address>
    User <jump-host-user>

Host spark
    HostName <target-internal-address>
    User <target-user>
    ProxyJump spark-jump
```

OpenSSH will automatically connect through:

```text
your computer -> EasyConnect -> jump host -> target computer
```

The standard direct SSH syntax is `user@host`, not `user/host`:

```powershell
ssh target-user@target-address
```

However, an internal target that is reachable only through the jump host must
use either the generated alias:

```powershell
ssh spark
```

or an explicit one-time ProxyJump command:

```powershell
ssh -J jump-user@jump-host target-user@target-address
```

For VS Code Remote-SSH:

1. Install the **Remote - SSH** extension.
2. Run **Remote-SSH: Connect to Host...** from the Command Palette.
3. Select the profile name, such as `spark`.

VS Code reads the same generated SSH configuration, so no separate jump-host
configuration is required.

## Forward web applications and other ports

Open the **Port forwards** page and add one or more rows. Each row contains:

- **Name**: a label such as `Spark Web UI`
- **Local port**: an unused port on your current computer
- **Target-side host**: usually `127.0.0.1`
- **Remote port**: the port used by the application on the target
- **Open mode**: Browser, VNC, RDP, or forwarding only

For example, to expose Spark port 8080 locally:

```text
Name: Spark Web UI
Local port: 18080
Target-side host: 127.0.0.1
Remote port: 8080
Open mode: Browser
```

Select **Save and start all forwards**, then open:

```text
http://127.0.0.1:18080
```

Several ports can share the same SSH connection:

```text
127.0.0.1:18080 -> target 127.0.0.1:8080
127.0.0.1:18888 -> target 127.0.0.1:8888
127.0.0.1:18000 -> target 127.0.0.1:8000
```

If an application listens on another interface or another machine reachable
from the target, replace the target-side host accordingly.

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
