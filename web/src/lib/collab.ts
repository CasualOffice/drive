/**
 * collab — P2.3 client co-editing session (`web/`).
 *
 * Given a document id, this hook brokers a live collaboration room:
 *
 *   1. `GET /api/files/{id}/collab` → `{ room, ws_url, token }`. A `404`
 *      (collab disabled, no `DOCHUB_COLLAB_URL`, or the broker declined)
 *      resolves to `null` — the caller then falls back to single-user
 *      editing (P2.1) unchanged. Co-editing is additive, never required.
 *   2. Open a `Y.Doc` + `y-websocket` `WebsocketProvider` against
 *      `ws_url` (room name + short-TTL editor `token` in the query).
 *      The `collab` server (Hocuspocus / Yjs) owns the live document and
 *      relays CRDT updates; Doc-Hub owns the encrypted canonical bytes.
 *   3. Publish local identity over Yjs *awareness* and expose the peer
 *      list + connection status so the editor chrome can render a live
 *      presence indicator.
 *
 * Teardown is clean: the provider + doc are destroyed on unmount / id
 * change / disable, and awareness is cleared so peers see us leave.
 *
 * What lives here vs. the editors:
 *   - This hook owns the transport (doc, provider, awareness, status).
 *   - `CodeTextEditor` binds a `Y.Text` (`getText(TEXT_KEY)`) to its
 *     buffer for real end-to-end co-editing of the plain-text kinds.
 *   - The SDK iframe editors (`.docx` / `.xlsx`) can't reach a Yjs doc
 *     across the iframe boundary today (the `CasualEditorIframe` /
 *     `SheetEmbed` protocols expose no collab channel — collab lives on
 *     the SDKs' *direct* mounts via `useCollab` / `attachCollab`). They
 *     consume this session for the presence indicator only and keep the
 *     single-user save→version path; deep CRDT binding is a follow-up
 *     gated on the iframe protocol carrying the SDK's collab API.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

import { getCollabRoom } from "../api/client.ts";

/** Shared-doc key the plain-text editor binds its buffer to. Both peers
 *  (and the server-side seed, when it lands) must agree on this name. */
export const TEXT_KEY = "content";

type Awareness = WebsocketProvider["awareness"];

export type CollabStatus =
  /** No room grant — collab disabled / 404. Caller edits single-user. */
  | "disabled"
  /** Grant resolved; the socket is opening or reconnecting. */
  | "connecting"
  /** Socket open + first sync exchanged. Live co-editing is on. */
  | "connected"
  /** Was connected, dropped. The editor keeps working locally. */
  | "disconnected";

/** How a peer is engaged with the document — drives the presence dot. */
export type CollabActivity = "editing" | "viewing";

/** Local identity published over awareness so peers can render us. */
export interface CollabIdentity {
  /** Stable-ish user id (falls back to a per-session random id). */
  userId: string;
  name: string;
  /** Avatar tint (hex/hsl string). */
  tint: string;
  activity: CollabActivity;
}

/** A peer derived from an awareness state entry. */
export interface CollabPeer {
  /** y-websocket awareness clientID (uint32). */
  clientId: number;
  userId: string;
  name: string;
  tint: string;
  activity: CollabActivity;
  /** True for the local user's own awareness entry. */
  self: boolean;
}

export interface CollabSession {
  status: CollabStatus;
  /** True once a room grant resolved and a provider is live/connecting.
   *  `false` ⇒ single-user fallback; editors must not assume a doc. */
  enabled: boolean;
  /** Peers in the room, including self (see `CollabPeer.self`). */
  peers: CollabPeer[];
  /** The shared document — `null` while disabled/fallback. */
  doc: Y.Doc | null;
  /** The transport — `null` while disabled/fallback. */
  provider: WebsocketProvider | null;
  awareness: Awareness | null;
}

const DISABLED: CollabSession = {
  status: "disabled",
  enabled: false,
  peers: [],
  doc: null,
  provider: null,
  awareness: null,
};

interface UseCollabOptions {
  /** Gate the connection — only open a room when the surface is a live
   *  editor (not a viewer / non-editable kind). Defaults to `true`. */
  enabled?: boolean;
}

