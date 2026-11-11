# Resources 原生监控方案

状态：资源监控已安装到本机日常应用；本次 Tree 合并尚未更新日常安装，目标 Herdr Desktop 0.1.15。运行配置与构建产物不入库，套件尚未发布新版本。

## 功能与边界

Professional footer 直接显示 CPU 和内存，不显示 `≈` 或终端数。点击打开同一 View 的 Resource Manager。界面沿用 Orca 的图标、数值格式、416 px 宽度和 640 px 高度上限。原 Resources / PTYs 合并为 Tree，统一提供资源树、内存趋势和键入过滤；默认关闭的 Ports 开关控制端口显示及搜索范围。Processes 提供 Name / PID / CPU / Memory 平表。使用原生 Popover、Tab、虚拟列表与主题色。关闭 Ports 隐藏已缓存端口行，保留关键词并仅按其他字段匹配。

两页均无固定搜索框。直接键入字符进入搜索，空格分隔关键词，忽略大小写且全部命中；支持跨字段匹配名称、机器、PID/PPID、显示格式的 CPU 和内存，Tree 还支持所属路径与已启用的监听字段。Backspace 删除字符，第一次 Esc 清空搜索，第二次 Esc 关闭弹层；Esc 使用局部 action 绑定，优先于 Popover 的默认关闭处理。方向键和 Enter 保留导航及展开操作，空格仅用于分词。切换页签清空搜索。

监控对象是 Core 公开的 live 终端 PID 及真实 OS 后代。界面按 Space → Pane 展示，当前 Space 置顶；内部保留 Machine / Space / Tab / Pane 归属关系，展示时跳过 Tab 层。逻辑 parent 只定位展示层级；资源归属只使用 OS PPID。没有可靠 PID 绑定的 Desktop、Core、已脱离进程树的 daemon 和容器，不虚构计量桶。

Processes 直接使用 Machine 汇总中已去重的进程，不先展开资源树。每个进程显示一次，使用 machine + PID + start 身份稳定标识行；同 PID 的不同机器彼此独立，PID 复用会更换行标识。多个关键词同时匹配同一行，不补入父进程，PID 支持子串匹配。支持名称、PID、CPU、内存排序，CPU/内存排序时未知值排在已知值之后，过期 CPU/内存显示 `—`。该页共用 1 Hz 样本，使用虚拟列表，不增加 helper 调用或监听扫描。Tree 开启 Ports 后，非空关键词搜索会启用全机监听查询，沿用 5 秒间隔，不逐按键扫描。

功能只读，不提供清理、结束进程或重启服务操作。不读取进程命令行、环境变量或终端内容，不持久化采样数据，不发 HTTP 请求、不转发端口。内存趋势最多保留 60 个有效点，仅存于 View 内存。

## 采集结构

```text
Professional layout
  ├─ professional-status：机器、分支、agents、Git Graph
  ├─ resource-monitor View：footer + Popover + 单一定时器
  │    ├─ collect.js：每台机器的请求合并、CPU 基线、监听缓存
  │    ├─ herdr.exec → herdr-resource-sample → 一份 JSON
  │    ├─ model.js：进程身份、归属、去重、汇总、未知值
  │    └─ tree.js：展示树、组合筛选、虚拟行
  └─ professional-status hint：命令面板提示
```

footer 和弹层共用一个 Mod 实例，无共享 store 或第二个采样器。系统调用不在 render 或行渲染回调中执行。helper 是一次性命令，不驻留、不启动服务、不执行子命令。

| 方案 | 目标适配 | 复杂度与失败方式 | 运行成本 |
| --- | --- | --- | --- |
| 每秒原生快照，当前实现 | 保留实时 CPU/内存，复用现有 exec 契约 | 一份 JSON；失败独立标记，不保留成功假象 | 有进程启动成本；本机 helper 常态约 0.55–0.61% 单核 |
| 常驻 helper + IPC | 可消除重复启动成本 | 需要增加 IPC、版本协商、存活检测、租约和退出处理；当前宿主 exec 不提供流式子进程句柄 | 常驻内存及唤醒；本项目未实现、未实测 |

当前先选择一次性 helper，避免增加服务生命周期。在完整链路验收前，不声称监控成本为零或已达到 0.5% 目标。

## 调度与生命周期

