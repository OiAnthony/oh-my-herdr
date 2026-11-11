Native helper dependency-license coverage
Evidence date: 2026-11-11

Scope: native/resource-sample/Cargo.lock, helper 0.1.0.
Project-original helper source: Apache-2.0; ../LICENSE.

CARGO-DEPENDENCIES.txt preserves full license/copyright/legal notice files
from the locally cached exact registry versions, including build-only crates.
Each section records the Cargo.lock registry-package SHA-256. These are
registry archive identifiers, not hashes of helper binaries. No claim that
an existing binary was built from this lockfile is made.

The helper directly uses serde_json on all supported targets and libc/libproc
on macOS. Active normal runtime dependency closure from the cached manifests:
- All targets: serde_json 1.0.154, serde_core 1.0.229, itoa 1.0.19,
  memchr 2.8.3, zmij 1.0.23.
- macOS additionally: libc 0.2.191, libproc 0.14.11, errno 0.3.14.
All eight runtime crate versions have their full cached legal texts bundled.
The helper's own Cargo.toml selects libproc/libc only for target_os=macos;
errno's windows-sys/windows-link dependencies therefore are not linked by
this helper on Windows. Their cached texts are nevertheless retained.

Extra cached build-dependency texts are deliberately retained conservatively:
libproc uses bindgen at build time. This includes unicode-ident's additional
Unicode-3.0 license, bindgen's BSD-3-Clause and libloading's ISC terms.
Dual-license alternatives are retained as supplied, not flattened to Apache.

Offline `cargo metadata --offline --locked --format-version 1` could not
complete because serde 1.0.229 is not cached. No fetching/build was done.
Three lock-only registry versions have no local source/license evidence and
are NOT claimed cleared by this bundle: serde 1.0.229, serde_derive 1.0.229,
syn 3.0.10. The helper itself is covered by the root project license.
serde_json puts serde under cfg(any()); serde_core puts serde_derive under
cfg(any()). cfg(any()) has no true arguments and is false on every target.
Thus these three registry versions, including syn 3.0.10 reached only via
serde_derive, are not in this helper's current runtime/build closure. They
would require fresh source/license evidence if feature/dependency choices
change or those crate sources are redistributed separately. No source or
license for them is fabricated or substituted from another version.

Method: read Cargo.lock and cached normalized Cargo.toml/license files only.
No build, test, linter, executable download, installation or network Cargo
operation was run. This inventory does not cover Rust toolchain or OS SDK
redistribution; neither is bundled by this source package.

Exact cached inventory (full legal files follow in CARGO-DEPENDENCIES.txt):

| aho-corasick | 1.1.5 | Unlicense OR MIT |
| bindgen | 0.72.1 | BSD-3-Clause |
| bitflags | 2.13.2 | MIT OR Apache-2.0 |
| cexpr | 0.6.0 | Apache-2.0/MIT |
| cfg-if | 1.0.5 | MIT OR Apache-2.0 |
| clang-sys | 1.9.1 | Apache-2.0 |
| either | 1.19.0 | MIT OR Apache-2.0 |
| errno | 0.3.14 | MIT OR Apache-2.0 |
| glob | 0.3.4 | MIT OR Apache-2.0 |
| itertools | 0.13.0 | MIT OR Apache-2.0 |
| itoa | 1.0.19 | MIT OR Apache-2.0 |
| libc | 0.2.191 | MIT OR Apache-2.0 |
| libloading | 0.8.9 | ISC |
| libproc | 0.14.11 | MIT |
| memchr | 2.8.3 | Unlicense OR MIT |
| minimal-lexical | 0.2.1 | MIT/Apache-2.0 |
| nom | 7.1.3 | MIT |
| proc-macro2 | 1.0.107 | MIT OR Apache-2.0 |
| quote | 1.0.47 | MIT OR Apache-2.0 |
| regex | 1.13.1 | MIT OR Apache-2.0 |
| regex-automata | 0.4.18 | MIT OR Apache-2.0 |
| regex-syntax | 0.8.11 | MIT OR Apache-2.0 |
| rustc-hash | 2.1.3 | Apache-2.0 OR MIT |
| serde_core | 1.0.229 | MIT OR Apache-2.0 |
| serde_json | 1.0.154 | MIT OR Apache-2.0 |
| shlex | 1.3.0 | MIT OR Apache-2.0 |
| syn | 2.0.119 | MIT OR Apache-2.0 |
| unicode-ident | 1.0.27 | (MIT OR Apache-2.0) AND Unicode-3.0 |
| windows-link | 0.2.1 | MIT OR Apache-2.0 |
| windows-sys | 0.61.2 | MIT OR Apache-2.0 |
| zmij | 1.0.23 | MIT |
