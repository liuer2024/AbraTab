# AbraTab bash integration.
#
# When the current word matches a snippet shortcut, Tab replaces it with the
# snippet body. If no shortcut matches, bash falls back to readline completion.

: "${ABRATAB_ROOT:=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)}"
export ABRATAB_ROOT

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

_abratab_pick() {
  if ! command -v fzf >/dev/null 2>&1; then
    printf "\nAbraTab search needs fzf\n" >&2
    return 0
  fi

  local picked id body
  picked="$(_abratab_cli search "$READLINE_LINE" 2>/dev/null | fzf --query "$READLINE_LINE" --prompt "AbraTab> " --height 40% --reverse)"
  id="${picked%%$'\t'*}"

  if [[ -n "$id" ]]; then
    body="$(_abratab_cli print "$id" 2>/dev/null)"
    if [[ -n "$body" ]]; then
      READLINE_LINE="$body"
      READLINE_POINT=${#READLINE_LINE}
    fi
  fi
}

bind -x '"\t": _abratab_expand_or_complete'
bind -x '"\C-g": _abratab_pick'
