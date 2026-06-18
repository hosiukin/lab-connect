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
  for (const key of ["jump_port", "target_port"]) {
    data[key] = Number(data[key]);
  }
  // direction from radio
  const dirRadio = document.querySelector('input[name="direction"]:checked');
  data.direction = dirRadio ? dirRadio.value : "forward";
  data.forwards = [...document.querySelectorAll(".forward-row")].map((row) => ({
    name: row.querySelector('[data-field="name"]').value.trim(),
    local_port: Number(row.querySelector('[data-field="local_port"]').value),
    remote_host: row.querySelector('[data-field="remote_host"]').value.trim(),
    remote_port: Number(row.querySelector('[data-field="remote_port"]').value),
    open_mode: row.querySelector('[data-field="open_mode"]').value,
    bind_host: row.querySelector('[data-field="bind_host"]')
      ? row.querySelector('[data-field="bind_host"]').value.trim() || "0.0.0.0"
      : "0.0.0.0",
  }));
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
  // direction radio
  const direction = config.direction || "forward";
  const radio = document.querySelector(`input[name="direction"][value="${direction}"]`);
  if (radio) radio.checked = true;
  applyDirection(direction);
  renderForwards(config.forwards || []);
}

function renderForwards(forwards) {
  const rows = document.getElementById("forwardRows");
  rows.innerHTML = "";
  forwards.forEach(addForward);
}

function addForward(forward = {}) {
  const isRev = currentDirection() === "reverse";
  const row = document.createElement("div");
  row.className = "forward-row";
  row.innerHTML = `
    <input data-field="name" aria-label="名称" placeholder="RDP 远程桌面">
    <input data-field="local_port" aria-label="${isRev ? "本机端口" : "本地端口"}" type="number" min="1" max="65535" placeholder="${isRev ? "3389" : "18080"}">
    <input data-field="remote_host" aria-label="${isRev ? "本机地址" : "目标侧地址"}" placeholder="127.0.0.1">
    <input data-field="remote_port" aria-label="${isRev ? "暴露端口(on jump)" : "远端端口"}" type="number" min="1" max="65535" placeholder="${isRev ? "13389" : "8080"}">
    <select data-field="open_mode" aria-label="打开方式">
      <option value="browser">浏览器</option>
      <option value="vnc">VNC</option>
      <option value="rdp">RDP</option>
      <option value="none">仅转发</option>
    </select>
    <button type="button" class="remove-forward danger" aria-label="删除">删除</button>
  `;
  for (const [key, value] of Object.entries({
    name: forward.name || "",
    local_port: forward.local_port || "",
    remote_host: forward.remote_host || "127.0.0.1",
    remote_port: forward.remote_port || "",
    open_mode: forward.open_mode || "browser",
  })) {
    const el = row.querySelector(`[data-field="${key}"]`);
    if (el) el.value = value;
  }
  // bind_host is hidden but present for reverse
  const bindInput = document.createElement("input");
  bindInput.type = "hidden";
  bindInput.setAttribute("data-field", "bind_host");
  bindInput.value = forward.bind_host || "0.0.0.0";
  row.appendChild(bindInput);
  row.querySelector(".remove-forward").addEventListener("click", () => row.remove());
  document.getElementById("forwardRows").append(row);
}

function currentDirection() {
  const radio = document.querySelector('input[name="direction"]:checked');
  return radio ? radio.value : "forward";
}

