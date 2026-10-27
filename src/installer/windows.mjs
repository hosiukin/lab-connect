// Generates the Windows installer as a plain PowerShell .ps1 script, plus the
// hidden desktop launcher. We deliberately avoid .bat/.vbs wrappers: endpoint
// security products frequently quarantine batch files, and Windows 11 is
// retiring VBScript. The installer and launcher are readable PowerShell.

import { jumpAlias, portalUrl, healthUrl, psq } from "./config.mjs";

function chunkText(value, width = 76) {
  if (!value) return "";
  return value.match(new RegExp(`.{1,${width}}`, "g")).join("\n");
}

function cfgJson(cfg) {
  return JSON.stringify({
    profile: cfg.profile,
    mode: cfg.mode,
    jumpAlias: jumpAlias(cfg),
    jumpHost: cfg.jumpHost,
    jumpPort: cfg.jumpPort,
    jumpUser: cfg.jumpUser,
    sparkHost: cfg.sparkHost,
    sparkPort: cfg.sparkPort,
    sparkUser: cfg.sparkUser,
    chain: cfg.chain,
    localPort: cfg.localPort,
    remotePort: cfg.remotePort,
    keyFile: cfg.keyFile,
    url: portalUrl(cfg),
    health: healthUrl(cfg),
  });
}

export function buildWindowsLauncher(cfg) {
  const data = cfgJson(cfg);
  return `$ErrorActionPreference = 'Stop'
$Cfg = ${psq(data)} | ConvertFrom-Json

$AppHome = Join-Path $env:LOCALAPPDATA 'SparkDSH'
$Log = Join-Path $AppHome 'launcher.log'
$PidFile = Join-Path $AppHome 'tunnel.pid'
$ErrFile = Join-Path $AppHome 'ssh-error.log'
New-Item -ItemType Directory -Force -Path $AppHome | Out-Null

function Write-Log([string]$Message) {
  try {
    Add-Content -Path $Log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $Message) -Encoding UTF8
  } catch {}
}

function Show-Alert([string]$Message) {
  Write-Log ('ALERT: ' + $Message)
  try {
    $ws = New-Object -ComObject WScript.Shell
    $ws.Popup($Message, 0, 'Spark DSH', 16) | Out-Null
  } catch {}
}

function Test-Health {
  try {
    $req = [System.Net.HttpWebRequest]::Create($Cfg.health)
    $req.Timeout = 1500
    $req.ReadWriteTimeout = 1500
    $req.Method = 'GET'
    $req.Proxy = $null
    $resp = $req.GetResponse()
    try {
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $body = $reader.ReadToEnd()
      return $body.Contains('"ok"')
    } finally {
      $resp.Close()
    }
  } catch {
    return $false
  }
}

function Open-Portal {
  try {
    Start-Process $Cfg.url | Out-Null
  } catch {
    Show-Alert ('无法打开浏览器，请手动访问：' + $Cfg.url)
  }
}

if (Test-Health) {
  Write-Log 'port already open; opening portal'
  Open-Portal
  exit 0
}

$ssh = Join-Path $env:SystemRoot 'System32\\OpenSSH\\ssh.exe'
if (-not (Test-Path $ssh)) {
  $cmd = Get-Command ssh.exe -ErrorAction SilentlyContinue
  if ($cmd) { $ssh = $cmd.Source } else {
    Show-Alert '找不到 ssh.exe。请在“设置 → 应用 → 可选功能”中安装 OpenSSH 客户端。'
    exit 2
  }
}

if (Test-Path $PidFile) {
  try {
    $old = [int](Get-Content $PidFile -Raw)
    $oldProc = if ($old -gt 0) { Get-Process -Id $old -ErrorAction SilentlyContinue } else { $null }
    if ($oldProc -and $oldProc.ProcessName -eq 'ssh') { Stop-Process -Id $old -Force -ErrorAction SilentlyContinue }
  } catch {}
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

$sshArgs = @(
  '-N',
  '-o', 'BatchMode=yes',
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'ConnectTimeout=20',
  '-o', 'ServerAliveInterval=30',
  '-o', 'ServerAliveCountMax=6',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-L', ('127.0.0.1:' + $Cfg.localPort + ':127.0.0.1:' + $Cfg.remotePort),
  $Cfg.profile
)

Write-Log ('starting tunnel 127.0.0.1:' + $Cfg.localPort + ' -> ' + $Cfg.remotePort)
try {
  $proc = Start-Process -FilePath $ssh -ArgumentList $sshArgs -WindowStyle Hidden -PassThru \
    -RedirectStandardError $ErrFile -RedirectStandardOutput (Join-Path $AppHome 'ssh-out.log')
  Set-Content -Path $PidFile -Value $proc.Id -Encoding ASCII
} catch {
  Show-Alert ('无法启动 ssh：' + $_.Exception.Message)
  exit 3
}

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 1000
  if ($proc.HasExited) { break }
  if (Test-Health) { $ready = $true; break }
}

if (-not $ready) {
  $tail = ''
  try { $tail = (Get-Content $ErrFile -Tail 12 -ErrorAction SilentlyContinue) -join "\`n" } catch {}
  Show-Alert ("无法建立到 spark 的隧道。\`n请确认 EasyConnect 已连接，且公钥已部署。\`n\`n" + $tail + "\`n\`n日志：" + $Log)
  exit 4
}

Write-Log 'tunnel ready; opening portal'
Open-Portal
`;
}

