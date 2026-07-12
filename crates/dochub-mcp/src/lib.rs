//! `dochub-mcp` — a Model Context Protocol (MCP) server core for Doc-Hub.
//!
//! MCP lets external agents (Claude, IDE assistants, …) call a server's *tools*
//! over JSON-RPC 2.0. This crate is the **pure, transport-agnostic core**: the
//! JSON-RPC message types, a tool registry, and the request dispatcher for the
//! `initialize` / `tools/list` / `tools/call` methods. It has no network, DB, or
//! auth dependency — exactly like `dochub-index` is a pure search primitive and
//! `dochub-ai` a pure RAG primitive — so the protocol logic is unit-testable in
//! isolation.
//!
//! The Doc-Hub tools (`search`, `semantic_search`, `ask`) and their transport
//! (an authenticated HTTP endpoint on the app origin that maps a tool call onto
//! the existing search/RAG handlers) are wired one layer up in `dochub-http`.
//! This crate just knows how to describe tools and dispatch calls to a
//! [`ToolHandler`].

#![forbid(unsafe_code)]

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;

/// MCP protocol version this server implements.
pub const PROTOCOL_VERSION: &str = "2025-06-18";

// ── JSON-RPC 2.0 envelopes ─────────────────────────────────────────────────

/// A JSON-RPC request (or notification, when `id` is absent).
#[derive(Debug, Clone, Deserialize)]
pub struct JsonRpcRequest {
    #[serde(default)]
    pub jsonrpc: String,
    /// Present for requests, absent for notifications.
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

/// A JSON-RPC response — carries exactly one of `result` / `error`.
#[derive(Debug, Clone, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

/// A JSON-RPC error object.
#[derive(Debug, Clone, Serialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// Standard JSON-RPC error codes used by the dispatcher.
pub mod error_code {
    pub const INVALID_REQUEST: i64 = -32600;
    pub const METHOD_NOT_FOUND: i64 = -32601;
    pub const INVALID_PARAMS: i64 = -32602;
    pub const INTERNAL_ERROR: i64 = -32603;
}

impl JsonRpcResponse {
    fn ok(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        }
    }

    fn err(id: Value, code: i64, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(JsonRpcError {
                code,
                message: message.into(),
                data: None,
            }),
        }
    }
}

// ── Tools ──────────────────────────────────────────────────────────────────

/// A tool advertised to clients via `tools/list`.
#[derive(Debug, Clone, Serialize)]
pub struct Tool {
    pub name: String,
    pub description: String,
    /// JSON Schema for the tool's `arguments` object.
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

impl Tool {
    #[must_use]
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        input_schema: Value,
    ) -> Self {
        Self {
            name: name.into(),
            description: description.into(),
            input_schema,
        }
    }
}

/// A tool's textual result. MCP supports richer content types; text is all the
/// Doc-Hub tools need (answers, hit lists).
#[derive(Debug, Clone)]
pub struct ToolOutput {
    pub text: String,
}

impl ToolOutput {
    #[must_use]
    pub fn text(text: impl Into<String>) -> Self {
        Self { text: text.into() }
    }
}

/// Errors a tool handler can return. These become an `isError: true` tool
/// result (per MCP, tool failures are reported *in the result*, not as
/// JSON-RPC protocol errors), so the calling model can see and recover.
#[derive(Debug, Error)]
pub enum ToolError {
    #[error("invalid arguments: {0}")]
    InvalidArguments(String),
    #[error("tool execution failed: {0}")]
    Execution(String),
}

/// Executes one tool. Implemented by the wiring layer (e.g. a handler that runs
/// a workspace-scoped semantic search).
#[async_trait]
pub trait ToolHandler: Send + Sync {
    async fn call(&self, arguments: Value) -> Result<ToolOutput, ToolError>;
}

// ── Server ─────────────────────────────────────────────────────────────────

/// Identifies the server to clients (shown in `initialize`).
#[derive(Debug, Clone)]
pub struct ServerInfo {
    pub name: String,
    pub version: String,
}

/// The MCP server: a tool registry + a JSON-RPC dispatcher. Build it with
/// [`McpServer::new`] and [`McpServer::register`], then feed requests to
/// [`McpServer::handle`].
pub struct McpServer {
    info: ServerInfo,
    tools: Vec<Tool>,
    handlers: HashMap<String, Arc<dyn ToolHandler>>,
}

impl std::fmt::Debug for McpServer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("McpServer")
            .field("info", &self.info)
            .field(
                "tools",
                &self.tools.iter().map(|t| &t.name).collect::<Vec<_>>(),
            )
            .finish_non_exhaustive()
    }
}

impl McpServer {
    #[must_use]
    pub fn new(info: ServerInfo) -> Self {
        Self {
            info,
            tools: Vec::new(),
            handlers: HashMap::new(),
        }
    }

    /// Register a `tool` and the `handler` that executes it. Chainable.
    #[must_use]
    pub fn register(mut self, tool: Tool, handler: Arc<dyn ToolHandler>) -> Self {
        self.handlers.insert(tool.name.clone(), handler);
        self.tools.push(tool);
        self
    }

    /// Dispatch one JSON-RPC message. Returns `Some(response)` for requests and
    /// `None` for notifications (which carry no `id` and expect no reply).
    pub async fn handle(&self, req: JsonRpcRequest) -> Option<JsonRpcResponse> {
        // Notifications (no id) get no response — e.g. `notifications/initialized`.
        let id = req.id.clone()?;

        let resp = match req.method.as_str() {
            "initialize" => JsonRpcResponse::ok(id, self.initialize_result()),
            "ping" => JsonRpcResponse::ok(id, json!({})),
            "tools/list" => JsonRpcResponse::ok(id, json!({ "tools": self.tools })),
            "tools/call" => self.handle_tools_call(id, req.params).await,
            other => JsonRpcResponse::err(
                id,
                error_code::METHOD_NOT_FOUND,
                format!("method not found: {other}"),
            ),
        };
        Some(resp)
    }

