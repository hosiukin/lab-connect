# Spark DSH 安装器

给实验室新同学的一键安装包：配置一次 SSH，以后在桌面双击 **Spark DSH**，自动建立隧道并打开 spark 服务器上的 DSH。内置数据集和技能已经准备好，打开就能问。

> **直接打开：[install.html](install.html)**（约 450 KB，单文件，离线可用）
>
> 这个页面会根据你的系统生成安装脚本，不收集密码；基础安装不需要管理员权限（可选的 iPad 网关需要一次管理员放行）。

---

## 它解决什么问题

实验室的 spark 服务器在 EasyConnect 后面，需要经过跳板机：

```text
你的电脑 → EasyConnect → 10.30.24.1（跳板） → 10.33.250.29（spark）
```

手动做法是每次开终端、敲 `ssh -L`、再开浏览器。这个安装器把这一步固定下来：

1. 生成 ed25519 密钥，写入 `~/.ssh/config` 的受管区块；
2. 把公钥部署到跳板机和 spark（按提示输入对应账号的密码）；
3. 创建桌面图标和启动器；
4. 以后双击图标：检查隧道 → 需要时重建 → 打开 `http://127.0.0.1:18090/`。

门户会话保持 12 小时，期间双击直接进入 DSH；过期后重新输入一次 spark 密码即可。

## 30 秒开始

### 1. 准备

- 连上 **EasyConnect**（直连模式除外）；
- 知道自己的 **spark 用户名**和密码（就是登录 spark Linux 的账号）；
- 知道**跳板机用户名**（通常与 spark 用户名相同）；
- 电脑上已有 OpenSSH 客户端（macOS / Linux 自带；Windows 10/11 通常自带）。

### 2. 生成安装包

打开 [install.html](install.html)，填写：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| spark 用户名 | 空 | 必填，例如 `zhangsan` |
| 跳板机用户名 | 跟随 spark | 一般相同 |
| 跳板机地址 | `10.30.24.1` | 医院跳板机 |
| spark 地址 | `10.33.250.29` | 实验室服务器 |
| SSH 别名 | `spark` | 终端里 `ssh spark` 使用 |
| 本地端口 | `18090` | 被占用时改成 18091 等 |
| SSH 私钥 | `~/.ssh/id_ed25519_spark` | 不存在会自动生成 |

点 **下载通用安装包**，得到一个 zip；也可以按系统下载。Windows 推荐直接下载 `.exe`，双击即可，不需要解压或打开 PowerShell；macOS / Linux 下载的 zip 保留了双击执行权限。

### 3. 运行安装脚本

解压后，按系统运行对应文件：

| 系统 | 文件 | 首次运行注意 |
| --- | --- | --- |
| macOS | `spark-install.command` | 双击；若被 Gatekeeper 拦截，右键 → 打开 |
| Windows | `spark-install.exe` | 双击；若 SmartScreen 拦截，点“更多信息 → 仍要运行” |
| Linux | `spark-install.desktop` | 解压后双击；若提示“不受信任”，右键允许启动 |
| Windows（备用） | `spark-install.ps1` | 不要双击；在 PowerShell 中运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\spark-install.ps1` |
| Linux（备用） | `spark-install.sh` | 终端运行 `bash spark-install.sh` |

Windows 不再生成 `.bat` 或 `.vbs`。`.exe` 是一个很小的 NSIS 启动器，加上你的配置后生成的 PowerShell 安装内容；它不调用 `cmd.exe`，也不使用批处理或 VBScript。这个 exe 没有代码签名，所以首次运行可能出现 SmartScreen 提示；如果单位安全中心直接隔离，请把文件加入排除项或让管理员放行，不要关闭整个防护。

脚本会提示输入跳板机和 spark 的密码，用于把公钥追加到服务器。**密码只在 ssh 的交互提示里输入，安装器不会读取或保存。**

### 4. 双击桌面图标

安装完成后桌面出现 **Spark DSH**：

- macOS：`~/Applications/Spark DSH.app`，桌面有同名软链接；
- Windows：桌面和开始菜单的 `Spark DSH.lnk`；
- Linux：`~/.local/share/applications/spark-dsh.desktop`，桌面副本和 `~/.local/bin/spark-dsh`。

双击后浏览器打开 `http://127.0.0.1:18090/`。第一次需要登录 spark 门户（Linux 用户名 + 密码）；之后 12 小时内直接进入 DSH。

