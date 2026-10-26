// Generates the macOS / Linux installer and desktop launcher.
// String interpolation is deliberate: no shell ${...} expansions are used so
// the JavaScript template can stay readable.

import {
  BLOCK_START,
  BLOCK_END,
  healthUrl,
  jumpAlias,
  portalUrl,
  shq,
  sshConfigBlock,
  shellHomePath,
} from "./config.mjs";

const MARK_START = BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MARK_END = BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildUnixLauncher(cfg) {
  const alias = cfg.profile;
  const sock = `"$HOME/.ssh/${alias}-dsh-tunnel.sock"`;
  return `#!/usr/bin/env bash
# Spark DSH 桌面启动器 — 由 install.html 生成
# 每次双击：确保 SSH 隧道存在，然后打开 spark 门户（已登录会直接进入 DSH）。
set -u

PROFILE=${shq(alias)}
SOCK=${sock}
LOCAL_PORT=${shq(String(cfg.localPort))}
REMOTE_PORT=${shq(String(cfg.remotePort))}
URL=${shq(portalUrl(cfg))}
HEALTH=${shq(healthUrl(cfg))}
APP_HOME="$HOME/.spark-dsh"
LOG="$APP_HOME/launcher.log"

mkdir -p "$APP_HOME" 2>/dev/null || true
chmod 700 "$APP_HOME" 2>/dev/null || true

note() {
  printf '%s %s\\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG" 2>/dev/null || true
}

alert() {
  message=$(printf '%s' "$1" | tr '\n' ' ' | tr -d '"\\\\')
  note "ALERT: $message"
  if [ "$(uname -s)" = "Darwin" ]; then
    if command -v osascript >/dev/null 2>&1; then
      osascript -e 'display alert "Spark DSH" message "'"$message"'" as critical' >/dev/null 2>&1 && return 0
    fi
  fi
  if [ -n "\${DISPLAY:-}" ] && command -v zenity >/dev/null 2>&1; then
    zenity --error --title='Spark DSH' --text="$message" >/dev/null 2>&1 && return 0
  fi
  if command -v notify-send >/dev/null 2>&1; then
    notify-send 'Spark DSH' "$message" >/dev/null 2>&1 && return 0
  fi
  printf 'Spark DSH: %s\\n' "$message" >&2
}

open_url() {
  if [ "$(uname -s)" = "Darwin" ]; then
    open "$URL" >/dev/null 2>&1
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 &
  elif command -v gio >/dev/null 2>&1; then
    gio open "$URL" >/dev/null 2>&1 &
  else
    printf '请在浏览器打开：%s\\n' "$URL"
  fi
}

health_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -m 2 "$HEALTH" 2>/dev/null | grep -q '"ok"' && return 0
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$LOCAL_PORT" >/dev/null 2>&1 && return 0
  fi
  return 1
}

tunnel_ok() {
  [ -S "$SOCK" ] || return 1
  ssh -S "$SOCK" -O check "$PROFILE" >/dev/null 2>&1
}

wait_health() {
  i=0
  while [ "$i" -lt 30 ]; do
    health_ok && return 0
    sleep 1
    i=$((i + 1))
  done
  return 1
}

if health_ok; then
  note "隧道已就绪，直接打开"
  open_url
  exit 0
fi

if tunnel_ok; then
  note "已有隧道未监听当前端口，先停止旧隧道"
  ssh -S "$SOCK" -O exit "$PROFILE" >/dev/null 2>&1 || true
fi
rm -f "$SOCK" 2>/dev/null || true
note "建立隧道 127.0.0.1:$LOCAL_PORT -> 127.0.0.1:$REMOTE_PORT"
ssh -fNT -M -S "$SOCK" \\
    -o BatchMode=yes \\
    -o ExitOnForwardFailure=yes \\
    -o ConnectTimeout=20 \\
    -o ServerAliveInterval=30 \\
    -o ServerAliveCountMax=6 \\
    -o StrictHostKeyChecking=accept-new \\
    -L "127.0.0.1:$LOCAL_PORT:127.0.0.1:$REMOTE_PORT" \\
    "$PROFILE" >>"$LOG" 2>&1
rc=$?
if [ "$rc" -ne 0 ]; then
  note "ssh 退出码 $rc"
  alert "无法建立到 spark 的隧道（ssh 退出码 $rc）。
请确认：
1. EasyConnect 已连接；
2. 公钥已部署（重新运行安装器即可）；
3. 本地端口 $LOCAL_PORT 没有被占用。
详细日志：~/.spark-dsh/launcher.log"
  exit 2
fi

if wait_health; then
  note "隧道就绪，打开浏览器"
  open_url
else
  note "隧道已启动但服务未就绪"
  alert "隧道已建立，但 spark 门户没有响应。
可能是服务正在启动，请稍等 10 秒后再双击一次。
详细日志：~/.spark-dsh/launcher.log"
fi
`;
}

