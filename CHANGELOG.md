# Changelog

## Unreleased

- 新增 `install.sh`，一条命令完成资源采集程序构建、布局与八个 Mods 部署、快捷键合并和 `herdr-app check`；支持 `--switch` 和 `--dry-run`。README 改为以安装和使用为主，并保留 Gallery `RECIPE.md`、真实窗口预览和统一的布局源文件 `layouts/Professional.json`、`layouts/Professional.svg`。
- 新增根 Apache-2.0 许可、NOTICE 与第三方来源清单，部署 Mod 自带必要许可。核实 Herdr v0.1.14 与 Open VS Code 对应源码的 Apache-2.0 / MIT 条款，保留其他资源及 native 依赖许可；移除未核清分发权的四枚应用 PNG，以中性图标替代，应用选项和启动行为不变。

- 修复 Resource Manager 按空格时关闭弹层的问题：空格和 Enter 使用面板内的 action 绑定，避免宿主 Popover 提前将它们作为确认操作；空格继续输入关键词分隔符，Enter 保留行展开行为。

- Resource Manager 两页移除固定搜索框，改为直接键入过滤所有表格字段；支持空格分词、跨字段组合匹配与 Backspace 编辑。Tree 保留命中项的所属路径和 OS 父进程链；第一次 Esc 清空搜索，第二次 Esc 隐藏弹层。Ports 开启时，非空关键词搜索补充全机监听；关闭 Ports 保留关键词并排除监听字段。

- Resource Manager 弹层在定位前按窗口尺寸计算像素宽高，保留 416 × 640 px 上限及窄窗口约束，消除百分比最大高度造成的 footer 上方空隙。

- Resources footer 的 CPU 低于 100% 时固定一位小数，达到 100% 后显示整数，例如 `1.0%`、`10.0%`、`120%`；图标与数值按单核占用从主题绿色经黄色渐变到红色，未知值保持中性色。CPU、内存各自分组，等宽数值左对齐并紧贴前面的图标，分隔符前后各一个空格；组内按内容排列，外层固定为 164 px，剩余空位留在最右侧。

