# Third-party provenance

Evidence recorded 2026-11-11. Project-original code is Apache-2.0 ([LICENSE](LICENSE)); this is not a blanket license for third-party code, art or trademarks. [NOTICE](NOTICE) and the component texts below must accompany redistribution. No publication or installation is performed by this record.

## Herdr Desktop builtin adaptations

The local upstream Git tag `v0.1.14` resolves to **`2405bf388c568c3ed479f05b8e405ccfa44b3f2c`** (`chore: release 0.1.14`, 2026-11-08). Its own [LICENSE](https://github.com/herdrdev/herdr-app/blob/2405bf388c568c3ed479f05b8e405ccfa44b3f2c/LICENSE) is Apache-2.0; the root project LICENSE reproduces that standard text. This is evidence from the actual 0.1.14 source revision, not an inference from today's upstream license. The tagged source tree has no root `NOTICE` file. The original inspected builtin JavaScript sources do not carry separate copyright notices; no new upstream copyright owner or year is invented here.

All paths in the source column are under [that fixed revision](https://github.com/herdrdev/herdr-app/tree/2405bf388c568c3ed479f05b8e405ccfa44b3f2c/defaults/mods).

| Maintained files | Upstream source | Local adaptation |
| --- | --- | --- |
| `mods/professional-status/main.js` | `defaults/mods/workspace-status/main.js` | Status composition and palette hints |
| `mods/tabs-professional/main.js` | `defaults/mods/tabs/main.js` | Agent launcher split button; Files/Changes focus behavior |
| `mods/professional-panels/files.js` | `defaults/mods/files/main.js` | Exported panel used by Professional focus adapter |
| `mods/professional-panels/changes.js` | `defaults/mods/changes/main.js` | Exported panel used by Professional focus adapter |
| `mods/agents-professional/main.js` | `defaults/mods/agents/main.js` | Professional focus behavior; automatic title cleanup |
| `mods/agent-launcher/main.js`, `launch.js` | `defaults/mods/new-menu/main.js` | Captured target, launch modes, agent picker, saved defaults and custom argv editor |
| `mods/git-graph/pane.js` | `defaults/mods/pane/main.js` | Read-only diff titles and Professional pane composition; Apache terms retained separately from the Graph's MIT license |

Modified source files have prominent adaptation/change notices. The historical imports were taken from installed Desktop 0.1.14, not from a recorded Git checkout. The tag establishes the corresponding published original source and license; it does **not** establish a byte-identical historical installed-app snapshot or signed binary-to-source attestation. That historical exact-byte chain remains unrecorded. The package targets Desktop 0.1.15 without silently relabeling the imported source version.

## Open With and imported Open in VS Code code

The [official Gallery entry](https://herdr.dev/mods/CacaoRick/herdr-open-vscode/) points to **CacaoRick/herdr-open-vscode**. Fixed upstream revision: **`1dfa20974f6da63b195660b68dd120bed2412184`**. Its [LICENSE](https://github.com/CacaoRick/herdr-open-vscode/blob/1dfa20974f6da63b195660b68dd120bed2412184/LICENSE) is MIT, **Copyright (c) 2026 CacaoRick**; the complete text is retained as [mods/open-with/LICENSE.open-vscode](mods/open-with/LICENSE.open-vscode).

Source evidence:

- [Original `mods/open-vscode/uri.js`](https://github.com/CacaoRick/herdr-open-vscode/blob/1dfa20974f6da63b195660b68dd120bed2412184/mods/open-vscode/uri.js): the imported `uriPath`, `utf8Hex`, `sshAuthority`, URI construction and `resolveHost` helpers are recognizable directly in maintained `mods/open-with/uri.js`.
- [Original `mods/open-vscode/main.js`](https://github.com/CacaoRick/herdr-open-vscode/blob/1dfa20974f6da63b195660b68dd120bed2412184/mods/open-vscode/main.js): local `code --folder-uri`, PowerShell protocol fallback, SSH host lookup and focused target selection are the source for maintained `vscode.js`, `target.js`, `context.js`, and launch integration in `main.js`.
- Local changes preserve POSIX backslashes, Windows drive/UNC folders, local launching for SSH folders, machine/cwd consistency, on-machine repository resolution, strict host overrides and failure propagation. Helpers were separated for testing and the UI was integrated into Open With. Existing MIT portions remain MIT; project-original additions are Apache-2.0. No claim of an independent rewrite or a retroactive Apache relicensing is made.

The imported runtime folder lacked a LICENSE file, but that absence did not establish that upstream lacked a license. The primary-source MIT license and matching implementation resolve that previously unverified attribution. The precise historical import commit was not recorded; the fixed revision above is corroborating source/license evidence, not a fabricated import timestamp or byte-identical revision claim.

### Open With artwork

[Icon NOTICE](mods/open-with/icons/NOTICE.txt) contains the detailed source links and modifications. The four installed-app PNGs (Visual Studio Code, Finder, Zed, IntelliJ IDEA) have been removed because no redistribution grant for those extracted files was established. All four application choices, names, bundle IDs and launching behavior remain; they use the existing original neutral `application.svg`. This is explicitly a neutral illustration, not replacement brand artwork. Microsoft's [primary brand guidelines](https://code.visualstudio.com/brand) distinguish the stable brand logo from the application icon and do not license every extracted app resource.

On macOS, the installer now exports these four icons from applications installed on the user's own machine via NSWorkspace, without launching them. PNG files and their index stay in that user's Herdr home under `data/open-with-icons/`, outside the source/package and managed redistribution assets. This local extraction does not establish or claim redistribution permission; absent applications retain the bundled neutral illustration.

Cursor and Sublime Text SVG path data is corroborated against Simple Icons revision **`cd796c98565fc466923fc1128b962e133fa3c612`**, with explicit fills and provenance comments added locally. Full CC0-1.0 legal text is [bundled](mods/open-with/icons/LICENSE.CC0-1.0.txt). Historical retrieval used `develop`; the corroborating revision is not asserted to be the historical download revision. CC0 expressly does not clear trademark, patent or third-party rights. Names/icons identify launch destinations and imply no endorsement.

## Other preserved exceptions

- **Git Graph:** [MIT text](mods/git-graph/LICENSE), Copyright (c) 2026 Rabeeh T A, upstream [rabeeh-ta/herdr-git-graph](https://github.com/rabeeh-ta/herdr-git-graph). Runtime snapshot reports 0.3.2; the historical Git revision is not recorded. Local changes removed updater/network UI and adapted Desktop list/checkout behavior. [Icon terms](mods/git-graph/icons/LICENSE-lucide.txt) remain separate.
- **Agent Launcher OMP artwork:** [fixed published-package/source provenance](mods/agent-launcher/icons/SOURCE.oh-my-pi.txt), including source revision `9058ab9d229663e229e2867824ba6df6f21e9e59`, and [original MIT copyright text](mods/agent-launcher/icons/LICENSE.oh-my-pi) are preserved.
- **Resource Monitor artwork:** Lucide ISC and applicable Feather MIT notices remain in [LICENSE.lucide](mods/resource-monitor/LICENSE.lucide).
- **Native helper:** project-original helper package declares Apache-2.0. [Dependency inventory and closure evidence](mods/resource-monitor/licenses/README.txt) and [complete cached per-version legal texts](mods/resource-monitor/licenses/CARGO-DEPENDENCIES.txt) cover all eight current runtime dependencies and conservatively retain cached build-dependency licenses, including BSD-3-Clause, ISC and Unicode-3.0 exceptions.

## Evidence boundaries

`cargo metadata --offline --locked` could not complete because a lock-only Serde version is absent locally. Cached manifests establish that the three uncached registry entries (`serde 1.0.229`, `serde_derive 1.0.229`, `syn 3.0.10`) are behind false `cfg(any())` dependencies and are not in this helper's active runtime/build closure. No license is fabricated for those absent versions; dependency changes or separate redistribution of their sources require fresh evidence. All currently active runtime crate legal texts were available locally and are bundled. A lock checksum identifies a registry archive, not a built helper binary.

A clean-source macOS arm64 build subsequently completed with `cargo build --release --locked` through the project's helper script, using the existing installed Rust toolchain and registry cache. Its compilation closure used the recorded cached versions, including `syn 2.0.119`, and did not compile the three lock-only versions above. This verifies the current local build path, not all target platforms or future feature choices.

The precise historical installed-app source chain and historical import commits are not recoverable from the provenance captured here. This record does not claim binary reproducibility, vendor trademark clearance, UI verification, or blanket legal clearance. Generated runtime declarations/configuration are development artifacts, not relicensed project-original API definitions; they should not be copied into a Gallery package merely because they exist in a local development directory.