- 活跃应用每 1000 ms 采集 CPU/内存。同机请求合并，全局最多并发两台机器，较旧快照优先。单次 exec 超时 2000 ms。
- 应用失活不启动新采样，清除 CPU 基线和监听调度时间；恢复后的首份 CPU 为未知。弹层关闭不影响 footer 采样。
- 只在弹层的 Tree 页可见且 Ports 开启时采集监听，每 5000 ms 一次。默认只读受管进程；存在非空关键词时补充全机监听。输入修改合并到下一次 tick。切到 Processes、关闭 Ports 或关闭弹层后暂停端口采集。
- 连接、终端根或机器身份改变时作废旧基线。旧连接、已移除目标、已关闭 View 的迟到结果不合入新状态。
- View 销毁后取消 timer，释放 InputState、FocusHandle、滚动句柄和历史。不会结束用户终端。
- footer 和弹层按实际显示值比较；数值未变时，不因新快照时间推进主动重绘。CPU、行内容、状态或趋势改变时刷新。footer 悬停时更新 tooltip。

## 原生 helper

源码位于 `native/resource-sample/`。Rust 锁文件固定依赖，发布构建使用 LTO、符号裁剪与 panic abort。构建只写本项目 target 和 Mod bin，不构建上游仓库。

```sh
node scripts/build-resource-helper.mjs
mods/resource-monitor/bin/herdr-resource-sample --roots=123,456
mods/resource-monitor/bin/herdr-resource-sample --roots=123,456 --ports
mods/resource-monitor/bin/herdr-resource-sample --roots=123,456 --all-ports
```

Windows 生成 `.exe`。`--ports` 只扫描受管进程；`--all-ports` 同时保留其他进程元数据用于全机端口搜索。空 roots 返回空受管集合。未知参数、非法 PID 返回非零状态。

| 平台 | 拓扑 / 身份 | CPU / 内存 | 监听 |
| --- | --- | --- | --- |
| macOS | 按根 PID 查询子进程；BSDInfo 启动时间；全机元数据仅用于全机端口搜索 | pidrusage 累计 CPU、resident、footprint；Mach ticks 按 timebase 换算；读取后重查启动身份 | libproc FD 与 SocketFDInfo |
| Linux | `/proc/PID/stat` 的 PPID 与 starttime | utime/stime、CLK_TCK、RSS pages；meminfo | TCP 表与 FD socket inode 关联 |
| Windows | Toolhelp；GetProcessTimes 创建时间 | 累计 FILETIME CPU、Working Set；GlobalMemoryStatusEx | GetExtendedTcpTable |

macOS 常态不逐个查询全机进程的 BSDInfo。无子进程时清零 errno，避免 libproc 将合法空列表误判为失败。全机端口元数据的覆盖状态与受管进程覆盖状态独立。

### JSON 契约

顶层：`schema: 1`、`platform`、`monotonic`（秒）、`topologyComplete`、`rows`、`host`、`listeners`、`listenerError`。

每个进程包含：`pid`、`ppid`、`name`、`start`（稳定身份或 null）、`seconds`（累计 CPU 秒）、`memory`（resident / working set 字节）、`footprint`（macOS 字节）。不可读计量为 null，禁止替换成零。

监听通道为 null，或 `{ rows, complete, scope }`；scope 为 `managed` 或 `all`。端点包含 `pid`、`family`、`address`、`port`、`protocol: tcp`、`socket`。仅在内核返回共享 socket 身份时据此去重；相同端口号不能证明是同一个 socket。

主机通道为 `{ total, available }`，单位字节。macOS 当前只返回 total，available 为 null；不会用 free 或受管进程之和代替主机可用内存。监听失败不丢弃独立有效的 CPU/内存结果。

## 归属、计量与未知值

身份使用 machine + PID + start。嵌套终端根的后代归最近根；终端详情不重复纳入嵌套根的资源。上层按进程身份去重。重复根无法唯一归属时保留冲突和机器级已知小计，不任意指定 owner。

CPU = 累计 CPU 秒差 / 单调时间秒差 × 100。100% 代表一核。首次、缺失 start、PID 复用、计数回退、时间不前进或快照间隔超过 3 秒时显示未知。进程样本超过 3 秒后不计入实时 footer。

macOS 主列、排序、趋势统一使用 Footprint，详情保留 RSS。Linux 为 RSS，Windows 为 Working Set。KB / MB / GB 的进位与 Orca 一致，按 1024 换算；未知显示 `—`，覆盖不完整时在 tooltip 和弹层中说明已知小计。相加仍可能重复共享页，不代表主机占用。

监听有独立时间、拓扑与进程启动身份。CPU-only tick 保留该次监听元数据，不借用新 PID 的名字或资源。旧监听不能挂到复用的 PID。搜索无匹配不表示端口空闲；覆盖不足时明确显示。回环与通配地址只说明绑定范围，不证明服务可达。

## 安装与分发

本机构建产物为 `mods/resource-monitor/bin/herdr-resource-sample[.exe]`，随安装器部署。源码检出后必须先构建；缺少 helper 时安装预检失败。POSIX 安装要求 owner execute 位；失败回滚同时恢复原字节与权限。生成二进制和 target 忽略入库，许可证随 Mod 部署。

