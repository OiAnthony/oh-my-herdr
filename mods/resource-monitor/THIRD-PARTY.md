# Third-party resources

- `activity.svg`, `memory.svg`, and `terminal.svg` come from Lucide. See `LICENSE.lucide` for the license text. They correspond to the official `activity`, `memory-stick`, and `terminal` icons, respectively.
- The native helper uses Rust crates pinned in `native/resource-sample/Cargo.lock`. `licenses/` retains the MIT license texts used with the binary: libproc 0.14.11, libc 0.2.191, errno 0.3.14, serde_json 1.0.154, serde_core 1.0.229, itoa 1.0.19, memchr 2.8.3, and zmij 1.0.23.
- The helper is built in this project; it does not download or execute other projects' prebuilt binaries. Rust build tools and build-only dependencies are not installed into the application directory.
