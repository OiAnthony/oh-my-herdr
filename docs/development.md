# 开发指南

本文面向维护 oh-my-herdr 的开发者。所有命令均从本仓库根目录执行；用户安装与配置见 [README](../README.md)，资源采集架构与协议见[资源监控设计](design/resource-monitor.md)。

## 环境与目录

需要 Node.js、Rust 工具链和可从终端运行的 `herdr-app`。目标宿主为 Herdr Desktop 0.1.15；macOS 构建还需要 Xcode Command Line Tools。测试使用 Node 内置的 `node:test`，不需要安装 npm 依赖。

| 路径 | 职责 |
| --- | --- |
| `mods/` | 八个可独立部署的 Mod；入口、图标及许可留在各自目录 |
| `layouts/` | oh-my-herdr 布局及布局选择器 SVG |
| `native/resource-sample/` | Rust 采集程序及依赖锁文件 |
| `scripts/` | helper 构建、白名单 ZIP 打包、发布包预检及性能测量工具 |
| `tests/` | Node 行为测试、安装器事务测试及真实 native helper 测试 |
| `docs/design/` | 设计、协议和性能口径 |

根目录保留 Gallery 资源、套件清单、快捷键规则和安装入口。不要把测试放进 `mods/`，安装器会递归复制 Mod 文件。源码向应用 home 单向部署；个人配置、会话、采样状态及应用生成的类型不进入仓库。

## 目录整理验收

按顺序执行：

```sh
node scripts/build-resource-helper.mjs
node --test tests/*.test.mjs
./install.sh --dry-run
```

第一条命令以 `--release --locked` 构建当前平台 helper，输出 `mods/resource-monitor/bin/herdr-resource-sample` 路径，Windows 文件名带 `.exe`。构建只写本项目的 Rust `target/` 和 Mod `bin/`；二者的生成内容由 `.gitignore` 排除。

第二条命令应以零退出码结束且没有失败测试。`resource-native.test.mjs` 会执行刚构建的 helper，创建临时子进程与 IPv4/IPv6 回环监听，并在测试后清理；它不能由 JSON 解析测试替代。安装器测试使用临时源目录和应用 home，不部署到日常应用目录。

第三条命令只读预检并打印 install/check 命令，不编译、安装、切换布局或重启。它要求已构建的 helper、可用的 Node 与 `herdr-app`，以及初始化过的目标 app home。dry-run 成功不等于实际部署或原生加载成功。

## macOS 发布 ZIP

套件版本由 `oh-my-herdr.json` 的 `version` 提供，目前为 0.4.0。helper 行为未改变，其 crate 版本仍为 0.1.0。在原生 arm64 或 x64 Mac 的源码根执行：

```sh
node scripts/package-release.mjs
node --test tests/oh-my-herdr.test.mjs tests/open-with.test.mjs tests/local-icons.test.mjs tests/release-package.test.mjs
```

打包器显式构建当前架构 helper，从 Node 官方下载固定 26.13.1 tarball，核对代码中固定的 SHA256，然后只提取 `bin/node` 和完整 `LICENSE`。下载使用 macOS 自带 curl，可沿用构建环境的代理设置；只发生在发布端，不在用户安装时发生。包名为 `dist/oh-my-herdr-0.4.0-darwin-arm64.zip` 或 `dist/oh-my-herdr-0.4.0-darwin-x64.zip`，并生成 `dist/SHA256SUMS`。`dist/` 与私有临时打包目录被忽略，二进制不入源码 Git。

已校验的 Node tarball 缓存在忽略目录 `.release-cache/`，后续构建仍逐次核对固定 SHA256；缓存不进入 ZIP。若缓存校验失败，删除报错的缓存文件后重新构建，不跳过校验。

白名单只收录明确的安装器依赖、文档/许可、跟踪中的布局和八个 Mods 的代码、SVG、metadata 与许可，以及本次构建的 helper。不会复制 `.git`、tests、Rust target、个人 apps/hosts 配置、data、会话、shared/log/window 状态、生成声明或本机应用 PNG。`release.json` 是包内容校验清单，不是第二套安装归属记录；配置目录仍只用原来的 `.oh-my-herdr/installed.json`。同源 SHA256 不是独立签名。

