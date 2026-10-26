# Spark DSH 安装器

给实验室新同学的一键安装包：配置一次 SSH，以后在桌面双击 **Spark DSH**，自动建立隧道并打开 spark 服务器上的 DSH。内置数据集和技能已经准备好，打开就能问。

> **直接打开：[install.html](install.html)**（约 200 KB，单文件，离线可用）
>
> 这个页面会根据你的系统生成安装脚本，不收集密码，也不需要管理员权限。

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

点 **下载通用安装包**，得到一个 zip；也可以只下载当前系统的单文件。

### 3. 运行安装脚本

解压后，按系统双击对应文件：

| 系统 | 文件 | 首次运行注意 |
| --- | --- | --- |
| macOS | `spark-install.command` | 右键 → 打开；或在终端 `chmod +x` 后运行 |
| Windows | `spark-install.bat` | SmartScreen：更多信息 → 仍要运行 |
| Linux | `spark-install.sh` | 终端运行 `bash spark-install.sh` |

脚本会提示输入跳板机和 spark 的密码，用于把公钥追加到服务器。**密码只在 ssh 的交互提示里输入，安装器不会读取或保存。**

### 4. 双击桌面图标

安装完成后桌面出现 **Spark DSH**：

- macOS：`~/Applications/Spark DSH.app`，桌面有同名软链接；
- Windows：桌面和开始菜单的 `Spark DSH.lnk`；
- Linux：`~/.local/share/applications/spark-dsh.desktop`，桌面副本和 `~/.local/bin/spark-dsh`。

双击后浏览器打开 `http://127.0.0.1:18090/`。第一次需要登录 spark 门户（Linux 用户名 + 密码）；之后 12 小时内直接进入 DSH。

## 三种连接方式

| 模式 | 适用场景 | 行为 |
| --- | --- | --- |
| **EasyConnect + 跳板机**（默认） | 医院网络的标准方式 | spark 走 `ProxyJump spark-jump`，先连 `10.30.24.1` |
| **直连 spark** | 已在实验室内网，或 VPN 直接路由到 spark | 不写跳板机配置，直接连 spark |
| **自定义跳板链** | 多级跳板 / 特殊网络 | 按 OpenSSH `ProxyJump` 语法填写，例如 `alice@10.30.24.1:22, alice@10.30.24.2` |

自定义跳板链需要你自行确保每一跳都已部署公钥；安装器只部署最后 spark 账号的公钥。

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
%LOCALAPPDATA%\SparkDSH\launch.vbs
%LOCALAPPDATA%\SparkDSH\stop-tunnel.ps1
%LOCALAPPDATA%\SparkDSH\uninstall.ps1
%LOCALAPPDATA%\SparkDSH\uninstall.bat
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

Windows：

```bat
%LOCALAPPDATA%\SparkDSH\uninstall.bat
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

### Windows 提示 SmartScreen

点 **更多信息 → 仍要运行**。安装器是纯文本脚本，可以先用记事本打开检查。若公司策略完全禁止 `.bat`，需要管理员放行，或改用 WSL 里的 Linux 脚本。

### ssh 退出码 255 / 连接超时

先确认 EasyConnect 已连接，浏览器能打开院内地址；再确认跳板机地址和端口。日志：

- macOS / Linux：`~/.spark-dsh/launcher.log`
- Windows：`%LOCALAPPDATA%\SparkDSH\launcher.log`

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

不需要管理员权限。所有文件都在用户目录；数据始终留在 spark 服务器，本机只建立 SSH 隧道。安装器和启动器不会把数据发到院外，也不会收集密码。

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
  bundle.mjs                 三平台文件与 zip 组装
  ui.mjs                     浏览器交互
assets/                      图标（PNG / ICO）
tests/                       Node + Python 测试
legacy/                      旧版 Python 向导，仅存档
```

构建脚本会按依赖顺序拼接模块，并去掉 ESM 的 `import` / `export`，所以 `src/installer/*.mjs` 既能被 Node 测试，也能被内联进浏览器。修改任一源文件后必须重新运行 `build_installer.py`，否则 `tests/test_install_html.py` 会报 `install.html is stale`。

## 旧版

根目录原来的 Python 向导（`lab_connect.py`、`static/`、`start-macos.command`、`start-windows.bat`）已移到 [`legacy/`](legacy/)，仅作参考，不再维护。新版不再需要本机 Python，也不需要启动本地 Web 服务。

## License

见 [LICENSE](LICENSE)。
