# oh-my-herdr

一个包含布局、两个独立功能 Mods 和一个布局适配 Mod 的 Herdr Desktop 扩展项目。当前版本为 `0.3.0`，目标运行版本为 Herdr Desktop `0.1.14`。

源码统一放在 `desktop/extensions/oh-my-herdr/`，项目内包含 `layouts/`、`mods/`、安装脚本和文档。它不是单个带路由器的 Mod；运行时仍部署为 Herdr 原生的多个 Mod 目录。不修改 Herdr 本体、内置 Mods、内置布局或快捷键。

## 安装与启用

需要 Node.js 和已安装的 `herdr-app`。先用目标应用目录启动一次 Herdr，生成内置模块、图标及类型声明。

在工作区根目录执行：

```sh
node desktop/extensions/oh-my-herdr/oh-my-herdr.mjs install
node desktop/extensions/oh-my-herdr/oh-my-herdr.mjs check
```

`install` 部署组件并记录文件归属，不切换布局。`check` 检查部署文件、布局引用和静态资源，并对每个 Mod 执行 `herdr-app check`。成功后，手动选择布局：

```sh
herdr-app do layout.switch '{"name":"Professional"}'
```

最后一条命令会改变当前窗口的布局。安装或检查不会替你执行它。`Professional` 复用内置标签栏，保留 Files、Changes；Open With 位于窗口右上角。底部 statusline 按机器、分支、agents、Git Graph 的顺序显示，命令面板提示保留在最右侧。左侧 footer 只保留 Settings、Add machine。

指定其他应用目录时，对每条命令使用同一目录：

```sh
node desktop/extensions/oh-my-herdr/oh-my-herdr.mjs install /private/var/tmp/oh-my-herdr-app
node desktop/extensions/oh-my-herdr/oh-my-herdr.mjs check /private/var/tmp/oh-my-herdr-app
HERDR_APP_HOME=/private/var/tmp/oh-my-herdr-app herdr-app do layout.switch '{"name":"Professional"}'
```

目录优先级：命令最后一个路径参数、`HERDR_APP_HOME`、`$XDG_CONFIG_HOME/herdr-app`、`~/.config/herdr-app`。

安装器拒绝路径中的符号链接，包括父目录。macOS 上 `/var` 是系统链接，因此示例使用真实路径 `/private/var/tmp`；其他位置也应使用不含链接的物理路径。

## 组件与源码

`oh-my-herdr.json` 是套件清单，记录版本、组件路径和来源。`open-with`、`git-graph` 各自维护功能代码与资源，不互相导入。`professional-status` 只负责 Professional 状态栏的组合；内置状态栏没有插槽，因此由这个薄适配器在 agents 信息后放置 Git Graph 按钮。运行时部署这三个 Mod，不增加统一路由或跨 Mod shared 包。

| 组件 | 源码 | 用途 |
| --- | --- | --- |
| Professional | `layouts/professional/` | 自定义工作区布局和预览图 |
| open-with | `mods/open-with/` | 选择本机应用打开当前仓库或目录；VS Code 支持 Remote - SSH |
| git-graph | `mods/git-graph/` | Git 历史图、Manygit、详情、操作菜单与确认对话框 |
| professional-status | `mods/professional-status/` | 布局适配器：机器、分支、agents、Git Graph 入口与命令面板提示 |

布局继续引用内置 `workspace-chrome`、`spaces`、`agents`、`tabs`、`files` 和 `changes`。这些模块由 Herdr 更新，不归套件管理。pane header 使用 `git-graph` 的 `pane-header` 角色，基于内置 `pane` 0.1.14 保留标题、状态及 split/zoom/close 操作，并为 diff 显示文件路径；宿主的原生 pane title 仍是只读值。移除 `tabs-professional` 后不再维护标签栏副本；`professional-status` 的来源是内置 `workspace-status` 0.1.14。

