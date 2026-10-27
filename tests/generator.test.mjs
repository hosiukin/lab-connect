import assert from "node:assert/strict";
import test from "node:test";
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {
  BLOCK_START,
  BLOCK_END,
  withDefaults,
  validateFields,
  sshConfigBlock,
  portalUrl,
  summaryLines,
  shellHomePath,
} from "../src/installer/config.mjs";
import {buildUnixInstaller, buildUnixLauncher} from "../src/installer/unix.mjs";
import {buildWindowsInstaller, buildWindowsLauncher} from "../src/installer/windows.mjs";
import {installerFiles, installerZip, buildReadme} from "../src/installer/bundle.mjs";
import {makeZip, crc32} from "../src/installer/zip.mjs";

const base = {sparkUser: "alice", jumpUser: "alice"};

test("validation: required fields and sensible constraints", () => {
  const empty = validateFields({});
  assert.equal(empty.ok, false);
  assert.ok(empty.fields.sparkUser);
  assert.ok(empty.fields.jumpUser);

  const direct = validateFields({...base, mode: "direct"});
  assert.equal(direct.ok, true, direct.errors.join("; "));
  assert.equal(direct.config.jumpUser, "alice");

  assert.equal(validateFields({...base, profile: "bad name"}).ok, false);
  assert.equal(validateFields({...base, sparkHost: "host with space"}).ok, false);
  assert.equal(validateFields({...base, sparkPort: 0}).ok, false);
  assert.equal(validateFields({...base, localPort: 80}).ok, false);
  assert.equal(validateFields({...base, localPort: 18090}).ok, true);
  assert.equal(validateFields({...base, keyFile: "~/.ssh/my key"}).ok, false);
  assert.equal(validateFields({...base, mode: "chain"}).ok, false);
  assert.equal(validateFields({...base, mode: "chain", chain: "alice@10.30.24.1:22"}).ok, true);
});

test("ssh config: jump, direct and chain", () => {
  const jump = withDefaults(base);
  const jumpBlock = sshConfigBlock(jump);
  assert.ok(jumpBlock.startsWith(BLOCK_START));
  assert.ok(jumpBlock.trimEnd().endsWith(BLOCK_END));
  assert.match(jumpBlock, /Host spark-jump\n    HostName 10\.30\.24\.1/);
  assert.match(jumpBlock, /Host spark\n(?:.*\n)*?    ProxyJump spark-jump/);
  assert.match(jumpBlock, /IdentityFile ~\/\.ssh\/id_ed25519_spark/);

  const directBlock = sshConfigBlock(withDefaults({...base, mode: "direct"}));
  assert.doesNotMatch(directBlock, /spark-jump/);
  assert.doesNotMatch(directBlock, /ProxyJump/);

  const chainBlock = sshConfigBlock(withDefaults({...base, mode: "chain", chain: "alice@10.30.24.1:22, bob@10.30.24.2"}));
  assert.match(chainBlock, /ProxyJump alice@10\.30\.24\.1:22,bob@10\.30\.24\.2/);
});

test("shell key path keeps ~ expansion and handles absolute paths", () => {
  assert.equal(shellHomePath("~/.ssh/id_ed25519_spark"), '"$HOME/.ssh/id_ed25519_spark"');
  assert.equal(shellHomePath("/opt/keys/spark"), "'/opt/keys/spark'");
});

test("unix installer: syntax valid for every mode", () => {
  for (const extra of [{}, {mode: "direct"}, {mode: "chain", chain: "alice@10.30.24.1:22"}]) {
    const cfg = withDefaults({...base, ...extra});
    const script = buildUnixInstaller(cfg, {png: ""});
    assert.ok(script.startsWith("#!/usr/bin/env bash"));
    assert.ok(!script.includes("undefined"));
    assert.ok(script.includes("127.0.0.1:$LOCAL_PORT:127.0.0.1:$REMOTE_PORT"));
    assert.ok(script.includes("ssh-copy-id"));
    const dir = mkdtempSync(join(tmpdir(), "spark-unix-"));
    const file = join(dir, "install.sh");
    writeFileSync(file, script);
    const check = spawnSync("bash", ["-n", file], {encoding: "utf8"});
    assert.equal(check.status, 0, check.stderr);
    assert.ok(statSync(file).size > 5000);
  }
});

test("unix launcher opens the tunnel URL and is idempotent", () => {
  const cfg = withDefaults({...base, localPort: 18123});
  const launcher = buildUnixLauncher(cfg);
  assert.match(launcher, /LOCAL_PORT='18123'/);
  assert.match(launcher, /URL='http:\/\/127\.0\.0\.1:18123\/'/);
  assert.match(launcher, /-L "127\.0\.0\.1:\$LOCAL_PORT:127\.0\.0\.1:\$REMOTE_PORT"/);
  assert.match(launcher, /ssh -S "\$SOCK" -O check/);
  const dir = mkdtempSync(join(tmpdir(), "spark-launcher-"));
  const file = join(dir, "launch.sh");
  writeFileSync(file, launcher);
  const check = spawnSync("bash", ["-n", file], {encoding: "utf8"});
  assert.equal(check.status, 0, check.stderr);
});

