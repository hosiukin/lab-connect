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
    "  1. 解压后双击 spark-install.bat。",
    "  2. 若出现 SmartScreen：更多信息 → 仍要运行。",
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
    `  · 门户地址：${portalUrl(cfg)}（会话保持 12 小时）`,
    "  · 首次登录使用 spark 的 Linux 用户名和密码",
    "",
    "卸载",
    "-".repeat(48),
    "  macOS / Linux：运行 ~/.spark-dsh/uninstall.sh",
    "  Windows：运行 %LOCALAPPDATA%\\SparkDSH\\uninstall.bat，",
    "           再删除 %LOCALAPPDATA%\\SparkDSH 文件夹",
    "  卸载会移除 SSH 配置中的受管区块，但保留密钥文件。",
    "",
  ];
  return lines.join("\r\n");
}

export function installerFiles(cfg, icons = {}, generatedAt = new Date()) {
  const unix = buildUnixInstaller(cfg, icons);
  const win = buildWindowsInstaller(cfg, icons).replace(/\r?\n/g, "\r\n");
  return [
    {name: "spark-install.command", text: unix, mode: 0o755},
    {name: "spark-install.sh", text: unix, mode: 0o755},
    {name: "spark-install.bat", text: win, mode: 0o644},
    {name: "README.txt", text: buildReadme(cfg, generatedAt), mode: 0o644},
  ];
}

export function installerZip(cfg, icons = {}, generatedAt = new Date()) {
  return makeZip(installerFiles(cfg, icons, generatedAt), generatedAt);
}

export function fileForOs(cfg, icons, os, generatedAt = new Date()) {
  const files = installerFiles(cfg, icons, generatedAt);
  if (os === "win") return files.find((f) => f.name.endsWith(".bat"));
  if (os === "linux") return files.find((f) => f.name.endsWith(".sh"));
  return files.find((f) => f.name.endsWith(".command"));
}
