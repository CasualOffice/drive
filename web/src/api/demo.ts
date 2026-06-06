// Demo-mode backend shim — no server, browser-storage backed.
//
// Compiled in when VITE_DEMO_MODE=1 (GitHub Pages build at drive.schnsrw.live).
// Metadata persists across reloads via localStorage under `cd-demo-state-v1`.
// Uploaded file blobs live in a module-scope Map (not persisted — too large
// for localStorage). Pipeline issue #12 upgrades blob persistence to IndexedDB.
//
// Sign-in accepts any non-empty username + password — there is no security
// boundary in demo mode; we just need the flow to feel real. The pre-filled
// `demo` / `demo` credentials shown on the SignIn page are just defaults.

import type { About, FileDto, FolderDto, FolderDetail, ListResp, Me } from "./client.ts";

interface DemoShare {
  id: string;
  token: string;
  url: string;
  permissions: "view";
  has_password: boolean;
  password?: string;
  expires_at: string | null;
  created_at: string;
  last_accessed_at: string | null;
  access_count: number;
  file_id: string;
}

interface DemoState {
  signedIn: boolean;
  folders: FolderDto[];
  files: FileDto[];
  shares: DemoShare[];
  nextId: number;
  username?: string;
}

const STATE_KEY = "cd-demo-state-v1";
const blobs: Map<string, Blob> = new Map();

const state: DemoState = loadState();
persist();

function loadState(): DemoState {
  // localStorage may throw in private-mode Safari; never let it break boot.
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STATE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DemoState>;
      if (Array.isArray(parsed.folders) && Array.isArray(parsed.files)) {
        return {
          signedIn: parsed.signedIn ?? false,
          folders: parsed.folders,
          files: parsed.files,
          shares: Array.isArray(parsed.shares) ? parsed.shares : [],
          nextId: typeof parsed.nextId === "number" ? parsed.nextId : 1000,
          username: parsed.username,
        };
      }
    }
  } catch {
    // Fall through to seed.
  }
  return {
    signedIn: false,
    folders: seedFolders(),
    files: seedFiles(),
    shares: [],
    nextId: 1000,
  };
}

function persist(): void {
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Quota exhausted / private mode — silently degrade to ephemeral.
  }
}

