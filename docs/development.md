# 开发指南

本文面向维护 oh-my-herdr 的开发者。所有命令均从本仓库根目录执行；用户安装与配置见 [README](../README.md)，资源采集架构与协议见[资源监控设计](design/resource-monitor.md)。

## 环境与目录

需要 Node.js、Rust 工具链和可从终端运行的 `herdr-app`。目标宿主为 Herdr Desktop 0.1.15；macOS 构建还需要 Xcode Command Line Tools。测试使用 Node 内置的 `node:test`，不需要安装 npm 依赖。

| 路径 | 职责 |
| --- | --- |
| `mods/` | 八个可独立部署的 Mod；入口、图标及许可留在各自目录 |
| `layouts/` | Professional 布局及布局选择器 SVG |
| `native/resource-sample/` | Rust 采集程序及依赖锁文件 |
| `scripts/` | helper 构建与性能测量工具 |
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

第三条命令只打印 helper 构建、install 和 check 命令，不执行安装、切换布局或重启。它仍检查 Node.js、Cargo 和 `herdr-app` 是否在 PATH 中；dry-run 成功不等于实际部署或原生加载成功。

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
