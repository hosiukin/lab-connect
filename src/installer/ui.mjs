// Browser UI. Kept DOM-only so the generator modules stay testable in Node.

import {withDefaults, validateFields} from "./config.mjs";
import {installerFiles, installerZip, fileForOs} from "./bundle.mjs";

const BUILD_TIME = "__BUILD_TIME__";
const STORAGE_KEY = "spark-dsh-installer-v2";
const ICONS = globalThis.SPARK_ICONS || {};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  form: $("#installer-form"),
  errors: $("#errors"),
  chip: $("#valid-chip"),
  summary: $("#summary"),
  hint: $("#os-hint"),
  toast: $("#toast"),
  jumpFields: $("#jump-fields"),
  chainField: $("#chain-field"),
  localPort: $("#localPort"),
  profile: $("#profile"),
};

const state = {
  os: "mac",
  showErrors: false,
  timer: 0,
};

const FIELD_IDS = [
  "profile",
  "jumpHost",
  "jumpPort",
  "jumpUser",
  "sparkHost",
  "sparkPort",
  "sparkUser",
  "chain",
  "localPort",
  "keyFile",
];

function detectOs() {
  const ua = navigator.userAgent || "";
  if (/Windows|Win32|Win64/i.test(ua)) return "win";
  if (/Mac OS X|Macintosh|iPhone|iPad/i.test(ua)) return "mac";
  return "linux";
}

function setOs(os, remember = true) {
  if (!["mac", "win", "linux"].includes(os)) os = detectOs();
  state.os = os;
  $$("#os-tabs button").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.os === os));
  });
  const hints = {
    mac: "将使用 spark-install.command。首次运行请右键 → 打开；或在终端 chmod +x 后运行。",
    win: "将使用 spark-install.bat。SmartScreen 提示时选“更多信息 → 仍要运行”。",
    linux: "将使用 spark-install.sh。终端运行 bash spark-install.sh 即可。",
  };
  els.hint.textContent = hints[os];
  if (remember) save();
}

function readForm() {
  return withDefaults({
    profile: $("#profile").value.trim(),
    mode: $('input[name="mode"]:checked')?.value || "jump",
    jumpHost: $("#jumpHost").value.trim(),
    jumpPort: $("#jumpPort").value,
    jumpUser: $("#jumpUser").value.trim(),
    sparkHost: $("#sparkHost").value.trim(),
    sparkPort: $("#sparkPort").value,
    sparkUser: $("#sparkUser").value.trim(),
    chain: $("#chain").value.trim(),
    localPort: $("#localPort").value,
    keyFile: $("#keyFile").value.trim(),
    openAfterInstall: $("#openAfterInstall").checked,
  });
}

function writeForm(config) {
  const cfg = withDefaults(config);
  $("#profile").value = cfg.profile;
  $("#jumpHost").value = cfg.jumpHost;
  $("#jumpPort").value = cfg.jumpPort;
  $("#jumpUser").value = cfg.jumpUser || cfg.sparkUser;
  $("#sparkHost").value = cfg.sparkHost;
  $("#sparkPort").value = cfg.sparkPort;
  $("#sparkUser").value = cfg.sparkUser;
  $("#chain").value = cfg.chain;
  $("#localPort").value = cfg.localPort;
  $("#keyFile").value = cfg.keyFile;
  $("#openAfterInstall").checked = cfg.openAfterInstall;
  const radio = $(`input[name="mode"][value="${cfg.mode}"]`);
  if (radio) radio.checked = true;
}

