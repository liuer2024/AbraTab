# AbraTab zsh integration.
#
# Source this file from ~/.zshrc. When the current word matches a snippet
# shortcut, Tab replaces it with the snippet body; otherwise Tab keeps zsh's
# normal completion behavior.

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
  emulate -L zsh

  local current_word="${LBUFFER##*[[:space:]]}"
  if [[ -n "$current_word" ]]; then
    local current_shell="${SHELL:t}"
    local expansion
    expansion="$(_abratab_cli expand "$current_word" "$current_shell" 2>/dev/null)"

    if [[ -n "$expansion" ]]; then
      LBUFFER="${LBUFFER[1,$(( ${#LBUFFER} - ${#current_word} ))]}$expansion"
      zle redisplay
      return 0
    fi
  fi

  zle expand-or-complete
}

_abratab_pick() {
  emulate -L zsh

  if ! command -v fzf >/dev/null 2>&1; then
    zle -M "AbraTab search needs fzf"
    return 0
  fi

  local query="${BUFFER}"
  local picked id body
  picked="$(_abratab_cli search "$query" 2>/dev/null | fzf --query "$query" --prompt "AbraTab> " --height 40% --reverse)"
  id="${picked%%$'\t'*}"

  if [[ -n "$id" ]]; then
    body="$(_abratab_cli print "$id" 2>/dev/null)"
    if [[ -n "$body" ]]; then
      BUFFER="$body"
      CURSOR=${#BUFFER}
      zle redisplay
    fi
  fi
}

zle -N _abratab_expand_or_complete
zle -N _abratab_pick
bindkey '^I' _abratab_expand_or_complete
bindkey '^G' _abratab_pick