两份重复 Git Graph 合并为 `git-graph`，采用较新的 0.3.2 实现，保留分支 checkout 的 `--` 安全边界和预热时跳过 working-tree status 的行为。`git-graph-main` 不再作为独立 Mod 部署。保留上游来源与许可证，不恢复模块自身的版本检查或更新提示。

Open With 的 `props.role: "launcher"` 用于右上角双段按钮：主按钮显示默认应用图标和名称，点击直接打开当前仓库或目录；右侧下拉打开应用选择菜单，可选择其他打开方式或设置默认应用。默认角色仍是应用选择菜单；入口初始化不会提前启动外部程序。状态栏适配器通过布局传入的 Graph `panel`、`mod` 绑定切换独立底部面板。入口仅显示文字，不使用浮窗，不把 Professional 节点 ID 写入 Git Graph 功能代码。

Professional 为 launcher 传入 `props.widthTarget: "open-with-launcher"`，指定可调整宽度的布局节点。按钮通过原生尺寸回调将槽位调整为按钮实际宽度加 10 像素右侧留白，避免短名称留下固定占位；按钮最大宽度为 190 像素，超长名称截断。其他布局不传 `widthTarget` 时，Open With 不调整布局。

Git Graph 位于终端及右侧面板下方、状态栏上方，默认收起。点击底部 Git Graph 切换显示；拖动上沿调整高度，初始高度为 420 像素，范围为 240–800 像素。Files、Changes 继续共用右侧面板，可与 Graph 同时显示；内置 `tabs` 仍按 space 恢复 Files/Changes，不控制 Graph 的开关。

当 workspace 本身是 Git 仓库且包含已初始化的 submodules 时，Graph 标题提供仓库选择器：主仓库标记为 `(root)`，子仓库使用 workspace 相对路径，递归包含嵌套 submodules，不受 Manygit 扫描深度限制。默认仍显示当前终端所在的仓库；切换后只读取所选仓库的历史、分支和工作区状态，详情、diff 与 Git 操作也固定到该仓库及机器。切换 workspace/cwd 后按新上下文加载；同一上下文重新进入时复用此前选择。

仓库选择器使用锚定按钮的浮动菜单，覆盖在提交图上方，不挤占面板空间或推动列表。菜单最多高 260 像素，超出时内部滚动；选择仓库、按 Esc 或点击菜单外部可关闭。Manygit 打开仓库后的选择器使用相同浮层，返回仓库总览的行为不变。

未初始化的 submodules 不显示，也不会自动初始化、更新或 fetch。没有 submodules 的普通仓库保持原样；非 Git 目录继续使用 Manygit 扫描。仓库列表在刷新历史时重新发现，打开选择器时重新读取各仓库状态。选择其他 submodule 不会改变终端 cwd 或内置 Changes 的目标。

个人快捷键可在应用目录的 `keys.json` 中合并以下区块；安装器不修改快捷键。仅在 Professional 布局中，连续按两次 `⌘⇧G` 切换 Git Graph 的显示与隐藏；单次不切换面板，现有 `⌘G` 不变。这里使用 Herdr 原生的空格分隔按键序列，不需要新增 Mod。

```json
"layout:Professional": {
  "cmd-shift-g cmd-shift-g": "layout.toggle:graph-panel"
}
```

`keys.json` 自定义后不会自动合入新版默认快捷键，后续新增默认绑定需要手动合并。

点击 commit 行，在该行下方展开详情；再次点击收起，点击另一条则切换展开项。左侧显示 Commit、Parents、Author、Committer、Date 和提交说明，右侧按目录显示变更文件及增删统计。窄面板改为上下排列。展开项与提交列表共用滚动区域，后续提交顺延，图线跨过展开区继续连接。Esc 或详情右上角的关闭按钮也可收起。