- Professional 支持单次 `⌘⇧G` 等待 300ms 后切换 Changes、300ms 内连续两次切换 Git Graph；两种操作均可再次触发以隐藏对应面板。Changes 按可见状态切换，不受终端或面板焦点影响；双次操作保留右侧 Files/Changes 状态。由标签栏统一计时，切换 space、tab 或布局后丢弃待执行操作，Files 快捷键立即执行并取消待处理的 Changes。安装器移除旧原生双次序列，避免叠加宿主固定的 1 秒等待，卸载恢复安装前原值。
- Agents 列表隐藏 OMP 自动标题中品牌后方的重复状态符号，包含等待、需关注、静态分隔符及四种 spinner；状态保留在 Herdr 行尾。任务 emoji、正文、无品牌标题及手动命名的 tab 保持原样。
- Resources 改为 footer 实时 CPU、内存与原生弹层，共享一套 1 Hz 采样；footer 不显示 `≈` 和终端数。沿用 Orca 的 416 px 弹层与紧凑表格；原 Resources / PTYs 合并为 Tree 页签，资源树按 Space → Pane 展示，省略 Tab 层，统一保留排序、子进程树、内存趋势和组合搜索。Ports 开关默认关闭，关闭后清空端口条件并隐藏缓存端口行。未知及覆盖不完整单独标注；应用失活暂停，显示值不变时减少 footer 与弹层重绘。
- Resource Manager 新增 Processes 页，将受管终端及子进程铺平成 Name / PID / CPU / Memory 明细表，支持名称或机器名、精确 PID 筛选与列排序；共享现有快照，不新增采样或端口扫描。
- 新增 Rust helper：macOS 按受管根查询后代并读取 footprint/RSS 与累计 CPU；Linux 使用 procfs，Windows 使用原生进程和 TCP API。监听默认只查受管进程，Tree 页可见且 Ports 开启后每 5 秒采集；输入端口筛选时才补充全机监听。PID 复用、超时和迟到结果不污染当前数据，不回退重型系统命令。
- 安装器支持本机 helper 的构建前检查、可执行权限和失败回滚；目标 Desktop 版本更新为 0.1.15。原生源码与依赖锁入库，二进制按目标平台构建，许可随 Mod 安装。本机采集及 Linux/Windows 交叉编译检查通过；完整界面与全链路性能仍待验收。
- 新增 `⌘⇧E` 聚焦 Files、`⌘⇧G` 切换 Changes；Files 已聚焦时再次按下隐藏，可见但未聚焦时只聚焦。Changes 按可见状态切换，隐藏后返回当前 pane。新增 `professional-panels` 布局适配器，保留内置 0.1.14 面板源码和原生子控件，内置模块不变；纳入安装归属和快捷键恢复。
- Professional 右上角改为 Files、Changes、`+`、Open With 的顺序，将两个启动入口相邻放置；保留独立菜单、默认项和快捷键行为，并同步布局预览图。
- Professional 新增基于内置 Agents 0.1.14 的 `agents-professional` 副本；OMP 配有图标时只移除自动标题的前导品牌 `π`，保留状态符号、任务 emoji、正文和手动命名的 tab。内置 Agents 不变，副本及布局引用纳入套件安装归属。
- Agent Launcher 和 Open With 的列表行尾预留 12 像素滚动条通道，避免滚动条覆盖设置默认项的星标按钮；保留按钮尺寸和原有点击行为。
- 标签栏的下拉箭头改用固定 12 像素的内置 SVG，并显式水平、垂直居中，避免文本箭头受字体基线影响而偏下。
- Agent Launcher 菜单恢复原生 `+` 的紧凑尺寸和信息密度，移除额外标题、机器说明及底部教程；未安装项最多显示两个，保留默认星标、自定义命令和 space/worktree 操作。
- 收录 oh-my-pi v18.18.6 官方 OMP 图标，保留原始 SVG、MIT 许可与来源记录；通过个人 `programs.json` 接入。菜单载入时刷新默认 agent 的名称和图标，保留已有或载入期间新选的默认项。
- 新增 Agent Launcher：Professional 标签栏的 `+` 改为双段按钮，主按钮与 `⌘⇧A` 共用默认启动入口，右侧下拉选择一次启动项；行尾 `☆ / ★` 只设置默认项，不启动。默认项与一个自定义命令按机器保存在个人 shared state 中，不纳入安装或卸载归属。
- 新增自定义新 tab 命令编辑器，使用程序与 JSON 参数数组，不隐式执行 shell 语法。启动固定菜单打开时的 space、机器和目录；默认 agent 失效时明确报错。保留普通终端、space/worktree 操作、`⌘T` 和原生 `⌘⇧P`。
- 重新引入基于内置 `tabs` 0.1.14 的个人 `tabs-professional` 副本，仅定制启动入口；新增独立 `agent-launcher` Mod。安装器支持更新旧的受管标签栏副本，保留个人文件并对新快捷键执行既有冲突检查与卸载恢复。
- 新增 `keybindings.json` 统一分发 macOS 按键规则：`⌘W` 从关闭 tab 改为关闭 pane，移除 `⌘⇧W` 的关闭 pane 绑定；不新增运行时 Mod。
- 安装器按绑定合并个人 `keys.json`，记录实际原值及安装值。首次安装拒绝其他自定义值，更新和检查检测受管绑定改动；规则退休与卸载恢复未修改的原绑定，卸载保留个人后来修改的按键并警告。快捷键写入参与现有部署事务和失败回滚，旧版归属记录可迁移。
- 右上角 Open With 改为双段按钮：主按钮显示默认应用图标和名称，点击直接打开当前仓库或目录；右侧下拉继续提供打开方式和默认应用选择。
- 新增 `open-with.open-default` 命令，与右上角主按钮共用默认应用启动逻辑；`⌘G` 从已退休的 `open-vscode` 入口迁移到该命令，不弹选择菜单。只有可见的 launcher 实例监听，菜单不重复启动。
- Open With 槽位跟随按钮实际宽度调整，消除短应用名与 Changes 之间的多余空白；按钮保留最大宽度，超长名称截断。
- 底部 Git Graph 入口仅保留文字，保持面板开关和选中状态。
- Git Graph 移为独立底部面板，默认收起，可调整高度；状态栏按钮只控制 Graph，Files/Changes 保留在右侧并可同时显示。
- Git Graph 支持 Git workspace 内的多个 submodules：仓库选择器列出主仓库和递归的已初始化子仓库，以相对路径区分同名仓库；切换时隔离历史、状态、详情和操作目标，阻止其他仓库的迟到详情覆盖当前选择。不自动初始化或更新 submodules。
- Git Graph 仓库选择器改为锚定按钮的原生浮层，不再挤占提交图空间；支持内部滚动、选择关闭、Esc 和点击外部关闭，Manygit 使用同一交互。
- commit 详情改为行内折叠展开：单项展开、再次点击收起，元信息与变更文件按左右两栏排列，窄面板上下排列；两栏撑满展开区，避免文件列表被挤掉。提交图线和列表继续穿过展开项。
- diff 改为 VS Code 式预览：单击文件复用当前 space 的预览 tab，双击固定，后续预览不覆盖固定项；已有固定项直接切回，关闭预览后可重开。tab 名称显示预览/固定状态。
- diff 读取固定仓库、机器、commit 和文件，保留未跟踪标记；过期异步结果不会覆盖新文件。不创建终端或磁盘临时文件，tab 仍按宿主规则保存和恢复。
- diff 正文仅显示差异内容并占满面板，移除重复的文件路径、提交、仓库与只读说明区；保留行号、增删标记、滚动和必要的加载/异常状态。
- Professional 的 diff pane title 改为文件相对路径；固定打开时的 workspace/cwd，在 workspace 下查看 submodule 时保留子仓库前缀，直接在子仓库中查看则相对该仓库。其他 pane 保留原有标题、状态与操作，diff 正文不增加标题区。
- 移除 Git Graph 文件详情与 diff 的 F4 源文件跳转，以及专用源文件预览、tab 复用状态处理和相关测试；保留 diff 预览、固定 tab 和路径标题，不修改全局快捷键。

