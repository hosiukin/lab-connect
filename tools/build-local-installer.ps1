#Requires -Version 5.1
<#
Build spark-install.exe locally from spark-build.json.
The JSON contains the configured PowerShell installer and the NSIS stub;
no executable is transported, so the generated EXE has no network download mark.
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$Config,
  [string]$Out = (Join-Path (Get-Location) "spark-install.exe")
)

$ErrorActionPreference = "Stop"

$kit = Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
if ($kit.schema -ne "spark-dsh-local-build/v1") {
  throw "不支持的配置格式：$($kit.schema)"
}
if (-not $kit.windows -or -not $kit.windows.stub -or $null -eq $kit.windows.script) {
  throw "配置缺少 windows.stub 或 windows.script"
}

$script = [string]$kit.windows.script
$stub = [Convert]::FromBase64String([string]$kit.windows.stub)
if ($stub.Length -lt 2 -or $stub[0] -ne 0x4D -or $stub[1] -ne 0x5A) {
  throw "stub 不是有效的 PE 文件"
}

# Windows PowerShell 5.1 needs the UTF-8 BOM to read Chinese prompts correctly.
$withBom = ([string][char]0xFEFF) + $script
$payload = [Text.Encoding]::UTF8.GetBytes($withBom)
if ($payload.Length -gt 99999999) {
  throw "安装脚本过大"
}
$footer = [Text.Encoding]::ASCII.GetBytes("SPRK" + $payload.Length.ToString("D8") + "`n")

$output = [byte[]]($stub + $payload + $footer)
$outFull = [IO.Path]::GetFullPath($Out)
$outDir = [IO.Path]::GetDirectoryName($outFull)
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}
[IO.File]::WriteAllBytes($outFull, $output)

$ps1 = [IO.Path]::ChangeExtension($outFull, ".ps1")
[IO.File]::WriteAllBytes($ps1, $payload)

Write-Host ("已生成：" + $outFull)
Write-Host ("大小：" + $output.Length + " 字节")
Write-Host ("同时保留可阅读脚本：" + $ps1)
Write-Host "现在可以双击生成的 exe；它是在本机生成的，不带网络下载标记。"
