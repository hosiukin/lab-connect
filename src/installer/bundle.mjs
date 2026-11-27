// Assembles the per-platform scripts and the universal zip.

import {makeZip} from "./zip.mjs";
import {buildUnixInstaller} from "./unix.mjs";
import {buildWindowsInstaller} from "./windows.mjs";
import {buildWindowsExe} from "./exe.mjs";
import {portalUrl, summaryLines} from "./config.mjs";

export function buildReadme(cfg, generatedAt = new Date()) {
  const lines = [
    "Spark DSH 安装包",
    "=".repeat(48),
    "",
    `生成时间：${generatedAt.toLocaleString("zh-CN", {hour12: false})}`,
    "",
    "本压缩包包含 macOS、Windows、Linux 三个安装脚本。",
    "运行你系统对应的那一个即可；三个脚本可以重复运行，配置会覆盖为最新值。",
    "",
    "配置摘要",
    "-".repeat(48),
    ...summaryLines(cfg).map((line) => `  ${line}`),
    `  SSH 私钥：${cfg.keyFile}`,
    "",
    "macOS",
    "-".repeat(48),
    "  1. 解压后双击 spark-install.command。",
    "  2. 若提示“无法验证开发者”：右键 → 打开 → 再点“打开”。",
    "  3. 按提示输入跳板机、spark 账号密码（用于部署公钥）。",
    "  4. 安装完成后桌面出现 “Spark DSH”，以后双击即可。",
    "",
    "Windows",
    "-".repeat(48),
    "  推荐：在下载页选择 Windows .exe（zip），解压后双击 spark-install.exe。",
    "  也可以使用本压缩包里的 PowerShell 脚本：",
    "     powershell -NoProfile -ExecutionPolicy Bypass -File .\\spark-install.ps1",
    "  如果 exe 被 SmartScreen / 安全中心拦截：",
    "    右键 spark-install.ps1 → 使用 PowerShell 运行；",
    "    或先 Unblock-File，再运行上面的命令。",
    "  不要双击 .ps1（默认会用记事本打开）。",
    "  按提示输入跳板机、spark 账号密码（用于部署公钥）。",
    "  安装完成后桌面出现 “Spark DSH”，以后双击即可。",
    "",
    "Linux",
    "-".repeat(48),
    "  1. 解压后双击 spark-install.desktop。",
    "  2. 若提示“不受信任”，右键允许启动；无法双击时运行 bash spark-install.sh。",
    "  3. 按提示输入跳板机、spark 账号密码（用于部署公钥）。",
    "  4. 桌面出现 spark-dsh.desktop；以后从桌面或应用菜单打开 “Spark DSH”。",
    "",
    "iPad（可选，Windows 常开电脑做网关）",
    "-".repeat(48),
    "  1. 先在 Windows 上安装并双击 Spark DSH，确认本机能打开门户。",
    "  2. 运行压缩包里的 spark-ipad-gateway.ps1；脚本会请求管理员权限。",
    "  3. iPad 与这台 Windows 连同一个 Wi-Fi / 局域网。",
    "  4. 在 iPad 打开脚本打印的 " + "http" + "://" + "<Windows 的局域网 IP>:18091/。",
    "  5. 撤销：spark-ipad-gateway.ps1 -Remove",
    "  注意：只允许本地子网，不要把 18091 映射到公网；日志见",
    "        %LOCALAPPDATA%\\SparkDSH\\ipad-urls.txt。",
    "",
    "安装器做了什么",
    "-".repeat(48),
    "  · 生成或复用 ed25519 SSH 密钥",
    "  · 在 ~/.ssh/config 写入带标记的受管配置块（可重复运行）",
    "  · 把公钥部署到跳板机和 spark（会提示输入一次密码）",
    "  · 创建桌面启动器：自动建立隧道并打开门户",
    "  · 不会收集、保存或上传密码",
    "",
    "使用前",
    "-".repeat(48),
    "  · 必须先连接 EasyConnect（直连模式除外）",
    `  · 实验室其他电脑保持默认跳板机 ${cfg.jumpHost}；不要改成直连`,
    `  · 门户地址：${portalUrl(cfg)}（会话保持 12 小时）`,
    "  · 首次登录使用 spark 的 Linux 用户名和密码",
    "",
    "卸载",
    "-".repeat(48),
    "  macOS / Linux：运行 ~/.spark-dsh/uninstall.sh",
    "  Windows：在 PowerShell 中运行",
    "    powershell -NoProfile -ExecutionPolicy Bypass -File \"$env:LOCALAPPDATA\\SparkDSH\\uninstall.ps1\"",
    "  再删除 %LOCALAPPDATA%\\SparkDSH 文件夹",
    "  卸载会移除 SSH 配置中的受管区块，但保留密钥文件。",
    "",
  ];
  return lines.join("\r\n");
}

