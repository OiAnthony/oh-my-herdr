#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
have_app_home=0
app_home=
switch_layout=0
dry_run=0

usage() {
  cat <<'EOF'
Usage: install.sh [options] [app-home]

Build the native resource helper, install the Professional layout and eight Mods,
then run herdr-app check.

Options:
  --switch     Switch the running Herdr Desktop to Professional after check
  --dry-run    Print commands without running them
  -h, --help   Show this help

The app home defaults to HERDR_APP_HOME, then $XDG_CONFIG_HOME/herdr-app,
then ~/.config/herdr-app.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --switch) switch_layout=1 ;;
    --dry-run) dry_run=1 ;;
    -h|--help) usage; exit 0 ;;
    --) shift; if [ "$#" -gt 0 ]; then app_home=$1; have_app_home=1; shift; fi; break ;;
    -*) echo "install.sh: unknown option: $1" >&2; usage >&2; exit 2 ;;
    *)
      if [ "$have_app_home" -eq 1 ]; then
        echo "install.sh: only one app home may be given" >&2
        exit 2
      fi
      app_home=$1
      have_app_home=1
      ;;
  esac
  shift
done

if [ ! -f "$root/oh-my-herdr.mjs" ]; then
  echo "install.sh: run this script from the oh-my-herdr checkout" >&2
  exit 1
fi

for tool in node cargo herdr-app; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "install.sh: $tool is required but was not found in PATH" >&2
    exit 1
  fi
done

if [ "$have_app_home" -eq 1 ]; then
  export HERDR_APP_HOME="$app_home"
fi

run() {
  if [ "$dry_run" -eq 1 ]; then
    printf '+ '
    printf '%q ' "$@"
    printf '\n'
  else
    "$@"
  fi
}

install_args=(install)
check_args=(check)
if [ "$have_app_home" -eq 1 ]; then
  install_args+=("$app_home")
  check_args+=("$app_home")
fi

run node "$root/scripts/build-resource-helper.mjs"
run node "$root/oh-my-herdr.mjs" "${install_args[@]}"
run node "$root/oh-my-herdr.mjs" "${check_args[@]}"

if [ "$switch_layout" -eq 1 ]; then
  if [ "$dry_run" -eq 1 ]; then
    printf "+ herdr-app \"do\" layout.switch '{\"name\":\"Professional\"}'\n"
  else
    herdr-app "do" layout.switch '{"name":"Professional"}'
  fi
elif [ "$dry_run" -eq 0 ]; then
  echo "Installed. Enable it with:"
  if [ "$have_app_home" -eq 1 ]; then
    printf "  HERDR_APP_HOME=%q herdr-app \"do\" layout.switch '{\"name\":\"Professional\"}'\n" "$app_home"
  else
    printf "  herdr-app \"do\" layout.switch '{\"name\":\"Professional\"}'\n"
  fi
fi
