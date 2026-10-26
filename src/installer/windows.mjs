// Generates the Windows installer (.bat with an embedded PowerShell payload)
// plus the hidden desktop launcher.

import { jumpAlias, portalUrl, healthUrl } from "./config.mjs";

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
$Cfg = @'
${data}
'@ | ConvertFrom-Json

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
  return `@echo off
setlocal
chcp 65001 >nul 2>nul
title Spark DSH Installer
set "SPARK_SELF=%~f0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:SPARK_SELF);$b='#SPARK_PS'+'_BEGIN';$e='#SPARK_PS'+'_END';$i=$t.IndexOf($b);$j=$t.IndexOf($e);if($i -lt 0 -or $j -le $i){exit 9};Invoke-Expression $t.Substring($i+$b.Length,$j-$i-$b.Length)"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo Installation did not finish. Exit code: %RC%
pause
exit /b %RC%
#SPARK_PS_BEGIN
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

function Invoke-Keygen([string[]]$Arguments) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $keygen
  $psi.UseShellExecute = $false
  # Build the command line ourselves so the empty -N value survives PowerShell's
  # native-argument handling on both Windows PowerShell 5.1 and PowerShell 7.
  $psi.Arguments = ($Arguments | ForEach-Object {
    if ($_ -eq '') { '""' }
    elseif ($_ -match '[\\s"]') { '"' + ($_ -replace '"', '\\"') + '"' }
    else { $_ }
  }) -join ' '
  $p = [System.Diagnostics.Process]::Start($psi)
  $p.WaitForExit()
  return $p.ExitCode
}

# ---------------------------------------------------------------- key
$KeyFile = $Cfg.keyFile
if ($KeyFile.StartsWith('~/')) { $KeyFile = Join-Path $env:USERPROFILE $KeyFile.Substring(2) }
$KeyFile = $KeyFile -replace '/', '\\'
$keyDir = Split-Path $KeyFile -Parent
New-Item -ItemType Directory -Force -Path $keyDir | Out-Null

if (-not (Test-Path $KeyFile)) {
  Write-Log ('生成密钥：' + $KeyFile)
  $rc = Invoke-Keygen @('-q', '-t', 'ed25519', '-N', '', '-C', ("spark-dsh@" + $env:COMPUTERNAME), '-f', $KeyFile)
  if ($rc -ne 0) { Fail '生成 SSH 密钥失败。' }
} else {
  Write-Log '复用已有密钥'
}
if (-not (Test-Path ($KeyFile + '.pub'))) {
  & $keygen -y -f $KeyFile > ($KeyFile + '.pub')
  if ($LASTEXITCODE -ne 0) { Fail '读取公钥失败（密钥可能带口令）。' }
}

# ---------------------------------------------------------------- ssh config
$SshDir = Join-Path $env:USERPROFILE '.ssh'
New-Item -ItemType Directory -Force -Path $SshDir | Out-Null
$ConfigPath = Join-Path $SshDir 'config'
$block = @'
${buildWindowsConfigBlock(cfg)}'@
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
  & $ssh -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=accept-new $Alias true 2>$null
  return ($LASTEXITCODE -eq 0)
}

function Deploy-Key([string]$Alias) {
  if (Test-KeyAuth $Alias) { Write-Log ('免密登录已可用：' + $Alias); return $true }
  Write-Log ('为 ' + $Alias + ' 部署公钥，接下来会提示输入该账号密码')
  $remote = 'umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; cat >> ~/.ssh/authorized_keys'
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
$selfText = [IO.File]::ReadAllText($env:SPARK_SELF)
$lm = '#SPARK_LAUNCHER_' + 'BEGIN'
$ln = '#SPARK_LAUNCHER_' + 'END'
$ls = $selfText.IndexOf($lm)
$le = $selfText.IndexOf($ln)
if ($ls -lt 0 -or $le -le $ls) { Fail '安装包缺少启动器数据，请重新下载完整的 spark-install.bat。' }
$launcherText = $selfText.Substring($ls + $lm.Length, $le - $ls - $lm.Length).TrimStart([char[]]@(13, 10))
[IO.File]::WriteAllText((Join-Path $AppHome 'launch.ps1'), $launcherText, (New-Object System.Text.UTF8Encoding($true)))

$vbs = 'CreateObject("WScript.Shell").Run "powershell.exe -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""' + (Join-Path $AppHome 'launch.ps1') + '""", 0, False'
[IO.File]::WriteAllText((Join-Path $AppHome 'launch.vbs'), $vbs, [System.Text.Encoding]::Unicode)

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

$uninstallBat = @'
@echo off
chcp 65001 >nul 2>nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\\SparkDSH\\uninstall.ps1"
pause
'@
Set-Content -Path (Join-Path $AppHome 'uninstall.bat') -Value $uninstallBat -Encoding ASCII

if ($IconB64) {
  try {
    [IO.File]::WriteAllBytes((Join-Path $AppHome 'spark-dsh.ico'), [Convert]::FromBase64String($IconB64))
  } catch {}
}

$ws = New-Object -ComObject WScript.Shell
$targets = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($dir in $targets) {
  if (-not $dir) { continue }
  try {
    $sc = $ws.CreateShortcut((Join-Path $dir 'Spark DSH.lnk'))
    $sc.TargetPath = (Join-Path $env:SystemRoot 'System32\\wscript.exe')
    $sc.Arguments = '//nologo "' + (Join-Path $AppHome 'launch.vbs') + '"'
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
Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\wscript.exe') -ArgumentList @('//nologo', ('"' + (Join-Path $AppHome 'launch.vbs') + '"'))
Start-Sleep -Seconds 2
Write-Log '如果提示登录，请输入 spark 用户名和密码（会话保持 12 小时）。'
Write-Log ('日志：' + (Join-Path $AppHome 'launcher.log'))
#SPARK_PS_END
#SPARK_LAUNCHER_BEGIN
${buildWindowsLauncher(cfg)}#SPARK_LAUNCHER_END
`;
}

function buildWindowsConfigBlock(cfg) {
  const common = [
    `    IdentityFile ${cfg.keyFile}`,
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
    "1. 双击 spark-install.bat。",
    "2. 若出现 SmartScreen 提示，点“更多信息”→“仍要运行”。",
    "3. 按提示输入跳板机和 spark 账号密码，用于部署公钥。",
    "4. 安装完成后桌面会出现 Spark DSH 图标。",
    "",
    "注意：使用前必须先连接 EasyConnect。",
  ].join("\r\n");
}