function nextId(prefix: string): string {
  state.nextId += 1;
  return `${prefix}_${state.nextId.toString(36)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function seedFolders(): FolderDto[] {
  const base = "2026-05-22T10:00:00Z";
  return [
    { id: "fld_projects", parent_id: null, name: "Projects", created_at: base, modified_at: base },
    { id: "fld_designs", parent_id: null, name: "Design references", created_at: base, modified_at: base },
    { id: "fld_personal", parent_id: null, name: "Personal", created_at: base, modified_at: base },
  ];
}

function seedFiles(): FileDto[] {
  const t = (d: string) => `2026-${d}T15:30:00Z`;
  return [
    {
      id: "f_quarter",
      parent_id: null,
      name: "Q2 planning.xlsx",
      size: 28_400,
      content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      version: 3,
      created_at: t("05-10"),
      modified_at: t("06-04"),
    },
    {
      id: "f_brief",
      parent_id: null,
      name: "Product brief.docx",
      size: 41_200,
      content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      version: 5,
      created_at: t("05-12"),
      modified_at: t("06-03"),
    },
    {
      id: "f_arch",
      parent_id: null,
      name: "Architecture.pdf",
      size: 1_184_000,
      content_type: "application/pdf",
      version: 1,
      created_at: t("05-15"),
      modified_at: t("05-29"),
    },
    {
      id: "f_logo",
      parent_id: null,
      name: "Logo mark.svg",
      size: 4_300,
      content_type: "image/svg+xml",
      version: 1,
      created_at: t("05-18"),
      modified_at: t("05-18"),
    },
    {
      id: "f_demo",
      parent_id: null,
      name: "Demo walkthrough.mp4",
      size: 18_400_000,
      content_type: "video/mp4",
      version: 1,
      created_at: t("05-20"),
      modified_at: t("05-20"),
    },
    {
      id: "f_readme",
      parent_id: null,
      name: "README.md",
      size: 2_100,
      content_type: "text/markdown",
      version: 2,
      created_at: t("05-22"),
      modified_at: t("06-01"),
    },
  ];
}

function listChildren(parentId: string | null): ListResp {
  return {
    folders: state.folders.filter((f) => f.parent_id === parentId),
    files: state.files.filter((f) => f.parent_id === parentId),
  };
}

export async function demoRequest<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  // Light latency so the UI's loading/transition states are visible — feels
  // more like a real product, not a static fixture.
  await new Promise((r) => setTimeout(r, 90 + Math.floor(Math.random() * 60)));

  const method = (init.method ?? "GET").toUpperCase();
  const url = new URL(path, "http://demo.local");
  const p = url.pathname;

  // ─── Setup ───────────────────────────────────────────────────────────
  if (p === "/api/setup/status" && method === "GET") {
    // The demo seeds a workspace owner, so the wizard never fires.
    return { needs_setup: false } as unknown as T;
  }
  if (p === "/api/setup/admin" && method === "POST") {
    throw makeError(409, "setup already complete");
  }

  // ─── Auth ────────────────────────────────────────────────────────────
  if (p === "/api/auth/sign-in" && method === "POST") {
    const body = init.json as { username?: string; password?: string };
    state.signedIn = true;
    state.username = body?.username?.trim() || "demo";
    persist();
    return { csrf_token: "demo-csrf" } as unknown as T;
  }
  if (p === "/api/auth/change-password" && method === "POST") {
    const body = init.json as { old_password: string; new_password: string };
    if (!body?.new_password || body.new_password.length < 12) {
      throw makeError(422, "new password must be at least 12 characters");
    }
    if (body.new_password === body.old_password) {
      throw makeError(422, "new password must differ from the old one");
    }
    return undefined as T;
  }
  if (p === "/api/about" && method === "GET") {
    if (!state.signedIn) throw makeError(401, "not signed in");
    return {
      version: "0.0.1 (demo)",
      git_sha: "demo",
      built_at: new Date().toISOString(),
      license: "Apache-2.0",
      repository: "https://github.com/schnsrw/drive",
      storage_backend: "Browser (localStorage)",
      db_backend: "Browser (localStorage)",
    } satisfies About as unknown as T;
  }
  if (p === "/api/auth/sign-out" && method === "POST") {
    state.signedIn = false;
    persist();
    return undefined as T;
  }
  if (p === "/api/me" && method === "GET") {
    if (!state.signedIn) throw makeError(401, "not signed in");
    return {
      admin: state.username ?? "demo",
      backend: "Browser (localStorage)",
      user_id: "demo-user",
      is_admin: true,
    } satisfies Me as unknown as T;
  }

  // ─── Folders ─────────────────────────────────────────────────────────
  if (p === "/api/folders/root/children" && method === "GET") {
    return listChildren(null) as unknown as T;
  }
  const folderMatch = p.match(/^\/api\/folders\/([^/]+)$/);
  if (folderMatch) {
    const fid = decodeURIComponent(folderMatch[1]);
    const idx = state.folders.findIndex((f) => f.id === fid);
    if (idx === -1) throw makeError(404, "folder not found");
    if (method === "GET") {
      return { folder: state.folders[idx], children: listChildren(fid) } satisfies FolderDetail as unknown as T;
    }
    if (method === "PATCH") {
      const body = init.json as { name?: string; parent_id?: string | null };
      const updated: FolderDto = {
        ...state.folders[idx],
        name: body.name ?? state.folders[idx].name,
        parent_id: body.parent_id ?? state.folders[idx].parent_id,
        modified_at: nowIso(),
      };
      state.folders[idx] = updated;
      persist();
      return updated as unknown as T;
    }
  }
  if (p === "/api/folders" && method === "POST") {
    const body = init.json as { name: string; parent_id: string | null };
    const f: FolderDto = {
      id: nextId("fld"),
      parent_id: body.parent_id ?? null,
      name: body.name,
      created_at: nowIso(),
      modified_at: nowIso(),
    };
    state.folders.push(f);
    persist();
    return f as unknown as T;
  }

  // ─── Files ───────────────────────────────────────────────────────────
  if (p === "/api/files" && method === "POST") {
    const fd = init.body as FormData;
    const file = fd.get("file") as File;
    const parentId = (fd.get("parent_id") as string | null) ?? null;
    const fileDto: FileDto = {
      id: nextId("f"),
      parent_id: parentId,
      name: file.name,
      size: file.size,
      content_type: file.type || null,
      version: 1,
      created_at: nowIso(),
      modified_at: nowIso(),
    };
    blobs.set(fileDto.id, file);
    state.files.push(fileDto);
    persist();
    return fileDto as unknown as T;
  }
  const fileMatch = p.match(/^\/api\/files\/([^/]+)(\/(trash|download))?$/);
  if (fileMatch) {
    const fid = decodeURIComponent(fileMatch[1]);
    const sub = fileMatch[3];
    const idx = state.files.findIndex((f) => f.id === fid);
    if (idx === -1) throw makeError(404, "file not found");
    if (method === "PATCH" && !sub) {
      const body = init.json as { name?: string; parent_id?: string | null };
      const next: FileDto = {
        ...state.files[idx],
        name: body.name ?? state.files[idx].name,
        parent_id: body.parent_id ?? state.files[idx].parent_id,
        modified_at: nowIso(),
        version: state.files[idx].version + 1,
      };
      state.files[idx] = next;
      persist();
      return next as unknown as T;
    }
    if (method === "POST" && sub === "trash") {
      state.files.splice(idx, 1);
      blobs.delete(fid);
      persist();
      return undefined as T;
    }
  }

  // ─── Sharing ─────────────────────────────────────────────────────────
  const shareCreateMatch = p.match(/^\/api\/files\/([^/]+)\/share$/);
  if (shareCreateMatch && method === "POST") {
    if (!state.signedIn) throw makeError(401, "not signed in");
    const fid = decodeURIComponent(shareCreateMatch[1]);
    const file = state.files.find((f) => f.id === fid);
    if (!file) throw makeError(404, "file not found");
    const body = init.json as {
      permissions?: string;
      password?: string | null;
      expires_in_seconds?: number | null;
    };
    if (body.permissions && body.permissions !== "view") {
      throw makeError(400, "only 'view' permissions ship in v0");
    }
    const token = randomToken();
    const created_at = nowIso();
    const expires_at =
      body.expires_in_seconds && body.expires_in_seconds > 0
        ? new Date(Date.now() + body.expires_in_seconds * 1000).toISOString()
        : null;
    const share: DemoShare = {
      id: nextId("shl"),
      token,
      url: `${window.location.origin}/s/${token}`,
      permissions: "view",
      has_password: !!(body.password && body.password.trim()),
      password: body.password?.trim() || undefined,
      expires_at,
      created_at,
      last_accessed_at: null,
      access_count: 0,
      file_id: fid,
    };
    state.shares.unshift(share);
    persist();
    const { password: _pwd, file_id: _fid, ...dto } = share;
    void _pwd;
    void _fid;
    return dto as unknown as T;
  }
  const shareListMatch = p.match(/^\/api\/files\/([^/]+)\/shares$/);
  if (shareListMatch && method === "GET") {
    if (!state.signedIn) throw makeError(401, "not signed in");
    const fid = decodeURIComponent(shareListMatch[1]);
    const shares = state.shares
      .filter((s) => s.file_id === fid)
      .map(({ password: _p, file_id: _f, ...rest }) => {
        void _p;
        void _f;
        return rest;
      });
    return { shares } as unknown as T;
  }
  const shareRevokeMatch = p.match(/^\/api\/shares\/([^/]+)$/);
  if (shareRevokeMatch && method === "DELETE") {
    if (!state.signedIn) throw makeError(401, "not signed in");
    const sid = decodeURIComponent(shareRevokeMatch[1]);
    const before = state.shares.length;
    state.shares = state.shares.filter((s) => s.id !== sid);
    if (state.shares.length === before) throw makeError(404, "not found");
    persist();
    return undefined as T;
  }
  const shareResolveMatch = p.match(/^\/api\/share\/([^/]+)$/);
  if (shareResolveMatch && method === "POST") {
    const token = decodeURIComponent(shareResolveMatch[1]);
    const share = state.shares.find((s) => s.token === token);
    if (!share) throw makeError(404, "not found");
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      throw makeError(410, "expired");
    }
    if (share.has_password) {
      const body = init.json as { password?: string | null };
      const candidate = body?.password ?? "";
      if (!candidate || candidate !== share.password) {
        throw makeError(401, "password required");
      }
    }
    const file = state.files.find((f) => f.id === share.file_id);
    if (!file) throw makeError(404, "file gone");
    share.access_count += 1;
    share.last_accessed_at = nowIso();
    persist();
    return {
      file: {
        name: file.name,
        size: file.size,
        content_type: file.content_type,
        modified_at: file.modified_at,
      },
      download_url: `/api/share/${token}/download`,
      permissions: share.permissions,
    } as unknown as T;
  }

  throw makeError(501, `demo: route not implemented (${method} ${p})`);
}

function randomToken(): string {
  // 16 bytes of randomness → URL-safe base64 of length 22 (no padding).
  // Uses crypto.getRandomValues so the demo at least *looks* legit; we
  // never check this token against a server.
  const bytes = new Uint8Array(16);
  (crypto as Crypto).getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function demoDownloadUrl(fileId: string): string {
  const file = state.files.find((f) => f.id === fileId);
  const blob = blobs.get(fileId);
  if (blob) return URL.createObjectURL(blob);
  // Seeded files have no blob (and uploads don't survive a reload) —
  // synthesize a tiny placeholder so the browser actually downloads
  // something the user can open.
  const placeholder = new Blob(
    [`Casual Drive demo · ${file?.name ?? fileId}\n\nThis is placeholder content. The live build serves real bytes.\n`],
    { type: "text/plain" },
  );
  return URL.createObjectURL(placeholder);
}

/** Share-link download in demo mode — synthesize a placeholder for the
 * underlying file. Used by Recipient when window.location.assign'd. */
export function demoShareDownload(token: string): string | null {
  const share = state.shares.find((s) => s.token === token);
  if (!share) return null;
  return demoDownloadUrl(share.file_id);
}

/** Hard-reset the demo. Wipes everything in localStorage and reloads.
 * Exposed on window for ad-hoc debugging (`__cdResetDemo()` in DevTools). */
export function resetDemo(): void {
  try {
    window.localStorage.removeItem(STATE_KEY);
  } catch {
    /* ignored */
  }
  window.location.reload();
}

if (typeof window !== "undefined") {
  (window as unknown as { __cdResetDemo?: () => void }).__cdResetDemo = resetDemo;
}

function makeError(status: number, message: string) {
  const err = new Error(message) as Error & { status: number; body: unknown };
  err.status = status;
  err.body = { error: message };
  return err;
}