export function buildUnixInstaller(cfg, icons = {}) {
  const jumpLines =
    cfg.mode === "jump"
      ? `for alias in ${shq(jumpAlias(cfg))} ${shq(cfg.profile)}; do\n  deploy_key "$alias" || failed="$failed $alias"\ndone`
      : `deploy_key ${shq(cfg.profile)} || failed="$failed ${cfg.profile}"`;
  const iconB64 = icons.png || "";
  const launcher = buildUnixLauncher(cfg);

  return `#!/usr/bin/env bash
# Spark DSH 安装器 — 由 install.html 生成
# 配置：${cfg.profile} · ${cfg.mode}
# 作用：生成密钥、写入 ~/.ssh/config、部署公钥、创建桌面图标与隧道启动器。
set -u

PROFILE=${shq(cfg.profile)}
MODE=${shq(cfg.mode)}
JUMP_ALIAS=${shq(jumpAlias(cfg))}
JUMP_HOST=${shq(cfg.jumpHost)}
JUMP_PORT=${shq(String(cfg.jumpPort))}
JUMP_USER=${shq(cfg.jumpUser)}
SPARK_HOST=${shq(cfg.sparkHost)}
SPARK_PORT=${shq(String(cfg.sparkPort))}
SPARK_USER=${shq(cfg.sparkUser)}
CHAIN=${shq(cfg.chain)}
LOCAL_PORT=${shq(String(cfg.localPort))}
REMOTE_PORT=${shq(String(cfg.remotePort))}
URL=${shq(portalUrl(cfg))}
KEY_FILE=${shellHomePath(cfg.keyFile)}
SSH_CONFIG="$HOME/.ssh/config"
APP_HOME="$HOME/.spark-dsh"
LOG="$APP_HOME/install.log"
LAUNCH_SH="$APP_HOME/launch.sh"
OPEN_AFTER=${cfg.openAfterInstall ? "1" : "0"}

mkdir -p "$APP_HOME" 2>/dev/null || true
chmod 700 "$APP_HOME" 2>/dev/null || true
umask 077

log() {
  printf '%s\\n' "$*"
  printf '%s %s\\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG" 2>/dev/null || true
}

alert() {
  message=$(printf '%s' "$1" | tr '\n' ' ' | tr -d '"\\\\')
  if [ "$(uname -s)" = "Darwin" ]; then
    if command -v osascript >/dev/null 2>&1; then
      osascript -e 'display alert "Spark DSH 安装器" message "'"$message"'" as critical' >/dev/null 2>&1 && return 0
    fi
  fi
  if [ -n "\${DISPLAY:-}" ] && command -v zenity >/dev/null 2>&1; then
    zenity --error --title='Spark DSH 安装器' --text="$message" >/dev/null 2>&1 && return 0
  fi
  printf '错误：%s\\n' "$message" >&2
}

die() {
  log "错误：$*"
  alert "$*"
  exit 1
}

on_error() {
  code=$?
  alert "安装中断（退出码 $code）。日志：$LOG"
  exit "$code"
}
trap on_error INT TERM

command -v ssh >/dev/null 2>&1 || die "找不到 ssh。请先安装 OpenSSH 客户端。"
command -v ssh-keygen >/dev/null 2>&1 || die "找不到 ssh-keygen。请先安装 OpenSSH 客户端。"

log "== Spark DSH 安装器 =="
log "别名：$PROFILE；本地端口：$LOCAL_PORT"

# ---------------------------------------------------------------- 1. 密钥
case "$KEY_FILE" in
  "~/"*) KEY_FILE="$HOME/\${KEY_FILE#\\~/}" ;;
esac
KEY_DIR=$(dirname "$KEY_FILE")
mkdir -p "$KEY_DIR" 2>/dev/null || true
chmod 700 "$KEY_DIR" 2>/dev/null || true

if [ -f "$KEY_FILE" ]; then
  log "复用已有密钥：$KEY_FILE"
else
  log "生成新密钥：$KEY_FILE"
  ssh-keygen -q -t ed25519 -N '' -C "spark-dsh@$(hostname 2>/dev/null || echo local)" -f "$KEY_FILE" || die "生成密钥失败。"
fi
if [ ! -f "$KEY_FILE.pub" ]; then
  ssh-keygen -y -f "$KEY_FILE" >"$KEY_FILE.pub" || die "读取公钥失败。"
fi
chmod 600 "$KEY_FILE" 2>/dev/null || true
chmod 644 "$KEY_FILE.pub" 2>/dev/null || true

# ---------------------------------------------------------------- 2. SSH 配置
mkdir -p "$HOME/.ssh" 2>/dev/null || true
chmod 700 "$HOME/.ssh" 2>/dev/null || true
if [ -f "$SSH_CONFIG" ]; then
  backup="$APP_HOME/ssh-config.backup.$(date '+%Y%m%d-%H%M%S')"
  cp -p "$SSH_CONFIG" "$backup" 2>/dev/null || true
  log "已备份原 SSH 配置：$backup"
fi

block_file=$(mktemp "\${TMPDIR:-/tmp}/spark-ssh-block.XXXXXX") || die "无法创建临时文件。"
cat >"$block_file" <<'SPARK_SSH_BLOCK'
${sshConfigBlock(cfg)}SPARK_SSH_BLOCK

old_file=$(mktemp "\${TMPDIR:-/tmp}/spark-ssh-old.XXXXXX") || die "无法创建临时文件。"
if [ -f "$SSH_CONFIG" ]; then
  awk '/^${MARK_START}$/{skip=1;next} /^${MARK_END}$/{skip=0;next} !skip{print}' "$SSH_CONFIG" >"$old_file"
else
  : >"$old_file"
fi
new_file=$(mktemp "$HOME/.ssh/.spark-config.XXXXXX") || die "无法创建临时文件。"
cat "$block_file" "$old_file" >"$new_file"
mv "$new_file" "$SSH_CONFIG" || die "无法写入 SSH 配置：$SSH_CONFIG"
chmod 600 "$SSH_CONFIG" 2>/dev/null || true
rm -f "$block_file" "$old_file" 2>/dev/null || true
log "已写入 SSH 配置（别名：$PROFILE）"

# ---------------------------------------------------------------- 3. 部署公钥
key_works() {
  ssh -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=accept-new "$1" true >/dev/null 2>&1
}

deploy_key() {
  alias=$1
  if key_works "$alias"; then
    log "免密登录已可用：$alias"
    return 0
  fi
  log "为 $alias 部署公钥（接下来会提示输入该账号密码）"
  if command -v ssh-copy-id >/dev/null 2>&1; then
    ssh-copy-id -i "$KEY_FILE.pub" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "$alias" || return 1
  else
    ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "$alias" \\
      'umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; cat >> ~/.ssh/authorized_keys' \\
      <"$KEY_FILE.pub" || return 1
  fi
  key_works "$alias"
}

failed=""
${jumpLines}

if [ -n "$failed" ]; then
  log "公钥部署未完成：$failed"
  alert "以下账号还没有部署公钥：$failed
如果账号由医院门户管理，请把 $KEY_FILE.pub 的内容导入门户；然后重新运行安装器，或双击桌面图标重试。"
else
  log "公钥部署完成"
fi

# ---------------------------------------------------------------- 4. 桌面启动器
cat >"$LAUNCH_SH" <<'SPARK_LAUNCHER'
${launcher}SPARK_LAUNCHER
chmod 755 "$LAUNCH_SH" 2>/dev/null || true

ICON_B64=${shq(iconB64)}
ICON_PNG="$APP_HOME/spark-dsh.png"
if [ -n "$ICON_B64" ]; then
  printf '%s' "$ICON_B64" | base64 --decode >"$ICON_PNG" 2>/dev/null || \\
  printf '%s' "$ICON_B64" | base64 -D >"$ICON_PNG" 2>/dev/null || true
fi

DESKTOP_DIR="$HOME/Desktop"
if command -v xdg-user-dir >/dev/null 2>&1; then
  d=$(xdg-user-dir DESKTOP 2>/dev/null || true)
  [ -n "$d" ] && DESKTOP_DIR="$d"
fi

install_macos() {
  app="$HOME/Applications/Spark DSH.app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" 2>/dev/null || true
  cat >"$app/Contents/Info.plist" <<'SPARK_PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Spark DSH</string>
  <key>CFBundleDisplayName</key><string>Spark DSH</string>
  <key>CFBundleIdentifier</key><string>lab.spark.dsh.launcher</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSUIElement</key><true/>
</dict>
</plist>
SPARK_PLIST
  cp "$LAUNCH_SH" "$app/Contents/MacOS/launch" 2>/dev/null || true
  chmod 755 "$app/Contents/MacOS/launch" 2>/dev/null || true
  if [ -f "$ICON_PNG" ] && command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
    iconset="$APP_HOME/AppIcon.iconset"
    rm -rf "$iconset" 2>/dev/null || true
    mkdir -p "$iconset" 2>/dev/null || true
    for s in 16 32 128 256 512; do
      sips -z "$s" "$s" "$ICON_PNG" --out "$iconset/icon_$s""x$s.png" >/dev/null 2>&1 || true
    done
    sips -z 32 32 "$ICON_PNG" --out "$iconset/icon_16x16@2x.png" >/dev/null 2>&1 || true
    sips -z 64 64 "$ICON_PNG" --out "$iconset/icon_32x32@2x.png" >/dev/null 2>&1 || true
    sips -z 256 256 "$ICON_PNG" --out "$iconset/icon_128x128@2x.png" >/dev/null 2>&1 || true
    sips -z 512 512 "$ICON_PNG" --out "$iconset/icon_256x256@2x.png" >/dev/null 2>&1 || true
    sips -z 1024 1024 "$ICON_PNG" --out "$iconset/icon_512x512@2x.png" >/dev/null 2>&1 || true
    iconutil -c icns "$iconset" -o "$app/Contents/Resources/AppIcon.icns" >/dev/null 2>&1 || true
    rm -rf "$iconset" 2>/dev/null || true
  fi
  mkdir -p "$HOME/Desktop" 2>/dev/null || true
  ln -sfn "$app" "$HOME/Desktop/Spark DSH.app" 2>/dev/null || true
  log "桌面图标：$HOME/Desktop/Spark DSH.app"
}

install_linux() {
  mkdir -p "$HOME/.local/share/applications" "$HOME/.local/bin" 2>/dev/null || true
  icon_dir="$HOME/.local/share/icons/hicolor/256x256/apps"
  mkdir -p "$icon_dir" 2>/dev/null || true
  [ -f "$ICON_PNG" ] && cp "$ICON_PNG" "$icon_dir/spark-dsh.png" 2>/dev/null || true
  entry="$HOME/.local/share/applications/spark-dsh.desktop"
  cat >"$entry" <<SPARK_DESKTOP
[Desktop Entry]
Type=Application
Name=Spark DSH
Comment=打开 spark 服务器的 DSH 助手
Exec="$LAUNCH_SH"
Icon=$icon_dir/spark-dsh.png
Terminal=false
Categories=Development;Science;Education;
StartupNotify=false
SPARK_DESKTOP
  chmod 644 "$entry" 2>/dev/null || true
  if [ -d "$DESKTOP_DIR" ]; then
    cp "$entry" "$DESKTOP_DIR/spark-dsh.desktop" 2>/dev/null || true
    chmod 755 "$DESKTOP_DIR/spark-dsh.desktop" 2>/dev/null || true
    if command -v gio >/dev/null 2>&1; then
      gio set "$DESKTOP_DIR/spark-dsh.desktop" metadata::trusted true >/dev/null 2>&1 || true
    fi
    log "桌面图标：$DESKTOP_DIR/spark-dsh.desktop"
  fi
  ln -sfn "$LAUNCH_SH" "$HOME/.local/bin/spark-dsh" 2>/dev/null || true
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
}

if [ "$(uname -s)" = "Darwin" ]; then
  install_macos
else
  install_linux
fi

# ---------------------------------------------------------------- 5. 卸载脚本
cat >"$APP_HOME/uninstall.sh" <<'SPARK_UNINSTALL'
#!/usr/bin/env bash
set -u
APP_HOME="$HOME/.spark-dsh"
echo "将移除 Spark DSH 桌面入口、SSH 配置块、隧道和 ~/.spark-dsh，不删除密钥。"
if [ -e "$HOME/.ssh/${cfg.profile}-dsh-tunnel.sock" ]; then
  ssh -S "$HOME/.ssh/${cfg.profile}-dsh-tunnel.sock" -O exit "${cfg.profile}" >/dev/null 2>&1 || true
fi
rm -f "$HOME/.ssh/${cfg.profile}-dsh-tunnel.sock" 2>/dev/null || true
rm -rf "$HOME/Applications/Spark DSH.app" 2>/dev/null || true
rm -f "$HOME/Desktop/Spark DSH.app" 2>/dev/null || true
rm -f "$HOME/.local/share/applications/spark-dsh.desktop" 2>/dev/null || true
rm -f "$HOME/.local/bin/spark-dsh" 2>/dev/null || true
rm -f "$HOME/.local/share/icons/hicolor/256x256/apps/spark-dsh.png" 2>/dev/null || true
desktop_dir="$HOME/Desktop"
if command -v xdg-user-dir >/dev/null 2>&1; then
  d=$(xdg-user-dir DESKTOP 2>/dev/null || true)
  [ -n "$d" ] && desktop_dir="$d"
fi
rm -f "$desktop_dir/spark-dsh.desktop" 2>/dev/null || true
ssh_cfg="$HOME/.ssh/config"
if [ -f "$ssh_cfg" ]; then
  tmp="$ssh_cfg.spark-uninstall.$$"
  awk '/^${MARK_START}$/{skip=1;next} /^${MARK_END}$/{skip=0;next} !skip{print}' "$ssh_cfg" >"$tmp" && mv "$tmp" "$ssh_cfg"
  chmod 600 "$ssh_cfg" 2>/dev/null || true
fi
printf 'SSH 配置块已移除；密钥 %s 保留。\n' ${shq(cfg.keyFile)}
cd "$HOME" 2>/dev/null || true
rm -rf "$APP_HOME" 2>/dev/null || true
SPARK_UNINSTALL
chmod 755 "$APP_HOME/uninstall.sh" 2>/dev/null || true

# ---------------------------------------------------------------- 6. 打开
log "安装完成。"
if [ "$OPEN_AFTER" = "1" ]; then
  log "正在建立隧道并打开 spark 门户…"
  "$LAUNCH_SH" || true
else
  log "双击桌面图标即可打开。"
fi

log "如果门户要求登录，请输入你的 spark 用户名和密码（会话保持 12 小时）。"
log "详细日志：$APP_HOME/launcher.log"
exit 0
`;
}
