# AbraTab fish integration.
#
# When the current token matches a snippet shortcut, Tab replaces it with the
# snippet body; otherwise Tab keeps fish's normal completion behavior.

if not set -q ABRATAB_ROOT
    set -gx ABRATAB_ROOT (cd (dirname (status filename))/..; and pwd -P)
end

function _abratab_cli
    if test -n "$ABRATAB_CLI"
        "$ABRATAB_CLI" $argv
    else if test -x "$ABRATAB_ROOT/src-tauri/target/debug/abratab-cli"
        "$ABRATAB_ROOT/src-tauri/target/debug/abratab-cli" $argv
    else if test -x "$ABRATAB_ROOT/src-tauri/target/release/abratab-cli"
        "$ABRATAB_ROOT/src-tauri/target/release/abratab-cli" $argv
    else if command -q abratab-cli
        abratab-cli $argv
    else
        pushd "$ABRATAB_ROOT/src-tauri" >/dev/null
        cargo run --quiet --bin abratab-cli -- $argv
        popd >/dev/null
    end
end

function _abratab_expand_or_complete
    set -l current_token (commandline -ct)

    if test -n "$current_token"
        set -l current_shell (basename "$SHELL")
        set -l expansion (_abratab_cli expand "$current_token" "$current_shell" 2>/dev/null)

        if test -n "$expansion"
            commandline -t -- "$expansion"
            return 0
        end
    end

    commandline -f complete
end

function _abratab_pick
    if not command -q fzf
        commandline -f repaint
        echo "AbraTab search needs fzf" >&2
        return 0
    end

    set -l query (commandline)
    set -l picked (_abratab_cli search "$query" 2>/dev/null | fzf --query "$query" --prompt "AbraTab> " --height 40% --reverse)
    set -l id (string split \t -- "$picked")[1]

    if test -n "$id"
        set -l body (_abratab_cli print "$id" 2>/dev/null)
        if test -n "$body"
            commandline -- "$body"
            commandline -C (string length -- "$body")
        end
    end
end

bind \t _abratab_expand_or_complete
bind \cg _abratab_pick
