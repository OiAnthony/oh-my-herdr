# Changelog

## 0.4.0 — 2026-11-12

- 新增 macOS arm64/x64 白名单 ZIP 打包与双原生架构 GitHub Actions，包含预编译资源 helper、官方固定 Node.js 26.13.1、完整 Node/依赖许可及最终 SHA256SUMS；不提交二进制，不使用 DMG、签名、公证或自动更新服务。
- `install.sh` 不再调用 Cargo。发布包仅使用私有 `runtime/node`，损坏时明确失败，不回退到全局 Node、不下载依赖或现场编译；源码开发者先显式运行 helper 构建脚本。安装前校验架构、包内容、可执行 helper、Herdr 与初始化 home，复用原有归属、事务、快捷键恢复和冲突保护。
- 新增 `--check` 与 `--uninstall` 私有运行时入口；更新为下载新版 ZIP 后重新安装。默认不切换布局、不重启，只有 `--switch` 显式启用。文档说明 macOS 13.5 下限、未签名安全提示及 Git/编辑器/Agent 的独立运行依赖。
- macOS arm64 实际构建最终 ZIP；87 项既有安装器/Open With/图标测试与 17 项最终包消费边界测试通过。解压到含空格和中文的路径，使用真实私有 Node 26.13.1、真实 Herdr Desktop 0.1.15 和隔离 PATH/home 完成 install、八 Mod check 与 uninstall，恢复原快捷键并保留个人状态；系统 Node、Cargo、下载和编译工具哨兵未被调用。ZIP 共 140 个文件，完整 Node LICENSE 与固定 SHA tarball 中的原文逐字节一致，未包含个人或生成状态。
- 本次未提交、推送、发布、触发远端工作流、安装到日常 profile、切换日常布局或重启服务。x64 运行、macOS 13.5 实机、未装 CLT 的干净 Mac、浏览器下载后的 Gatekeeper/手动安全许可流程及真实窗口交互均未验收；工作流 YAML 解析通过不代表双架构远端运行通过。

- Open With 默认列表将 Finder 移到首位，其余应用相对顺序不变；保留已保存的默认应用，自定义应用列表仍遵循个人配置。远程及非 macOS 的 VS Code 回退按应用 ID 查找，不再依赖列表首项。
- 18 项相关测试和八个 Mod 加载检查通过，已安装到当前 Herdr。真实窗口截图确认 Finder 位于首行、六项图标正常，VS Code 仍为已保存的默认项；未切换布局或重启。

- 修复 Open With 中 VS Code、Finder、Zed、IntelliJ IDEA 全部显示通用图标的问题：macOS 安装时通过 NSWorkspace 从本机应用导出图标，按内容哈希缓存到 `data/open-with-icons/`，在 Mod 热加载前写入索引。不分发提取资源；未安装项保留通用图标，个人图标优先，应用启动契约不变。
- 87 项 Open With、原生图标导出和安装器相关测试通过；当前 macOS Herdr 已生成四枚本机图标缓存，部署后八个 Mod 加载检查通过。运行窗口处于屏外且无可访问内容，`shot` 返回旧帧，尚未确认新界面的视觉效果；未切换布局、重启或提交。