单击变更文件会打开只读 diff 预览 tab，每个 space 最多保留一个可替换的预览。单击其他文件时，更新同一个 tab 的内容和名称，不关闭重建。双击文件会固定该 tab，后续单击会另开预览，不覆盖固定项；再次打开已固定的同一文件、仓库、机器和 commit，会切回原 tab。预览 tab 的名称带 `Preview`，固定后移除该前缀。使用标准 tab 关闭按钮关闭。

预览正文区域仅显示 diff，行号、增删标记和 hunk 分隔行从顶部开始铺满可用空间；不重复显示文件路径、提交元信息、仓库位置或预览说明。预览/固定状态保留在 tab 名称中，提交详情仍在 Graph 展开区查看。保留横纵滚动，以及加载、空内容、二进制和错误状态；读取上限仍为 3,000 行、每行 2,000 字符，未跟踪文件最多读取前 400,000 字符。

diff pane title 显示相对路径，完整标题可通过悬停查看。普通仓库相对 Git 根目录；从 workspace 打开子仓库或 submodule 时，相对 workspace 的 Git 根目录显示，无 Git 仓库的 workspace 则相对该目录。例如 workspace `/work/project` 中的 submodule `/work/project/libs/client`，文件 `src/index.ts` 显示为 `libs/client/src/index.ts`。直接在 submodule 中打开时显示 `src/index.ts`。路径基准和机器随 diff 固定，不跟随之后的 cwd 或焦点变化；不属于同一 workspace 的仓库使用自身相对路径。Git 读取始终在文件所属仓库执行，不把 workspace 相对路径传给 submodule 的 Git。

每次读取都固定仓库、机器、commit 和文件，不随焦点改变；快速切换时，过期的异步结果不会覆盖新文件。未提交变更显示打开时读取的工作区内容。不创建终端或磁盘临时文件。预览状态由扩展管理，tab 仍按宿主规则保存和恢复，不依赖 Herdr 0.1.14 缺少的原生 preview-tab 标记。

Graph 的 Changes 跳转只在布局显式提供绑定且目标与内置 Changes 一致时显示；独立 pane、异仓库或 Manygit 子仓库不会误跳到当前窗口的另一个仓库。

## 更新、接管与卸载

更新源码后，再执行 `install`。它也是更新入口，不需要独立 updater。

已移除 Git Graph 的 F4 源文件跳转与内部源文件预览。更新前先关闭已有的源文件预览 tab；diff 预览和固定 tab 不受影响。安装器会按归属记录移除未修改的旧 `source.js`、`source-file.js`，不修改全局快捷键。

- 首次安装只接管与源码逐字节一致的已有文件。其他同名文件视为冲突。
- 后续更新依据 `.oh-my-herdr/installed.json` 中的文件哈希判断归属。本地修改或删除受管文件时，安装停止，不强制覆盖。
- 操作先检查全部冲突。执行期间发生可恢复的文件操作错误时，回滚本次写入；这不是跨文件系统的断电事务。
- 不修改 Herdr 自己的 `installed.json`，也不覆盖共享状态、会话、窗口信息或布局点击状态。
- `apps.json`、`hosts.json`、自定义图标等非受管文件保留。生成的 `.d.ts`、`jsconfig.json`、`.error` 不作为套件源码发布。

已有运行副本可能含有单独 updater 或本地修改，因此第一次整合可能报告冲突。先把冲突文件备份到应用目录之外，确认差异后再处理旧副本。不要直接清空整个 Mod 目录，也不要删除个人配置以绕过检查。

从 `0.1.0` 或 `0.2.0` 升级时，安装器按旧归属记录移除未修改的 `git-graph-main`、`tabs-professional` 和 `open-vscode` 受管文件。`open-vscode` 的能力已合入 Open With，不部署旧入口或兼容别名。个人布局或快捷键中的旧引用需要改为内置 `tabs` 或 `open-with`。

