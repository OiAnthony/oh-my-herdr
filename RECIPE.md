# oh-my-herdr

Professional 是 Herdr Desktop 的完整工作区布局：左侧管理 Spaces 和 Agents，右上角启动 Agent 或用编辑器打开仓库，底部查看 Git 历史及受管终端的 CPU、内存。八个独立 Mods 由布局组合，不替换 Herdr 本体。目标版本为 Herdr Desktop 0.1.15，快捷键按 macOS 编写。

![oh-my-herdr Professional](preview.png)

## What you see

窗口使用 Herdr 当前主题，根节点为横向布局，不显示系统标题栏。macOS 窗口按钮保留在左上角，终端 pane 使用圆角边框。

- 左侧栏初始宽 268 px，可缩至 44 px。顶部是 46 px 的原生工作区标题，中间分别显示 Spaces 和 Agents，底部 69 px 保留 Settings、Add machine。OMP 配有图标时，Agents 列表去掉自动标题中重复的品牌和已知状态前缀，任务文本和手动名称保留。
- 右侧顶部是 42 px 标签栏。工作区标签之后依次放置 Files、Changes、Agent 启动按钮和 Open With。两个启动入口都由主按钮与独立下拉箭头组成；名称过长时截断，悬停显示完整名称。
- 中间显示当前 tab 的 panes。pane header 高 30 px，保留状态、分割、缩放和关闭操作；diff pane 的标题是相对路径。内容区 padding 和相邻区域间距均为 8 px。
- Files 和 Changes 共用右侧面板，初始宽 368 px，范围 280 至 900 px，默认隐藏。同一时刻只显示其中一页。
- Git Graph 是独立底部面板，初始高 420 px，范围 240 至 800 px，默认隐藏；可以与右侧 Files / Changes 同时显示。
- 底部状态栏高 28 px，依次显示机器、分支、Agents 摘要、Git Graph 入口、CPU / 内存，以及最右侧原生命令面板提示。资源槽宽 164 px，命令提示槽宽 130 px。

Resource Manager 从底部读数向上打开，宽度上限 416 px，高度上限 640 px，同时不超过窗口宽的 95% 和高的 85%。Tree 按 Space、Pane、OS 子进程分层；Processes 是 Name / PID / CPU / Memory 平表。内存用 1024 进位显示，CPU 低于 100% 时保留一位小数，达到 100% 后显示整数。

## How it behaves

### Agents 与启动入口

Herdr 提供 working、blocked、done、idle 状态。Agents 列表保留原生分组、置顶、优先级和行尾状态显示；扩展不根据标题猜测或覆盖真实 Agent 状态。OMP 标题清理只影响列表显示，不改终端原始标题。

启动按钮的主区域与 `⌘⇧A` 使用当前机器的默认项。没有默认项时打开菜单，不自动选择一个 Agent。右侧箭头始终只打开菜单。

- 点击程序行，在打开菜单时捕获的 space、机器和目录中新建一个 tab；不改变默认项。
- 点击行尾星标，仅设置默认项，不启动程序。默认项和一个自定义命令按机器分别保存，本机使用空字符串键。
- Custom command 分别编辑名称、Program 和 JSON 字符串数组参数。保存不启动，不隐式执行管道、重定向或变量展开。需要 shell 时，由用户显式填写 shell 与脚本参数。
- 默认项启动前重新查询 Herdr 程序表。程序未安装、原 space 已关闭或机器不可用时明确报错，不静默换机器或程序。
- 菜单保留 Terminal、New space、New worktree、Open worktree。方向键选择、Enter 启动、D 设为默认、Esc 关闭。