## iPad 访问：用常开的 Windows 电脑做网关

iPadOS 不能运行安装器里的 `.command` / `.exe` / `.ps1` / `.sh`，但可以把一台常开的 Windows 电脑当成局域网网关：

```text
iPad Safari ──同一 Wi-Fi──> Windows 10.0.0.50:18091
                                   │ portproxy
                                   ▼
                         127.0.0.1:18090（Spark DSH 隧道）
                                   │ SSH
                                   ▼
                         spark 上的 127.0.0.1:8090
```

### 1. 在 Windows 上正常安装

用 [install.html](install.html) 生成 Windows 安装包并运行，确认双击桌面的 **Spark DSH** 后，本机浏览器能打开 `http://127.0.0.1:18090/`。

### 2. 运行网关脚本

通用 ZIP 里带有 `spark-ipad-gateway.ps1`。解压后，在 Windows 上打开 **管理员 PowerShell**，进入解压目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\spark-ipad-gateway.ps1
```

也可以在资源管理器里右键脚本 → **使用 PowerShell 运行**；若双击被记事本打开，就按上面的命令执行。脚本发现没有管理员权限时会自动请求 UAC。它会：

- 用 Windows 自带的 `portproxy` 增加 `0.0.0.0:18091 → 127.0.0.1:18090`；
- 增加只允许 **本地子网** 的防火墙规则；
- 打印并写入 `%LOCALAPPDATA%\SparkDSH\ipad-urls.txt`。

**为什么是 18091**：18090 已经被 SSH 隧道占用，不能再让 portproxy 监听同一个端口；iPad 访问 18091，Windows 再把它转到 18090。

### 3. iPad 打开

让 iPad 和 Windows 连同一个 Wi-Fi / 局域网，在 Safari 打开脚本打印的地址，例如：

```text
http://192.168.1.50:18091/
```

用 spark 的 Linux 用户名和密码登录即可。可点 Safari 的 **分享 → 添加到主屏幕**，以后像 App 一样打开。

### 4. 保持可用

- Windows 电源设置里关闭睡眠，或至少设置“接通电源时永不休眠”；
- EasyConnect 要保持连接；VPN 断开后，SSH 隧道需要重新双击 **Spark DSH**；
- 把桌面的 **Spark DSH** 快捷方式复制到 `shell:startup`，登录 Windows 后自动建立隧道；
- 如果 Windows 的当前网络被识别为“公用网络”，防火墙规则不会生效；改成“专用网络”，或确认脚本的 `Private,Domain` 配置；
- iPad 用蜂窝网络、访客 Wi-Fi（开启 AP 隔离）或不同子网时无法访问。

### 5. 撤销

```powershell
powershell -ExecutionPolicy Bypass -File .\spark-ipad-gateway.ps1 -Remove
```

只删除 18091 的 portproxy 和防火墙规则，不影响 Spark DSH 本身的隧道。

> 安全边界：18091 只允许本地子网访问，门户仍然需要登录；不要在路由器上把 18091 映射到公网，也不要在不可信的 Wi-Fi 上开启。局域网内是 HTTP 明文，只适合可信的院内 / 家庭网络。

## 三种连接方式

| 模式 | 适用场景 | 行为 |
| --- | --- | --- |
| **EasyConnect + 跳板机**（默认） | 医院网络的标准方式 | spark 走 `ProxyJump spark-jump`，先连 `10.30.24.1` |
| **直连 spark** | 已在实验室内网，或 VPN 直接路由到 spark | 不写跳板机配置，直接连 spark |
| **自定义跳板链** | 多级跳板 / 特殊网络 | 按 OpenSSH `ProxyJump` 语法填写，例如 `alice@10.30.24.1:22, alice@10.30.24.2` |

自定义跳板链需要你自行确保每一跳都已部署公钥；安装器只部署最后 spark 账号的公钥。

> **实验室其他电脑仍走跳板机**：默认模式就是 EasyConnect + `10.30.24.1`，安装器会把 `ProxyJump` 写进 `~/.ssh/config`。只有在实验室内网且已经能直接路由到 spark 时，才选“直连 spark”；不要因为某台机器曾经直连成功就改掉其他电脑的默认配置。

## 安装器写了什么

全部在用户目录，不需要管理员权限：

```text
~/.ssh/config                         带标记的受管配置块（可重复运行）
~/.ssh/id_ed25519_spark               新生成的私钥（权限 600）
~/.ssh/id_ed25519_spark.pub           公钥
~/.spark-dsh/launch.sh                启动器（macOS / Linux）
~/.spark-dsh/uninstall.sh             卸载脚本
~/.spark-dsh/install.log              安装日志
~/.spark-dsh/launcher.log             隧道与打开浏览器的日志
```

Windows：

```text
%LOCALAPPDATA%\SparkDSH\launch.ps1
%LOCALAPPDATA%\SparkDSH\stop-tunnel.ps1
%LOCALAPPDATA%\SparkDSH\uninstall.ps1
%LOCALAPPDATA%\SparkDSH\spark-dsh.ico
%LOCALAPPDATA%\SparkDSH\install.log
%LOCALAPPDATA%\SparkDSH\launcher.log
```

SSH 配置块使用固定标记：

```text
# >>> spark-dsh installer managed start >>>
...
# <<< spark-dsh installer managed end <<<
```

重复运行安装器会替换这一块，不会动你已有的其他 `Host`。写入前会备份为 `ssh-config.backup.<时间戳>`。

## 打开之后：内置数据

这些数据在 spark 上，工作区已经挂好符号链接，**不需要下载到本机**：

| 数据集 | 规模 | 内容 |
| --- | --- | --- |
| `braf_n316` | 316 例 · 4.2 MB | 黑色素瘤队列，临床、病理、BRAF 突变 |
| `crc_full` | 25,427 例 · 1.5 GB | 结直肠癌完整导出，队列筛选与基线分析 |
| `n25427` | 25,427 例 · 22 张表 · 2.2 GB | 住院、门诊、检验、病理、影像等原始 HIS 导出 |
| `followup` | 25,427 × 37 | 结局、生存时间、删失与质控字段 |
| `research.sqlite` | 3.4 GB | 规范化的 `patient_timeline` 表，主键 `patient_sn`，可直接 SQL |

原始路径在 `/srv/spark-shared/datasets/`，SQLite 在 `/srv/spark-work/.spark-shared-datasets/n25427/research.sqlite`。DSH 的 `spark-datasets` 技能知道这些路径和表结构。

第一次打开可以问：

> 列出内置数据集，并告诉我 braf_n316 有哪些字段。

还可以让 DSH：

- 用 `braf_n316` 统计 BRAF 突变与临床分期的关系；
- 从 `research.sqlite` 筛选 2018 年后确诊、随访完整的 CRC 患者；
- 把 `n25427` 的病理表和随访表按 `patient_sn` 关联，导出 CSV；
- 做病历读取、病史结构化提取（`dprlab-reading` 技能）。

## 日常使用

- **打开**：双击桌面 **Spark DSH**。启动器会先检查 `127.0.0.1:18090/healthz`，已有隧道就直接开浏览器，没有就重建。
- **终端 SSH**：`ssh spark`（别名可在安装器里改）。
- **停止隧道**：macOS / Linux 运行 `~/.spark-dsh/uninstall.sh` 会停止隧道并移除桌面入口；只想停隧道可以 `ssh -S ~/.ssh/spark-dsh-tunnel.sock -O exit spark`。
- **换端口**：改本地端口后重新生成并运行安装包；旧隧道会被新启动器替换。
- **多台电脑**：每台电脑各生成一次；公钥可以复用，也可以让安装器生成新的。

## 卸载

macOS / Linux：

```bash
~/.spark-dsh/uninstall.sh
```

它会停止隧道、移除桌面 / 开始菜单入口、删除 `~/.spark-dsh` 和 SSH 配置块，但保留密钥。

Windows（在 PowerShell 中运行，不要双击 `.ps1`）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\SparkDSH\uninstall.ps1"
```

