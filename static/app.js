const token = document.querySelector('meta[name="lab-connect-token"]').content;
const form = document.getElementById("profileForm");
const consoleBox = document.getElementById("console");

function write(message, kind = "info") {
  const stamp = new Date().toLocaleTimeString();
  consoleBox.textContent += `\n[${stamp}] ${kind.toUpperCase()} ${message}`;
  consoleBox.scrollTop = consoleBox.scrollHeight;
}

function configFromForm() {
  const data = Object.fromEntries(new FormData(form).entries());
  for (const key of ["jump_port", "target_port", "local_port", "remote_service_port"]) {
    data[key] = Number(data[key]);
  }
  return data;
}

async function api(path, payload = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Lab-Connect-Token": token,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.output || `HTTP ${response.status}`);
  return data;
}

async function busy(button, task) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "处理中…";
  try {
    await task();
  } catch (error) {
    write(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function fillForm(config) {
  for (const [key, value] of Object.entries(config)) {
    const field = form.elements.namedItem(key);
    if (field) field.value = value;
  }
}

function showTunnel(result) {
  const running = Boolean(result.running);
  document.getElementById("stateDot").classList.toggle("online", running);
  document.getElementById("stateText").textContent = running ? "隧道运行中" : "隧道已停止";
  document.getElementById("stateDetail").textContent = result.output || "";
}

async function refreshState() {
  const state = await api("/api/state");
  fillForm(state.config);
  document.getElementById("platformBadge").textContent =
    `${state.platform} · Python ${state.python}`;
  showTunnel(state.tunnel);
}

document.querySelectorAll(".step").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".step").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    document.getElementById(button.dataset.panel).classList.add("active");
  });
});

document.getElementById("saveButton").addEventListener("click", (event) => {
  event.preventDefault();
  busy(event.currentTarget, async () => {
    if (!form.reportValidity()) return;
    const result = await api("/api/save", { config: configFromForm() });
    write(result.output, result.ok ? "success" : "error");
  });
});

document.getElementById("createKeyButton").addEventListener("click", (event) => {
  busy(event.currentTarget, async () => {
    const result = await api("/api/key/create", { config: configFromForm() });
    write(result.output, result.ok ? "success" : "error");
  });
});

for (const [buttonId, destination, passwordId] of [
  ["deployJumpButton", "jump", "jumpPassword"],
  ["deployTargetButton", "target", "targetPassword"],
]) {
  document.getElementById(buttonId).addEventListener("click", (event) => {
    busy(event.currentTarget, async () => {
      const input = document.getElementById(passwordId);
      const result = await api("/api/key/deploy", {
        config: configFromForm(),
        destination,
        password: input.value,
      });
      input.value = "";
      write(result.output, result.ok ? "success" : "error");
    });
  });
}

document.getElementById("diagnoseButton").addEventListener("click", (event) => {
  busy(event.currentTarget, async () => {
    const result = await api("/api/diagnose", { config: configFromForm() });
    const checks = document.getElementById("checks");
    checks.classList.remove("empty");
    checks.innerHTML = "";
    for (const check of result.checks) {
      const row = document.createElement("article");
      row.className = `check ${check.ok ? "pass" : "fail"}`;
      const title = document.createElement("strong");
      title.textContent = `${check.ok ? "通过" : "失败"} · ${check.name}`;
      const output = document.createElement("pre");
      output.textContent = check.output || "无输出";
      row.append(title, output);
      checks.append(row);
    }
    write("完整诊断已结束。", "success");
  });
});

for (const [buttonId, path] of [
  ["startButton", "/api/tunnel/start"],
  ["stopButton", "/api/tunnel/stop"],
  ["statusButton", "/api/tunnel/status"],
]) {
  document.getElementById(buttonId).addEventListener("click", (event) => {
    busy(event.currentTarget, async () => {
      const result = await api(path, { config: configFromForm() });
      showTunnel(result);
      write(result.output, result.ok ? "success" : "error");
    });
  });
}

document.getElementById("openButton").addEventListener("click", (event) => {
  busy(event.currentTarget, async () => {
    const result = await api("/api/client/open", { config: configFromForm() });
    write(result.output, result.ok ? "success" : "error");
  });
});

document.getElementById("downloadLogs").addEventListener("click", (event) => {
  event.preventDefault();
  fetch("/api/logs", { headers: { "X-Lab-Connect-Token": token } })
    .then((response) => response.blob())
    .then((blob) => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "lab-connect.log";
      link.click();
      URL.revokeObjectURL(link.href);
    });
});

document.getElementById("clearConsole").addEventListener("click", () => {
  consoleBox.textContent = "显示已清空，磁盘日志仍然保留。";
});

refreshState().catch((error) => write(error.message, "error"));
