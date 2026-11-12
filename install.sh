#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
have_app_home=0
app_home=
switch_layout=0
dry_run=0
operation=install

usage() {
  cat <<'EOF'
Usage: install.sh [--switch] [--dry-run] [app-home]
       install.sh --uninstall [app-home]
       install.sh --check [app-home]

Install/update the layout and eight Mods, then run herdr-app check.
Release ZIPs use only their private runtime/node and precompiled helper.
Source developers must explicitly run node scripts/build-resource-helper.mjs first.

Options:
  --switch     Switch to oh-my-herdr only after successful install/check
  --uninstall  Restore managed shortcuts and remove unchanged owned files
  --check      Check the installed suite without installing
  --dry-run    Validate prerequisites and print commands without modifying files
  -h, --help   Show this help

App home: explicit argument, HERDR_APP_HOME, $XDG_CONFIG_HOME/herdr-app,
then ~/.config/herdr-app. Start Herdr with this home once before installing.
EOF
}

fail() { echo "install.sh: $*" >&2; exit 1; }
select_operation() {
  [ "$operation" = install ] || fail "choose only one of --uninstall and --check"
  operation=$1
}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --switch) switch_layout=1 ;;
    --uninstall) select_operation uninstall ;;
    --check) select_operation check ;;
    --dry-run) dry_run=1 ;;
    -h|--help) usage; exit 0 ;;
    --) shift; [ "$#" -le 1 ] || fail "only one app home may be given"
      if [ "$#" -eq 1 ]; then
        [ "$have_app_home" -eq 0 ] || fail "only one app home may be given"
        app_home=$1; have_app_home=1; shift
      fi
      break ;;
    -*) fail "unknown option: $1" ;;
    *) [ "$have_app_home" -eq 0 ] || fail "only one app home may be given"
       app_home=$1; have_app_home=1 ;;
  esac
  shift
done
[ "$switch_layout" -eq 0 ] || [ "$operation" = install ] || fail "--switch requires install"
[ -f "$root/oh-my-herdr.mjs" ] || fail "incomplete package: missing oh-my-herdr.mjs"

if [ -e "$root/release.json" ] || [ -e "$root/runtime" ] || [ -e "$root/release-target" ]; then
  [ -f "$root/release.json" ] && [ -f "$root/release-target" ] || fail "incomplete release package; extract a fresh ZIP"
  IFS= read -r target < "$root/release-target" || fail "invalid release-target; extract a fresh ZIP"
  [ "$(/usr/bin/uname -s)" = Darwin ] || fail "release ZIPs require macOS 13.5 or newer"
  case "$(/usr/bin/uname -m)" in
    arm64) arch=arm64 ;;
    x86_64) arch=x64 ;;
    *) fail "unsupported Mac architecture" ;;
  esac
  [ "$target" = "darwin-$arch" ] || fail "package architecture mismatch: need darwin-$arch, got $target"
  os_version=$(/usr/bin/sw_vers -productVersion)
  IFS=. read -r major minor patch <<< "$os_version"
  [ "$major" -gt 13 ] || { [ "$major" -eq 13 ] && [ "${minor:-0}" -ge 5 ]; } || fail "macOS 13.5 or newer is required"
  node="$root/runtime/node"
  [ -x "$node" ] && [ ! -L "$node" ] || fail "missing or non-executable private runtime/node; extract a fresh ZIP (no system Node fallback)"
else
  [ -f "$root/native/resource-sample/Cargo.toml" ] || fail "incomplete release package; extract a fresh ZIP"
  node=$(command -v node) || fail "source installation requires Node; build the helper explicitly first"
fi

if [ "$have_app_home" -eq 1 ]; then export HERDR_APP_HOME="$app_home"; fi
if [ "$operation" != uninstall ]; then
  command -v herdr-app >/dev/null 2>&1 || fail "herdr-app is required; install Herdr Desktop and make its CLI available"
fi
run() {
  if [ "$dry_run" -eq 1 ]; then printf '+ '; printf '%q ' "$@"; printf '\n'; else "$@"; fi
}
args=("$operation")
if [ "$have_app_home" -eq 1 ]; then args+=("$app_home"); fi
# The CLI uses the same read-only preflight before any actual installation.
if [ "$dry_run" -eq 1 ]; then
  "$node" "$root/oh-my-herdr.mjs" preflight "${args[@]}"
fi
run "$node" "$root/oh-my-herdr.mjs" "${args[@]}"
if [ "$operation" = install ]; then
  args[0]=check
  run "$node" "$root/oh-my-herdr.mjs" "${args[@]}"
  if [ "$switch_layout" -eq 1 ]; then
    run herdr-app do layout.switch '{"name":"oh-my-herdr"}'
  elif [ "$dry_run" -eq 0 ]; then
    echo "Installed. Enable with ./install.sh --switch or Herdr's layout picker. No layout was switched."
  fi
fi
