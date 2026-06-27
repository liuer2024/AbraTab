//! Minimal stdio MCP server for AbraTab.
//!
//! Speaks JSON-RPC 2.0 over newline-delimited stdin/stdout (the MCP stdio
//! transport). Exposes a single tool, `inbox_add`, that writes a record into
//! AbraTab's Inbox. Designed to be launched by an MCP client (Claude Code,
//! Codex, …) as `abratab-cli mcp`.

use crate::store::Store;
use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::io::{BufRead, Write};

const PROTOCOL_VERSION: &str = "2025-06-18";

pub fn serve(store: Store) -> Result<()> {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();

    for line in stdin.lock().lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let message: Value = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(_) => {
                write_message(&mut out, &error_response(Value::Null, -32700, "parse error"))?;
                continue;
            }
        };

        let id = message.get("id").cloned();
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");

        // Notifications carry no id and never get a response.
        let Some(id) = id else {
            continue;
        };

        let response = match method {
            "initialize" => {
                let version = message
                    .get("params")
                    .and_then(|p| p.get("protocolVersion"))
                    .and_then(Value::as_str)
                    .unwrap_or(PROTOCOL_VERSION)
                    .to_string();
                result_response(
                    id,
                    json!({
                        "protocolVersion": version,
                        "capabilities": { "tools": { "listChanged": false } },
                        "serverInfo": { "name": "abratab", "version": env!("CARGO_PKG_VERSION") }
                    }),
                )
            }
            "tools/list" => result_response(id, json!({ "tools": [tool_schema()] })),
            "tools/call" => match handle_tool_call(&store, message.get("params")) {
                Ok(text) => result_response(
                    id,
                    json!({ "content": [{ "type": "text", "text": text }], "isError": false }),
                ),
                Err(error) => result_response(
                    id,
                    json!({
                        "content": [{ "type": "text", "text": format!("Error: {error}") }],
                        "isError": true
                    }),
                ),
            },
            "ping" => result_response(id, json!({})),
            other => error_response(id, -32601, &format!("method not found: {other}")),
        };

        write_message(&mut out, &response)?;
    }

    Ok(())
}

fn tool_schema() -> Value {
    json!({
        "name": "inbox_add",
        "description": "Save a note, summary, decision, or any record into AbraTab's Inbox so the user can review it later in the AbraTab desktop app.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": { "type": "string", "description": "The note content to save (required)." },
                "title": { "type": "string", "description": "Optional short title for the record." },
                "source": { "type": "string", "description": "Tool saving this, e.g. \"claude\" or \"codex\". Defaults to \"mcp\"." }
            },
            "required": ["text"]
        }
    })
}

fn handle_tool_call(store: &Store, params: Option<&Value>) -> Result<String> {
    let params = params.context("missing params")?;
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .context("missing tool name")?;
    if name != "inbox_add" {
        anyhow::bail!("unknown tool: {name}");
    }

    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    let text = args
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if text.is_empty() {
        anyhow::bail!("`text` is required");
    }
    let title = args.get("title").and_then(Value::as_str).unwrap_or("");
    let source = args
        .get("source")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("mcp");

    let item = store.add_inbox_item(source, title, &text)?;
    Ok(format!("Saved to AbraTab Inbox (id={}).", item.id))
}

fn result_response(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn write_message(out: &mut impl Write, message: &Value) -> Result<()> {
    let text = serde_json::to_string(message)?;
    out.write_all(text.as_bytes())?;
    out.write_all(b"\n")?;
    out.flush()?;
    Ok(())
}
