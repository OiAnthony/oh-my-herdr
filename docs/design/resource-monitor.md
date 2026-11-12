# Task Manager 原生监控设计

目标版本为 Herdr Desktop 0.1.15。本文记录资源采集架构、JSON 协议和性能口径；构建、测试与实机验证步骤见[开发指南](../development.md)，历史验收记录见 [Changelog](../../CHANGELOG.md#资源监控历史验收记录)。

## 功能与边界

oh-my-herdr footer 最右侧显示 Herdr 受管 CPU 和内存，不随弹层作用域变化。点击打开同一 View 的 Task Manager。使用原生 Popover、RadioGroup、Tab、虚拟列表与主题色，宽度上限 416 px，高度上限 640 px。标题下方左侧为 Tree、Processes、Ports 页签，右侧为统一控制三个页签的 `Herdr / System` 选择器，同行使用 space-between 布局。每次打开返回 Herdr Tree，清空过滤并定位、展开当前 pane；打开期间切换页签保留范围。切换范围保留关键词与排序，重置滚动位置。Tree 始终显示已采集的监听行，不提供 Ports 开关。

三个页签均无固定搜索框。直接键入字符进入搜索，空格分隔关键词，忽略大小写且全部命中；支持跨字段匹配。Tree 和 Processes 可匹配名称、机器、PID/PPID、显示格式的 CPU 和内存，Tree 还支持所属路径与监听字段。Backspace 删除字符，第一次 Esc 清空搜索，第二次 Esc 关闭弹层；Esc 使用局部 action 绑定，优先于 Popover 的默认关闭处理。方向键和 Enter 保留导航及展开操作，空格仅用于分词。切换页签清空搜索。

Herdr 范围监控 Core 公开的 live 终端 PID 及真实 OS 后代。Tree 按 Space → Pane 展示，当前 Space 置顶；内部保留 Machine / Space / Tab / Pane 归属关系，展示时跳过 Tab 层。逻辑 parent 只定位展示层级；资源归属只使用 OS PPID。没有可靠 PID 绑定的 Desktop、Core、已脱离进程树的 daemon 和容器，不虚构计量桶。System 范围枚举各机器的 OS 进程，Tree 按机器 → PPID 层级展示，缺失父进程作为根，环打断一条边。进程节点只显示自身资源，机器汇总按身份去重，不重复累加后代。

Processes 使用当前范围按机器去重的进程，不先展开资源树。每个进程显示一次，使用 machine + PID + start 身份稳定标识行；同 PID 的不同机器彼此独立，PID 复用会更换行标识。多个关键词同时匹配同一行，不补入父进程，PID 支持子串匹配。支持名称、PID、CPU、内存排序，CPU/内存排序时未知值排在已知值之后，过期 CPU/内存显示 `—`。该页共用 1 Hz 样本，使用虚拟列表，不增加监听扫描。三个页签的搜索都只过滤当前范围，不触发范围扩大。

Ports 提供 Endpoint / Process / PID 平表，每 5 秒按当前作用域请求 TCP 监听。Herdr 只显示受管进程的监听，System 包含受管之外的监听，没有受管终端时仍可查询本机及工作区机器。按端口号、进程名或 PID 排序，键入过滤同一行的机器、监听地址、绑定范围、进程和 PID。监听使用该次扫描的进程身份，不向新快照中复用的 PID 借用名称；Herdr 再按 machine + PID + start 筛选归属。权限不足或采集失败时保留覆盖状态，空结果不表示端口空闲。

Tree 工具栏提供展开全部、收起全部和定位当前 pane。定位返回 Herdr Tree、清空过滤、展开目标及祖先并居中选中目标，支持终端与 Mod pane。摘要下方不显示常驻描述；机器、采样时间、错误与监听覆盖状态移到摘要 tooltip，行级状态保持不变。图标保留 tooltip 与辅助功能名称。摘要只显示当前机器，不跨机器相加。System 的可读进程计量与部分覆盖在 tooltip 中说明；内存进程合计不是系统已用内存。

功能只读，不提供清理、结束进程或重启服务操作。不读取进程命令行、环境变量或终端内容，不持久化采样数据，不发 HTTP 请求、不转发端口。内存趋势最多保留 60 个有效点，仅存于 View 内存。

### 数值排版规范

Task Manager 的实时数值更新不得引起水平布局位移。footer、面板摘要、Tree 与 Processes 的 CPU／Memory 都使用固定宽度、禁止 flex 收缩的数值槽、等宽字体和右对齐；不能只固定最外层宽度，内部仍按内容宽度排列。图标、分隔符、内存单位、指标标签和相邻列不随数值位数变化而左右移动，不对数值更新添加位移动画。

footer 位于命令面板提示右侧，是状态栏最后一个槽位，宽 188 px；触发按钮宽 176 px，CPU 数值槽宽 52 px，内存数值槽宽 64 px。面板摘要的 CPU／Memory 槽分别宽 64／76 px；表格保持 52／76 px。字体沿用平台等宽字体：macOS 用 Menlo，Windows 用 Consolas，其他平台用 monospace。不用空格补齐，不以省略号截断。

footer 数值最多三位数字，小数点、`%` 与单位不计入。CPU 低于 100% 保留一位小数，100% 至 999% 显示整数；舍入后超过三位时使用十进制缩写，例如 `1600% → 1.60k%`，`k%` 表示千个百分点，不改成整机归一化占用。内存按数值大小显示两位、一位或零位小数，例如 `1.24 GB / 12.4 GB / 124 GB`。单位仍按 1024 换算；舍入将产生四位整数时提前升单位，例如 `999.5 MB → 0.98 GB`。不截断或封顶采样值，颜色按未缩写的 CPU 计算；tooltip 与面板保留明细格式。

验收覆盖 `—`、`9.9% → 10.0%`、`99.9% → 100%`、`999% → 1.00k%`，以及内存的位数与单位切换。面板 CPU 保留一位小数。更新前后检查图标、分隔符、单位右边缘、内存指标标签、趋势图和列边界的位置，不要求不同字符数的文本左边缘重合。

## 采集结构

```text
oh-my-herdr layout
  ├─ professional-status：机器、分支、agents、Git Graph
  ├─ professional-status hint：命令面板提示
  └─ resource-monitor View：最右侧 footer + Popover + 单一定时器
       ├─ collect.js：每台机器的请求合并、CPU 基线、监听缓存
       ├─ herdr.exec → herdr-resource-sample → 一份 JSON
       ├─ model.js：进程身份、归属、去重、汇总、未知值
       └─ tree.js：展示树、组合筛选、虚拟行
```

footer 和弹层共用一个 Mod 实例，无共享 store 或第二个采样器。系统调用不在 render 或行渲染回调中执行。helper 是一次性命令，不驻留、不启动服务、不执行子命令。

| 方案 | 目标适配 | 复杂度与失败方式 | 运行成本 |
| --- | --- | --- | --- |
| 每秒原生快照，当前实现 | 保留实时 CPU/内存，复用现有 exec 契约 | 一份 JSON；失败独立标记，不保留成功假象 | 有进程启动成本；本机 helper 常态约 0.55–0.61% 单核 |
| 常驻 helper + IPC | 可消除重复启动成本 | 需要增加 IPC、版本协商、存活检测、租约和退出处理；当前宿主 exec 不提供流式子进程句柄 | 常驻内存及唤醒；本项目未实现、未实测 |

当前先选择一次性 helper，避免增加服务生命周期。在完整链路验收前，不声称监控成本为零或已达到 0.5% 目标。

## 调度与生命周期

- 活跃应用每 1000 ms 采集 CPU/内存。同机请求合并，全局最多并发两台机器，较旧快照优先。单次 exec 超时 2000 ms。
- 应用失活不启动新采样，清除 CPU 基线和监听调度时间，拒绝在途迟到结果；恢复后的首份 CPU 为未知。
- System 只在弹层打开且该范围被选中时采集。关闭按钮、Esc 和 Popover dismissal 都恢复 Herdr；关闭后保留 footer 的受管采样。范围切换清除旧基线、监听缓存及全机展示缓存，拒绝旧范围在途结果。
- 只在弹层 Ports 或 Tree 页可见时采集监听，每 5000 ms 一次，范围始终跟随选择器。Tree 默认启用监听显示与搜索，不设开关。切到 Processes 或关闭弹层后暂停端口采集。搜索不改变采集范围或扫描调度。
- 连接、终端根或机器身份改变时作废旧基线。旧连接、已移除目标、已关闭 View 的迟到结果不合入新状态。
- View 销毁后取消 timer，释放 FocusHandle、滚动句柄和历史。不会结束用户终端。
- footer 和弹层按实际显示值比较；数值未变时，不因新快照时间推进主动重绘。CPU、行内容、状态或趋势改变时刷新。footer 悬停时更新 tooltip。

## 原生 helper

源码位于 `native/resource-sample/`。Rust 锁文件固定依赖，发布构建使用 LTO、符号裁剪与 panic abort。构建只写本项目 target 和 Mod bin，不构建上游仓库。

```sh
node scripts/build-resource-helper.mjs
mods/resource-monitor/bin/herdr-resource-sample --roots=123,456 --scope=herdr
mods/resource-monitor/bin/herdr-resource-sample --roots=123,456 --scope=herdr --ports
mods/resource-monitor/bin/herdr-resource-sample --roots= --scope=system --ports
```

Windows 生成 `.exe`。省略 `--scope` 默认 Herdr；System 不受 roots 限制，采集所有可枚举进程的可读指标。`--ports` 在当前范围补充监听。移除旧 `--all-ports` 参数，不保留兼容路径。空 roots 在 Herdr 返回空集合，在 System 仍枚举全机。未知参数、非法范围和非法 PID 返回非零状态。原生 helper 与 Mod 必须配套构建、部署。

| 平台 | 拓扑 / 身份 | CPU / 内存 | 监听 |
| --- | --- | --- | --- |
| macOS | Herdr 按根 PID 查询子进程，System 枚举全机；BSDInfo 启动时间 | pidrusage 累计 CPU、resident、footprint；Mach ticks 按 timebase 换算；读取后重查启动身份 | libproc FD 与 SocketFDInfo |
| Linux | `/proc/PID/stat` 的 PPID 与 starttime | utime/stime、CLK_TCK、RSS pages；meminfo | TCP 表与 FD socket inode 关联 |
| Windows | Toolhelp；GetProcessTimes 创建时间 | 累计 FILETIME CPU、Working Set；GlobalMemoryStatusEx | GetExtendedTcpTable |

macOS 的 Herdr 常态不逐个查询全机 BSDInfo。无子进程时清零 errno，避免 libproc 将合法空列表误判为失败。System 覆盖状态不依赖是否开启 Ports；元数据不可读时保留 PID 和未知占位，指标不可读保持 null。监听单独保留错误状态，并在归属前复查进程身份。

### JSON 契约

顶层：`schema: 1`、`platform`、`monotonic`（秒）、`topologyComplete`、`rows`、`host`、`listeners`、`listenerError`。

每个进程包含：`pid`、`ppid`、`name`、`start`（稳定身份或 null）、`seconds`（累计 CPU 秒）、`memory`（resident / working set 字节）、`footprint`（macOS 字节）。不可读计量为 null，禁止替换成零。

监听通道为 null，或 `{ rows, complete, scope }`；scope 为 `managed` 或 `all`。端点包含 `pid`、`family`、`address`、`port`、`protocol: tcp`、`socket`。仅在内核返回共享 socket 身份时据此去重；相同端口号不能证明是同一个 socket。

主机通道为 `{ total, available }`，单位字节。macOS 当前只返回 total，available 为 null；不会用 free 或受管进程之和代替主机可用内存。监听失败不丢弃独立有效的 CPU/内存结果。

## 归属、计量与未知值

身份使用 machine + PID + start。嵌套终端根的后代归最近根；终端详情不重复纳入嵌套根的资源。上层按进程身份去重。重复根无法唯一归属时保留冲突和机器级已知小计，不任意指定 owner。

CPU = 累计 CPU 秒差 / 单调时间秒差 × 100。100% 代表一核。首次、缺失 start、PID 复用、计数回退、时间不前进或快照间隔超过 3 秒时显示未知。进程样本超过 3 秒后不计入实时 footer。

macOS 主列、排序、趋势统一使用 Footprint，详情保留 RSS。Linux 为 RSS，Windows 为 Working Set。KB / MB / GB 的进位与 Orca 一致，按 1024 换算；未知显示 `—`，覆盖不完整时在 tooltip 和弹层中说明已知小计。相加仍可能重复共享页，不代表主机占用。

Herdr 与 System 的节点 ID 和趋势相互独立。System 的机器趋势不因普通进程增减重置；进程趋势在 PID 复用时重置。完整覆盖且内存可读的新样本才追加趋势，缺失指标与错误样本不补零。

监听有独立时间、拓扑与进程启动身份。CPU-only tick 保留该次监听元数据，不借用新 PID 的名字或资源。旧监听不能挂到复用的 PID。搜索无匹配不表示端口空闲；覆盖不足时明确显示。回环与通配地址只说明绑定范围，不证明服务可达。

## 安装与分发

本机构建产物为 `mods/resource-monitor/bin/herdr-resource-sample[.exe]`，随安装器部署。源码检出后必须先构建；缺少 helper 时安装预检失败。POSIX 安装要求 owner execute 位；失败回滚同时恢复原字节与权限。生成二进制和 target 忽略入库，许可证随 Mod 部署。

远端需要为该 OS/架构构建并将 helper 放入 PATH。当前不自动安装远端软件，不提权。helper 缺失、格式错误、非零退出或超时显示错误，不退回 ps/top/lsof/PowerShell。当前 native schema 与 JS collector 必须配套更新。

## 性能口径

性能采样命令和测量边界见[开发指南](../development.md#资源采集性能测量)。以下为历史测量，不代表后续版本或当前运行环境的性能。

2026-11-11，macOS arm64，9 个受管根，采样期间后代数量变化，末次约 21 个进程。三种模式分别持续 30 秒，1 Hz；监听模式每 5 秒扫描一次。CPU 为单核百分比。

| 模式 | helper CPU 均值 / 次 | helper 单核占用 | 峰值 RSS | 单次 wall p95 |
| --- | ---: | ---: | ---: | ---: |
| footer | 6.09 ms | 0.61% | 1.86 MiB | 20.2 ms |
| PTYs，受管监听 | 5.48 ms | 0.55% | 1.88 MiB | 36.3 ms |
| 显式全机端口搜索 | 9.32 ms | 0.93% | 3.92 MiB | 33.6 ms |

二进制 336624 字节。测量控制器使用 POSIX spawn，单独记录 Python 控制器约 0.15–0.19% 单核；该控制器不是生产 JS。不同模式有负载变化，不据此宣称监听比 footer 更快。

参考 Node 测试中，约 865 条全机元数据、9 个根的 JSON 解析、资源模型、展开树投影执行 1000 次，约 0.77 ms CPU / 次。该数值不含进程启动、Herdr IPC 或 GPUI，不能直接加总为生产性能。

隔离原生应用另做了短测：一个终端、两个进程，后台测试副本强制活动，每种状态持续 10 秒。通过 `proc_pid_rusage` 读取 App 自身及已回收子进程累计 CPU，包括实际 exec、JS 与原生绘制。以下为单次顺序测量，基线包含其他 Mods；增量是相对暂停采集的差值，不是生产成本上限。该测量使用原来的内存与终端数 footer；直接显示 CPU 后尚未重测。

| 原生应用状态 | App 与子进程单核占用 | 相对暂停基线增量 |
| --- | ---: | ---: |
| 暂停监控 | 0.47% | — |
| footer | 1.43% | 0.95% |
| Resources 弹层，数值稳定 | 1.36% | 0.89% |

按显示值抑制重绘前，相同场景的弹层增量约 2.19%；应用该优化后为约 0.89%。两轮基线存在变化，不能把差值当作固定收益。活跃负载下显示值可能每秒改变，仍需单独测量。

目标为完整链路稳态不超过 0.5% 单核，验收上限 1%，helper 峰值 RSS 不超过 10 MiB。上述受管场景的历史 helper 短测满足 1% 与 10 MiB 上限；原生应用短测增量接近 1% 上限，0.5% 目标尚未达到。完整链路未验收，尤其是 tooltip 悬停、数据频繁变化的弹层、远端 exec 包装与多机器并发。

2026-11-12 新增 System 范围后，在 macOS arm64 用 `--roots= --scope system --samples=10 --ports-every=5` 短测，1 Hz，历时 10.00 秒。末次枚举 939 个进程，其中 730 个内存可读。helper 单核占用 1.55%，CPU 均值 15.52 ms／次，wall p95 为 210.45 ms，峰值 RSS 为 3.98 MiB，最大 JSON 为 134556 字节。Python 控制器另占约 0.37% 单核。该结果不含 Herdr IPC、生产 JS 和 GPUI；System helper 已超过上述 1% 上限，不能声明全链路性能达标。全机采集保持显式、面板内启用，不扩大默认 footer 的采集范围。