它会停止隧道、删除桌面和开始菜单快捷方式、移除 `~/.ssh/config` 的受管区块。最后手动删除 `%LOCALAPPDATA%\SparkDSH` 文件夹。卸载**保留密钥**，方便以后重装。

## 常见问题

### macOS 提示“无法验证开发者”，或双击没反应

Finder 里右键安装脚本 → **打开** → 再点 **打开**。仍被拦截时，到 **系统设置 → 隐私与安全性** 点 **仍要打开**；或：

```bash
xattr -dr com.apple.quarantine ~/Downloads/spark-install.command
chmod +x ~/Downloads/spark-install.command
~/Downloads/spark-install.command
```

桌面 App 同理。公司 MDM 禁止运行未签名脚本时，需要走管理员白名单。

### Windows 安装包被 SmartScreen / 安全中心拦截

Windows 入口推荐 `spark-install.exe`（双击），备用是纯文本 `spark-install.ps1`。两者都不再包含 `.bat` / `.vbs`，也不调用 `cmd.exe`。exe 未做代码签名，首次运行 SmartScreen 可能提示：点“更多信息 → 仍要运行”。如果单位安全中心隔离 exe，把文件加入排除项或让管理员放行，不要关闭整个防护。

使用 PS1 备用入口时，如果执行策略阻止：

