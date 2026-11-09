# Changelog

## Unreleased

- 右上角 Open With 改为双段按钮：主按钮显示默认应用图标和名称，点击直接打开当前仓库或目录；右侧下拉继续提供打开方式和默认应用选择。
- Open With 槽位跟随按钮实际宽度调整，消除短应用名与 Changes 之间的多余空白；按钮保留最大宽度，超长名称截断。
- 底部 Git Graph 入口仅保留文字，保持面板开关和选中状态。

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