export function buildWindowsInstaller(cfg, icons = {}) {
  const data = cfgJson(cfg);
  const iconB64 = chunkText(icons.ico || "");
  return `# Spark DSH Windows installer
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File .\\spark-install.ps1
#Requires -Version 5.1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Cfg = @'
${data}
'@ | ConvertFrom-Json

$IconB64 = @'
${iconB64}
'@
$IconB64 = ($IconB64 -replace '\\s', '')

$AppHome = Join-Path $env:LOCALAPPDATA 'SparkDSH'
$Log = Join-Path $AppHome 'install.log'
New-Item -ItemType Directory -Force -Path $AppHome | Out-Null

function Write-Log([string]$Message) {
  Write-Host $Message
  try { Add-Content -Path $Log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $Message) -Encoding UTF8 } catch {}
}

function Show-Alert([string]$Message) {
  Write-Log ('ERROR: ' + $Message)
  try {
    $ws = New-Object -ComObject WScript.Shell
    $ws.Popup($Message, 0, 'Spark DSH 安装器', 16) | Out-Null
  } catch {}
}

function Fail([string]$Message) {
  Show-Alert $Message
  throw $Message
}

trap { Write-Log ('安装失败：' + $_); exit 1 }

Write-Log '== Spark DSH 安装器 =='
Write-Log ('SSH 别名：' + $Cfg.profile)

# ---------------------------------------------------------------- SSH client
$ssh = Join-Path $env:SystemRoot 'System32\\OpenSSH\\ssh.exe'
if (-not (Test-Path $ssh)) {
  $cmd = Get-Command ssh.exe -ErrorAction SilentlyContinue
  if ($cmd) { $ssh = $cmd.Source }
}
if (-not $ssh -or -not (Test-Path $ssh)) {
  Fail '找不到 ssh.exe。请打开“设置 → 应用 → 可选功能 → 添加功能”，安装 OpenSSH 客户端，然后重新运行安装器。'
}
$sshDir = Split-Path $ssh -Parent
$keygen = Join-Path $sshDir 'ssh-keygen.exe'
if (-not (Test-Path $keygen)) {
  $kg = Get-Command ssh-keygen.exe -ErrorAction SilentlyContinue
  if ($kg) { $keygen = $kg.Source } else { Fail '找不到 ssh-keygen.exe，请安装 OpenSSH 客户端。' }
}
Write-Log ('SSH 客户端：' + $ssh)

function ConvertTo-KeygenCommandLine([string[]]$Arguments) {
  # Build the command line ourselves so empty values such as -N '' and -P ''
  # survive PowerShell's native-argument handling on both Windows PowerShell 5.1
  # and PowerShell 7.
  return ($Arguments | ForEach-Object {
    if ($_ -eq '') { '""' }
    elseif ($_ -match '[\\s"]') { '"' + ($_ -replace '"', '\\"') + '"' }
    else { $_ }
  }) -join ' '
}

function Invoke-Keygen([string[]]$Arguments) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $keygen
  $psi.UseShellExecute = $false
  $psi.Arguments = ConvertTo-KeygenCommandLine $Arguments
  $p = [System.Diagnostics.Process]::Start($psi)
  $p.WaitForExit()
  return $p.ExitCode
}

function Invoke-KeygenCapture([string[]]$Arguments) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $keygen
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.Arguments = ConvertTo-KeygenCommandLine $Arguments
  $p = [System.Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEnd()
  $err = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  return [pscustomobject]@{ Code = $p.ExitCode; Out = $out; Err = $err }
}

# ---------------------------------------------------------------- key
$KeyFile = $Cfg.keyFile
if ($KeyFile.StartsWith('~/')) { $KeyFile = Join-Path $env:USERPROFILE $KeyFile.Substring(2) }
$KeyFile = $KeyFile -replace '/', '\\'
$keyDir = Split-Path $KeyFile -Parent
New-Item -ItemType Directory -Force -Path $keyDir | Out-Null

$DefaultKeyFile = ($Cfg.keyFile -eq '~/.ssh/id_ed25519_spark')
$keyPublic = ''
if (Test-Path -LiteralPath $KeyFile -PathType Leaf) {
  # A key copied from another PC can retain an inherited ACL that Windows
  # OpenSSH rejects. Restrict it to the current user before probing it.
  try {
    $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls $KeyFile /inheritance:r /grant:r ($me + ':F') 2>$null | Out-Null
  } catch {}
  # -P '' makes ssh-keygen fail instead of prompting when an old key has a
  # passphrase, so the installer can recover instead of hanging.
  $probe = Invoke-KeygenCapture @('-y', '-P', '', '-f', $KeyFile)
  if ($probe.Code -eq 0 -and $probe.Out.Trim()) {
    $keyPublic = $probe.Out.Trim()
    Write-Log ('复用已有密钥：' + $KeyFile)
  } else {
    $reason = (($probe.Err -replace '\\s+', ' ').Trim())
    if ($DefaultKeyFile) {
      $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
      $backup = $KeyFile + '.bak.' + $stamp
      Move-Item -LiteralPath $KeyFile -Destination $backup
      if (Test-Path -LiteralPath ($KeyFile + '.pub') -PathType Leaf) {
        Move-Item -LiteralPath ($KeyFile + '.pub') -Destination ($backup + '.pub')
      }
      Write-Log ('已有密钥无法无口令读取（可能带口令或已损坏），已备份为：' + $backup)
      if ($reason) { Write-Log ('ssh-keygen：' + $reason) }
    } else {
      Fail ('已有密钥无法无口令读取：' + $KeyFile + '。请换一个私钥路径，或先运行 ssh-keygen -p -f "' + $KeyFile + '" 去掉口令后重试。')
    }
  }
}

if (-not (Test-Path -LiteralPath $KeyFile -PathType Leaf)) {
  Write-Log ('生成密钥：' + $KeyFile)
  $rc = Invoke-Keygen @('-q', '-t', 'ed25519', '-N', '', '-C', ("spark-dsh@" + $env:COMPUTERNAME), '-f', $KeyFile)
  if ($rc -ne 0) { Fail '生成 SSH 密钥失败。' }
  $probe = Invoke-KeygenCapture @('-y', '-P', '', '-f', $KeyFile)
  if ($probe.Code -ne 0) { Fail ('读取新公钥失败：' + $probe.Err) }
  $keyPublic = $probe.Out.Trim()
}
if (-not $keyPublic) {
  $probe = Invoke-KeygenCapture @('-y', '-P', '', '-f', $KeyFile)
  if ($probe.Code -ne 0) { Fail ('读取公钥失败（密钥可能带口令）：' + $probe.Err) }
  $keyPublic = $probe.Out.Trim()
}

# A stale .pub from another key makes every server reject this key. Rebuild it
# from the private key whenever it is missing or does not match.
$pubPath = $KeyFile + '.pub'
$oldPub = ''
if (Test-Path -LiteralPath $pubPath -PathType Leaf) {
  try { $oldPub = [string](Get-Content -LiteralPath $pubPath -Raw) } catch { $oldPub = '' }
}
if ($oldPub.Trim() -ne $keyPublic) {
  if ($oldPub) {
    $pubBackup = $pubPath + '.bak.' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
    Copy-Item -LiteralPath $pubPath -Destination $pubBackup
    Write-Log ('原公钥文件已备份：' + $pubBackup)
  }
  try {
    [IO.File]::WriteAllText($pubPath, $keyPublic + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
  } catch {
    Fail ('写入公钥失败：' + $_.Exception.Message)
  }
  Write-Log ('已校准公钥文件：' + $pubPath)
}
$fingerprint = & $keygen -l -f $pubPath 2>$null
if ($LASTEXITCODE -eq 0 -and $fingerprint) {
  Write-Log ('密钥指纹：' + (($fingerprint -join ' ').Trim()))
}

# ---------------------------------------------------------------- ssh config
$SshDir = Join-Path $env:USERPROFILE '.ssh'
New-Item -ItemType Directory -Force -Path $SshDir | Out-Null
$ConfigPath = Join-Path $SshDir 'config'
$block = @'
${buildWindowsConfigBlock(cfg, '__SPARK_KEY_FILE__')}'@
$block = $block.Replace('__SPARK_KEY_FILE__', $KeyFile.Replace('\\', '/'))
$existing = ''
if (Test-Path $ConfigPath) {
  Copy-Item $ConfigPath (Join-Path $AppHome ('ssh-config.backup.' + (Get-Date -Format 'yyyyMMdd-HHmmss')))
  $existing = Get-Content $ConfigPath -Raw
  if ($null -eq $existing) { $existing = '' }
}
$pattern = '(?ms)^# >>> spark-dsh installer managed start >>>.*?^# <<< spark-dsh installer managed end <<<\\r?\\n?'
$existing = [regex]::Replace($existing, $pattern, '')
$newText = $block + "\\r\\n" + $existing
[IO.File]::WriteAllText($ConfigPath, $newText, (New-Object System.Text.UTF8Encoding($false)))
Write-Log '已写入 SSH 配置'

# ---------------------------------------------------------------- deploy key
function Test-KeyAuth([string]$Alias) {
  $authOut = & $ssh -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=accept-new $Alias true 2>&1
  if ($LASTEXITCODE -eq 0) { return $true }
  if ($authOut) {
    Write-Log ('免密认证失败（' + $Alias + '）：' + (($authOut | Out-String).Trim()))
  }
  return $false
}

function Deploy-Key([string]$Alias) {
  if (Test-KeyAuth $Alias) { Write-Log ('免密登录已可用：' + $Alias); return $true }
  Write-Log ('为 ' + $Alias + ' 部署公钥，接下来会提示输入该账号密码')
  $remote = 'umask 077; mkdir -p ~/.ssh; chmod 700 ~/.ssh; touch ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys; cat >> ~/.ssh/authorized_keys'
  try {
    Get-Content ($KeyFile + '.pub') -Raw | & $ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 $Alias $remote
  } catch {
    Write-Log ('部署出错：' + $_.Exception.Message)
  }
  return (Test-KeyAuth $Alias)
}

$failed = @()
if ($Cfg.mode -eq 'jump') {
  if (-not (Deploy-Key $Cfg.jumpAlias)) { $failed += $Cfg.jumpAlias }
}
if (-not (Deploy-Key $Cfg.profile)) { $failed += $Cfg.profile }
if ($failed.Count -gt 0) {
  Write-Log ('公钥部署未完成：' + ($failed -join ', '))
  Show-Alert ("以下账号还没有部署公钥：" + ($failed -join ', ') + "\`n请把 " + $KeyFile + ".pub 的内容导入医院门户，或重新运行安装器。")
} else {
  Write-Log '公钥部署完成'
}

# ---------------------------------------------------------------- launcher
# The launcher is embedded as a readable here-string, not Base64 and not a
# self-extracting shell stub. This keeps the script easy to audit and avoids
# the legacy command-shell wrapper patterns most often quarantined by endpoint
# security products.
$launcherText = @'
${buildWindowsLauncher(cfg)}'@
[IO.File]::WriteAllText((Join-Path $AppHome 'launch.ps1'), $launcherText, (New-Object System.Text.UTF8Encoding($true)))

$stopPs1 = @'
$AppHome = Join-Path $env:LOCALAPPDATA 'SparkDSH'
$PidFile = Join-Path $AppHome 'tunnel.pid'
if (Test-Path $PidFile) {
  try { $id = [int](Get-Content $PidFile -Raw) } catch { $id = 0 }
  $proc = if ($id -gt 0) { Get-Process -Id $id -ErrorAction SilentlyContinue } else { $null }
  if ($proc -and $proc.ProcessName -eq 'ssh') {
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    Write-Host 'Spark DSH 隧道已停止。'
  } else {
    Write-Host '没有找到运行中的 Spark DSH 隧道。'
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
} else {
  Write-Host '没有找到运行中的 Spark DSH 隧道。'
}
'@
[IO.File]::WriteAllText((Join-Path $AppHome 'stop-tunnel.ps1'), $stopPs1, (New-Object System.Text.UTF8Encoding($true)))

$uninstallPs1 = @'
$ErrorActionPreference = 'Stop'
$AppHome = Join-Path $env:LOCALAPPDATA 'SparkDSH'
$PidFile = Join-Path $AppHome 'tunnel.pid'
if (Test-Path $PidFile) {
  try {
    $id = [int](Get-Content $PidFile -Raw)
    $proc = if ($id -gt 0) { Get-Process -Id $id -ErrorAction SilentlyContinue } else { $null }
    if ($proc -and $proc.ProcessName -eq 'ssh') { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  } catch {}
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}
$configPath = Join-Path $env:USERPROFILE '.ssh\\config'
if (Test-Path $configPath) {
  $text = Get-Content $configPath -Raw
  if ($null -eq $text) { $text = '' }
  $pattern = '(?ms)^# >>> spark-dsh installer managed start >>>.*?^# <<< spark-dsh installer managed end <<<\\r?\\n?'
  $text = [regex]::Replace($text, $pattern, '')
  [IO.File]::WriteAllText($configPath, $text, (New-Object System.Text.UTF8Encoding($false)))
}
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  if ($dir) { Remove-Item (Join-Path $dir 'Spark DSH.lnk') -Force -ErrorAction SilentlyContinue }
}
Remove-Item (Join-Path $AppHome 'spark-dsh.ico') -Force -ErrorAction SilentlyContinue
Write-Host 'Spark DSH 隧道、快捷方式和 SSH 配置块已移除；密钥保留。'
Write-Host ('请手动删除文件夹：' + $AppHome)
'@
[IO.File]::WriteAllText((Join-Path $AppHome 'uninstall.ps1'), $uninstallPs1, (New-Object System.Text.UTF8Encoding($true)))

if ($IconB64) {
  try {
    [IO.File]::WriteAllBytes((Join-Path $AppHome 'spark-dsh.ico'), [Convert]::FromBase64String($IconB64))
  } catch {}
}

$powershell = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'
$ws = New-Object -ComObject WScript.Shell
$targets = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($dir in $targets) {
  if (-not $dir) { continue }
  try {
    $sc = $ws.CreateShortcut((Join-Path $dir 'Spark DSH.lnk'))
    $sc.TargetPath = $powershell
    $sc.Arguments = '-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $AppHome 'launch.ps1') + '"'
    $sc.WorkingDirectory = $AppHome
    $sc.Description = '打开 spark 服务器的 DSH 助手'
    $icon = Join-Path $AppHome 'spark-dsh.ico'
    if (Test-Path $icon) { $sc.IconLocation = $icon }
    $sc.Save()
    Write-Log ('已创建快捷方式：' + (Join-Path $dir 'Spark DSH.lnk'))
  } catch {
    Write-Log ('创建快捷方式失败：' + $_.Exception.Message)
  }
}

Write-Log '安装完成，正在打开 spark 门户…'
Start-Process -FilePath $powershell -ArgumentList @(
  '-NoLogo', '-NoProfile', '-WindowStyle', 'Hidden',
  '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $AppHome 'launch.ps1') + '"')
)
Start-Sleep -Seconds 2
Write-Log '如果提示登录，请输入 spark 用户名和密码（会话保持 12 小时）。'
Write-Log ('日志：' + (Join-Path $AppHome 'launcher.log'))
`;
}

