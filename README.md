# oh-my-herdr

Herdr Desktop 的 oh-my-herdr 工作区：左侧 Spaces 和 Agents，右上角启动 Agent 或打开仓库，右侧 Files/Changes，底部 Git Graph、CPU 和内存。

![oh-my-herdr 布局](preview.png)

支持 Herdr Desktop 0.1.15，不适用于 Herdr TUI。套件版本为 0.4.0。

## 安装

需要 macOS 13.5 或更新版本，以及至少启动过一次的 Herdr Desktop 0.1.15。终端要能运行 `herdr-app`。普通 ZIP 安装不需要 Node.js、Rust、Cargo、Git 或 Xcode，不修改系统 PATH，不使用 sudo。

在 [Releases](https://github.com/OiAnthony/oh-my-herdr/releases) 下载 0.4.0 的对应架构 ZIP 和 `SHA256SUMS`：Apple Silicon 选 `darwin-arm64`，Intel 选 `darwin-x64`。若该版本尚未发布，维护者需先按[开发指南](docs/development.md)构建；GitHub 自动生成的 Source code ZIP 不包含运行时或 helper，不能代替发布包。

以下命令以 Apple Silicon、下载目录为 `~/Downloads` 为例；Intel 用户将文件名中的 `arm64` 换为 `x64`：

```sh
cd ~/Downloads
shasum -a 256 oh-my-herdr-0.4.0-darwin-arm64.zip
# 将输出与 SHA256SUMS 中同名文件的 SHA256 比较，一致后再解压。
unzip oh-my-herdr-0.4.0-darwin-arm64.zip
cd oh-my-herdr-0.4.0-darwin-arm64
./install.sh --switch
```

脚本使用包内 `runtime/node` 与预编译资源采集程序，安装布局和 8 个 Mods、合并快捷键，再运行 `herdr-app check`。成功时输出 `8 mods checked`，`--switch` 随后显式启用布局。不加 `--switch` 则不切换布局；所有模式都不重启 Herdr。`--dry-run` 只读预检并打印命令。包损坏、架构不符、Herdr 缺失或 home 未初始化时，写入配置前失败，不调用系统 Node、不下载依赖、不现场编译。

ZIP 未签名、未公证。浏览器下载后，Node 或 helper 可能被 macOS Gatekeeper 拦截。确认下载来源和校验值后，按系统提示在「系统设置 → 隐私与安全性」中手动允许被阻止的程序，再重试；若系统仍不允许执行，停止安装。安装器不会删除 quarantine 或关闭 Gatekeeper，也不承诺没有安全提示。校验和用于发现损坏，不是独立签名。

安装免工具链不代表运行功能免依赖：Git Graph 等 Git 功能仍需可用 Git；编辑器和 Agent 需自行安装。本套件不捆绑 Git，也不安装 Command Line Tools。

Mods 是可信代码，安装前可以读源码。

## 启用

```sh
herdr-app do layout.switch '{"name":"oh-my-herdr"}'
```

安装时加 `--switch` 可以一步完成：

```sh
./install.sh --switch
```

`herdr-app check` 只验证部署和初始加载，布局与交互仍要在窗口里确认。

## 快速上手

右上角两个按钮分别启动 Agent 和打开仓库。点主按钮用默认项，点箭头换选项，点行尾星标设默认。

| 快捷键 | 功能 |
| --- | --- |
| `⌘⇧A` | 启动当前机器的默认 Agent |
| `⌘G` | 用默认应用打开当前仓库或目录 |
| `⌘⇧E` | 显示并聚焦 Files；已聚焦时隐藏 |
| `⌘⇧G` | 切换 Changes；300 ms 内连按两次切换 Git Graph |
| `⌘W` | 关闭当前 pane；最后一个 pane 关闭时也关闭 tab |
| `⌘T` | 新建终端 |
| `⌘⇧P` | 命令面板 |

点底部最右侧 CPU 或内存读数打开 Task Manager。页签与 `Herdr / System` 同行，选择器统一控制 Tree、Processes 和 Ports：Herdr 只看受管终端及 OS 后代，System 查看各机器的全机进程和 TCP 监听。每次打开返回 Herdr Tree，自动定位并展开当前 pane；切换范围保留过滤词与排序，切换页签保留范围。Tree 顶部图标可展开全部、收起全部、定位当前 pane；定位按钮也会返回 Herdr Tree、清空过滤、展开目标及祖先并滚动到目标行。摘要下方不显示常驻说明，机器、采样与覆盖状态可悬停查看。直接输入过滤，空格分词，第一次 Esc 清空，第二次关闭。Tree 默认显示监听端口；Tree 和 Ports 页每 5 秒采集监听，Processes 或关闭弹层时停止扫描。搜索不扩大范围。底部读数始终是 Herdr 受管资源；System 摘要是可读进程合计，不是系统已用内存。关闭弹层后停止全机采集。

footer 数值最多三位数字，不计小数点、百分号与单位；例如 `10.0%`、`100%`、`1.60k%` 和 `12.4 GB`。`k%` 表示千个百分点，CPU 100% 仍代表一个核。面板和悬停提示保留明细格式。footer 使用紧凑的固定宽度槽，等宽数值左对齐并紧贴图标，更新时不推动相邻元素。Task Manager 摘要左侧分两行显示 CPU、Memory，Tree 的内存趋势图填满右侧剩余宽度；实际内存指标（如 Footprint）保留在摘要 tooltip。

`⌘W` 会结束 pane 里的终端。`⌘⇧W` 原有的关闭 pane 绑定已被移除。

## 配置

应用目录默认是 `~/.config/herdr-app`。换目录时先 `export HERDR_APP_HOME=/path/to/app-home`，路径和父目录不能含符号链接。

注册 OMP，在 `programs.json` 中加入：

```json
{
  "programs": {
    "omp": {
      "name": "OMP",
      "run": ["omp"],
      "icon": "mods/agent-launcher/icons/omp.svg",
      "tint": false
    }
  }
}
```

Open With 的应用列表写在 `mods/open-with/apps.json`，每项需要 `id`、`title`，普通应用还需要 macOS `bundleId`，最多 20 项。Core 机器名和 SSH Host 不同时，在 `mods/open-with/hosts.json` 中写 `{"my-machine":"my-ssh-alias"}`，key 是机器名，value 是 SSH Host。

macOS 安装时会从本机已安装的 VS Code、Finder、Zed 和 IntelliJ IDEA 导出图标，缓存到应用目录的 `data/open-with-icons/`。导出资源不进入源码或发布包；未安装的应用保留通用图标，Cursor 和 Sublime Text 保留随包 SVG。个人 `apps.json` 中显式指定的图标优先。重新运行安装器可刷新缓存；卸载会保留该本机缓存。

## 更新与卸载

下载新版的对应架构 ZIP，核对新版 `SHA256SUMS` 后解压到新目录，再从新目录运行 `./install.sh`。例如重新安装 0.4.0（不切换布局）：

```sh
cd ~/Downloads/oh-my-herdr-0.4.0-darwin-arm64
./install.sh
./install.sh --check
```

不需要系统 Node，不添加更新服务，也不从旧目录自动下载新版。保留解压目录，以便检查或卸载。

布局原名 `Professional`，现统一为 `oh-my-herdr`。更新会移除归属记录中未修改的旧布局文件；未受管或已修改的同名文件不会被强制覆盖。若当前正在使用旧布局，先切到内置 `main`，更新后按上面的启用命令切到新布局。旧布局的尺寸、显隐等个人状态保留，不自动迁移到新名称。

卸载前先切回内置布局；自定义 home 时，以下所有命令使用同一个 `HERDR_APP_HOME`：

```sh
herdr-app do layout.switch '{"name":"main"}'
cd ~/Downloads/oh-my-herdr-0.4.0-darwin-arm64
./install.sh --uninstall
```

卸载同样使用私有 Node，恢复未修改的受管快捷键，保留个人配置与状态。即使 Herdr CLI 已移除，仍可卸载。若受管文件有本地修改，先按报错备份、处理冲突，不强制覆盖。

不要通过删除 `mods/` 或 `data/` 目录卸载。

## 从源码开发

源码安装需要 Node.js、Rust/Cargo；macOS 编译需要 Xcode Command Line Tools。开发者显式构建后安装：

```sh
git clone https://github.com/OiAnthony/oh-my-herdr.git
cd oh-my-herdr
node scripts/build-resource-helper.mjs
./install.sh
```

`install.sh` 不再自动编译。开发测试、双架构打包和隔离验证见[开发指南](docs/development.md)。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| `Missing keys.json` | 用目标应用目录启动一次 Herdr，确认 `HERDR_APP_HOME` 一致 |
| helper、私有 Node 缺失或校验不符 | 发布包重新下载并解压；不要补装系统 Node 或 Cargo。源码开发者按开发指南显式构建 helper |
| 检查通过但界面没变化 | 手动切到 oh-my-herdr；安装器不会自动启用布局 |
| 快捷键或文件冲突 | 按报错检查 `keys.json` 或受管文件；安装器不提供强制覆盖 |
| macOS 阻止执行 Node 或 helper | 核对来源和 SHA256，按系统「隐私与安全性」提示手动允许；不要关闭安全机制 |
| 架构不匹配 | Apple Silicon 使用 arm64 ZIP，Intel 使用 x64 ZIP |

更多资料：

- [Changelog](CHANGELOG.md)
- [Gallery recipe](RECIPE.md)
- [开发指南](docs/development.md)
- [资源监控设计](docs/design/resource-monitor.md)
- [许可与来源](THIRD_PARTY.md)

Linux、Windows 的资源采集和 Remote - SSH 尚未完成目标环境端到端验收；资源弹层的筛选、排序和键盘交互尚未完成完整实机验收。原创代码采用 Apache-2.0，第三方代码和资源保留各自许可。
