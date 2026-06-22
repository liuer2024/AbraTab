mod models;
mod store;

use anyhow::{bail, Context, Result};
use arboard::Clipboard;
use models::SnippetInput;
use std::env;
use store::Store;

fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "help".to_string());
    let store = Store::open_default()?;

    match command.as_str() {
        "list" => print_snippets(&store.list(None, false)?),
        "search" => {
            let query = args.collect::<Vec<_>>().join(" ");
            print_snippets(&store.list(Some(&query), false)?);
        }
        "print" => {
            let id = required(args.next(), "print requires a snippet id")?;
            let snippet = store.get(&id)?.context("snippet not found")?;
            print!("{}", snippet.body);
        }
        "copy" => {
            let id = required(args.next(), "copy requires a snippet id")?;
            let snippet = store.get(&id)?.context("snippet not found")?;
            let mut clipboard = Clipboard::new()?;
            clipboard.set_text(snippet.body)?;
            println!("copied {}", snippet.id);
        }
        "add" => {
            let title = required(args.next(), "add requires a title")?;
            let body = required(args.next(), "add requires a body")?;
            let snippet = store.save(SnippetInput {
                id: None,
                title,
                body,
                description: None,
                category: None,
                tags: None,
                shortcut: None,
                shell: Some("any".into()),
                enabled: Some(true),
                favorite: Some(false),
            })?;
            println!("{}", snippet.id);
        }
        "delete" | "remove" => {
            let id = required(args.next(), "delete requires a snippet id")?;
            store.delete(&id)?;
        }
        "restore" => {
            let id = required(args.next(), "restore requires a snippet id")?;
            store.restore(&id)?;
        }
        "purge" => {
            let id = required(args.next(), "purge requires a snippet id")?;
            store.purge(&id)?;
        }
        "favorite" => {
            let id = required(args.next(), "favorite requires a snippet id")?;
            let favorite = args
                .next()
                .map(|value| matches!(value.as_str(), "1" | "true" | "on" | "yes"))
                .unwrap_or(true);
            store.set_favorite(&id, favorite)?;
        }
        "db-path" => println!("{}", store::default_db_path()?.display()),
        "help" | "--help" | "-h" => print_help(),
        other => bail!("unknown command: {other}"),
    }

    Ok(())
}

fn print_snippets(snippets: &[models::Snippet]) {
    for snippet in snippets {
        let tags = if snippet.tags.is_empty() {
            String::new()
        } else {
            format!(" [{}]", snippet.tags.join(","))
        };
        println!(
            "{}\t{}\t{}{}",
            snippet.id, snippet.shortcut, snippet.title, tags
        );
    }
}

fn print_help() {
    println!(
        "AbraTab CLI\n\nCommands:\n  list\n  search <query>\n  print <id>\n  copy <id>\n  add <title> <body>\n  delete <id>\n  restore <id>\n  purge <id>\n  favorite <id> [on|off]\n  db-path"
    );
}

fn required(value: Option<String>, message: &str) -> Result<String> {
    value.context(message.to_string())
}
