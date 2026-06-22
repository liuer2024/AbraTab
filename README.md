# AbraTab

AbraTab is a local terminal snippet manager built with Tauri, React, Rust, and SQLite.

## MVP features

- GUI snippet list with create, edit, delete, duplicate, search, and copy.
- SQLite persistence in the app data directory.
- Snippet fields: title, body, description, category, tags, shortcut, shell, enabled.
- Simple `{{variable}}` placeholder highlighting in the editor.
- CLI entry for listing, searching, printing, copying, adding, and removing snippets.
- zsh/bash/fish Tab expansion and Ctrl+G search for snippet shortcuts.

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
cargo run --bin abratab-cli -- expand dlog
```

## Shell expansion and search

Recommended: open AbraTab Settings -> Terminal, then use Register for zsh,
bash, or fish.

Tab expansion only needs the local `abratab-cli` binary. Terminal search uses
`fzf`; install it from Settings -> Terminal, or run:

```bash
brew install fzf
```

Install the zsh integration:

```bash
./scripts/install-zsh-integration.sh
```

Then restart the terminal or run `source ~/.zshrc`. Typing `dlog` and pressing
Tab expands it to the snippet body when `dlog` is an enabled shortcut.

Press `Ctrl+G` in the terminal to search snippets with `fzf` and replace the
current command line with the selected snippet body. In iTerm2, `Command+G` is
an app shortcut by default; map it in Profiles -> Keys to send `Ctrl+G` if you
want that key.

The installer writes a marked block to `~/.zshrc`, sets `ABRATAB_ROOT`, and uses
the built `abratab-cli` binary instead of running Cargo on every Tab press.

Uninstall:

```bash
./scripts/uninstall-zsh-integration.sh
```