- 将 `Professional` 布局统一更名为 `oh-my-herdr`，同步 JSON／SVG、套件清单、快捷键作用域、安装与切换命令。更新安装器移除未修改的受管旧布局，保留个人状态与本地修改保护；不自动切换当前窗口，不迁移旧布局点击状态。各 Mod 标识不变。
- 收紧 Task Manager footer：按钮从 176 px 缩至 148 px，CPU／内存数值槽分别缩至 40／48 px，改为左对齐并紧贴图标；保留三位数字格式、等宽字体、稳定槽位和 CPU 配色。
- Task Manager 摘要改为全宽左右布局：CPU、Memory 在左侧分两行显示，Tree 内存趋势图自适应填满右侧剩余宽度；内存指标保留在 tooltip。21 项视图回归与 Desktop 0.1.15 Mod 加载检查通过，隔离原生窗口用固定样本检查了 416／304 px 面板及 footer 的低负载、缩写边界和未知值。未部署到日常应用，未验证物理输入或真实采集链路。
- Task Manager 打开时自动返回 Herdr Tree，清空过滤并居中定位、展开当前 pane；定位按钮同时展开目标与祖先。页签与 scope 选择器改为同排左右分布，移除 Footprint 下方常驻说明，机器、采样和覆盖状态保留在摘要 tooltip。
- 21 项视图测试及 Herdr Desktop 0.1.15 Mod 加载检查通过；隔离原生窗口使用固定样本确认同排布局、精简摘要和默认展开，并通过辅助功能点击收起全部及定位按钮验证展开行为。未部署到日常应用，未验证真实采集全链路。
- Resource Manager 更名为 Task Manager，更新标题、辅助功能名称及键盘上下文；Professional 将资源 footer 移到状态栏最右侧，命令面板提示保留在其左侧。
- 新增数值稳定排版规范：footer、面板摘要及 CPU／Memory 表格列使用固定宽度槽、等宽字体和右对齐，位数、未知值与内存单位变化不推动相邻元素。footer 资源槽调整为 188 px，配色规则不变。
- Tree 默认采集、显示和搜索监听端口，移除 Ports 开关及其状态；沿用 5 秒扫描间隔和当前作用域，切到 Processes 或关闭面板停止扫描。
- Task Manager footer 数值限制为最多三位数字，不计小数点、百分号与单位；内存按数值调整小数位并在需要时升单位，CPU 超过三位用 `k%` 等十进制缩写。仅压缩 footer，tooltip 与面板保留明细，颜色仍按原始 CPU 占用计算。
- macOS arm64 的 56 项相关 Node 测试及 Herdr Desktop 0.1.15 Mod 初始加载检查通过。隔离原生窗口使用固定样本检查了最右侧 footer、Tree 默认监听行、Processes、未知值与 640 × 480 窄窗口；数值变化前后分隔符及内存图标区域像素一致。固定样本渲染不视为真实鼠标／键盘交互或完整采集链路验收；未部署到日常应用。
- 修复 Resource Manager 的 Scope 选项文字偏上：为原生 Radio 显式设置 flex 和双轴居中，保持 24 px 高度及现有交互；隔离原生窗口截图确认 Herdr、System 文字垂直居中。
- Resource Manager 新增 `Herdr / System` 作用域选择器，统一控制 Tree、Processes 和 Ports。每次打开默认 Herdr，切换范围保留关键词与排序，搜索不再隐式扩大范围；定位 pane 返回 Herdr Tree。System 增加全机 CPU／内存及 OS 进程树，未知指标不补零，进程自身指标与机器去重合计分开。footer 始终显示受管资源；关闭弹层停止全机采集，范围切换隔离 CPU 基线、监听缓存、趋势及迟到结果。原生 CLI 改为 `--scope=herdr|system [--ports]`，移除旧 `--all-ports`，helper 与 Mod 需配套部署。
- 作用域功能在 macOS arm64 验证了 58 项相关 Node 测试、2 项 Rust 测试、Linux／Windows 交叉编译，以及 Herdr Desktop 0.1.15 初始加载和隔离窗口的真实全机 Tree 渲染。辅助功能读取被系统拒绝，未宣称物理鼠标／键盘切换验收。全机 helper 在约 939 个进程、1 Hz、每 5 秒扫描端口的 10 秒短测中占 1.55% 单核、峰值 RSS 3.98 MiB，超过既有 1% CPU 上限；完整应用性能尚未验收。本次未部署到日常应用、切换日常布局或重启现有服务。
- Resource Manager 增加展开全部、收起全部及定位当前 pane 图标；定位会清空过滤、展开祖先并居中选中目标。新增 Ports 页，按当前作用域列出 TCP 监听地址、进程和 PID，支持键入筛选及列排序；共用现有采集器，每 5 秒扫描，隐藏后停止。移除底部只读与键盘操作说明，错误和覆盖状态移到上方，Refresh / Close 改为图标。
- 将九个 Node 测试文件迁入 `tests/`，修正模块、快捷键预设和原生 helper 的相对路径；测试命令改为 `node --test tests/*.test.mjs`。新增开发指南，资源监控方案迁至 `docs/design/resource-monitor.md`，历史验收记录归入本 changelog。套件入口、Mod 和布局路径、安装行为不变。
- 新增 `install.sh`，一条命令完成资源采集程序构建、布局与八个 Mods 部署、快捷键合并和 `herdr-app check`；支持 `--switch` 和 `--dry-run`。README 改为以安装和使用为主，并保留 Gallery `RECIPE.md`、真实窗口预览和统一的布局源文件 `layouts/Professional.json`、`layouts/Professional.svg`。
- 新增根 Apache-2.0 许可、NOTICE 与第三方来源清单，部署 Mod 自带必要许可。核实 Herdr v0.1.14 与 Open VS Code 对应源码的 Apache-2.0 / MIT 条款，保留其他资源及 native 依赖许可；移除未核清分发权的四枚应用 PNG，以中性图标替代，应用选项和启动行为不变。

