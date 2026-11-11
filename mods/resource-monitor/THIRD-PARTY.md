# 第三方资源

- `activity.svg`、`memory.svg`、`terminal.svg` 来自 Lucide，许可正文见 `LICENSE.lucide`。它们分别对应官方 `activity`、`memory-stick`、`terminal` 图标。
- 原生 helper 使用锁定在 `native/resource-sample/Cargo.lock` 中的 Rust crates。`licenses/` 保留随二进制使用的 MIT 许可正文：libproc 0.14.11、libc 0.2.191、errno 0.3.14、serde_json 1.0.154、serde_core 1.0.229、itoa 1.0.19、memchr 2.8.3、zmij 1.0.23。
- helper 在本项目中构建，不下载或执行其他项目的预编译二进制。Rust 构建工具及仅用于构建的依赖不安装到应用目录。
