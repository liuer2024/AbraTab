#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZSHRC="${ZDOTDIR:-$HOME}/.zshrc"
CLI="$ROOT/src-tauri/target/debug/abratab-cli"

if [[ ! -x "$CLI" ]]; then
  (cd "$ROOT/src-tauri" && cargo build --bin abratab-cli)
fi

mkdir -p "$(dirname "$ZSHRC")"
touch "$ZSHRC"

START="# >>> AbraTab zsh integration >>>"
END="# <<< AbraTab zsh integration <<<"
BLOCK="$START
export ABRATAB_ROOT=\"$ROOT\"
export ABRATAB_CLI=\"$CLI\"
source \"$ROOT/scripts/abratab.zsh\"
$END"

TMP="$(mktemp)"
awk -v start="$START" -v end="$END" '
  $0 == start { skip = 1; next }
  $0 == end { skip = 0; next }
  !skip { print }
' "$ZSHRC" > "$TMP"
{
  cat "$TMP"
  printf "\n%s\n" "$BLOCK"
} > "$ZSHRC"
rm -f "$TMP"

printf "AbraTab zsh integration installed in %s\n" "$ZSHRC"
printf "Restart your terminal or run: source %s\n" "$ZSHRC"