function save() {
  try {
    const cfg = readForm();
    const raw = {
      profile: cfg.profile,
      mode: cfg.mode,
      jumpHost: cfg.jumpHost,
      jumpPort: cfg.jumpPort,
      jumpUser: cfg.jumpUser,
      sparkHost: cfg.sparkHost,
      sparkPort: cfg.sparkPort,
      sparkUser: cfg.sparkUser,
      chain: cfg.chain,
      localPort: cfg.localPort,
      keyFile: cfg.keyFile,
      openAfterInstall: cfg.openAfterInstall,
      os: state.os,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
  } catch {
    /* private mode / file:// restrictions: ignore */
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    writeForm(data);
    if (["mac", "win", "linux"].includes(data.os)) state.os = data.os;
    return data;
  } catch {
    return null;
  }
}

function setSummary(cfg) {
  const route = [];
  if (cfg.mode === "jump") route.push(`${cfg.jumpUser || "?"}@${cfg.jumpHost || "?"}`);
  if (cfg.mode === "chain") route.push(cfg.chain || "?");
  route.push(`${cfg.sparkUser || "?"}@${cfg.sparkHost || "?"}`);
  const rows = [
    ["SSH 别名", cfg.profile || "spark"],
    ["链路", route.join("  →  ")],
    ["本地隧道", `127.0.0.1:${cfg.localPort || "?"} → ${cfg.remotePort}`],
    ["桌面图标", "Spark DSH"],
  ];
  els.summary.innerHTML = rows
    .map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function render() {
  const cfg = readForm();
  const result = validateFields(cfg);

  els.jumpFields.hidden = cfg.mode !== "jump";
  els.chainField.hidden = cfg.mode !== "chain";
  setSummary(cfg);

  els.chip.textContent = result.ok ? "可以生成" : "还需检查";
  els.chip.classList.toggle("ok", result.ok);

  if (state.showErrors && !result.ok) {
    els.errors.hidden = false;
    els.errors.innerHTML = result.errors.map((message) => `<p>· ${escapeHtml(message)}</p>`).join("");
  } else {
    els.errors.hidden = true;
    els.errors.innerHTML = "";
  }

  for (const id of FIELD_IDS) {
    const input = document.getElementById(id);
    if (!input) continue;
    if (state.showErrors && result.fields[id]) {
      input.setAttribute("aria-invalid", "true");
    } else {
      input.removeAttribute("aria-invalid");
    }
  }
  return {cfg, result};
}

function toast(message, kind = "ok", duration = 4200) {
  window.clearTimeout(state.timer);
  els.toast.textContent = message;
  els.toast.classList.toggle("err", kind === "err");
  els.toast.hidden = false;
  state.timer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, duration);
}

function download(bytes, filename, mime) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function downloadZip() {
  const { cfg, result } = render();
  if (!result.ok) {
    state.showErrors = true;
    render();
    els.errors.scrollIntoView({ behavior: "smooth", block: "center" });
    toast("还有必填项没填好，请看红色提示。", "err");
    return;
  }
  save();
  const zip = installerZip(cfg, ICONS);
  download(zip, "spark-dsh-installer.zip", "application/zip");
  toast("安装包已生成。解压后双击 spark-install." + (state.os === "win" ? "bat" : state.os === "linux" ? "sh" : "command"), "ok", 6000);
}

function downloadSingle(os) {
  const { cfg, result } = render();
  if (!result.ok) {
    state.showErrors = true;
    render();
    els.errors.scrollIntoView({ behavior: "smooth", block: "center" });
    toast("请先补全连接信息。", "err");
    return;
  }
  save();
  const file = fileForOs(cfg, ICONS, os);
  download(file.text, file.name, "text/plain;charset=utf-8");
  if (os === "mac" || os === "linux") {
    toast(`已下载 ${file.name}。若双击没反应，先在终端执行：chmod +x ~/Downloads/${file.name}`, "ok", 9000);
  } else {
    toast("已下载 spark-install.bat。若被 SmartScreen 拦截，请选“更多信息 → 仍要运行”。", "ok", 8000);
  }
}

async function copyText(text, message = "已复制到剪贴板") {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    try {
      document.execCommand("copy");
      toast(message);
    } catch {
      toast("复制失败，请手动选择文本。", "err");
    }
    area.remove();
  }
}

function manualCommand() {
  if (state.os === "win") {
    return 'cd /d "%USERPROFILE%\\Downloads"\nspark-install.bat';
  }
  const file = state.os === "linux" ? "spark-install.sh" : "spark-install.command";
  return `chmod +x ~/Downloads/${file}\n~/Downloads/${file}`;
}

function bind() {
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    downloadZip();
  });

  els.form.addEventListener("input", () => {
    render();
    save();
  });
  els.form.addEventListener("change", () => {
    render();
    save();
  });

  // Most users use the same account on the jump host and spark. Fill it in
  // until they deliberately type a different one.
  $("#sparkUser").addEventListener("input", () => {
    const sparkUser = $("#sparkUser").value.trim();
    const jumpUser = $("#jumpUser");
    if (sparkUser && !jumpUser.value.trim()) jumpUser.value = sparkUser;
  });

  $$("#os-tabs button").forEach((button) => {
    button.addEventListener("click", () => setOs(button.dataset.os));
  });

  $$("[data-single]").forEach((button) => {
    button.addEventListener("click", () => downloadSingle(button.dataset.single));
  });

  $("#btn-copy").addEventListener("click", () => copyText(manualCommand(), "安装命令已复制"));

  $$(".prompt").forEach((button) => {
    button.addEventListener("click", () => copyText(button.dataset.prompt, "已复制，打开 DSH 后直接粘贴"));
  });

  $("#copy-first").addEventListener("click", () =>
    copyText("列出内置数据集，并告诉我 braf_n316 有哪些字段。", "已复制，打开 DSH 后粘贴"),
  );

  window.addEventListener("beforeunload", save);

  // Arrow-key navigation for the OS tabs.
  $("#os-tabs").addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const tabs = $$("#os-tabs button");
    const index = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
    const next = (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    setOs(tabs[next].dataset.os);
    tabs[next].focus();
    event.preventDefault();
  });
}

function init() {
  const stored = load();
  const params = new URLSearchParams(location.search);
  const requested = params.get("os");
  setOs(["mac", "win", "linux"].includes(requested) ? requested : stored?.os || detectOs(), false);
  bind();
  render();
  const stamp = new Date(BUILD_TIME);
  const label = Number.isNaN(stamp.getTime())
    ? "本地生成 · 不联网"
    : `构建于 ${stamp.toLocaleDateString("zh-CN")}`;
  const buildEl = $("#build-time");
  if (buildEl) buildEl.textContent = label;
}

init();