- 修复 Resource Manager 按空格时关闭弹层的问题：空格和 Enter 使用面板内的 action 绑定，避免宿主 Popover 提前将它们作为确认操作；空格继续输入关键词分隔符，Enter 保留行展开行为。

- Resource Manager 移除固定搜索框，改为直接键入过滤所有表格字段；支持空格分词、跨字段组合匹配与 Backspace 编辑。Tree 保留命中项的所属路径和 OS 父进程链；第一次 Esc 清空搜索，第二次 Esc 隐藏弹层。关闭 Ports 保留关键词并排除监听字段。

- Resource Manager 弹层在定位前按窗口尺寸计算像素宽高，保留 416 × 640 px 上限及窄窗口约束，消除百分比最大高度造成的 footer 上方空隙。

- Resources footer 的 CPU 低于 100% 时固定一位小数，达到 100% 后显示整数，例如 `1.0%`、`10.0%`、`120%`；图标与数值按单核占用从主题绿色经黄色渐变到红色，未知值保持中性色。CPU、内存各自分组，等宽数值左对齐并紧贴前面的图标，分隔符前后各一个空格；组内按内容排列，外层固定为 164 px，剩余空位留在最右侧。

- Professional 支持单次 `⌘⇧G` 等待 300ms 后切换 Changes、300ms 内连续两次切换 Git Graph；两种操作均可再次触发以隐藏对应面板。Changes 按可见状态切换，不受终端或面板焦点影响；双次操作保留右侧 Files/Changes 状态。由标签栏统一计时，切换 space、tab 或布局后丢弃待执行操作，Files 快捷键立即执行并取消待处理的 Changes。安装器移除旧原生双次序列，避免叠加宿主固定的 1 秒等待，卸载恢复安装前原值。
- Agents 列表隐藏 OMP 自动标题中品牌后方的重复状态符号，包含等待、需关注、静态分隔符及四种 spinner；状态保留在 Herdr 行尾。任务 emoji、正文、无品牌标题及手动命名的 tab 保持原样。
- Resources 改为 footer 实时 CPU、内存与原生弹层，共享一套 1 Hz 采样；footer 不显示 `≈` 和终端数。沿用 Orca 的 416 px 弹层与紧凑表格；原 Resources / PTYs 合并为 Tree 页签，资源树按 Space → Pane 展示，省略 Tab 层，统一保留排序、子进程树、内存趋势和组合搜索。Ports 开关默认关闭，关闭后清空端口条件并隐藏缓存端口行。未知及覆盖不完整单独标注；应用失活暂停，显示值不变时减少 footer 与弹层重绘。
- Resource Manager 新增 Processes 页，将受管终端及子进程铺平成 Name / PID / CPU / Memory 明细表，支持名称或机器名、精确 PID 筛选与列排序；共享现有快照，不新增采样或端口扫描。
- 新增 Rust helper：macOS Herdr 范围按受管根查询后代，System 枚举全机；Linux 使用 procfs，Windows 使用原生进程和 TCP API。按范围读取内存与累计 CPU，监听每 5 秒按需采集。PID 复用、超时和迟到结果不污染当前数据，不回退重型系统命令。
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

