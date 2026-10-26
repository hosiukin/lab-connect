// Pure configuration model for the Spark DSH installer.
// No DOM access here: this module is imported directly by tests.

export const DEFAULTS = Object.freeze({
  profile: "spark",
  mode: "jump", // jump | direct | chain
  jumpHost: "10.30.24.1",
  jumpPort: 22,
  jumpUser: "",
  sparkHost: "10.33.250.29",
  sparkPort: 22,
  sparkUser: "",
  chain: "",
  localPort: 18090,
  remotePort: 8090,
  keyFile: "~/.ssh/id_ed25519_spark",
  openAfterInstall: true,
});

export const LIMITS = Object.freeze({
  localPortMin: 1024,
  localPortMax: 65535,
});

export const BLOCK_START = "# >>> spark-dsh installer managed start >>>";
export const BLOCK_END = "# <<< spark-dsh installer managed end <<<";

const HOST_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,251})$/;
const USER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const CHAIN_RE = /^[A-Za-z0-9][A-Za-z0-9._@:-]*(?:\s*,\s*[A-Za-z0-9][A-Za-z0-9._@:-]*)*$/;

export function bytesToMiB(bytes) {
  const n = Number(bytes) || 0;
  return (n / (1024 * 1024)).toFixed(1);
}

/** Fill defaults and coerce numeric fields. Does not validate. */
export function withDefaults(input = {}) {
  const cfg = { ...DEFAULTS, ...input };
  const num = (value, fallback) =>
    value === undefined || value === null || value === "" ? fallback : Number(value);
  cfg.jumpPort = num(cfg.jumpPort, 22);
  cfg.sparkPort = num(cfg.sparkPort, 22);
  cfg.localPort = num(cfg.localPort, DEFAULTS.localPort);
  cfg.remotePort = num(cfg.remotePort, DEFAULTS.remotePort);
  if (cfg.sparkUser && !input.jumpUser) cfg.jumpUser = cfg.sparkUser;
  cfg.profile = String(cfg.profile || DEFAULTS.profile).trim();
  cfg.chain = String(cfg.chain || "").trim().replace(/\s*,\s*/g, ",");
  return cfg;
}

/**
 * Validate a normalized config. Returns {ok, errors, config}.
 * Error messages are Chinese and user-facing.
 */
export function validateFields(input = {}) {
  const cfg = withDefaults(input);
  const errors = [];
  const fields = {};
  const add = (field, message) => {
    errors.push(message);
    if (!fields[field]) fields[field] = message;
  };
  const require = (name, label) => {
    if (!String(cfg[name] || "").trim()) add(name, `请填写 ${label}`);
  };

  if (!PROFILE_RE.test(cfg.profile)) {
    add("profile", "名称只能使用字母、数字、点、下划线和短横线（不超过 32 个字符）");
  }
  require("sparkUser", "spark 用户名");
  if (cfg.sparkUser && !USER_RE.test(cfg.sparkUser)) add("sparkUser", "spark 用户名格式不正确");
  if (!cfg.sparkHost || !HOST_RE.test(cfg.sparkHost)) add("sparkHost", "spark 地址格式不正确");
  if (!byPort(cfg.sparkPort)) add("sparkPort", "spark SSH 端口必须是 1-65535");

  if (cfg.mode === "jump") {
    require("jumpUser", "跳板机用户名");
    if (!cfg.jumpHost || !HOST_RE.test(cfg.jumpHost)) add("jumpHost", "跳板机地址格式不正确");
    if (cfg.jumpUser && !USER_RE.test(cfg.jumpUser)) add("jumpUser", "跳板机用户名格式不正确");
    if (!byPort(cfg.jumpPort)) add("jumpPort", "跳板机端口必须是 1-65535");
  } else if (cfg.mode === "chain") {
    if (!cfg.chain || !CHAIN_RE.test(cfg.chain)) {
      add("chain", "自定义跳板链格式应为 user@host[:port]，多级用逗号分隔");
    }
  } else if (cfg.mode !== "direct") {
    add("mode", "未知的连接方式");
  }

  if (!byPort(cfg.localPort) || cfg.localPort < LIMITS.localPortMin) {
    add("localPort", `本地端口必须是 ${LIMITS.localPortMin}-65535（推荐 18090）`);
  }
  if (!byPort(cfg.remotePort)) add("remotePort", "远端端口必须是 1-65535");
  if (!String(cfg.keyFile || "").trim()) add("keyFile", "请填写 SSH 私钥路径");
  if (cfg.keyFile && /[\n\r\0]/.test(cfg.keyFile)) add("keyFile", "SSH 私钥路径包含非法字符");
  if (cfg.keyFile && /\s/.test(cfg.keyFile)) add("keyFile", "SSH 私钥路径不能包含空格");

  return { ok: errors.length === 0, errors, fields, config: cfg };
}