启动器不会安装 Agent、发送首条任务或自行管理终端生命周期。注册 OMP 等未内置程序的方法见 [README](README.md#注册-omp-或其他-agent)。

### Open With

点击主按钮或 `⌘G`，用默认应用打开当前终端的 Git 根目录；不在 Git 仓库时使用 cwd。没有当前终端 cwd 时，再查询当前 tab 的终端目录或 space 目录。它不跟随 Files / Changes 选中文件，也不打开单个文件。

下拉菜单支持本次打开和用星标设置默认应用。方向键选择、Enter 打开、D 设为默认、Esc 关闭。设置默认项不启动应用。

本机 macOS 提供 VS Code、Finder、Zed、IntelliJ IDEA、Cursor、Sublime Text。远程、Windows 和 Linux 仅提供 VS Code。远程目标经本机 VS Code Remote - SSH 打开，需要可用的 SSH Host；不能直接复用 Core 的 relay / via 连接。菜单打开时固定目标，主按钮每次点击重新读取当前目标。所有应用仍需自行安装。

### Git Graph、Files 与 Changes

点击底部 Git Graph 入口切换面板。拖动上沿调整高度。选择某个 commit，在该行下方展开元信息与文件树；再次点击、Esc 或详情关闭按钮收起。一次只展开一个 commit，列表与图线继续通过展开区。

单击变更文件会打开当前 space 共用的只读预览 tab；单击其他文件复用它。双击固定该 tab，后续预览不会覆盖固定项。再次打开同一机器、仓库、commit 和文件时切回已有固定项。每次异步读取固定目标，过期结果不得覆盖新文件；未提交变更显示打开时读取的内容。

Git workspace 有已初始化的 submodules 时，标题菜单列出 `(root)` 和按相对路径区分的递归子仓库。选择只改变 Graph 目标，不修改终端 cwd 或右侧 Changes。未初始化的 submodules 不显示，也不自动初始化、更新或 fetch。非 Git 目录使用 Manygit 扫描。

`⌘⇧E` 显示并聚焦 Files；Files 已聚焦时隐藏面板。单次 `⌘⇧G` 等待 300 ms 后切换 Changes，是否隐藏只取决于 Changes 是否已显示。300 ms 内连续两次 `⌘⇧G` 取消单次操作并切换 Git Graph，保留右侧面板状态。切换 space、tab 或布局后丢弃尚未执行的单次操作。

Git Graph 支持提交、checkout、fetch、push 等写入或网络操作。查看历史或 diff 不会替用户确认这些操作。

### 资源与监听端口

底部显示受管终端及其 OS 子进程的 CPU 和内存，不是整机任务管理器。CPU 100% 表示一个逻辑核，可以超过 100%。macOS 内存为 footprint，Linux 为 RSS，Windows 为 Working Set；共享页可能重复计算。未知值和不完整覆盖必须单独显示，不能填零或伪造归属。

活跃应用每秒采集 CPU 和内存，同机请求合并；应用失活暂停，恢复后重新建立 CPU 基线。关闭弹层后底部继续采样，关闭对应 View 才释放采集生命周期。相同显示值不因新采样强制重绘。这里不使用快速重绘计时器实现动画。

弹层直接键入即可搜索，空格分词，全部词须命中同一行或所属路径。支持名称、机器、PID / PPID、CPU 和内存等字段。Backspace 删除；第一次 Esc 清空搜索，第二次关闭。方向键导航，Enter 展开或折叠 Tree；切换页面清空搜索。

Tree 的 Ports 默认关闭。开启后每 5 秒采集监听端口，且只有非空搜索时才补充全机监听和未归属 Pane 的 Other processes。关闭 Ports 保留搜索词、隐藏端口行，只按其他字段匹配；Processes 不采集端口。

采集程序只读，不提权，不读取 argv、环境变量或终端内容，不保存采样历史、不结束进程、不转发端口。首次采样、PID 复用、计数回退、采样间隔过长或机器不可达时保留未知或错误状态。

## Built from

仓库根就是一个 Gallery layout 包：`layouts/Professional.json`、`layouts/Professional.svg`、`mods/`、本 recipe 和 `preview.png`。SVG 是 Herdr 布局选择器资源，PNG 是 Gallery 的真实界面截图，两者用途不同。

| Mod | 布局角色与职责 |
| --- | --- |
| `tabs-professional` | 标签栏、Files / Changes 入口、默认启动按钮、快捷键计时 |
| `agent-launcher` | 启动菜单和自定义命令编辑器 |
| `agents-professional` | Agents 列表，保留原生状态并清理 OMP 重复标题前缀 |
| `professional-panels` | `props.child` 为 `files` 或 `changes`，提供原生面板及焦点交接 |
| `open-with` | `props.role: "launcher"` 为右上角主入口；默认角色为应用菜单；`widthTarget` 指定可调整的槽位 |
| `professional-status` | 机器、分支、Agents 摘要和 Graph 入口；`props.role: "hint"` 为命令面板提示 |
| `git-graph` | 底部历史图；`props.role` 区分 pane header、diff、菜单、对话框和设置 |
| `resource-monitor` | 底部读数与 Resource Manager，共享按机器去重的快照 |

布局还引用 Herdr 自带的 `workspace-chrome` 与 `spaces`，图标也有内置资源引用。安装前必须用目标应用 home 启动过 Herdr，不能拿一个空目录代替初始化环境。

Mods 通过 `herdr` 读取 spaces、panes、terminals、agents、focused、theme、layout 等数据，通过 `run` 分发窗口命令；`exec`、`hc` 用于 Git、程序启动、Core 查询和采集 helper。GPUI 控件由 `gpui-kit` / `gpui-base` 描述，没有 DOM、HTML/CSS 或 Node.js API。

资源采集程序源码在 `native/resource-sample/`，依赖固定于 Cargo.lock。macOS 使用 libproc，Linux 使用 procfs，Windows 使用原生进程与 TCP API。构建只生成当前平台的程序；远端需自行构建并把 `herdr-resource-sample` 放进 PATH。

### 安装现有实现

先读目标应用 home 的 AGENTS.md、生成类型、本 recipe 及实际文件，向用户说明程序执行、网络、文件读写和快捷键变更。不要仅因它出现在 Gallery 就认定安全。

检查 Node.js、Cargo 与 `herdr-app` 已安装。macOS 编译还需 Xcode Command Line Tools。在可信源码根执行：

```sh
node scripts/build-resource-helper.mjs && node oh-my-herdr.mjs install && node oh-my-herdr.mjs check
```

自定义应用目录时，对所有命令统一设置 `HERDR_APP_HOME`。安装器要求已有完整 `keys.json`，按绑定合并 [keybindings.json](keybindings.json)，并在 `.oh-my-herdr/installed.json` 中记录文件哈希与快捷键原值。它不切换布局或重启应用。

同名文件、受管文件本地修改或快捷键冲突时，停止并向用户说明；不要强制覆盖、删除归属记录或擅自给整个套件改名。手动改名需要同步所有 Mod 路径、命令和安装器边界，不是简单重命名文件夹。不要另用社区管理器接管同一批文件，避免两个归属记录互相覆盖。

确认安装检查通过，并且用户同意改变当前窗口布局后，执行：

```sh
herdr-app do layout.switch '{"name":"Professional"}'
```

安装器也负责后续更新和卸载。卸载前切回内置布局并关闭套件窗格；之后运行 `node oh-my-herdr.mjs uninstall`。它恢复未修改的受管快捷键，保留个人配置和状态。完整操作见 [README](README.md)。

从空目录重建时，可按上述布局树和职责实现八个独立 Mods；无需复制安装器内部结构。但仍须保留快捷键冲突保护、明确安装和启用边界、准确的资源口径，以及第三方来源和许可告知。

## Watch out

- Mods 是可信代码，不是沙箱。本套件可执行 Git、打开本机应用、通过 VS Code 发起 SSH 连接、启动用户填写的程序。个人 shared state 明文保存，不适合放密钥。
- `⌘W` 从关闭 tab 改为关闭当前 pane，会结束其中的终端；最后一个 pane 关闭时也关闭 tab。`⌘⇧W` 的原关闭 pane 绑定被移除。`⌘T` 与原生 `⌘⇧P` 保留。
- `keybindings.json` 是安装器规则，不是可直接覆盖 Herdr 配置的 `keys.json`。已有同名绑定不能未经同意替换；安装器没有 force 选项。
- 原生 helper 的构建产物不入 Git。干净检出必须先构建；找不到 helper 时应显示错误，不退回 `ps`、`top`、`lsof` 或 PowerShell 采样。
- 源码与应用 home 单向部署。不复制个人 `apps.json`、`hosts.json`、shared state、data、窗口信息或会话进仓库。
- 适配器来源为内置 0.1.14 副本，目标运行版本为 Desktop 0.1.15。升级宿主时需核对当前类型与副本差异，不能把新 API 当成旧版本也支持。
- commit 详情是 retained 子视图。不要在 deferred row renderer 注册事件，也不要跨元素描述复用外层 render 创建的元素对象。
- Linux / Windows 资源采集尚未完成目标平台运行验收；Remote - SSH 尚未完成端到端验收。macOS 部分资源弹层物理输入、排序与滚动交互仍需验收，不能用 `herdr-app check` 代替。
- 项目原创代码采用 Apache-2.0。第三方代码、图标与 native 依赖的许可例外见 [NOTICE](NOTICE)、[THIRD_PARTY.md](THIRD_PARTY.md) 及各 Mod 内的许可文件，分发时必须保留。VS Code、Finder、Zed、IntelliJ IDEA 使用中性图标，应用名称不代表厂商背书；不要重新打包未经核清分发权的本机应用图标。

## Done when

- 在初始化过的隔离 app home 和独立 Core 会话中，从干净源码构建 helper，实际完成 install、check、uninstall；八个 Mod 初始加载成功。卸载恢复快捷键，个人配置保留。
- 原生窗口显示 Professional 的左栏、标签栏、两个启动入口和状态栏；Files / Changes 在右侧，Graph 在底部，可同时显示，无加载错误。
- Agent 行点击只启动一次，星标和保存命令不启动；主按钮与 `⌘⇧A` 各只创建一个 tab，切换机器后默认项隔离，失效目标明确报错。
- Open With 的设置默认项不打开程序；启动使用正确仓库与机器，不把远程目录交给本机普通应用。失败有明确提示。
- Graph 能展开、收起和切换 commit；单击文件复用预览，双击固定，固定项不被替换；切换子仓库不改变终端 cwd 或 Changes 目标。
- Files 的聚焦与隐藏、Changes 的单次切换、Graph 的双次切换符合 300 ms 判定，切换上下文不会执行过期待处理命令。
- Resource Manager 两页能显示真实采样，搜索、排序、方向键、Enter 与 Esc 按上述规则工作；Ports 关闭时不扫描监听端口，关闭弹层停止端口采集但保留 footer 采样。
- 使用应用真实截图检查布局；不要把宿主模拟回调、初始加载成功或测试断言写成真实鼠标、键盘和远端验收证明。