function buildWindowsConfigBlock(cfg, keyFile = cfg.keyFile) {
  const common = [
    `    IdentityFile ${keyFile}`,
    "    IdentitiesOnly yes",
    "    ServerAliveInterval 30",
    "    ServerAliveCountMax 6",
    "    TCPKeepAlive yes",
    "    StrictHostKeyChecking accept-new",
  ];
  const lines = ["# >>> spark-dsh installer managed start >>>"];
  if (cfg.mode === "jump") {
    lines.push(
      `Host ${jumpAlias(cfg)}`,
      `    HostName ${cfg.jumpHost}`,
      `    Port ${cfg.jumpPort}`,
      `    User ${cfg.jumpUser}`,
      ...common,
      "",
    );
  }
  lines.push(
    `Host ${cfg.profile}`,
    `    HostName ${cfg.sparkHost}`,
    `    Port ${cfg.sparkPort}`,
    `    User ${cfg.sparkUser}`,
  );
  if (cfg.mode === "jump") lines.push(`    ProxyJump ${jumpAlias(cfg)}`);
  else if (cfg.mode === "chain") lines.push(`    ProxyJump ${cfg.chain}`);
  lines.push(...common, "    ExitOnForwardFailure yes", "    ConnectTimeout 20", "# <<< spark-dsh installer managed end <<<", "");
  return lines.join("\r\n");
}

export function buildWindowsReadme(cfg) {
  return [
    "Spark DSH Windows 安装说明",
    "",
    `SSH 别名：${cfg.profile}`,
    `门户地址：${portalUrl(cfg)}`,
    "",
    "1. 解压后打开 PowerShell，进入解压目录，运行：",
    "   powershell -NoProfile -ExecutionPolicy Bypass -File .\\spark-install.ps1",
    "2. 不要双击 .ps1（默认会用记事本打开）。",
    "3. 按提示输入跳板机和 spark 账号密码，用于部署公钥。",
    "4. 安装完成后桌面会出现 Spark DSH 图标。",
    "",
    "注意：使用前必须先连接 EasyConnect。",
  ].join("\r\n");
}
