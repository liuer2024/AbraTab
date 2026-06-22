#!/usr/bin/env bash
set -euo pipefail

ZSHRC="${ZDOTDIR:-$HOME}/.zshrc"
START="# >>> AbraTab zsh integration >>>"
END="# <<< AbraTab zsh integration <<<"

if [[ ! -f "$ZSHRC" ]]; then
  printf "%s does not exist; nothing to uninstall.\n" "$ZSHRC"
  exit 0
fi

TMP="$(mktemp)"
awk -v start="$START" -v end="$END" '
  $0 == start { skip = 1; removed = 1; next }
  $0 == end { skip = 0; next }
  !skip { print }
  END { if (!removed) exit 2 }
' "$ZSHRC" > "$TMP" || {
  code=$?
  rm -f "$TMP"
  if [[ "$code" -eq 2 ]]; then
    printf "AbraTab zsh integration block was not found in %s\n" "$ZSHRC"
    exit 0
  fi
  exit "$code"
}

cat "$TMP" > "$ZSHRC"
rm -f "$TMP"

printf "AbraTab zsh integration removed from %s\n" "$ZSHRC"
