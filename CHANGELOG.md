# Changelog

## Unreleased

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
