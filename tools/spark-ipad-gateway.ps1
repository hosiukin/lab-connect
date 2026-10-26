#Requires -Version 5.1
<#
.SYNOPSIS
  把本机 Spark DSH 隧道共享给同一局域网的 iPad。

.DESCRIPTION
  安装器默认只让 SSH 隧道监听 127.0.0.1:18090，所以 iPad 无法直接访问。
  本脚本使用 Windows 自带的 portproxy 增加一个局域网端口 18091，并只允许
  本地子网访问它；SSH 隧道本身仍然只监听回环地址。

  先在 Windows 上双击桌面的 Spark DSH，确认本机浏览器能打开门户，再运行本脚本。
  脚本会自动请求管理员权限；普通安装器本身仍然不需要管理员权限。

.PARAMETER Port
  安装器里的本地隧道端口，默认 18090。

.PARAMETER GatewayPort
  给 iPad 使用的局域网端口，默认 18091。不要和 18090 相同。

.PARAMETER Remove
  删除 portproxy 和防火墙规则，不影响 Spark DSH 的回环隧道。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\spark-ipad-gateway.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\spark-ipad-gateway.ps1 -Port 18090 -GatewayPort 18092

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\spark-ipad-gateway.ps1 -Remove
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 65535)][int]$Port = 18090,
    [ValidateRange(1, 65535)][int]$GatewayPort = 18091,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$RuleName = 'Spark DSH iPad gateway'
$ListenAddress = '0.0.0.0'
$AppHome = Join-Path $env:LOCALAPPDATA 'SparkDSH'

if ($Port -eq $GatewayPort) {
    throw 'GatewayPort 不能和 Port 相同。'
}

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal -ArgumentList $identity
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Restart-Elevated {
    $argList = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"' + $PSCommandPath + '"'),
        '-Port', [string]$Port,
        '-GatewayPort', [string]$GatewayPort
    )
    if ($Remove) { $argList += '-Remove' }
    Write-Host '需要管理员权限来添加端口转发和防火墙规则，正在请求…'
    try {
        $proc = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList -Wait -PassThru
        exit $proc.ExitCode
    } catch {
        Write-Host ('未获得管理员权限：' + $_.Exception.Message)
        exit 1
    }
}

if (-not (Test-IsAdmin)) {
    Restart-Elevated
    exit 0
}

function Test-Tunnel {
    try {
        $req = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:' + $Port + '/healthz')
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

function Get-LanAddresses {
    $rows = @()
    try {
        $rows = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
            Select-Object InterfaceAlias, IPAddress)
    } catch {}
    if ($rows.Count -eq 0) {
        try {
            $rows = @([System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
                Where-Object { $_.AddressFamily -eq 'InterNetwork' -and -not [System.Net.IPAddress]::IsLoopback($_) } |
                ForEach-Object { [pscustomobject]@{ InterfaceAlias = '本机'; IPAddress = $_.IPAddressToString } })
        } catch {}
    }
    $result = @()
    foreach ($row in $rows) {
        if ($result.IPAddress -notcontains $row.IPAddress) {
            $result += [pscustomobject]@{ InterfaceAlias = $row.InterfaceAlias; IPAddress = $row.IPAddress }
        }
    }
    return $result
}

function Write-LanUrls {
    $addresses = @(Get-LanAddresses)
    $scheme = 'http' + '://'
    $lines = @(
        'Spark DSH iPad 地址',
        '',
        ('本机隧道：' + $scheme + '127.0.0.1:' + $Port + '/'),
        ('局域网端口：' + $GatewayPort + '（仅本地子网）'),
        ''
    )
    if ($addresses.Count -eq 0) {
        $lines += '没有检测到局域网 IPv4，请运行 ipconfig 查看。'
    } else {
        $lines += '在同一个 Wi-Fi / 局域网的 iPad 上打开：'
        foreach ($address in $addresses) {
            $lines += ('  [' + $address.InterfaceAlias + '] ' + $scheme + $address.IPAddress + ':' + $GatewayPort + '/')
        }
        $lines += ''
        $lines += '优先选 Wi-Fi / Ethernet / 以太网；不要用 VPN 或虚拟网卡地址。'
    }
    $lines | ForEach-Object { Write-Host $_ }
    try {
        New-Item -ItemType Directory -Force -Path $AppHome | Out-Null
        $file = Join-Path $AppHome 'ipad-urls.txt'
        $lines | Set-Content -Path $file -Encoding UTF8
        Write-Host ''
        Write-Host ('已写入：' + $file)
    } catch {}
}

if ($Remove) {
    & netsh interface portproxy delete v4tov4 listenaddress=$ListenAddress listenport=$GatewayPort 2>$null | Out-Null
    try {
        Get-NetFirewallRule -DisplayName $RuleName -ErrorAction Stop |
            Remove-NetFirewallRule -ErrorAction Stop
    } catch {}
    Write-Host ('已删除 iPad 网关：端口 ' + $GatewayPort + ' 和防火墙规则。')
    Write-Host 'Spark DSH 本身的 127.0.0.1 隧道不受影响。'
    exit 0
}

$service = Get-Service -Name iphlpsvc -ErrorAction SilentlyContinue
if ($service -and $service.Status -ne 'Running') {
    try { Start-Service iphlpsvc } catch { Write-Host ('无法启动 iphlpsvc：' + $_.Exception.Message) }
}

# Remove a stale portproxy rule with the same listen address/port.
& netsh interface portproxy delete v4tov4 listenaddress=$ListenAddress listenport=$GatewayPort 2>$null | Out-Null
Start-Sleep -Milliseconds 500

$listener = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -eq $GatewayPort -and $_.LocalAddress -in @('0.0.0.0', '::') }
if ($listener) {
    throw ('端口 ' + $GatewayPort + ' 已被其他程序占用，请换一个 -GatewayPort。')
}

& netsh interface portproxy add v4tov4 listenaddress=$ListenAddress listenport=$GatewayPort connectaddress=127.0.0.1 connectport=$Port
if ($LASTEXITCODE -ne 0) {
    throw ('netsh portproxy 添加失败，退出码 ' + $LASTEXITCODE + '。')
}

try {
    $oldRule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
    if ($oldRule) { $oldRule | Remove-NetFirewallRule -ErrorAction SilentlyContinue }
    New-NetFirewallRule -DisplayName $RuleName `
        -Description 'Allow iPad on the local subnet to reach the Spark DSH portal' `
        -Direction Inbound -Action Allow -Protocol TCP `
        -LocalPort $GatewayPort -Profile Private,Domain `
        -RemoteAddress LocalSubnet | Out-Null
} catch {
    Write-Host ('端口转发已建立，但防火墙规则添加失败：' + $_.Exception.Message)
    Write-Host ('请在 Windows 防火墙中允许 TCP ' + $GatewayPort + '，且只允许本地子网。')
}

Write-Host ''
Write-Host 'iPad 网关已开启。'
if (-not (Test-Tunnel)) {
    Write-Host ('提示：127.0.0.1:' + $Port + ' 门户还没有响应。请先双击桌面 Spark DSH，等本机能打开后再试。')
}
Write-Host ''
Write-LanUrls