远端需要为该 OS/架构构建并将 helper 放入 PATH。当前不自动安装远端软件，不提权。helper 缺失、格式错误、非零退出或超时显示错误，不退回 ps/top/lsof/PowerShell。当前 native schema 与 JS collector 必须配套更新。

## 验证与性能口径

```sh
node scripts/build-resource-helper.mjs
node --test *.test.mjs
cargo test --locked --manifest-path native/resource-sample/Cargo.toml
cargo fmt --check --manifest-path native/resource-sample/Cargo.toml
cargo check --locked --manifest-path native/resource-sample/Cargo.toml --target x86_64-unknown-linux-gnu --target x86_64-pc-windows-gnu
python3 scripts/bench-resource-helper.py --roots=123,456 --samples=30
python3 scripts/bench-resource-helper.py --roots=123,456 --samples=30 --ports-every=5
python3 scripts/bench-resource-helper.py --roots=123,456 --samples=30 --ports-every=5 --all-ports
```

交叉检查需先安装相应 Rust target。原生测试必须使用本机新构建的 helper，不以字符串解析测试代替真实系统 API 验证。

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

目标为完整链路稳态不超过 0.5% 单核，验收上限 1%，helper 峰值 RSS 不超过 10 MiB。当前 helper 达到 1% 与 10 MiB 上限；原生应用短测增量接近 1% 上限，0.5% 目标尚未达到。完整链路未验收，尤其是 tooltip 悬停、数据频繁变化的弹层、远端 exec 包装与多机器并发。

130 项 Node 回归与 1 项 Cargo 单元测试通过。覆盖 CPU 忙循环对照、嵌套根与真实子进程、IPv4/IPv6 监听、全机端口搜索、无 argv 输出、非法 CLI 输入、CPU 预热与 PID 复用、异步作废、单一定时器、显示值不变免重绘、失活暂停、监听按需请求、卸载与权限回滚。Linux / Windows 通过 x86_64 Cargo check，尚未运行验收。

隔离应用安装后，8 个 Mod 的原生加载检查通过。独立应用 home 和 Core 会话中的原生帧已确认真实终端采样、footer 数值、横向页签、表头列对齐、PTYs 趋势与真实监听端口筛选。为在后台验证采样，测试副本强制视为活动窗口；发布源码仍按真实窗口活动状态暂停采集。端口筛选通过测试副本设置初始条件，不视为真实输入交互验收。

原生宿主加载检查覆盖 footer 与强制打开的 Resources / PTYs；新增 Processes 后，另用隔离 Mod 检查了新增页面及已知、未知、过期进程行。33 项相关回归通过，覆盖平表去重、跨机器 PID、PID 复用、过滤、排序和共用采样。

2026-11-11 合并为 Tree 后，34 项相关回归与 Herdr Desktop 0.1.15 的 Mod 加载检查通过。隔离应用 home、Core 会话和本机监听进程验证了 Tree / Processes 实际渲染、内存趋势、页签切换，以及 Ports 开关的启用与关闭。真实端口通过隔离副本预设筛选条件显示；关闭 Ports 后，端口行、端口筛选框与监听说明消失。原生辅助功能接口未能写入筛选框，因此预设条件验证不视为真实输入交互验收；本次未验证物理鼠标、键盘或滚动，未更新日常安装。

通过宿主桌面工具在真实窗口点击 footer 并切换 Processes，已确认 Space → Pane 展示、平表四列对齐和真实采样数据。这不能证明像素级 1:1；实际筛选输入、排序点击、键盘焦点、Esc / outside dismissal、滚动、主题和窄窗口仍需真实窗口验收。只读范围和布局均在自维护扩展内，不修改 Desktop/Core/TUI 本体。

2026-11-11 改为键入过滤后，38 项相关回归、完整 Node 测试与 Herdr Desktop 0.1.15 的 Mod 加载检查通过。隔离应用用固定样本验证无搜索框的 Tree 和预设 `worker 12.5% 2.0 MB` 的 Processes 渲染。通过原生 action 分发确认第一次 Esc 清空搜索且 `open=true`，释放后第二次令 `open=false`。后台窗口的辅助功能接口未暴露可操作控件，截图在后台也未持续刷新，因此这些结果不视为真实物理按键及关闭画面的验收。未更新日常安装。

随后修复空格关闭弹层的回归。宿主 Popover 的空格与 Enter 绑定会先分发 Confirm action，再决定是否发送原始键盘事件；Resource Manager 现在为这两个按键注册局部 action。模拟该分发顺序的回归测试先复现空格令 `open=false`，修复后通过；39 项相关测试覆盖 Tree / Processes 的空格分词、Enter 行展开和两次 Esc。完整 Node 测试与 0.1.15 Mod 加载检查通过。本次未验证真实物理按键，未更新日常安装。
