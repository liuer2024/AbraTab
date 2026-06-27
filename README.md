# AbraTab

AbraTab is a local-first text expansion and code snippet manager. Type a
trigger, press Tab, and expand reusable text anywhere you can type. It supports
variable placeholders, categories, tags, shell-specific snippets, and terminal
search.

妙手（AbraTab）：本地优先的文本扩展与代码片段管理工具。输入触发词，按下 Tab，在任何能打字的地方瞬间展开，支持变量填充、分类与标签管理。"妙手"取信手拈来、按 Tab 即变之意。

## Features

- Local-first snippet storage with SQLite.
- Desktop GUI built with Tauri, React, Rust, and SQLite.
- Trigger-based expansion from zsh, bash, and fish.
- `Ctrl+G` terminal search powered by `fzf`.
- Variable placeholders such as `{{name}}`.
- Categories, tags, favorites, pinning, and trash.
- Shell-specific snippets for terminal workflows.
- Lightweight CLI for listing, searching, copying, and expanding snippets.

## Status

AbraTab is early-stage software. The current focus is local snippet management,
terminal expansion, and a polished desktop editing workflow.

## Development

Requirements:

- Node.js
- pnpm
- Rust
- Tauri prerequisites for your operating system

Install dependencies and start the app:

```bash
pnpm install
pnpm tauri:dev
```

Build the frontend:

```bash
pnpm build
```

Build the desktop app:

```bash
pnpm tauri:build
```

## Automated Builds

GitHub Actions runs CI on pushes and pull requests to `main`.

To create a release build, push a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow builds the macOS app and creates a draft GitHub Release.
Review the generated assets, then publish the release from GitHub.

## CLI

After building the Rust side, the CLI binary is available as `abratab-cli`:

```bash
cd src-tauri
cargo run --bin abratab-cli -- list
cargo run --bin abratab-cli -- search docker
cargo run --bin abratab-cli -- print <id>
cargo run --bin abratab-cli -- copy <id>
cargo run --bin abratab-cli -- expand dlog
```

## Shell Expansion And Search

Recommended: open AbraTab Settings -> Terminal, then register zsh, bash, or
fish from the app.

Tab expansion only needs the local `abratab-cli` binary. Terminal search uses
`fzf`; install it from Settings -> Terminal, or run:

```bash
brew install fzf
```

Manual zsh installation:

```bash
./scripts/install-zsh-integration.sh
```

Then restart the terminal or run:

```bash
source ~/.zshrc
```

Typing `dlog` and pressing Tab expands it to the snippet body when `dlog` is an
enabled shortcut.

Press `Ctrl+G` in the terminal to search snippets with `fzf` and replace the
current command line with the selected snippet body. In iTerm2, `Command+G` is
an app shortcut by default; map it in Profiles -> Keys to send `Ctrl+G` if you
want that key.

Uninstall manual zsh integration:

```bash
./scripts/uninstall-zsh-integration.sh
```

## Data

AbraTab stores snippets locally. On macOS, the default database path is:

```text
~/Library/Application Support/AbraTab/AbraTab.db
```

## License

MIT
