# AI, agent, and MCP — operator guide

How to configure the optional AI layer, what each surface does, and how a
headless agent (Claude, an IDE assistant) connects over MCP. Everything here is
**opt-in**: with no provider configured, Doc-Hub stays fully functional — search
and a self-hosted extractive answerer work offline, and the agentic surfaces
report themselves unavailable rather than degrading.

See also [`ARCHITECTURE.md`](./ARCHITECTURE.md) §"AI layer" and §"Token model".

## Configuring a provider

The AI layer is provider-agnostic. Pick one with `DOCHUB_AI_PROVIDER`; unset ⇒
offline mode (extractive answers, no agent).

| Env var | Purpose | Default |
|---|---|---|
| `DOCHUB_AI_PROVIDER` | `anthropic` \| `openai` \| `local` (aliases: `claude`, `chatgpt`, `gpt`, `ollama`) | unset ⇒ offline |
| `DOCHUB_AI_API_KEY` | provider key; falls back to `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | — (optional for a keyless local server) |
| `DOCHUB_AI_MODEL` | model id | `claude-sonnet-5` (anthropic) / `gpt-4o-mini` (openai) |
| `DOCHUB_AI_BASE_URL` | override the API base | `https://api.anthropic.com` / `https://api.openai.com/v1` |

`anthropic` speaks the Messages API (`/v1/messages`); `openai` speaks Chat
Completions (`/chat/completions`) — which is also what local servers (Ollama, LM
Studio, vLLM) expose. So a self-hosted model is just the `openai` wire format
pointed at localhost.

**Claude (hosted):**
```
DOCHUB_AI_PROVIDER=anthropic
DOCHUB_AI_API_KEY=sk-ant-…
```

**ChatGPT (hosted):**
```
DOCHUB_AI_PROVIDER=openai
DOCHUB_AI_API_KEY=sk-…
```

**Local model (air-gapped), e.g. Ollama:**
```
DOCHUB_AI_PROVIDER=local
DOCHUB_AI_BASE_URL=http://localhost:11434/v1
DOCHUB_AI_MODEL=llama3.1
# no key needed for a keyless local server
```

The provider is resolved once at first use and cached for the process. Keys
never appear in logs, errors, or responses.

## The surfaces

All are session-authed, workspace-scoped, and permission-filtered: a call only
ever reaches documents the calling user can view. Retrieval is identical across
them (the same embedder + cosine top-k the `embed_file` job populated).

| Endpoint | What it does | Needs a provider? |
|---|---|---|
| `GET /api/search/semantic?q=` | Meaning-based passage retrieval; ranked snippets. | No |
| `POST /api/search/ask` | Single-shot RAG: retrieve once, compose a cited answer. | No — offline uses the extractive answerer |
| `POST /api/agent/ask` | **Agentic** research: the model runs its own multi-step searches, refines, then answers with citations + a search trace. | Yes — reports `available:false` otherwise |

- **`ask`** is instant and always works: with a provider it writes an abstractive
  answer; without one it falls back to the offline extractive answerer (it
  stitches the most relevant sentences and cites them — invents nothing).
- **`agent/ask`** is deliberate and multi-step. The model decides what to search
  and when to answer (a bounded ReAct loop), so it needs a real model to reason.
  With no provider it returns `{ "available": false, "answer": "", … }`; the SPA
  shows a "configure a provider" hint rather than a degraded answer.

In the SPA these appear on the search results: an instant **Answer** panel and a
**Research** panel (with a "Research this" trigger and the agent's search trace).

## MCP — connecting a headless agent

`POST /api/mcp` speaks JSON-RPC 2.0 (Model Context Protocol). It exposes three
tools, each bound to the caller's permissions:

| Tool | Purpose |
|---|---|
| `semantic_search` | ranked passages related by meaning |
| `ask` | single-shot RAG answer with sources |
| `research` | agentic multi-step research (needs a provider) |

### Authentication

MCP accepts **either** a browser session cookie **or** a personal access token
(PAT) via `Authorization: Bearer <token>` — so a headless agent authenticates
with a PAT while the SPA uses its cookie.

1. In the SPA, open **Settings → Tokens & sessions**, create a token, and copy
   it. The plaintext (`dh_pat_…`) is shown **once**; only its SHA-256 hash is
   stored.
2. Point your MCP client at `https://<app-origin>/api/mcp` with header
   `Authorization: Bearer dh_pat_…`.

```bash
curl -sX POST https://drive.example.com/api/mcp \
  -H 'Authorization: Bearer dh_pat_…' \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"research","arguments":{"q":"what is our refund policy?"}}}'
```

`initialize` and `tools/list` are the usual handshake. Notifications (no `id`)
return `204`.

## Personal access tokens

PATs are managed session-only (a token can't mint more tokens):

- `POST /api/tokens` `{ "name": "laptop CLI", "expires_in_days": 90 }` → returns
  the plaintext **once**.
- `GET /api/tokens` → metadata only (never the secret): name, created/last-used,
  expiry, and `active` (not revoked, not expired).
- `DELETE /api/tokens/{id}` → revoke (a tombstone — the row stays for audit).

Every issue and revoke is written to the append-only, hash-chained audit log
(`token.created` / `token.revoked`) and shown on the Activity feed.

## Rate limits

The AI surfaces fan out to retrieval + an LLM on every call (the agent several
times), so they share **one per-user budget**: ~20 requests burst, refilling
~1 every 5s (≈12/min sustained). Over budget → `429 Too Many Requests` with a
`Retry-After` header and `{ "retry_after_seconds": N }`. The MCP handshake
(`initialize`, `tools/list`) is never throttled — only `tools/call`.

Limits are in-memory per instance; a Redis backend for clustered deployments is
a follow-up (same as the upload limiter).

## Offline / air-gapped behaviour

With no `DOCHUB_AI_PROVIDER`:

- `semantic_search` and `ask` work — `ask` uses the offline extractive answerer.
- `agent/ask` and the MCP `research` tool report unavailable.
- No network calls leave the box; every test in the suite runs in this mode, so
  the default is deterministic and self-hostable.