```powershell
Unblock-File .\spark-install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\spark-install.ps1
```

若安全中心直接隔离文件，把 `spark-install.ps1` 加入排除项，或让管理员放行；不要关闭整个防护。只有单位策略完全禁止 PowerShell 脚本时，才考虑 WSL 里的 Linux 脚本。

### ssh 退出码 255 / 连接超时

先确认 EasyConnect 已连接，浏览器能打开院内地址；再确认跳板机地址和端口。日志：

- macOS / Linux：`~/.spark-dsh/launcher.log`
- Windows：`%LOCALAPPDATA%\SparkDSH\launcher.log`

### 显示“复用已有密钥”，但提示密钥错误

新版安装器会先校验私钥能否用空口令读取，并把 `.pub` 和私钥重新比对：

- 如果默认路径 `~/.ssh/id_ed25519_spark` 的私钥损坏或带口令，安装器会把它备份成 `id_ed25519_spark.bak.<时间>`，然后自动生成新的 spark 专用密钥；
- 如果只是 `.pub` 过期或不匹配，安装器会用私钥重新生成 `.pub`，不会覆盖私钥；
- 从别的电脑拷来的私钥如果权限过宽，安装器会先收紧权限（macOS / Linux 为 `chmod 600`，Windows 限制 ACL）再验证；
- 如果私钥路径是你自定义的，安装器不会擅自覆盖。请换一个新路径，或先去掉口令：

```bash
ssh-keygen -p -N '' -f ~/.ssh/id_ed25519_spark
```

重新运行安装器后，旧的 `.pub` 不会再被拿去部署。

### Permission denied (publickey)

公钥没有部署成功。把 `~/.ssh/id_ed25519_spark.pub` 的内容导入医院门户的 SSH 公钥设置，或重新运行安装器并输入密码。不要删除私钥。

