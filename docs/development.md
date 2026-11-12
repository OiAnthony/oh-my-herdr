# Development guide

This guide is for developers maintaining oh-my-herdr. Run all commands from the repository root. See the [README](../README.md) for user installation and configuration, and the [resource monitoring design](design/resource-monitor.md) for the collection architecture and protocol.

## Documentation language

Default documentation and the Gallery recipe are written in English. The Chinese README is `README.zh-CN.md`. Keep installation, configuration, and development instructions aligned between `README.md` and `README.zh-CN.md` whenever either changes.

Gallery text lives in `RECIPE.md`. Local edits alone do not update the live Gallery: publication requires an authorized push to the public repository and Gallery reindexing. See the Gallery's [Share yours instructions](https://herdr.dev/gallery/) for repository and package requirements. Editing these files does not publish them.

## Environment and directory structure

You need Node.js, the Rust toolchain, and `herdr-app` available in the terminal. The target host is Herdr Desktop 0.1.15; macOS builds also require Xcode Command Line Tools. Tests use Node's built-in `node:test`, with no npm dependencies to install.

| Path | Responsibility |
| --- | --- |
| `mods/` | Eight independently deployable Mods, each retaining its entry point, icons, and licenses |
| `layouts/` | The oh-my-herdr layout and layout selector SVG |
| `native/resource-sample/` | Rust collector and dependency lockfile |
| `scripts/` | Helper build, allowlisted ZIP packaging, release package preflight, and performance measurement tools |
| `tests/` | Node behavior tests, installer transaction tests, and real native helper tests |
| `docs/design/` | Design, protocol, and performance criteria |

The root retains Gallery assets, the suite manifest, shortcut rules, and installation entry points. Do not put tests in `mods/`: the installer copies Mod files recursively. Deployment is one-way from source to application home; personal configuration, sessions, sample state, and application-generated types do not belong in the repository.

## Directory organization acceptance

Run these commands in order:

```sh
node scripts/build-resource-helper.mjs
node --test tests/*.test.mjs
./install.sh --dry-run
```

The first command builds the current platform's helper with `--release --locked` and prints the path `mods/resource-monitor/bin/herdr-resource-sample`, with an `.exe` suffix on Windows. The build writes only to this project's Rust `target/` and Mod `bin/` directories; generated contents in both are excluded by `.gitignore`.

The second command should exit with code zero and no failed tests. `resource-native.test.mjs` runs the newly built helper, creates temporary child processes and IPv4/IPv6 loopback listeners, and cleans them up after testing. JSON parsing tests are not a substitute. Installer tests use temporary source directories and application homes rather than deploying into the everyday application directory.

The third command performs a read-only preflight and prints install/check commands. It does not compile, install, switch layouts, or restart. It requires a built helper, working Node and `herdr-app`, and an initialized target app home. A successful dry run does not establish successful deployment or native loading.

## macOS release ZIP

The suite version comes from `version` in `oh-my-herdr.json`, currently 0.4.0. Helper behavior has not changed, so its crate version remains 0.1.0. From the source root on a native arm64 or x64 Mac, run:

```sh
node scripts/package-release.mjs
node --test tests/oh-my-herdr.test.mjs tests/open-with.test.mjs tests/local-icons.test.mjs tests/release-package.test.mjs
```

The packager explicitly builds the helper for the current architecture, downloads the pinned Node 26.13.1 tarball from the official Node source, checks the SHA256 pinned in code, then extracts only `bin/node` and the complete `LICENSE`. Downloads use macOS's built-in curl and can use the build environment's proxy settings. They occur only during release packaging, not user installation. The package is named `dist/oh-my-herdr-0.4.0-darwin-arm64.zip` or `dist/oh-my-herdr-0.4.0-darwin-x64.zip`, with `dist/SHA256SUMS` also generated. `dist/` and the private temporary packaging directory are ignored; binaries are not committed to source Git.

Verified Node tarballs are cached in the ignored `.release-cache/` directory. Subsequent builds still check the pinned SHA256 every time; the cache is not included in the ZIP. If cache verification fails, delete the cache file identified in the error and rebuild rather than skipping verification.

