# oh-my-herdr

Herdr Desktop 的 Professional 工作区：左侧 Spaces 和 Agents，右上角启动 Agent 或打开仓库，右侧 Files/Changes，底部 Git Graph、CPU 和内存。

![Professional 布局](preview.png)

支持 Herdr Desktop 0.1.15，不适用于 Herdr TUI。当前源码对应 0.3.0。

## 安装

需要 Herdr Desktop 0.1.15（至少启动过一次）、Node.js、Rust 工具链；macOS 还要 Xcode Command Line Tools。终端要能运行 `herdr-app`。

```sh
git clone https://github.com/OiAnthony/oh-my-herdr.git && oh-my-herdr/install.sh
```

脚本编译资源采集程序、安装布局和 8 个 Mods、合并快捷键，再运行 `herdr-app check`。成功时输出 `8 mods checked`。安装默认不切换布局，也不重启 Herdr；遇到文件或快捷键冲突会停止。先看要执行的命令可加 `--dry-run`。

Mods 是可信代码，安装前可以读源码。

## 启用

```sh
herdr-app do layout.switch '{"name":"Professional"}'
```

安装时加 `--switch` 可以一步完成：

```sh
oh-my-herdr/install.sh --switch
```

`herdr-app check` 只验证部署和初始加载，布局与交互仍要在窗口里确认。

## 快速上手

右上角两个按钮分别启动 Agent 和打开仓库。点主按钮用默认项，点箭头换选项，点行尾星标设默认。

| 快捷键 | 功能 |
| --- | --- |
| `⌘⇧A` | 启动当前机器的默认 Agent |
| `⌘G` | 用默认应用打开当前仓库或目录 |
| `⌘⇧E` | 显示并聚焦 Files；已聚焦时隐藏 |
| `⌘⇧G` | 切换 Changes；300 ms 内连按两次切换 Git Graph |
| `⌘W` | 关闭当前 pane；最后一个 pane 关闭时也关闭 tab |
| `⌘T` | 新建终端 |
| `⌘⇧P` | 命令面板 |

点底部 CPU 或内存读数打开 Resource Manager。直接输入过滤，空格分词，第一次 Esc 清空，第二次关闭。Tree 页可以打开 Ports 查看监听端口。

`⌘W` 会结束 pane 里的终端。`⌘⇧W` 原有的关闭 pane 绑定已被移除。

## 配置

应用目录默认是 `~/.config/herdr-app`。换目录时先 `export HERDR_APP_HOME=/path/to/app-home`，路径和父目录不能含符号链接。

注册 OMP，在 `programs.json` 中加入：

```json
{
  "programs": {
    "omp": {
      "name": "OMP",
      "run": ["omp"],
      "icon": "mods/agent-launcher/icons/omp.svg",
      "tint": false
    }
  }
}
```

Open With 的应用列表写在 `mods/open-with/apps.json`，每项需要 `id`、`title`，普通应用还需要 macOS `bundleId`，最多 20 项。Core 机器名和 SSH Host 不同时，在 `mods/open-with/hosts.json` 中写 `{"my-machine":"my-ssh-alias"}`，key 是机器名，value 是 SSH Host。

## 更新与卸载

更新时进入项目目录重新运行：

```sh
./install.sh
```

卸载前先切回内置布局：

```sh
herdr-app do layout.switch '{"name":"main"}'
```

再执行：

```sh
node oh-my-herdr.mjs uninstall
```

不要通过删除 `mods/` 或 `data/` 目录卸载。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| `Missing keys.json` | 用目标应用目录启动一次 Herdr，确认 `HERDR_APP_HOME` 一致 |
| `Missing native resource helper` | 运行 `node scripts/build-resource-helper.mjs`，再重新安装 |
| 检查通过但界面没变化 | 手动切到 Professional；安装器不会自动启用布局 |
| 快捷键或文件冲突 | 按报错检查 `keys.json` 或受管文件；安装器不提供强制覆盖 |

更多资料：

- [Changelog](CHANGELOG.md)
- [Gallery recipe](RECIPE.md)
- [开发指南](docs/development.md)
- [资源监控设计](docs/design/resource-monitor.md)
- [许可与来源](THIRD_PARTY.md)

Linux、Windows 的资源采集和 Remote - SSH 尚未完成目标环境端到端验收；资源弹层的筛选、排序和键盘交互尚未完成完整实机验收。原创代码采用 Apache-2.0，第三方代码和资源保留各自许可。
