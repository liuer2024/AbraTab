# AbraTab

AbraTab is a local terminal snippet manager built with Tauri, React, Rust, and SQLite.

## MVP features

- GUI snippet list with create, edit, delete, duplicate, search, and copy.
- SQLite persistence in the app data directory.
- Snippet fields: title, body, description, category, tags, shortcut, shell, enabled.
- Simple `{{variable}}` placeholder highlighting in the editor.
- CLI entry for listing, searching, printing, copying, adding, and removing snippets.

## Development

```bash
pnpm install
pnpm tauri:dev
```

## CLI

After building the Rust side, the CLI binary is available as `abratab-cli` from Cargo:

```bash
cd src-tauri
cargo run --bin abratab-cli -- list
cargo run --bin abratab-cli -- search docker
cargo run --bin abratab-cli -- print <id>
cargo run --bin abratab-cli -- copy <id>
```

Useful shell binding idea for zsh:

```zsh
abratab-pick() {
  local picked
  picked=$(cd /path/to/abraTab/src-tauri && cargo run --quiet --bin abratab-cli -- search "$BUFFER" | fzf | awk '{print $1}')
  [[ -n "$picked" ]] && BUFFER+=$(cd /path/to/abraTab/src-tauri && cargo run --quiet --bin abratab-cli -- print "$picked")
  zle redisplay
}
zle -N abratab-pick
bindkey '^G' abratab-pick
```