    fn initialize_result(&self) -> Value {
        json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": self.info.name, "version": self.info.version },
        })
    }

    async fn handle_tools_call(&self, id: Value, params: Value) -> JsonRpcResponse {
        let name = match params.get("name").and_then(Value::as_str) {
            Some(n) => n.to_string(),
            None => {
                return JsonRpcResponse::err(
                    id,
                    error_code::INVALID_PARAMS,
                    "tools/call requires a string `name`",
                )
            }
        };
        // `arguments` is optional; default to an empty object.
        let arguments = params
            .get("arguments")
            .cloned()
            .unwrap_or_else(|| json!({}));

        let Some(handler) = self.handlers.get(&name) else {
            return JsonRpcResponse::err(
                id,
                error_code::INVALID_PARAMS,
                format!("unknown tool: {name}"),
            );
        };

        // Per MCP, a tool's own failure is reported as an `isError` result, not
        // a protocol error, so the model can read the message and adapt.
        match handler.call(arguments).await {
            Ok(out) => JsonRpcResponse::ok(id, tool_content(&out.text, false)),
            Err(e) => JsonRpcResponse::ok(id, tool_content(&e.to_string(), true)),
        }
    }
}

/// Build a `tools/call` result payload: one text content block + `isError`.
fn tool_content(text: &str, is_error: bool) -> Value {
    json!({
        "content": [ { "type": "text", "text": text } ],
        "isError": is_error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(id: Option<Value>, method: &str, params: Value) -> JsonRpcRequest {
        JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id,
            method: method.into(),
            params,
        }
    }

    struct EchoHandler;
    #[async_trait]
    impl ToolHandler for EchoHandler {
        async fn call(&self, arguments: Value) -> Result<ToolOutput, ToolError> {
            let q = arguments
                .get("q")
                .and_then(Value::as_str)
                .ok_or_else(|| ToolError::InvalidArguments("missing q".into()))?;
            if q == "boom" {
                return Err(ToolError::Execution("kaboom".into()));
            }
            Ok(ToolOutput::text(format!("echo: {q}")))
        }
    }

    fn server() -> McpServer {
        McpServer::new(ServerInfo {
            name: "dochub".into(),
            version: "0.0.1".into(),
        })
        .register(
            Tool::new(
                "search",
                "Search documents",
                json!({ "type": "object", "properties": { "q": { "type": "string" } }, "required": ["q"] }),
            ),
            Arc::new(EchoHandler),
        )
    }

    #[tokio::test]
    async fn initialize_reports_server_and_capabilities() {
        let r = server()
            .handle(req(Some(json!(1)), "initialize", json!({})))
            .await
            .unwrap();
        let result = r.result.unwrap();
        assert_eq!(result["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(result["serverInfo"]["name"], "dochub");
        assert!(result["capabilities"]["tools"].is_object());
        assert_eq!(r.id, json!(1));
    }

    #[tokio::test]
    async fn tools_list_returns_registered_tools_with_schema() {
        let r = server()
            .handle(req(Some(json!(2)), "tools/list", json!({})))
            .await
            .unwrap();
        let tools = r.result.unwrap();
        let arr = tools["tools"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["name"], "search");
        // Schema is surfaced under the MCP `inputSchema` key.
        assert_eq!(arr[0]["inputSchema"]["required"][0], "q");
    }

    #[tokio::test]
    async fn tools_call_dispatches_and_wraps_text() {
        let r = server()
            .handle(req(
                Some(json!(3)),
                "tools/call",
                json!({ "name": "search", "arguments": { "q": "budget" } }),
            ))
            .await
            .unwrap();
        let result = r.result.unwrap();
        assert_eq!(result["isError"], false);
        assert_eq!(result["content"][0]["type"], "text");
        assert_eq!(result["content"][0]["text"], "echo: budget");
    }

    #[tokio::test]
    async fn tool_execution_error_is_iserror_result_not_protocol_error() {
        let r = server()
            .handle(req(
                Some(json!(4)),
                "tools/call",
                json!({ "name": "search", "arguments": { "q": "boom" } }),
            ))
            .await
            .unwrap();
        assert!(
            r.error.is_none(),
            "should be a result, not a protocol error"
        );
        let result = r.result.unwrap();
        assert_eq!(result["isError"], true);
        assert!(result["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("kaboom"));
    }

    #[tokio::test]
    async fn unknown_tool_is_invalid_params() {
        let r = server()
            .handle(req(
                Some(json!(5)),
                "tools/call",
                json!({ "name": "nope", "arguments": {} }),
            ))
            .await
            .unwrap();
        assert_eq!(r.error.unwrap().code, error_code::INVALID_PARAMS);
    }

    #[tokio::test]
    async fn unknown_method_is_method_not_found() {
        let r = server()
            .handle(req(Some(json!(6)), "resources/list", json!({})))
            .await
            .unwrap();
        assert_eq!(r.error.unwrap().code, error_code::METHOD_NOT_FOUND);
    }

    #[tokio::test]
    async fn notification_gets_no_response() {
        // No id ⇒ notification (e.g. notifications/initialized) ⇒ no reply.
        let r = server()
            .handle(req(None, "notifications/initialized", json!({})))
            .await;
        assert!(r.is_none());
    }

    #[tokio::test]
    async fn ping_returns_empty_result() {
        let r = server()
            .handle(req(Some(json!(7)), "ping", json!({})))
            .await
            .unwrap();
        assert_eq!(r.result.unwrap(), json!({}));
    }
}