### 资源监控历史验收记录

以下记录迁自原资源监控方案，保留当时的验证范围与限制，不代表本次目录整理重新执行了这些验收。

130 项 Node 回归与 1 项 Cargo 单元测试通过。覆盖 CPU 忙循环对照、嵌套根与真实子进程、IPv4/IPv6 监听、全机端口搜索、无 argv 输出、非法 CLI 输入、CPU 预热与 PID 复用、异步作废、单一定时器、显示值不变免重绘、失活暂停、监听按需请求、卸载与权限回滚。Linux / Windows 通过 x86_64 Cargo check，尚未运行验收。

隔离应用安装后，8 个 Mod 的原生加载检查通过。独立应用 home 和 Core 会话中的原生帧已确认真实终端采样、footer 数值、横向页签、表头列对齐、PTYs 趋势与真实监听端口筛选。为在后台验证采样，测试副本强制视为活动窗口；发布源码仍按真实窗口活动状态暂停采集。端口筛选通过测试副本设置初始条件，不视为真实输入交互验收。

原生宿主加载检查覆盖 footer 与强制打开的 Resources / PTYs；新增 Processes 后，另用隔离 Mod 检查了新增页面及已知、未知、过期进程行。33 项相关回归通过，覆盖平表去重、跨机器 PID、PID 复用、过滤、排序和共用采样。

2026-11-11 合并为 Tree 后，34 项相关回归与 Herdr Desktop 0.1.15 的 Mod 加载检查通过。隔离应用 home、Core 会话和本机监听进程验证了 Tree / Processes 实际渲染、内存趋势、页签切换，以及 Ports 开关的启用与关闭。真实端口通过隔离副本预设筛选条件显示；关闭 Ports 后，端口行、端口筛选框与监听说明消失。原生辅助功能接口未能写入筛选框，因此预设条件验证不视为真实输入交互验收；本次未验证物理鼠标、键盘或滚动，未更新日常安装。

通过宿主桌面工具在真实窗口点击 footer 并切换 Processes，已确认 Space → Pane 展示、平表四列对齐和真实采样数据。这不能证明像素级 1:1；实际筛选输入、排序点击、键盘焦点、Esc / outside dismissal、滚动、主题和窄窗口仍需真实窗口验收。只读范围和布局均在自维护扩展内，不修改 Desktop/Core/TUI 本体。

2026-11-11 改为键入过滤后，38 项相关回归、完整 Node 测试与 Herdr Desktop 0.1.15 的 Mod 加载检查通过。隔离应用用固定样本验证无搜索框的 Tree 和预设 `worker 12.5% 2.0 MB` 的 Processes 渲染。通过原生 action 分发确认第一次 Esc 清空搜索且 `open=true`，释放后第二次令 `open=false`。后台窗口的辅助功能接口未暴露可操作控件，截图在后台也未持续刷新，因此这些结果不视为真实物理按键及关闭画面的验收。未更新日常安装。

随后修复空格关闭弹层的回归。宿主 Popover 的空格与 Enter 绑定会先分发 Confirm action，再决定是否发送原始键盘事件；Resource Manager 现在为这两个按键注册局部 action。模拟该分发顺序的回归测试先复现空格令 `open=false`，修复后通过；39 项相关测试覆盖 Tree / Processes 的空格分词、Enter 行展开和两次 Esc。完整 Node 测试与 0.1.15 Mod 加载检查通过。本次未验证真实物理按键，未更新日常安装。

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
