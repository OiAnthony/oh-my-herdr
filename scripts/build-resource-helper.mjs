#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const native = resolve(root, "native/resource-sample");
execFileSync("cargo", ["build", "--release", "--locked", "--manifest-path", resolve(native, "Cargo.toml")], { stdio: "inherit" });
const suffix = process.platform === "win32" ? ".exe" : "";
const name = `herdr-resource-sample${suffix}`;
const destination = resolve(root, "mods/resource-monitor/bin", name);
mkdirSync(dirname(destination), { recursive: true });
copyFileSync(resolve(native, "target/release", `herdr-resource-sample${suffix}`), destination);
chmodSync(destination, 0o755);
console.log(destination);
