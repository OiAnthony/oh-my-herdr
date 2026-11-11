#!/usr/bin/env python3
"""Measure native sampling and this controller; excludes Herdr IPC and GPUI."""
import argparse
import json
import math
import os
from pathlib import Path
import resource
import statistics
import subprocess
import sys
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--roots", default=str(os.getpid()))
parser.add_argument("--samples", type=int, default=30)
parser.add_argument("--interval", type=float, default=1.0)
parser.add_argument("--ports-every", type=int, default=0)
parser.add_argument("--scope", choices=("herdr", "system"), default="herdr")
args = parser.parse_args()
if args.samples < 1 or args.interval <= 0 or args.ports_every < 0:
    parser.error("samples/interval must be positive; ports-every must be nonnegative")
helper = Path(__file__).resolve().parents[1] / "mods/resource-monitor/bin/herdr-resource-sample"
command = [str(helper), f"--roots={args.roots}", f"--scope={args.scope}"]
subprocess.run(command, check=True, capture_output=True, timeout=2, close_fds=False)
cpu, wall, sizes = [], [], []
parent_before = time.process_time()
started = time.monotonic()
last = None
for index in range(args.samples):
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    tick = time.monotonic()
    result = subprocess.run(command + (["--ports"] if args.ports_every and index % args.ports_every == 0 else []),
                            check=True, capture_output=True, timeout=2, close_fds=False)
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    cpu.append((after.ru_utime + after.ru_stime - before.ru_utime - before.ru_stime) * 1000)
    wall.append((time.monotonic() - tick) * 1000)
    sizes.append(len(result.stdout))
    last = json.loads(result.stdout)
    time.sleep(max(0, started + (index + 1) * args.interval - time.monotonic()))
duration = time.monotonic() - started
parent_cpu = time.process_time() - parent_before
rss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
print(json.dumps({
    "samples": args.samples, "durationSeconds": duration, "portsEvery": args.ports_every,
    "processScope": args.scope, "listenerScope": "all" if args.scope == "system" else "managed",
    "roots": len(set(filter(None, args.roots.split(",")))),
    "lastRows": len(last["rows"]),
    "lastMeasuredProcesses": sum(row["memory"] is not None for row in last["rows"]),
    "helperCpuMeanMs": statistics.mean(cpu), "helperCpuP95Ms": sorted(cpu)[math.ceil(len(cpu) * .95) - 1],
    "helperWallMedianMs": statistics.median(wall), "helperWallP95Ms": sorted(wall)[math.ceil(len(wall) * .95) - 1],
    "helperCpuOneCorePercent": sum(cpu) / 1000 / duration * 100,
    "pythonControllerCpuOneCorePercent": parent_cpu / duration * 100,
    "helperPeakRssMiB": rss / (1024 ** 2 if sys.platform == "darwin" else 1024),
    "outputMaxBytes": max(sizes), "binaryBytes": helper.stat().st_size,
    "scope": "native helper and Python controller; excludes Herdr IPC, production JS and GPUI"
}, indent=2))