### 本地端口 18090 被占用

```bash
# macOS / Linux
lsof -nP -iTCP:18090 -sTCP:LISTEN
# Windows
netstat -ano | findstr 18090
```

关掉占用的程序，或在安装器里换一个本地端口（如 18091）重新生成。

### 登录后又回到登录页

用 spark 的 **Linux 用户名和密码**，不是工号或邮箱。Cookie 有效期 12 小时；清除浏览器 Cookie、换浏览器或无痕窗口后需要重新登录。确认浏览器地址是 `127.0.0.1:18090`，不是 `8090`。

### Linux 桌面图标提示“不受信任”

右键图标 → **允许启动**，或：

```bash
gio set ~/Desktop/spark-dsh.desktop metadata::trusted true
chmod +x ~/Desktop/spark-dsh.desktop
```

### 需要管理员权限吗？会上传患者数据吗？

基础安装不需要管理员权限，所有文件都在用户目录；只有可选的 iPad 网关需要管理员添加防火墙规则。数据始终留在 spark 服务器，本机只建立 SSH 隧道。安装器和启动器不会把数据发到院外，也不会收集密码。

## 安全说明

- 安装器是单文件静态 HTML，不上传输入、不埋点；生成的脚本只包含地址、用户名、端口和公钥路径。
- 密码由 `ssh` / `ssh-copy-id` 在终端直接询问，不进入脚本、日志或浏览器存储。
- Unix 上私钥权限 `600`、`.ssh` 目录 `700`；SSH 配置块外的内容不会被修改。
- 门户 Cookie 是 `HttpOnly`、`SameSite=Lax`，有效期 12 小时。
- 卸载保留密钥，避免影响其他使用同一密钥的服务器；确认不再需要时可手动删除。

## 发布这个页面

`install.html` 是自包含的，可以直接用微信 / 邮件发给同事，也可以放到任意静态托管。

仓库内置了 GitHub Pages 工作流：推送到 `main` 后，在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**，之后每次改动会自动构建、跑测试并发布。发布地址形如：

```text
https://<你的 GitHub 用户名>.github.io/lab-connect/
```

如果不想用 Pages，也可以把 `install.html` 放到院内共享盘或门户静态目录；它不需要任何外部资源。

## 开发

```bash
# 重新生成 install.html
python3 build_installer.py

# 生成器单元测试（Node 18+）
node --test tests/generator.test.mjs

# 单文件完整性 + Unix 安装器端到端测试
python3 -m unittest discover -s tests -v
```

目录：

```text
install.html                 构建产物，提交到仓库，可直接分发
build_installer.py           把 CSS / JS / 图标内联成单文件
src/installer/
  page.html                  页面结构
  installer.css              样式
  config.mjs                 纯配置模型与校验（Node 可测）
  unix.mjs                   macOS / Linux 安装器与启动器
  windows.mjs                Windows 安装器与启动器
  zip.mjs                    无依赖 ZIP 写入器
  bundle.mjs                 三平台文件、iPad 网关脚本与 zip 组装
  ui.mjs                     浏览器交互
assets/                      图标（PNG / ICO）
tools/                       spark-ipad-gateway.ps1（Windows 局域网网关）
tests/                       Node + Python 测试
legacy/                      旧版 Python 向导，仅存档
```

构建脚本会按依赖顺序拼接模块，并去掉 ESM 的 `import` / `export`，所以 `src/installer/*.mjs` 既能被 Node 测试，也能被内联进浏览器。修改任一源文件后必须重新运行 `build_installer.py`，否则 `tests/test_install_html.py` 会报 `install.html is stale`。

## 旧版

根目录原来的 Python 向导（`lab_connect.py`、`static/`、`start-macos.command`、`start-windows.bat`）已移到 [`legacy/`](legacy/)，仅作参考，不再维护。新版不再需要本机 Python，也不需要启动本地 Web 服务。

## License

见 [LICENSE](LICENSE)。
