# AbraTab bash integration.
#
# When the current word matches a snippet shortcut, Tab replaces it with the
# snippet body. If no shortcut matches, bash falls back to readline completion.

: "${ABRATAB_ROOT:=/Users/smiler/Documents/98_personal/abraTab}"

_abratab_cli() {
  if [[ -n "${ABRATAB_CLI:-}" ]]; then
    "$ABRATAB_CLI" "$@"
  elif [[ -x "$ABRATAB_ROOT/src-tauri/target/debug/abratab-cli" ]]; then
    "$ABRATAB_ROOT/src-tauri/target/debug/abratab-cli" "$@"
  elif [[ -x "$ABRATAB_ROOT/src-tauri/target/release/abratab-cli" ]]; then
    "$ABRATAB_ROOT/src-tauri/target/release/abratab-cli" "$@"
  elif command -v abratab-cli >/dev/null 2>&1; then
    abratab-cli "$@"
  else
    (cd "$ABRATAB_ROOT/src-tauri" && cargo run --quiet --bin abratab-cli -- "$@")
  fi
}

_abratab_expand_or_complete() {
  local before="${READLINE_LINE:0:READLINE_POINT}"
  local after="${READLINE_LINE:READLINE_POINT}"
  local current_word="${before##*[[:space:]]}"

  if [[ -n "$current_word" ]]; then
    local current_shell="${SHELL##*/}"
    local expansion
    expansion="$(_abratab_cli expand "$current_word" "$current_shell" 2>/dev/null)"

    if [[ -n "$expansion" ]]; then
      READLINE_LINE="${before:0:${#before}-${#current_word}}$expansion$after"
      READLINE_POINT=$((${#before} - ${#current_word} + ${#expansion}))
      return 0
    fi
  fi

  READLINE_LINE="${READLINE_LINE:0:READLINE_POINT}	${READLINE_LINE:READLINE_POINT}"
  READLINE_POINT=$((READLINE_POINT + 1))
}

bind -x '"\t": _abratab_expand_or_complete'