function peersFromAwareness(awareness: Awareness): CollabPeer[] {
  const selfId = awareness.clientID;
  const peers: CollabPeer[] = [];
  awareness.getStates().forEach((state, clientId) => {
    const user = (state as { user?: Partial<CollabIdentity> }).user;
    if (!user) return;
    peers.push({
      clientId,
      userId: user.userId ?? String(clientId),
      name: user.name ?? "Someone",
      tint: user.tint ?? "#64748b",
      activity: user.activity === "viewing" ? "viewing" : "editing",
      self: clientId === selfId,
    });
  });
  return peers;
}

/**
 * Open (or decline) a collab room for `fileId` and keep it live for the
 * component's lifetime. Returns a `CollabSession` that is always safe to
 * read: while a room is being brokered — or when collab is disabled — it
 * reports `disabled`/`connecting` with a `null` doc, and the caller runs
 * single-user.
 *
 * `identity` may change (e.g. `activity` flipping editing↔viewing)
 * without tearing down the socket — only the fileId / enabled gate does.
 */
export function useCollabSession(
  fileId: string,
  identity: CollabIdentity,
  options: UseCollabOptions = {},
): CollabSession {
  const enabled = options.enabled ?? true;

  const [session, setSession] = useState<CollabSession>(DISABLED);

  // Latch the latest identity so the connect effect doesn't re-run when
  // the caller passes a fresh object each render.
  const identityRef = useRef(identity);
  identityRef.current = identity;

  useEffect(() => {
    if (!enabled || !fileId) {
      setSession(DISABLED);
      return;
    }

    let cancelled = false;
    let provider: WebsocketProvider | null = null;
    let doc: Y.Doc | null = null;

    (async () => {
      let room;
      try {
        room = await getCollabRoom(fileId);
      } catch {
        // Broker error ⇒ fall back to single-user, quietly.
        room = null;
      }
      if (cancelled) return;
      if (!room) {
        setSession(DISABLED);
        return;
      }

      doc = new Y.Doc();
      provider = new WebsocketProvider(room.ws_url, room.room, doc, {
        connect: true,
        params: { token: room.token },
      });

      const awareness = provider.awareness;
      const id = identityRef.current;
      awareness.setLocalStateField("user", {
        userId: id.userId,
        name: id.name,
        tint: id.tint,
        activity: id.activity,
      });

      const publish = () => {
        if (cancelled || !provider) return;
        setSession({
          status: provider.wsconnected
            ? "connected"
            : provider.wsconnecting
              ? "connecting"
              : "disconnected",
          enabled: true,
          peers: peersFromAwareness(awareness),
          doc,
          provider,
          awareness,
        });
      };

      provider.on("status", publish);
      provider.on("sync", publish);
      provider.on("connection-close", publish);
      provider.on("connection-error", publish);
      awareness.on("change", publish);

      publish();
    })();

    return () => {
      cancelled = true;
      if (provider) {
        // Clear our awareness entry so peers see us leave immediately,
        // then tear down the socket + doc.
        try {
          provider.awareness.setLocalState(null);
        } catch {
          /* provider already gone */
        }
        provider.destroy();
      }
      if (doc) doc.destroy();
      setSession(DISABLED);
    };
  }, [fileId, enabled]);

  // Push identity changes (name / tint / activity) onto the existing
  // awareness entry without reconnecting.
  useEffect(() => {
    const awareness = session.awareness;
    if (!awareness) return;
    awareness.setLocalStateField("user", {
      userId: identity.userId,
      name: identity.name,
      tint: identity.tint,
      activity: identity.activity,
    });
  }, [session.awareness, identity.userId, identity.name, identity.tint, identity.activity]);

  return useMemo(() => session, [session]);
}

/** Peers other than the local user — what the presence stack renders. */
export function otherPeers(session: CollabSession): CollabPeer[] {
  return session.peers.filter((p) => !p.self);
}

/** Deterministic avatar tint from a stable seed (user id / name), so the
 *  same user reads the same colour across sessions without a server hint.
 *  Mirrors the presence layer's tinted-monogram language. */
export function tintFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 62% 52%)`;
}