## 0.3.0 — 2026-11-10

- 将 Open VS Code 的本机启动、协议回退和 Remote - SSH 能力合入 Open With，移除独立 `open-vscode` Mod；SSH Host 配置改为 `mods/open-with/hosts.json`。
- 移除 `tabs-professional`，Professional 改用内置 `tabs`，继续保留标签管理及 Files/Changes 入口。
- Open With 保留在窗口右上角；底部 statusline 通过薄布局适配器在机器、分支、agents 信息右侧显示 Git Graph 按钮，Graph 仍显示在原右侧面板。左侧 footer 只保留原有 Settings/Add machine。
- Git Graph 的 Changes 跳转改为显式集成，仅在宿主布局和仓库目标匹配时提供，避免独立使用时操作错误布局或仓库。
- 保持目标目录和机器同源，保留 POSIX 文件名中的反斜杠与 Windows drive/UNC 路径；远程目标只交给 VS Code Remote - SSH。
- 安装器按旧归属记录退休两个旧组件，保留个人文件；SSH Host 配置单次迁移、冲突预检和失败回滚，不纳入套件文件归属。

## 0.2.0 — 2026-11-09

- 将整个项目移入 `desktop/extensions/oh-my-herdr/`，内部继续保留一个布局和多个独立 Mods。
- 合并重复的 Git Graph：以较新的 0.3.2 实现统一为 `git-graph`，移除独立 `git-graph-main`。
- 同步迁移布局、工具栏、资源和自弹窗引用；保留 Open With 与 Remote SSH 直达功能。
- 安装器支持从旧归属记录移除重复组件；旧副本备份到运行 `mods/` 目录之外。

## 0.1.0 — 2026-11-09

- 将 Professional 布局与五个独立 Mods 纳入 oh-my-herdr 组件清单，保留现有模块名称和共享状态 key。
- 纳入两份 Git Graph 与 Open VS Code 源码，保留来源信息和已有许可证。
- 移除 Git Graph 自身的版本检查和更新提示，改由套件源码统一维护。
- 用统一的 install、check、uninstall 入口替代 Open With 单组件安装脚本。
- 增加按文件哈希管理的部署归属、冲突预检和失败回滚，保留个人配置及运行状态。
- 明确安装不切换布局、不修改快捷键、不重启应用，公开分发前需核查品牌资源授权。