function applyDirection(direction) {
  const isRev = direction === "reverse";
  // Update profile panel: target fields optional in reverse
  document.getElementById("targetHostLabel").querySelector("input").required = !isRev;
  document.getElementById("targetPortLabel").querySelector("input").required = !isRev;
  document.getElementById("targetUserLabel").querySelector("input").required = !isRev;
  // Update target key card visibility
  const targetKeyCard = document.getElementById("targetKeyCard");
  if (targetKeyCard) targetKeyCard.style.display = isRev ? "none" : "";
  // Update forward-head column labels
  const head = document.getElementById("forwardHead");
  const colA = head.querySelector('[data-col="colA"]');
  const colB = head.querySelector('[data-col="colB"]');
  const colC = head.querySelector('[data-col="colC"]');
  if (isRev) {
    colA.textContent = "本机端口";
    colB.textContent = "本机地址";
    colC.textContent = "暴露端口";
  } else {
    colA.textContent = "本地端口";
    colB.textContent = "目标侧地址";
    colC.textContent = "远端端口";
  }
  // Update tunnel description
  const tunnelDesc = document.getElementById("tunnelDesc");
  tunnelDesc.textContent = isRev
    ? "反向转发将本机端口暴露到跳板机，实验室设备可通过跳板机访问本机。"
    : "所有转发通过目标 SSH Host 建立，可访问目标机上的 localhost 服务。";
  // Update hint
  const hint = document.getElementById("forwardHint");
  hint.innerHTML = isRev
    ? `例如暴露本机 RDP：本机端口 <code>3389</code>，本机地址 <code>127.0.0.1</code>，暴露端口 <code>13389</code>。启动后实验室通过 <code>跳板机:13389</code> 远程桌面。`
    : `例如 Spark 的 Web 服务：本地端口 <code>18080</code>，目标侧地址 <code>127.0.0.1</code>，远端端口 <code>8080</code>。启动后浏览器访问 <code>http://127.0.0.1:18080</code>。`;
  // Update preset labels
  const preset = document.getElementById("presetForward");
  for (const opt of preset.options) {
    if (opt.value === "rdp") {
      opt.textContent = isRev ? "反向 RDP · 3389→13389" : "RDP · 3389";
    } else if (opt.value === "vnc") {
      opt.textContent = isRev ? "反向 VNC · 5900→15901" : "VNC · 5900";
    }
  }
}

const forwardPresets = {
  web: { name: "Web 8080", local_port: 18080, remote_host: "127.0.0.1", remote_port: 8080, open_mode: "browser" },
  jupyter: { name: "Jupyter", local_port: 18888, remote_host: "127.0.0.1", remote_port: 8888, open_mode: "browser" },
  vllm: { name: "vLLM API", local_port: 18000, remote_host: "127.0.0.1", remote_port: 8000, open_mode: "browser" },
  vnc: { name: "Screen Sharing", local_port: 15901, remote_host: "127.0.0.1", remote_port: 5900, open_mode: "vnc" },
  rdp: { name: "Remote Desktop", local_port: 13389, remote_host: "127.0.0.1", remote_port: 3389, open_mode: "rdp" },
};

// Direction toggle handler
document.querySelectorAll('input[name="direction"]').forEach((radio) => {
  radio.addEventListener("change", () => applyDirection(radio.value));
});

document.getElementById("addForwardButton").addEventListener("click", () => addForward());
document.getElementById("presetForward").addEventListener("change", (event) => {
  if (event.target.value) {
    const preset = { ...forwardPresets[event.target.value] };
    // In reverse mode, swap displayed semantics for presets
    if (currentDirection() === "reverse") {
      // For RDP preset: swap local_port and remote_port (expose home's 3389 as jump's 13389)
      // Keep remote_host (home side) and adjust
      // The preset already has sensible values; we keep them as-is since
      // the field semantics change in reverse mode
    }
    addForward(preset);
  }
  event.target.value = "";
});

function showTunnel(result) {
  const running = Boolean(result.running);
  document.getElementById("stateDot").classList.toggle("online", running);
  document.getElementById("stateText").textContent = running ? "隧道运行中" : "隧道已停止";
  document.getElementById("stateDetail").textContent = result.output || "";
  const list = document.getElementById("endpointList");
  list.innerHTML = "";
  for (const [index, endpoint] of (result.endpoints || []).entries()) {
    const item = document.createElement("div");
    item.className = "endpoint";
    const text = document.createElement("div");
    text.innerHTML = `<strong></strong><code></code>`;
    text.querySelector("strong").textContent = endpoint.name;
    text.querySelector("code").textContent =
      `${endpoint.endpoint} → ${endpoint.remote_host}:${endpoint.local_port}`;
    const open = document.createElement("button");
    open.textContent = endpoint.open_mode === "none" ? "显示地址" : "打开";
    open.disabled = !running;
    open.addEventListener("click", () => busy(open, async () => {
      const response = await api("/api/client/open", {
        config: configFromForm(),
        forward_index: index,
      });
      write(response.output, response.ok ? "success" : "error");
    }));
    item.append(text, open);
    list.append(item);
  }
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
