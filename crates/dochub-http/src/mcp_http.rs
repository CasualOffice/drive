//! `POST /api/mcp` — Model Context Protocol endpoint (JSON-RPC 2.0 over HTTP).
//!
//! Exposes Doc-Hub's retrieval as MCP **tools** so an external agent (Claude,
//! an IDE assistant) can search and question a workspace's documents. The
//! `dochub-mcp` core handles the protocol; this module supplies the transport
//! (an authenticated app-origin endpoint) and the concrete tool handlers, each
//! bound to the caller's session so a tool call is subject to the **same
//! workspace-scoping + permission filtering as a user request** — an agent can
//! only reach what its authenticated user can view.
//!
//! Tools:
//! - `semantic_search` — meaning-based retrieval; returns ranked passages.
//! - `ask` — RAG question answering; returns a composed answer with citations.
//!
//! Auth is the normal session ([`AuthSession`]); a bearer-token path for
//! headless agents is a follow-up. Notifications (no `id`) get `204 No Content`.

use std::fmt::Write as _;
use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use dochub_ai::AnswerContext;
use dochub_auth::AuthSession;
use dochub_mcp::{JsonRpcRequest, McpServer, ServerInfo, Tool, ToolError, ToolHandler, ToolOutput};
use serde_json::{json, Value};

use crate::content_search::kind_of;
use crate::semantic_search::retrieve_chunks;
use crate::workspaces::resolve_active_workspace;
use crate::HttpState;

/// Max passages a tool pulls as context / results.
const MCP_MAX_CHUNKS: usize = 8;

/// `POST /api/mcp` — session-authed JSON-RPC. Builds a per-request MCP server
/// whose tools are bound to the caller, dispatches the message, and returns the
/// response (or `204` for a notification).
pub(crate) async fn mcp_endpoint(
    State(s): State<HttpState>,
    session: AuthSession,
    Json(req): Json<JsonRpcRequest>,
) -> Response {
    let server = McpServer::new(ServerInfo {
        name: "casual-dochub".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    })
    .register(
        semantic_search_tool(),
        Arc::new(RetrievalTool {
            state: s.clone(),
            user_id: session.user_id.clone(),
            mode: Mode::Search,
        }),
    )
    .register(
        ask_tool(),
        Arc::new(RetrievalTool {
            state: s,
            user_id: session.user_id,
            mode: Mode::Ask,
        }),
    );

    match server.handle(req).await {
        Some(resp) => Json(resp).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    }
}

fn arg_schema(extra_desc: &str) -> Value {
    json!({
        "type": "object",
        "properties": {
            "q": { "type": "string", "description": extra_desc },
            "limit": { "type": "integer", "minimum": 1, "maximum": 25 },
            "workspace": { "type": "string", "description": "Optional workspace id; defaults to the caller's personal workspace." }
        },
        "required": ["q"]
    })
}

fn semantic_search_tool() -> Tool {
    Tool::new(
        "semantic_search",
        "Find document passages related by meaning to a query. Returns ranked snippets with their document titles.",
        arg_schema("The search query."),
    )
}

fn ask_tool() -> Tool {
    Tool::new(
        "ask",
        "Answer a natural-language question from the workspace's documents, with citations to the sources used.",
        arg_schema("The question to answer."),
    )
}

#[derive(Clone, Copy)]
enum Mode {
    Search,
    Ask,
}

/// A tool bound to the caller. `retrieve_chunks` enforces workspace + ACL, so
/// this never returns anything the user can't view.
struct RetrievalTool {
    state: HttpState,
    user_id: String,
    mode: Mode,
}

#[async_trait::async_trait]
impl ToolHandler for RetrievalTool {
    async fn call(&self, arguments: Value) -> Result<ToolOutput, ToolError> {
        let q = arguments
            .get("q")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                ToolError::InvalidArguments("`q` (non-empty string) is required".into())
            })?;
        let limit = arguments
            .get("limit")
            .and_then(Value::as_u64)
            .map_or(10, |n| n.clamp(1, 25) as usize);
        let workspace_arg = arguments.get("workspace").and_then(Value::as_str);

        let workspace = resolve_active_workspace(&self.state.db, &self.user_id, workspace_arg)
            .await
            .map_err(|e| ToolError::Execution(format!("workspace: {e:?}")))?;

        let chunks = retrieve_chunks(&self.state, &self.user_id, &workspace, q, MCP_MAX_CHUNKS)
            .await
            .map_err(|code| ToolError::Execution(format!("retrieval failed ({code})")))?;

        match self.mode {
            Mode::Search => Ok(ToolOutput::text(format_search(&chunks, limit))),
            Mode::Ask => Ok(ToolOutput::text(format_answer(q, &chunks).await)),
        }
    }
}

type Chunk = (dochub_db::StoredEmbedding, dochub_db::File, f32);

/// Render semantic-search hits, deduped to the best chunk per file.
fn format_search(chunks: &[Chunk], limit: usize) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut out = String::new();
    let mut n = 0;
    for (chunk, file, score) in chunks {
        if n >= limit {
            break;
        }
        if !seen.insert(chunk.file_id.clone()) {
            continue;
        }
        n += 1;
        let _ = writeln!(
            out,
            "{n}. {} [{}] (score {score:.2})\n   {}",
            file.name,
            kind_of(file),
            snippet(&chunk.chunk_text),
        );
    }
    if out.is_empty() {
        "No matching passages found.".into()
    } else {
        out
    }
}

/// Compose an extractive answer + citations from the retrieved chunks.
async fn format_answer(q: &str, chunks: &[Chunk]) -> String {
    if chunks.is_empty() {
        return "No relevant passages were found to answer that.".into();
    }
    let contexts: Vec<AnswerContext> = chunks
        .iter()
        .map(|(chunk, file, _)| AnswerContext {
            source_id: chunk.file_id.clone(),
            title: file.name.clone(),
            text: chunk.chunk_text.clone(),
        })
        .collect();
    let answer = match crate::ai::answerer().answer(q, &contexts).await {
        Ok(a) => a,
        Err(e) => return format!("Failed to compose an answer: {e}"),
    };
    if answer.text.trim().is_empty() {
        return "No relevant passages were found to answer that.".into();
    }
    let mut out = answer.text;
    if !answer.citations.is_empty() {
        out.push_str("\n\nSources:");
        for c in &answer.citations {
            if let Some((_, file, _)) = chunks.get(c.context_index) {
                let _ = write!(out, "\n- {}", file.name);
            }
        }
    }
    out
}

/// Trim a chunk to a compact one-line snippet.
fn snippet(text: &str) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= 200 {
        flat
    } else {
        let mut s: String = flat.chars().take(200).collect();
        s.push('…');
        s
    }
}
