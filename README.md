# AbraTab

AbraTab is a local terminal snippet manager built with Tauri, React, Rust, and SQLite.

## MVP features

- GUI snippet list with create, edit, delete, duplicate, search, and copy.
- SQLite persistence in the app data directory.
- Snippet fields: title, body, description, category, tags, shortcut, shell, enabled.
- Simple `{{variable}}` placeholder highlighting in the editor.
- CLI entry for listing, searching, printing, copying, adding, and removing snippets.
- zsh Tab expansion for snippet shortcuts through `scripts/abratab.zsh`.

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

## zsh Tab expansion

Recommended: open AbraTab Settings -> Terminal, then use Register for zsh,
bash, or fish.

Install the zsh integration:

```bash
./scripts/install-zsh-integration.sh
```

Then restart the terminal or run `source ~/.zshrc`. Typing `dlog` and pressing
Tab expands it to the snippet body when `dlog` is an enabled shortcut.

The installer writes a marked block to `~/.zshrc`, sets `ABRATAB_ROOT`, and uses
the built `abratab-cli` binary instead of running Cargo on every Tab press.

Uninstall:

```bash
./scripts/uninstall-zsh-integration.sh
```