退休 `open-vscode` 时，安装器将旧 `mods/open-vscode/hosts.json` 复制到 `mods/open-with/hosts.json`，仅在新文件不存在时写入；内容相同则保留，不同则在任何写入前停止。冲突时先备份并合并两份配置，再将旧文件移到 `mods/` 之外。新配置不纳入归属记录，卸载也不删除。迁移只执行一次，后续更新不再读取旧路径。

升级前备份旧目录到应用目录之外。旧目录中剩余的生成文件或个人文件保留；升级后将这些剩余目录移入备份，不要继续留在 `mods/` 下。不要删除整个 `data/` 或手改 `layouts/.state/`。共享 `git-graph.*`、`open-with.default-app` 状态沿用。

卸载前，先手动切回内置布局，并关闭使用这些 Mods 的自定义窗格或弹窗：

```sh
herdr-app do layout.switch '{"name":"main"}'
node desktop/extensions/oh-my-herdr/oh-my-herdr.mjs uninstall
```

卸载只移除归属记录中的未修改文件。遇到修改过的受管文件时停止；非受管配置、生成文件和状态保留。安装器不自动切布局，因此卸载后引用这些 Mods 的其他个人布局需要自行调整。

回退到旧套件版本时，使用保存的旧源码执行 `install`。更新前若存在本地修改，先在应用目录之外备份并完成合并，不使用强制覆盖。

## Open With 配置

Open With 在打开菜单或点击主按钮时固定目标。它从当前终端 cwd 查询 Git 根目录；不在 Git 仓库时使用 cwd。没有当前终端 cwd 时，再使用当前 tab 的终端目录或 space 目录。它不读取 Files 或 Changes 的文件选择，也不支持文件目标。

默认候选为 VS Code、Finder、Zed、IntelliJ IDEA、Cursor 和 Sublime Text；应用需要另行安装。点击应用行执行本次打开，点击右侧星标设置默认应用。默认应用 ID 保存在共享状态 `open-with.default-app`，组件名称和状态 key 沿用整合前的值。

菜单支持方向键、Enter 打开、D 设置默认、Esc 关闭。设置默认应用后，主按钮立即同步图标和名称。主按钮每次点击时重新获取当前目录，打开失败时显示错误通知；菜单打开失败时保留错误，可以重试或选择其他应用。远程目标只提供 VS Code，通过本机的 Remote - SSH 打开，主按钮也显示 VS Code；不会把远程路径交给本机普通应用。Windows、Linux 上也只提供 VS Code。本机 macOS 继续提供完整应用列表。

在目标目录的 `mods/open-with/apps.json` 中配置完整应用列表，例如：

```json
[
  { "id": "vscode", "title": "VS Code", "bundleId": "com.microsoft.VSCode" },
  { "id": "finder", "title": "Finder", "bundleId": "com.apple.finder" }
]
```

每项需要唯一 `id` 和非空 `title`，最多 20 项。普通应用需要 macOS `bundleId`；`id: "vscode"` 是专用 VS Code 启动项，其 `bundleId` 可省略。可选 `icon` 为应用目录内的相对图片路径或绝对路径；省略时使用通用图标。不创建该文件时使用默认列表。远程目标或非 macOS 平台即使自定义列表省略 VS Code，也会提供内置 VS Code 项。此配置属于用户，不回写源码、不随更新删除。

在 `mods/open-with/hosts.json` 中覆盖 Core 机器名到 SSH Host 的映射，例如 `{"my-machine":"my-ssh-alias"}`。远程打开依赖本机 VS Code 的 Remote - SSH 扩展、可用的 SSH 配置及连接权限，不随套件安装远程软件。它不能直接复用 Core 的 relay／`via` 连接，需要自行提供可用的 SSH Host。VS Code 优先使用 `code --folder-uri`，失败后使用本机协议打开器；两条路径使用同一目录和机器目标。

## 开发与验证

源码到应用目录单向部署，不反向同步整个应用 home。不要提交生成类型、运行状态或个人配置。