/** Validate a normalized config. Returns {ok, errors, fields, config}. */
export function validate(input = {}) {
  return validateFields(input);
}

function byPort(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

/** ~ expansion used by generated scripts (left untouched in display). */
export function expandKeyPath(keyFile, home = "~") {
  const value = String(keyFile || "").trim();
  if (value === "~") return home;
  if (value.startsWith("~/")) return `${home}${value.slice(1)}`;
  return value;
}

export function jumpAlias(cfg) {
  return `${cfg.profile}-jump`;
}

export function portalUrl(cfg) {
  return `http://127.0.0.1:${cfg.localPort}/`;
}

export function healthUrl(cfg) {
  return `http://127.0.0.1:${cfg.localPort}/healthz`;
}

/** OpenSSH config block. All values are validated before this is called. */
export function sshConfigBlock(cfg) {
  const common = [
    `    IdentityFile ${expandKeyPath(cfg.keyFile)}`,
    "    IdentitiesOnly yes",
    "    ServerAliveInterval 30",
    "    ServerAliveCountMax 6",
    "    TCPKeepAlive yes",
    "    StrictHostKeyChecking accept-new",
  ];
  const lines = [BLOCK_START];

  if (cfg.mode === "jump") {
    lines.push(
      `Host ${jumpAlias(cfg)}`,
      `    HostName ${cfg.jumpHost}`,
      `    Port ${cfg.jumpPort}`,
      `    User ${cfg.jumpUser}`,
      ...common,
      "",
    );
  }

  lines.push(
    `Host ${cfg.profile}`,
    `    HostName ${cfg.sparkHost}`,
    `    Port ${cfg.sparkPort}`,
    `    User ${cfg.sparkUser}`,
  );
  if (cfg.mode === "jump") {
    lines.push(`    ProxyJump ${jumpAlias(cfg)}`);
  } else if (cfg.mode === "chain") {
    lines.push(`    ProxyJump ${cfg.chain}`);
  }
  lines.push(
    ...common,
    "    ExitOnForwardFailure yes",
    "    ConnectTimeout 20",
    BLOCK_END,
    "",
  );
  return lines.join("\n");
}

/** Resolve which aliases must receive the public key during install. */
export function deployTargets(cfg) {
  if (cfg.mode === "jump") return [jumpAlias(cfg), cfg.profile];
  return [cfg.profile];
}

/** Human-readable one-screen summary, reused by UI and script banners. */
export function summaryLines(cfg) {
  const route = [];
  if (cfg.mode === "jump") route.push(`跳板 ${cfg.jumpUser}@${cfg.jumpHost}:${cfg.jumpPort}`);
  if (cfg.mode === "chain") route.push(`跳板链 ${cfg.chain}`);
  route.push(`spark ${cfg.sparkUser}@${cfg.sparkHost}:${cfg.sparkPort}`);
  return [
    `SSH 别名：${cfg.profile}`,
    `链路：${route.join("  →  ")}`,
    `隧道：127.0.0.1:${cfg.localPort} → spark 127.0.0.1:${cfg.remotePort}`,
    `桌面地址：${portalUrl(cfg)}`,
  ];
}

/** POSIX single-quote escaping. */
export function shq(value) {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

/** Double-quoted shell word where a leading ~ expands to $HOME at runtime. */
export function shellHomePath(keyFile, home = "$HOME") {
  const value = String(keyFile || "").trim();
  if (value.startsWith("~/")) {
    const rest = value.slice(2).replace(/["\\$`]/g, "\\$&");
    return `"${home}/${rest}"`;
  }
  return shq(value);
}

/** PowerShell single-quote escaping. */
export function psq(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

/** JSON literal safe to embed in a script (escapes closing tags for HTML). */
export function jsonLiteral(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}