发布包测试从最终 ZIP 解压到包含空格和中文的目录，执行真实私有 Node 与安装器。测试将系统 Node、Cargo、下载工具和编译器替换为禁止调用的哨兵，Herdr CLI 使用边界替身；它验证损坏、架构、冲突、更新/卸载和配置恢复，不等于真实 Mod 加载或 Gatekeeper 验收。运行这些测试前必须先构建 ZIP，缺包时测试失败而不静默跳过。

实际加载验证需另外使用 Herdr 初始化过的隔离 app home，设置同一个 `HERDR_APP_HOME`，从最终解压目录执行 `./install.sh`、`./install.sh --check`、`./install.sh --uninstall`。不得部署到日常 home、切换日常布局或重启当前服务。真实八 Mod 加载不需要改动 Mod UI，本次安装任务也不以此声称窗口交互已验收。

GitHub Actions 的 `.github/workflows/release.yml` 在 `macos-15`（arm64）和 `macos-15-intel`（x64）分别构建并测试最终 ZIP，合并后重新生成两个 ZIP 的 `SHA256SUMS`。手动运行只生成 artifacts；`v<version>` tag 才创建 GitHub Release，并校验 tag 与套件版本一致。实现工作流不等于获准运行或发布它。没有签名、公证、DMG、自动更新服务或系统 PATH 安装。

私有 Node 要求 macOS 13.5+。本机某一架构通过不代表另一架构通过；未安装 CLT 的干净 Mac、浏览器下载 quarantine 与手动安全许可流程须单独验收，不能用隔离 PATH 测试代替。

## 修改 Rust 采集程序

修改 native 代码后，除上述验收外，按改动范围运行：

```sh
cargo test --locked --manifest-path native/resource-sample/Cargo.toml
cargo fmt --check --manifest-path native/resource-sample/Cargo.toml
```

需要检查 Linux / Windows 编译时，先安装相应 Rust target，再执行：

```sh
cargo check --locked --manifest-path native/resource-sample/Cargo.toml --target x86_64-unknown-linux-gnu --target x86_64-pc-windows-gnu
```

交叉编译检查不代表目标平台运行通过。本机测试只证明当前 OS 与架构的行为。

## 资源采集性能测量

先构建 helper。将下列命令中的 `123,456` 替换为待测终端的真实根 PID；Python 测量脚本依赖 POSIX `resource` 模块，不用于 Windows。

```sh
python3 scripts/bench-resource-helper.py --roots=123,456 --samples=30
python3 scripts/bench-resource-helper.py --roots=123,456 --samples=30 --ports-every=5
python3 scripts/bench-resource-helper.py --roots= --samples=30 --scope system --ports-every=5
```

脚本输出 JSON，分别统计 helper CPU、wall time、峰值 RSS、输出大小和 Python 控制器 CPU。默认采样间隔为 1 秒；三条命令分别测受管资源、受管监听和全机资源加监听。System 不依赖 roots；`lastRows` 与 `lastMeasuredProcesses` 分别记录末次枚举和可读内存的进程数。结果不含 Herdr IPC、生产 JavaScript 或 GPUI，不能据此宣称完整链路性能达标。历史测量条件与数值见[设计文档](design/resource-monitor.md#性能口径)。

## Mod 与布局的实机验证

仅整理测试和文档时，不需要部署到日常应用或切换当前布局。修改 Mod 或布局行为时，另行使用获准的隔离应用 home 和 Core 会话验证，遵循 [RECIPE 验收清单](../RECIPE.md#done-when)。

隔离应用 home 必须先由目标版本 Herdr 初始化，不能用空目录替代。按 [README](../README.md#配置) 统一设置 `HERDR_APP_HOME` 后执行安装和检查；启用布局、卸载前切回内置布局分别按 README 操作，不在测试脚本里隐式切换。

`herdr-app check` 只验证部署与初始加载。真实窗口还需检查布局、异步成功及失败、筛选、排序、键盘焦点、Esc、滚动、主题和窄窗口。Linux / Windows 资源采集、Remote - SSH 以及尚未完成的物理输入验收必须分别记录，不以本机测试或静态加载通过代替。