运行文件生命周期、Open With 和 Graph 行内展开回归检查：

```sh
node --test desktop/extensions/oh-my-herdr/oh-my-herdr.test.mjs desktop/extensions/oh-my-herdr/open-with.test.mjs desktop/extensions/oh-my-herdr/git-graph.test.mjs
```

在隔离应用目录中安装并运行 `check`。要验证完整界面，还需要用独立的 `HERDR_APP_HOME` 和隔离 Core 会话启动真实应用；仅隔离应用 home 不代表 Core 终端和空间已隔离。

commit 展开区使用 retained `CommitDetails` 子视图，挂载到虚拟列表中的独立条目。交互控件归子视图所有；不要在 deferred row renderer 注册事件，也不要把外层 render 创建的元素对象传进 row renderer。元素对象只属于创建它的那次描述，不能跨描述复用。

`herdr-app check` 只覆盖初始加载，不覆盖异步数据、延迟绘制、实际布局和点击流程。真实窗口验收包括：内置标签栏、Files/Changes、底部 Graph 开关及高亮、commit 展开/收起/切换、展开后的图线和滚动、单击文件复用预览、双击固定、固定项不被替换、关闭预览后重开、Git 右键菜单、Open With 菜单与键盘关闭、窄面板和布局切换。未连接远程目标时，不宣称 Remote - SSH 已验证。

## 安全与分发边界

Mods 是可信代码，不是沙箱。Git Graph 可执行 Git 写入和网络操作，例如提交、切换分支、fetch、push；查看面板不等于授权执行这些操作。Open With 可以启动本机应用或通过 VS Code 发起远程连接。安装前应审查源码，不自动运行破坏性操作验证功能。

Git Graph 的上游版权与 MIT 文本随源码保留。Open With 品牌图标的来源见 [NOTICE](mods/open-with/icons/NOTICE.txt)。其中部分图片提取自本机应用，提取不代表获得公开再分发许可。本套件当前用于本地整合；公开发布前必须核查组件和资源授权，不能把套件版本视为全部资源采用同一许可证。

合入 Open With 的旧 `open-vscode` 快照没有附带 LICENSE，来源情况记录在组件清单中。原 Open With 的 Apache-2.0 文本不代表该导入代码也已获得同一授权。未核清授权前，不将本地整合包作为可公开分发的软件发布。

## 本机验证记录

### 未发布修改

2026-11-10 移除 F4 源文件跳转及专用预览实现，删除对应的四项源文件预览测试。保留的 10 项 Graph 回归检查全部通过，`git-graph` 通过 `herdr-app check`。此次未更新日常安装，未在真实窗口验证移除后的按键行为。

2026-11-10 在 Herdr Desktop `0.1.14` 的隔离应用目录和独立 Core 会话中验证：

- 54 项现有回归检查通过，三个 Mod 的 `herdr-app check` 均通过，宿主状态及 `.error` 检查无错误。
- 真实渲染显示右上角应用图标、名称和独立下拉按钮，以及底部纯文字 Git Graph；IntelliJ IDEA 名称完整显示。
- 通过原生可访问性操作验证下拉按钮打开菜单、设置 Finder／IntelliJ IDEA 为默认应用后主按钮同步，以及 Esc 关闭菜单。
- 使用实际主按钮回调和模拟执行器检查点击时的目录及默认应用、重复点击保护、远程应用过滤、失败通知和空配置禁用。未实际启动外部应用或连接 SSH，未验证鼠标坐标命中区域，未更新日常安装。

同日完成按钮间距修复并更新日常安装：隔离窗口中，VS Code 和 IntelliJ IDEA 槽位分别随内容调整为 124、143 像素，超长自定义名称在 190 像素按钮上限内截断，下拉按钮保持可见。日常窗口中的 VS Code 槽位为 127 像素；已查看实际渲染，确认 Changes 旁的多余占位消失。54 项回归检查和三个 Mod 加载检查通过，布局、标签、焦点、设置及快捷键保留。