function linuxDesktopEntry() {
  return [
    "[Desktop Entry]",
    "Version=1.0",
    "Type=Application",
    "Name=安装 Spark DSH",
    "Comment=安装 Spark DSH 并创建桌面启动器",
    String.raw`Exec=sh -c "cd \"\\$(dirname \"\\$1\")\" && exec bash spark-install.sh" sh "%k"`,
    "Icon=utilities-terminal",
    "Terminal=true",
    "Categories=Utility;",
    "StartupNotify=false",
    "",
  ].join("\n");
}

export function installerFiles(cfg, icons = {}, generatedAt = new Date()) {
  const unix = buildUnixInstaller(cfg, icons);
  // PowerShell 5.1 treats BOM-less UTF-8 as ANSI; the BOM keeps the Chinese
  // prompts readable. This is a plain .ps1, with no .bat/.vbs wrapper.
  const win = "\uFEFF" + buildWindowsInstaller(cfg, icons).replace(/\r?\n/g, "\r\n");
  const files = [
    {name: "spark-install.command", text: unix, mode: 0o755},
    {name: "spark-install.sh", text: unix, mode: 0o755},
    {name: "spark-install.desktop", text: linuxDesktopEntry(), mode: 0o755},
    {name: "spark-install.ps1", text: win, mode: 0o644},
  ];
  const gateway = String(icons.gateway || "").replace(/^\uFEFF/, "").replace(/\r?\n/g, "\r\n");
  if (gateway) {
    // Windows PowerShell 5.1 treats BOM-less UTF-8 as ANSI; keep the BOM so
    // the Chinese prompts and help text display correctly.
    files.push({name: "spark-ipad-gateway.ps1", text: "\uFEFF" + gateway, mode: 0o644});
  }
  files.push({name: "README.txt", text: buildReadme(cfg, generatedAt), mode: 0o644});
  return files;
}

export function installerZip(cfg, icons = {}, generatedAt = new Date()) {
  return makeZip(installerFiles(cfg, icons, generatedAt), generatedAt);
}

function windowsScript(cfg, icons) {
  return buildWindowsInstaller(cfg, icons).replace(/\r?\n/g, "\r\n");
}

function windowsPs1(cfg, icons) {
  return "\uFEFF" + windowsScript(cfg, icons);
}

export function buildWindowsBuildKit(cfg, icons = {}, generatedAt = new Date()) {
  if (!icons.exe) throw new Error("Windows stub is missing");
  return {
    schema: "spark-dsh-local-build/v1",
    generatedAt: generatedAt.toISOString(),
    config: {...cfg},
    windows: {
      stub: String(icons.exe),
      script: windowsScript(cfg, icons),
    },
  };
}