test("windows installer is a readable PowerShell script", () => {
  const cfg = withDefaults(base);
  const ps1 = buildWindowsInstaller(cfg, {ico: ""});
  assert.ok(ps1.startsWith("# Spark DSH Windows installer"));
  assert.match(ps1, /^#Requires -Version 5\.1$/m);
  assert.doesNotMatch(ps1, /@echo off/);
  assert.doesNotMatch(ps1, /wscript\.exe/i);
  assert.doesNotMatch(ps1, /launch\.vbs/i);
  assert.doesNotMatch(ps1, /uninstall\.bat/i);
  assert.doesNotMatch(ps1, /\.bat\b/i);
  assert.doesNotMatch(ps1, /\.vbs\b/i);
  assert.match(ps1, /spark-install\.ps1/);
  assert.match(ps1, /\$sc\.TargetPath = \$powershell/);
  assert.match(ps1, /Start-Process -FilePath \$powershell/);
  assert.match(ps1, /function Invoke-Keygen/);
  assert.match(ps1, /function Invoke-KeygenCapture/);
  assert.match(ps1, /'-y', '-P', '', '-f'/);
  assert.match(ps1, /Move-Item -LiteralPath \$KeyFile -Destination \$backup/);
  assert.match(ps1, /已校准公钥文件/);
  assert.match(ps1, /IdentityFile __SPARK_KEY_FILE__/);
  assert.doesNotMatch(ps1, /IdentityFile ~\/\.ssh/);
  assert.ok(ps1.includes("$KeyFile.Replace('\\', '/')"));
  assert.match(ps1, /chmod 600 ~\/\.ssh\/authorized_keys/);
  assert.match(ps1, /'-N', '', '-C'/);
  assert.doesNotMatch(ps1, /-N '""'/);
  assert.match(ps1, /if \(\$null -eq \$existing\)/);
  assert.match(ps1, /\$IconB64 = @'/);
  assert.match(ps1, /uninstall\.ps1/);
  assert.match(ps1, /ProcessName -eq 'ssh'/);
  assert.match(ps1, /ProxyJump spark-jump/);
  assert.match(ps1, /HostName 10\.30\.24\.1/);
  assert.ok(ps1.split(/\r?\n/).every((line) => line.length < 8000));

  const ico = readFileSync(new URL("../assets/spark-dsh.ico", import.meta.url)).toString("base64");
  const withIcon = buildWindowsInstaller(cfg, {ico});
  const block = withIcon.match(/\$IconB64 = @'\n([\s\S]*?)\n'@/);
  assert.ok(block, "icon block must be present");
  assert.equal(Buffer.from(block[1].replace(/\s/g, ""), "base64").toString("base64"), ico);

  const cfgStart = ps1.indexOf("$Cfg = @'\n");
  const cfgEnd = ps1.indexOf("\n'@", cfgStart);
  assert.ok(cfgStart >= 0 && cfgEnd > cfgStart, "config here-string must be present");
  const json = ps1.slice(cfgStart + "$Cfg = @'\n".length, cfgEnd).trim();
  const parsed = JSON.parse(json);
  assert.equal(parsed.sparkUser, "alice");
  assert.equal(parsed.mode, "jump");
  assert.equal(parsed.jumpHost, "10.30.24.1");
  assert.equal(parsed.localPort, 18090);

  const token = "$launcherText = @'\n";
  const launcherStart = ps1.indexOf(token);
  const launcherEnd = ps1.indexOf("\n'@", launcherStart);
  assert.ok(launcherStart >= 0 && launcherEnd > launcherStart, "launcher here-string must be present");
  const launcher = ps1.slice(launcherStart + token.length, launcherEnd);
  assert.equal(launcher.trimEnd(), buildWindowsLauncher(cfg).trimEnd());
  assert.ok(launcher.startsWith("$ErrorActionPreference"));
  assert.ok(launcher.includes("tunnel.pid"));
  assert.ok(launcher.includes("$sshArgs"));
  assert.ok(!launcher.includes("$args ="));
  assert.ok(!launcher.includes("\n'@"), "launcher must not contain a nested here-string terminator");

  const tmp = mkdtempSync(join(tmpdir(), "spark-ps1-"));
  const file = join(tmp, "spark-install.ps1");
  writeFileSync(file, "\uFEFF" + ps1);
  const path = file.replace(/'/g, "''");
  const command =
    "$e=$null; [System.Management.Automation.Language.Parser]::ParseFile('" + path + "',[ref]$null,[ref]$e)>$null; " +
    "if($e){$e|% Message; exit 1}";
  const pwsh = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", command], {encoding: "utf8"});
  if (!pwsh.error) assert.equal(pwsh.status, 0, pwsh.stderr || pwsh.stdout);

  const launcherFile = join(tmp, "launch.ps1");
  writeFileSync(launcherFile, "\uFEFF" + launcher);
  const launcherCommand =
    "$e=$null; [System.Management.Automation.Language.Parser]::ParseFile('" +
    launcherFile.replace(/'/g, "''") +
    "',[ref]$null,[ref]$e)>$null; if($e){$e|% Message; exit 1}";
  const launcherParse = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", launcherCommand], {encoding: "utf8"});
  if (!launcherParse.error) assert.equal(launcherParse.status, 0, launcherParse.stderr || launcherParse.stdout);
});

test("zip bundle: four files, correct modes, UTF-8 readme", () => {
  const cfg = withDefaults(base);
  const files = installerFiles(cfg, {png: "", ico: ""}, new Date("2026-01-02T03:04:05Z"));
  assert.deepEqual(files.map((f) => f.name), [
    "spark-install.command",
    "spark-install.sh",
    "spark-install.ps1",
    "README.txt",
  ]);
  assert.equal(files[0].mode, 0o755);
  assert.equal(files[1].mode, 0o755);
  assert.equal(files[2].mode, 0o644);
  assert.ok(files[2].text.startsWith("\uFEFF"));
  assert.ok(files[2].text.includes("# Spark DSH Windows installer"));
  const readme = files[3].text;
  for (const word of ["macOS", "Windows", "Linux", "iPad", "卸载", "不会收集"]) assert.ok(readme.includes(word));

  const zip = installerZip(cfg, {png: "", ico: ""}, new Date("2026-01-02T03:04:05Z"));
  const dir = mkdtempSync(join(tmpdir(), "spark-zip-"));
  const file = join(dir, "bundle.zip");
  writeFileSync(file, zip);
  const list = spawnSync("unzip", ["-Z1", file], {encoding: "utf8"});
  assert.equal(list.status, 0, list.stderr);
  assert.deepEqual(list.stdout.trim().split("\n"), files.map((f) => f.name));

  const extract = join(dir, "out");
  const unzip = spawnSync("unzip", ["-q", file, "-d", extract], {encoding: "utf8"});
  assert.equal(unzip.status, 0, unzip.stderr);
  assert.equal(statSync(join(extract, "spark-install.command")).mode & 0o777, 0o755);
  assert.equal(statSync(join(extract, "spark-install.sh")).mode & 0o777, 0o755);
  assert.equal(statSync(join(extract, "spark-install.ps1")).mode & 0o777, 0o644);
  const winScript = readFileSync(join(extract, "spark-install.ps1"));
  assert.deepEqual([...winScript.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(winScript.toString("utf8").includes("# Spark DSH Windows installer"));
  assert.ok(readFileSync(join(extract, "README.txt"), "utf8").includes("Spark DSH"));
});

test("optional iPad gateway is bundled with BOM and CRLF", () => {
  const cfg = withDefaults(base);
  const gateway = "# test gateway\r\nWrite-Host 'ok'\r\n";
  const files = installerFiles(cfg, {png: "", ico: "", gateway}, new Date("2026-01-02T03:04:05Z"));
  assert.deepEqual(files.map((f) => f.name), [
    "spark-install.command",
    "spark-install.sh",
    "spark-install.ps1",
    "spark-ipad-gateway.ps1",
    "README.txt",
  ]);
  const file = files[3];
  assert.equal(file.mode, 0o644);
  assert.ok(file.text.startsWith("\uFEFF"));
  assert.equal(file.text.slice(1), gateway);
  assert.ok(files[4].text.includes("spark-ipad-gateway.ps1"));

  const zip = installerZip(cfg, {png: "", ico: "", gateway}, new Date("2026-01-02T03:04:05Z"));
  const dir = mkdtempSync(join(tmpdir(), "spark-gateway-zip-"));
  const zipFile = join(dir, "bundle.zip");
  writeFileSync(zipFile, zip);
  const list = spawnSync("unzip", ["-Z1", zipFile], {encoding: "utf8"});
  assert.equal(list.status, 0, list.stderr);
  assert.deepEqual(list.stdout.trim().split("\n"), files.map((f) => f.name));
});

test("crc32 and zip writer basics", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const zip = makeZip([{name: "a.txt", text: "hello", mode: 0o644}]);
  assert.equal(zip[0], 0x50);
  assert.equal(zip[1], 0x4b);
});

test("summary and portal URL", () => {
  const cfg = withDefaults({...base, localPort: 19000});
  assert.equal(portalUrl(cfg), "http://127.0.0.1:19000/");
  const lines = summaryLines(cfg).join("\n");
  assert.match(lines, /alice@10\.30\.24\.1:22/);
  assert.match(lines, /127\.0\.0\.1:19000/);
});
