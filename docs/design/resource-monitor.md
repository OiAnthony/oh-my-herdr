# Task Manager native monitoring design

The target version is Herdr Desktop 0.1.15. This document records the resource collection architecture, JSON protocol, and performance criteria. See the [development guide](../development.md) for build, test, and real-device validation steps, and the [Changelog](../../CHANGELOG.md#resource-monitoring-historical-validation) for historical validation records.

## Features and boundaries

The far-right oh-my-herdr footer shows Herdr-managed CPU and memory regardless of the popover scope. Clicking it opens Task Manager in the same View. It uses native Popover, RadioGroup, Tab, virtual lists, and theme colors, with a maximum width of 416 px and height of 640 px. Below the title, Tree, Processes, and Ports tabs sit on the left, with a `Herdr / System` selector controlling all three tabs on the right, in the same space-between row. Each opening returns to Herdr Tree, clears the filter, and locates and expands the current pane; switching tabs while open preserves the scope. Switching scope preserves keywords and sorting but resets the scroll position. Tree always displays collected listener rows and has no Ports toggle.

None of the three tabs has a fixed search box. Typing starts a search; space-separated keywords are case-insensitive and must all match, including across fields. Tree and Processes match names, machines, PID/PPID, and formatted CPU and memory; Tree also matches ownership paths and listener fields. Backspace deletes characters, the first Esc clears the search, and the second Esc closes the popover. Esc uses a local action binding that takes precedence over Popover's default dismissal. Arrow keys and Enter retain navigation and expansion behavior; spaces only separate keywords. Switching tabs clears the search.

Herdr scope monitors live terminal PIDs exposed by Core and their actual OS descendants. Tree displays Space → Pane, with the current Space first; Machine / Space / Tab / Pane ownership is retained internally, but the Tab level is omitted from display. Logical parents determine display hierarchy only; resource ownership uses OS PPID exclusively. Desktop, Core, detached daemons, and containers without reliable PID bindings are not assigned fabricated measurement buckets. System scope enumerates OS processes on each machine; Tree displays machine → PPID hierarchy, treats missing parents as roots, and breaks one edge in each cycle. Process nodes show only their own resources; machine totals deduplicate by identity without counting descendants twice.

Processes uses processes deduplicated per machine within the current scope, without first expanding the resource tree. Each process appears once, with a stable row identity of machine + PID + start; identical PIDs on different machines remain independent, and PID reuse changes the row identity. Multiple keywords must match the same row; parent processes are not added, and PID supports substring matching. Sorting supports name, PID, CPU, and memory. Unknown CPU/memory values sort after known values, and expired CPU/memory displays `—`. This page shares the 1 Hz samples, uses a virtual list, and adds no listener scans. Search in all three tabs filters only the current scope and never broadens it.

Ports provides a flat Endpoint / Process / PID table, requesting TCP listeners every 5 seconds for the current scope. Herdr shows only managed-process listeners; System includes unmanaged listeners and can query the local and workspace machines even without managed terminals. Sorting supports port number, process name, or PID; type-to-filter matches the machine, listener address, binding scope, process, and PID within the same row. Listeners use process identities from that scan, not names borrowed from reused PIDs in newer snapshots; Herdr further filters ownership by machine + PID + start. Insufficient permissions or collection failures retain coverage status: empty results do not mean a port is free.

The Tree toolbar provides expand all, collapse all, and locate current pane. Locate returns to Herdr Tree, clears the filter, expands the target and its ancestors, and centers and selects the target; both terminal and Mod panes are supported. No persistent description appears below the summary; machine, sample time, errors, and listener coverage move to the summary tooltip, while row-level status remains unchanged. Icons retain tooltips and accessible names. The summary shows only the current machine, never a cross-machine sum. System's readable-process measurements and partial coverage are explained in the tooltip; summed process memory is not system-used memory.

The feature is read-only: it cannot clean up, terminate processes, or restart services. It does not read process command lines, environment variables, or terminal content; persist samples; make HTTP requests; or forward ports. Memory trends retain at most 60 valid points, stored only in View memory.

### Numeric layout rules

Task Manager's live numeric updates must not shift horizontal layout. CPU/Memory values in the footer, panel summary, Tree, and Processes use fixed-width, non-shrinking numeric slots, monospace fonts, and right alignment. Fixing only the outer width while laying out the contents by their width is insufficient. Icons, separators, memory units, metric labels, and adjacent columns must not move horizontally as digit counts change; numeric updates have no movement animation.

The footer sits to the right of the command-palette hint as the final status-bar slot, at 188 px wide. The trigger button is 176 px wide, with a 52 px CPU numeric slot and a 64 px memory numeric slot. Panel-summary CPU/Memory slots are 64/76 px; table slots remain 52/76 px. Fonts follow the platform monospace font: Menlo on macOS, Consolas on Windows, and monospace elsewhere. Do not pad with spaces or truncate with ellipses.

Footer values have at most three digits, excluding the decimal point, `%`, and units. CPU below 100% keeps one decimal place; 100% through 999% uses integers. If rounding would exceed three digits, use decimal abbreviations, for example `1600% → 1.60k%`; `k%` means thousands of percentage points, not utilization normalized across the whole machine. Memory uses two, one, or zero decimal places depending on magnitude, for example `1.24 GB / 12.4 GB / 124 GB`. Units still scale by 1024; promote the unit early if rounding would produce a four-digit integer, for example `999.5 MB → 0.98 GB`. Do not truncate or cap samples. Colors use unabbreviated CPU values; tooltips and the panel retain detailed formatting.

Acceptance covers `—`, `9.9% → 10.0%`, `99.9% → 100%`, `999% → 1.00k%`, and memory digit-count and unit transitions. Panel CPU keeps one decimal place. Compare the positions of icons, separators, unit right edges, memory metric labels, trend graphs, and column boundaries before and after updates; text with different character counts need not share a left edge.

## Collection architecture

```text
oh-my-herdr layout
  ├─ professional-status: machine, branch, agents, Git Graph
  ├─ professional-status hint: command-palette hint
  └─ resource-monitor View: far-right footer + Popover + single timer
       ├─ collect.js: per-machine request coalescing, CPU baselines, listener cache
       ├─ herdr.exec → herdr-resource-sample → one JSON payload
       ├─ model.js: process identity, ownership, deduplication, totals, unknown values
       └─ tree.js: display tree, combined filtering, virtual rows
```

The footer and popover share one Mod instance, with no shared store or second sampler. System calls do not run in render or row-render callbacks. The helper is a one-shot command: it does not stay resident, start a service, or execute subcommands.

| Approach | Fit for the target | Complexity and failure modes | Runtime cost |
| --- | --- | --- | --- |
| Native snapshot every second, current implementation | Retains live CPU/memory and reuses the existing exec contract | One JSON payload; failures are marked independently rather than appearing successful | Process startup cost; local helper typically uses about 0.55–0.61% of one core |
| Resident helper + IPC | Can eliminate repeated startup cost | Requires IPC, version negotiation, liveness checks, leases, and exit handling; current host exec provides no streaming child-process handle | Resident memory and wakeups; not implemented or measured in this project |

The current choice is a one-shot helper to avoid adding a service lifecycle. Until full-path acceptance is complete, do not claim zero monitoring cost or achievement of the 0.5% target.

## Scheduling and lifecycle

- Collect CPU/memory every 1000 ms while the application is active. Coalesce requests for the same machine, with at most two machines running concurrently across the instance; prioritize older snapshots. Each exec times out after 2000 ms.
- When the application becomes inactive, start no new samples, clear CPU baselines and listener scheduling times, and reject late in-flight results. The first CPU sample after resuming is unknown.
- Collect System scope only while the popover is open and that scope is selected. The close button, Esc, and Popover dismissal all restore Herdr; managed footer sampling continues after closing. Scope switches clear old baselines, listener caches, and whole-machine display caches, and reject in-flight results from the old scope.
- Collect listeners only while the popover's Ports or Tree tab is visible, every 5000 ms, always following the scope selector. Tree enables listener display and search by default, with no toggle. Switching to Processes or closing the popover pauses port collection. Search does not alter collection scope or scan scheduling.
- Connection, terminal-root, or machine-identity changes invalidate old baselines. Late results from old connections, removed targets, or closed Views are not merged into new state.
- Destroying the View cancels the timer and releases the FocusHandle, scroll handles, and history. It does not terminate user terminals.
- The footer and popover compare actual displayed values: unchanged values do not trigger redraws merely because a snapshot timestamp advanced. CPU, row-content, status, or trend changes refresh the display. Hovering the footer updates the tooltip.

## Native helper

Source lives in `native/resource-sample/`. The Rust lockfile pins dependencies; release builds use LTO, symbol stripping, and panic abort. Builds write only this project's target and Mod bin directories and do not build the upstream repository.

```sh
node scripts/build-resource-helper.mjs
mods/resource-monitor/bin/herdr-resource-sample --roots=123,456 --scope=herdr
mods/resource-monitor/bin/herdr-resource-sample --roots=123,456 --scope=herdr --ports
mods/resource-monitor/bin/herdr-resource-sample --roots= --scope=system --ports
```

Windows produces an `.exe`. Omitting `--scope` defaults to Herdr; System ignores roots and collects readable metrics for all enumerable processes. `--ports` adds listeners within the current scope. The old `--all-ports` argument is removed, with no compatibility path. Empty roots return an empty set in Herdr but still enumerate the whole machine in System. Unknown arguments, invalid scopes, and invalid PIDs return a nonzero status. The native helper and Mod must be built and deployed together.

| Platform | Topology / identity | CPU / memory | Listeners |
| --- | --- | --- | --- |
| macOS | Herdr queries descendants by root PID; System enumerates the whole machine; BSDInfo start time | pidrusage cumulative CPU, resident, footprint; Mach ticks converted using timebase; recheck start identity after reading | libproc FD and SocketFDInfo |
| Linux | PPID and starttime from `/proc/PID/stat` | utime/stime, CLK_TCK, RSS pages; meminfo | TCP tables associated with FD socket inodes |
| Windows | Toolhelp; GetProcessTimes creation time | Cumulative FILETIME CPU, Working Set; GlobalMemoryStatusEx | GetExtendedTcpTable |

Normal macOS Herdr collection does not query BSDInfo for every process on the machine. Clear errno when there are no children so libproc does not misclassify a valid empty list as a failure. System coverage does not depend on Ports being enabled; unreadable metadata retains the PID and unknown placeholders, and unreadable metrics remain null. Listeners retain independent error status and recheck process identity before ownership assignment.

### JSON contract

Top-level fields: `schema: 1`, `platform`, `monotonic` (seconds), `topologyComplete`, `rows`, `host`, `listeners`, and `listenerError`.

Each process contains `pid`, `ppid`, `name`, `start` (stable identity or null), `seconds` (cumulative CPU seconds), `memory` (resident / working set bytes), and `footprint` (macOS bytes). Unreadable metrics are null and must not be replaced with zero.

The listener channel is null or `{ rows, complete, scope }`, with scope `managed` or `all`. Endpoints contain `pid`, `family`, `address`, `port`, `protocol: tcp`, and `socket`. Deduplicate by shared socket identity only when the kernel returns it; matching port numbers do not prove sockets are identical.

The host channel is `{ total, available }`, in bytes. macOS currently returns only total, with available null; free memory or summed managed-process memory is not substituted for host-available memory. Listener failures do not discard independently valid CPU/memory results.

## Ownership, measurement, and unknown values

Identity is machine + PID + start. Descendants of nested terminal roots belong to the nearest root; terminal details do not count nested-root resources again. Higher levels deduplicate by process identity. If duplicate roots prevent unique ownership, retain the conflict and the machine-level known subtotal rather than arbitrarily assigning an owner.

CPU = change in cumulative CPU seconds / change in monotonic seconds × 100. 100% represents one core. CPU is unknown for first samples, missing start identities, PID reuse, counter rollback, non-advancing time, or snapshot gaps over 3 seconds. Process samples older than 3 seconds are excluded from the live footer.

On macOS, the main column, sorting, and trends consistently use Footprint; details retain RSS. Linux uses RSS, and Windows uses Working Set. KB / MB / GB scale by 1024, as in Orca. Unknown values display `—`; incomplete coverage is explained as a known subtotal in the tooltip and popover. Summation can still double-count shared pages and does not represent host usage.

Herdr and System have independent node IDs and trends. System machine trends do not reset for ordinary process additions or removals; process trends reset on PID reuse. Only new samples with complete coverage and readable memory append a trend point; missing metrics and error samples are not filled with zero.

Listeners have their own timestamp, topology, and process-start identities. CPU-only ticks retain metadata from the listener scan instead of borrowing names or resources from new PIDs. Old listeners must not attach to reused PIDs. No search matches do not mean a port is free; insufficient coverage is explicitly displayed. Loopback and wildcard addresses indicate binding scope only, not service reachability.

## Installation and distribution

The local build artifact is `mods/resource-monitor/bin/herdr-resource-sample[.exe]`, deployed by the installer. Source checkouts must build it first; a missing helper fails installation preflight. POSIX installation requires the owner-execute bit; failure rollback restores both original bytes and permissions. Generated binaries and target are excluded from version control; licenses are deployed with the Mod.

Remote machines require a helper built for their OS/architecture and placed in PATH. Remote software is not currently installed automatically, and privileges are not elevated. Missing helpers, malformed output, nonzero exits, and timeouts display errors, with no fallback to ps/top/lsof/PowerShell. The native schema and JS collector must currently be updated together.

## Performance criteria

See the [development guide](../development.md#resource-collection-performance-measurement) for performance sampling commands and measurement boundaries. The following measurements are historical and do not establish performance for later versions or the current environment.

On 2026-11-11, macOS arm64, with 9 managed roots, descendant counts varied during sampling and ended at about 21 processes. Each of three modes ran for 30 seconds at 1 Hz; listener modes scanned every 5 seconds. CPU is expressed as a percentage of one core.

| Mode | Mean helper CPU / invocation | Helper single-core utilization | Peak RSS | Invocation wall p95 |
| --- | ---: | ---: | ---: | ---: |
| footer | 6.09 ms | 0.61% | 1.86 MiB | 20.2 ms |
| PTYs, managed listeners | 5.48 ms | 0.55% | 1.88 MiB | 36.3 ms |
| Explicit whole-machine port search | 9.32 ms | 0.93% | 3.92 MiB | 33.6 ms |

The binary was 336624 bytes. The measurement controller used POSIX spawn; the Python controller was separately recorded at about 0.15–0.19% of one core and is not production JS. Loads differed between modes, so these results do not establish that listener collection is faster than the footer.

In a reference Node test, JSON parsing, the resource model, and expanded-tree projection for about 865 whole-machine metadata rows and 9 roots ran 1000 times, taking about 0.77 ms CPU per invocation. This excludes process startup, Herdr IPC, and GPUI and cannot simply be added up as production performance.

A separate short test used an isolated native application: one terminal, two processes, with a background test copy forced active, each state lasting 10 seconds. `proc_pid_rusage` read cumulative CPU for the App itself and reaped children, including actual exec, JS, and native drawing. The following is a single sequential measurement; the baseline includes other Mods, and the increment is relative to paused collection, not an upper bound on production cost. This measurement used the old memory-and-terminal-count footer; it has not been repeated since CPU was displayed directly.

| Native application state | App and child-process single-core utilization | Increment over paused baseline |
| --- | ---: | ---: |
| Monitoring paused | 0.47% | — |
| footer | 1.43% | 0.95% |
| Resources popover, stable values | 1.36% | 0.89% |

Before suppressing redraws based on displayed values, the popover increment in the same scenario was about 2.19%; after that optimization, it was about 0.89%. Baselines differed between rounds, so the difference is not a fixed benefit. Displayed values may change every second under active load, which still requires separate measurement.

The full-path steady-state target is at most 0.5% of one core, with an acceptance ceiling of 1% and helper peak RSS at most 10 MiB. The historical short helper tests above for managed scenarios met the 1% and 10 MiB ceilings; the native application's short-test increment approached the 1% ceiling, and the 0.5% target has not been met. Full-path acceptance remains incomplete, particularly tooltip hover, popovers with frequently changing data, remote exec wrappers, and concurrent machines.

After adding System scope on 2026-11-12, a short macOS arm64 test used `--roots= --scope system --samples=10 --ports-every=5` at 1 Hz for 10.00 seconds. The final enumeration contained 939 processes, 730 with readable memory. Helper single-core utilization was 1.55%, mean CPU was 15.52 ms per invocation, wall p95 was 210.45 ms, peak RSS was 3.98 MiB, and maximum JSON size was 134556 bytes. The Python controller separately used about 0.37% of one core. This excludes Herdr IPC, production JS, and GPUI. The System helper already exceeds the 1% ceiling above, so full-path performance compliance cannot be claimed. Whole-machine collection remains explicit and enabled within the panel; it does not broaden the default footer's collection scope.