The allowlist includes only explicit installer dependencies, documentation/licenses, tracked layouts, the eight Mods' code, SVGs, metadata, and licenses, and the helper built for this package. It excludes `.git`, tests, Rust target, personal apps/hosts configuration, data, sessions, shared/log/window state, generated declarations, and local application PNGs. `release.json` is a package content verification manifest, not a second installation ownership record; configuration ownership continues to use only `.oh-my-herdr/installed.json`. SHA256 from the same source is not an independent signature.

Release package tests extract the final ZIP into a directory containing spaces and Chinese characters, then execute the real private Node and installer. They replace system Node, Cargo, download tools, and compilers with sentinels that prohibit invocation, while using a boundary test double for the Herdr CLI. They verify corruption, architecture, conflicts, update/uninstall, and configuration restoration, not real Mod loading or Gatekeeper acceptance. Build the ZIP before running these tests: a missing package fails the tests rather than silently skipping them.

Actual loading validation separately requires an isolated app home initialized by Herdr. Set the same `HERDR_APP_HOME` and run `./install.sh`, `./install.sh --check`, and `./install.sh --uninstall` from the final extracted directory. Do not deploy into the everyday home, switch the everyday layout, or restart the current service. Real loading of all eight Mods does not require changing Mod UI, and this installation task does not establish acceptance of window interactions.

GitHub Actions in `.github/workflows/release.yml` builds and tests the final ZIP on `macos-15` (arm64) and `macos-15-intel` (x64), then regenerates `SHA256SUMS` for the two combined ZIPs. Manual runs produce artifacts only; a `v<version>` tag creates a GitHub Release after checking that the tag matches the suite version. Implementing the workflow does not authorize running it or publishing a release. There is no signing, notarization, DMG, automatic update service, or system PATH installation.

Private Node requires macOS 13.5+. Passing on one local architecture does not establish success on the other. A clean Mac without CLT, browser download quarantine, and the manual security approval flow require separate acceptance; isolated PATH tests are not a substitute.

## Modifying the Rust collector

After changing native code, run the following as appropriate for the change, in addition to the acceptance steps above:

```sh
cargo test --locked --manifest-path native/resource-sample/Cargo.toml
cargo fmt --check --manifest-path native/resource-sample/Cargo.toml
```

To check Linux / Windows compilation, install the corresponding Rust targets first, then run:

```sh
cargo check --locked --manifest-path native/resource-sample/Cargo.toml --target x86_64-unknown-linux-gnu --target x86_64-pc-windows-gnu
```

Cross-compilation checks do not establish successful execution on the target platform. Local tests establish behavior only for the current OS and architecture.

## Resource collection performance measurement

Build the helper first. Replace `123,456` in the commands below with the actual root PIDs of the terminals to measure. The Python measurement script depends on the POSIX `resource` module and is not for Windows.

```sh
python3 scripts/bench-resource-helper.py --roots=123,456 --samples=30
python3 scripts/bench-resource-helper.py --roots=123,456 --samples=30 --ports-every=5
python3 scripts/bench-resource-helper.py --roots= --samples=30 --scope system --ports-every=5
```

The script outputs JSON measuring helper CPU, wall time, peak RSS, output size, and Python controller CPU separately. The default sampling interval is 1 second. The three commands measure managed resources, managed listeners, and system-wide resources plus listeners, respectively. System does not depend on roots; `lastRows` and `lastMeasuredProcesses` record the final counts of enumerated processes and processes with readable memory, respectively. Results exclude Herdr IPC, production JavaScript, and GPUI, so they do not establish end-to-end performance compliance. See the [design document](design/resource-monitor.md#performance-criteria) for historical measurement conditions and values.

## Validating Mods and layouts in the application

Reorganizing tests and documentation alone does not require deployment into the everyday application or switching the current layout. When changing Mod or layout behavior, validate separately using an authorized isolated application home and Core session, following the [RECIPE acceptance checklist](../RECIPE.md#done-when).

The isolated application home must first be initialized by the target Herdr version; an empty directory is not a substitute. Set `HERDR_APP_HOME` consistently as described in the [README](../README.md#configuration), then install and check. Follow the README to activate the layout and switch back to a built-in layout before uninstalling; do not switch implicitly from test scripts.

`herdr-app check` verifies only deployment and initial loading. The real window also needs checks for layout, asynchronous success and failure, filtering, sorting, keyboard focus, Esc, scrolling, themes, and narrow windows. Record Linux / Windows resource collection, Remote - SSH, and any outstanding physical-input acceptance separately; local tests or successful static loading cannot replace them.
