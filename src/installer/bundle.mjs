// Assembles the per-platform scripts and the universal zip.

import {makeZip} from "./zip.mjs";
import {buildUnixInstaller} from "./unix.mjs";
import {buildWindowsInstaller} from "./windows.mjs";
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
    "  1. 解压后打开 PowerShell，进入解压目录，运行：",
    "     powershell -NoProfile -ExecutionPolicy Bypass -File .\\spark-install.ps1",
    "  2. 不要双击 .ps1（默认会用记事本打开）。",
    "  3. 按提示输入跳板机、spark 账号密码（用于部署公钥）。",
    "  4. 安装完成后桌面出现 “Spark DSH”，以后双击即可。",
    "",
    "Linux",
    "-".repeat(48),
    "  1. 解压后运行：bash spark-install.sh",
    "  2. 按提示输入跳板机、spark 账号密码（用于部署公钥）。",
    "  3. 桌面出现 spark-dsh.desktop；双击前如提示“不受信任”，右键允许启动。",
    "  4. 以后从桌面或应用菜单打开 “Spark DSH”。",
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

export function installerFiles(cfg, icons = {}, generatedAt = new Date()) {
  const unix = buildUnixInstaller(cfg, icons);
  // PowerShell 5.1 treats BOM-less UTF-8 as ANSI; the BOM keeps the Chinese
  // prompts readable. This is a plain .ps1, with no .bat/.vbs wrapper.
  const win = "\uFEFF" + buildWindowsInstaller(cfg, icons).replace(/\r?\n/g, "\r\n");
  const files = [
    {name: "spark-install.command", text: unix, mode: 0o755},
    {name: "spark-install.sh", text: unix, mode: 0o755},
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

export function fileForOs(cfg, icons, os, generatedAt = new Date()) {
  const files = installerFiles(cfg, icons, generatedAt);
  if (os === "win") return files.find((f) => f.name === "spark-install.ps1");
  if (os === "linux") return files.find((f) => f.name.endsWith(".sh"));
  return files.find((f) => f.name.endsWith(".command"));
}
