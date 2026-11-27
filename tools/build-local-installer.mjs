#!/usr/bin/env node
// Build spark-install.exe from a self-contained spark-build.json.
// Useful for agents on macOS/Linux or Windows machines with Node installed.

import {readFileSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {buildWindowsExe} from "../src/installer/exe.mjs";

const args = process.argv.slice(2);
const configIndex = args.indexOf("--config");
const outIndex = args.indexOf("--out");
const configPath = configIndex >= 0 ? args[configIndex + 1] : "spark-build.json";
const outPath = outIndex >= 0 ? args[outIndex + 1] : "spark-install.exe";

if (!configPath) {
  console.error("用法: node tools/build-local-installer.mjs --config spark-build.json [--out spark-install.exe]");
  process.exit(2);
}

const kit = JSON.parse(readFileSync(configPath, "utf8"));
if (kit.schema !== "spark-dsh-local-build/v1") {
  console.error(`不支持的配置格式：${kit.schema}`);
  process.exit(2);
}
if (!kit.windows?.stub || typeof kit.windows.script !== "string") {
  console.error("配置缺少 windows.stub 或 windows.script");
  process.exit(2);
}

// buildWindowsExe adds the BOM and normalizes line endings; the kit stores the
// script without a BOM so both the EXE and the sidecar PS1 are correct.
const exe = buildWindowsExe(kit.windows.stub, kit.windows.script);
const out = resolve(outPath);
writeFileSync(out, exe);
const ps1 = out.replace(/\.exe$/i, "") + ".ps1";
writeFileSync(ps1, "\uFEFF" + kit.windows.script.replace(/\r?\n/g, "\r\n"));
console.log(`已生成：${out}  (${exe.length} 字节)`);
console.log(`同时保留可阅读脚本：${ps1}`);