export function installerLocalBuildZip(cfg, icons = {}, generatedAt = new Date()) {
  const kit = buildWindowsBuildKit(cfg, icons, generatedAt);
  const agentGuide = [
    "# Spark DSH 本机构建包",
    "",
    "用户要求：构建一个可双击安装 Spark DSH 的 exe。",
    "不要使用 PowerShell；你已经在目标电脑上，用当前环境里的 Node 或 Python 直接生成二进制即可。",
    "",
    "## 输入",
    "",
    "`spark-build.json` 包含：",
    "",
    "- `windows.stub`：NSIS 启动器的 base64；",
    "- `windows.script`：已经填写好配置的 PowerShell 安装脚本（CRLF）。",
    "",
    "不需要联网，不需要 NSIS，不需要修改 JSON 里的地址/用户名。",
    "",
    "## 生成的 exe 格式",
    "",
    "按顺序拼接：",
    "",
    "1. base64 解码后的 `windows.stub`；",
    "2. UTF-8 BOM（EF BB BF）；",
    "3. `windows.script` 的 UTF-8 字节（保持 CRLF）；",
    "4. ASCII 页脚：`SPRK` + 8 位十进制 payload 长度 + LF。",
    "",
    "写入当前目录的 `spark-install.exe`。可以把同样带 BOM 的脚本写入 `spark-install.ps1` 便于检查。",
    "",
    "## 最快：不保存构建脚本，直接运行",
    "",
    "```text",
    "node -e \"const fs=require('fs');const k=JSON.parse(fs.readFileSync('spark-build.json','utf8'));const s=k.windows.script.replace(/\\r?\\n/g,'\\r\\n');const p=Buffer.from('\\uFEFF'+s,'utf8');const f=Buffer.from('SPRK'+String(p.length).padStart(8,'0')+'\\n','ascii');fs.writeFileSync('spark-install.exe',Buffer.concat([Buffer.from(k.windows.stub,'base64'),p,f]));fs.writeFileSync('spark-install.ps1',p);\"",
    "```",
    "",
    "这条命令不落盘任何构建脚本，只生成 exe 和可阅读的 ps1。",
    "",
    "## 或者写成 build.mjs",
    "",
    "```js",
    "import {readFileSync, writeFileSync} from 'node:fs';",
    "const kit = JSON.parse(readFileSync('spark-build.json', 'utf8'));",
    "const script = kit.windows.script.replace(/\\r?\\n/g, '\\r\\n');",
    "const payload = Buffer.from('\\uFEFF' + script, 'utf8');",
    "const footer = Buffer.from('SPRK' + String(payload.length).padStart(8, '0') + '\\n', 'ascii');",
    "const exe = Buffer.concat([Buffer.from(kit.windows.stub, 'base64'), payload, footer]);",
    "writeFileSync('spark-install.exe', exe);",
    "writeFileSync('spark-install.ps1', payload);",
    "```",
    "",
    "## Python 做法",
    "",
    "```python",
    "import base64, json, pathlib",
    "kit = json.loads(pathlib.Path('spark-build.json').read_text(encoding='utf-8'))",
    "script = kit['windows']['script'].replace('\\r\\n', '\\n').replace('\\n', '\\r\\n')",
    "payload = b'\\xef\\xbb\\xbf' + script.encode('utf-8')",
    "footer = b'SPRK' + f'{len(payload):08d}'.encode('ascii') + b'\\n'",
    "exe = base64.b64decode(kit['windows']['stub']) + payload + footer",
    "pathlib.Path('spark-install.exe').write_bytes(exe)",
    "pathlib.Path('spark-install.ps1').write_bytes(payload)",
    "```",
    "",
    "## 验证",
    "",
    "- `spark-install.exe` 前两个字节是 `MZ`；",
    "- 最后 13 字节匹配 `SPRK\\d{8}\\n`；",
    "- 文件大小大于 100 KB。",
    "",
    "## 规则",
    "",
    "- 不要修改 `spark-build.json` 里的地址、用户名和端口，除非用户明确要求。",
    "- 不要上传 `spark-build.json`；它含内网地址和用户名，但不含密码或私钥。",
    "- 不要要求用户关闭整个安全防护；如果生成 exe 后被系统拦截，如实报告。",
    "- 构建完成后告诉用户：双击 `spark-install.exe`，按提示输入跳板机和 spark 密码；",
    "  安装完成后桌面会出现 Spark DSH，以后双击它使用。",
    "",
  ].join("\r\n");
  const readme = [
    "Spark DSH 本机构建包",
    "====================",
    "",
    "这个包不含 exe，也不含 PowerShell 构建脚本；只有配置、说明和 Markdown。",
    "把整个文件夹交给另一台电脑上的 agent，让它按 AGENTS.md 用 Node 或 Python 生成 exe。",
    "",
    "如果自己操作，直接对 agent 说：",
    "  请先读当前目录的 AGENTS.md，然后帮我构建一个 exe，直接打开就可以使用 dsh。",
    "",
    "配置摘要：",
    ...summaryLines(cfg).map((line) => "  " + line),
    "",
    "生成的 exe 仍然没有代码签名；本机生成通常不会带网络下载标记，",
    "但安全软件是否放行仍取决于本机策略。",
    "",
  ].join("\r\n");
  return makeZip(
    [
      {name: "spark-build.json", text: JSON.stringify(kit, null, 2) + "\n", mode: 0o644},
      {name: "AGENTS.md", text: agentGuide, mode: 0o644},
      {name: "README.txt", text: readme, mode: 0o644},
    ],
    generatedAt,
  );
}

export function installerWindowsZip(cfg, icons = {}, generatedAt = new Date()) {
  if (!icons.exe) throw new Error("Windows stub is missing");
  const script = windowsScript(cfg, icons);
  const exe = buildWindowsExe(icons.exe, script);
  return makeZip(
    [
      {name: "spark-install.exe", bytes: exe, mode: 0o755},
      {name: "spark-install.ps1", text: "\uFEFF" + script, mode: 0o644},
      {name: "README.txt", text: buildReadme(cfg, generatedAt), mode: 0o644},
    ],
    generatedAt,
  );
}

export function installerWindowsPs1Zip(cfg, icons = {}, generatedAt = new Date()) {
  return makeZip(
    [
      {name: "spark-install.ps1", text: windowsPs1(cfg, icons), mode: 0o644},
      {name: "README.txt", text: buildReadme(cfg, generatedAt), mode: 0o644},
    ],
    generatedAt,
  );
}

export function fileForOs(cfg, icons, os, generatedAt = new Date()) {
  const files = installerFiles(cfg, icons, generatedAt);
  if (os === "win") return files.find((f) => f.name === "spark-install.ps1");
  if (os === "linux") return files.find((f) => f.name.endsWith(".sh"));
  return files.find((f) => f.name.endsWith(".command"));
}