本次底部面板与 commit 行内展开改动，在独立应用目录和 Core 会话中验证：

- 部署 61 个受管文件，三个 Mod 的 `herdr-app check` 通过；8 项 Graph 回归检查覆盖展开位置、分页、收起、切换提交，以及预览替换、固定、关闭和目标隔离。
- 真实窗口确认 Graph 位于底部，Files/Changes 可在右侧同时显示；通过宿主命令检查开关和高度调整。检查了 1280 × 820 和 760 × 600 像素窗口，元信息与文件区在宽面板左右排列，在窄面板上下排列。
- 真实文件行回调连接实际宿主，确认单击其他文件保留 tab ID、双击固定后新增独立预览、再次打开固定项复用原 tab、关闭预览后可重开。真实 Git 读取覆盖已提交快照、未跟踪文本和二进制状态；确定性异步检查确认过期成功和失败均不覆盖新文件。
- 已使用应用内截图检查提交详情、文件树和 diff 正文。系统屏幕录制权限未授予，原生鼠标命中与拖动尚未通过验收；回调驱动的结果不视为物理点击证明。
- 未更新日常安装，未重启日常应用或终端。一次性脚本和回调探针已清理，隔离窗口保留供检查。

### 0.3.0

2026-11-10 在 Herdr Desktop `0.1.14`、Core `0.1.19`、Node.js `26.13.0` 上验证：

- 54 项回归检查通过，覆盖组件退休、SSH 配置迁移与回滚、目标机器归属、URI 编码和启动失败路径。
- 隔离目录部署 57 个受管文件，三个 Mod 的 `herdr-app check` 均通过。
- 真实原生窗口显示右上角 Open With，以及底部机器、分支、agents 信息右侧的 Git Graph 按钮；左侧 footer 仅保留 Settings/Add machine。Git 图加载了临时仓库提交和未提交变更，状态无错误。
- 通过一次性回调脚本连接真实宿主，验证 Graph 开、关及从 Changes 切回，以及右上角入口打开实际菜单；原生 Esc 关闭菜单通过。未进行鼠标命中区域验收。
- 系统截图权限不足，使用应用自身的 `shot` 检查实际渲染，不修改系统权限。App home、Core session、配置和测试仓库均隔离，未更新日常安装。

没有从菜单启动外部应用或连接 SSH。Remote - SSH 和 Windows PowerShell 路径仅完成逻辑边界检查，未作目标平台端到端验证。Git 测试提交只写入临时仓库，不写用户仓库或远端。

### 0.2.0

0.2.0 于 2026-11-09 在 Herdr Desktop `0.1.14`、Node.js `26.13.0` 上完成验证：

- 33 项回归检查通过，覆盖文件生命周期、配置保留、路径边界、失败回滚以及五个 Mods 向四个 Mods 的归属迁移。
- 隔离目录部署 60 个受管文件，四个 Mods 的 `herdr-app check` 全部通过。真实隔离窗口显示 Professional 工具栏和合并后的 Git 提交图，异步加载出测试提交，状态无错误。
- 日常安装已更新到四个 Mods，四项加载检查通过。运行目录保留 21 个内置 Mods 和四个项目 Mods，旧 `git-graph-main` 目录已移到 `backups/` 下，不再参与加载。
- 内置文件、设置和快捷键的哈希未变；当前布局、标签及焦点保持不变。源码旧平级入口已移入独立项目目录。
- 系统截图权限不足，使用 Herdr 自带 `shot` 导出实际渲染画面，不修改系统权限。

未执行 Git push、reset 等写入操作，未从菜单启动外部应用，未连接远程 SSH 目标。Open VS Code 完成静态加载检查，未作 Remote - SSH 端到端验证。重组和去重没有重启日常应用或终端。

