import { useEffect, useState } from "react";

import { DEMO_MODE } from "../api/client.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { ComingSoon } from "../components/ComingSoon.tsx";
import { DemoBanner } from "../components/DemoBanner.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { HelpModal } from "../components/HelpModal.tsx";
import { Sidebar, type NavId } from "../components/Sidebar.tsx";
import { TopBar, type ViewMode } from "../components/TopBar.tsx";
import { Activity } from "./Activity.tsx";
import { Admin } from "./Admin.tsx";
import { Files } from "./Files.tsx";
import { Notes } from "./Notes.tsx";
import { Settings } from "./Settings.tsx";

export function Shell() {
  const { status } = useAuth();
  const username = status.kind === "authed" ? status.me.admin : "admin";
  const [nav, setNav] = useState<NavId>("home");
  const [view, setView] = useState<ViewMode>("grid");
  const [query, setQuery] = useState("");
  const [itemCount, setItemCount] = useState(0);
  const [uploadTick, setUploadTick] = useState(0);
  const [newFolderTick, setNewFolderTick] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  // `?` opens the help modal when the user isn't typing. Listen to the
  // bell's "View all activity →" deep-link too so a click in the dropdown
  // routes to the Activity tab.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if (typing) return;
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setHelpOpen(true);
      }
    }
    function onNav(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === "activity") setNav("activity");
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("cd:nav", onNav);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("cd:nav", onNav);
    };
  }, []);

  return (
    <div className="h-full w-full flex flex-col" style={{ background: "var(--paper)" }}>
      {DEMO_MODE && <DemoBanner />}
      <div className="flex" style={{ flex: 1, minHeight: 0 }}>
      <Sidebar
        current={nav}
        onSelect={setNav}
        itemCount={itemCount}
        onNewFolder={() => setNewFolderTick((t) => t + 1)}
        onUpload={() => setUploadTick((t) => t + 1)}
        username={username}
      />
      <div className="flex-1 flex flex-col" style={{ minWidth: 0 }}>
        {nav === "home" && (
          <div style={{ padding: "26px 40px 0" }}>
            <TopBar
              query={query}
              onQueryChange={setQuery}
              view={view}
              onViewChange={setView}
              onShowHelp={() => setHelpOpen(true)}
            />
          </div>
        )}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {nav === "home" && (
            <Files
              view={view}
              query={query}
              uploadRequested={uploadTick}
              onUploadHandled={() => {}}
              newFolderRequested={newFolderTick}
              onNewFolderHandled={() => {}}
              onItemCount={setItemCount}
            />
          )}
          {nav === "recent" && (
            <CenteredPane>
              <ComingSoon
                title="Recently opened files"
                description="See the last 20 files you opened — across every folder — at the top of your Drive."
                bullets={[
                  "Auto-tracks open events and snapshots them per user",
                  "Filterable by type and date",
                  "Persists across sessions",
                ]}
              />
            </CenteredPane>
          )}
          {nav === "starred" && (
            <CenteredPane>
              <ComingSoon
                title="Starred files and folders"
                description="Pin the things you keep coming back to. Stars work across folders and survive renames."
                bullets={[
                  "Star/unstar from the preview modal or context menu",
                  "Star a folder to pin the whole tree",
                  "Synced across sessions and devices once multi-user lands",
                ]}
              />
            </CenteredPane>
          )}
          {nav === "shared" && (
            <CenteredPane>
              <ComingSoon
                title="Shared with you"
                description="Files other members of your workspace share with you appear here — ranked by recent activity."
                bullets={[
                  "View files shared via direct invite or share-link",
                  "Filter by sender and permission level (view / comment / edit)",
                  "Multi-user is queued for v0.2",
                ]}
              />
            </CenteredPane>
          )}
          {nav === "trash" && (
            <CenteredPane>
              <EmptyState
                title="Trash is empty."
                subtitle="Files you delete will appear here for 30 days before being permanently removed."
              />
            </CenteredPane>
          )}
          {nav === "notes" && <Notes />}
          {nav === "activity" && <Activity />}
          {nav === "admin" && <Admin onNavigate={(t) => setNav(t)} />}
          {nav === "settings" && <Settings />}
        </main>
      </div>
      </div>

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

function CenteredPane({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        background: "var(--paper)",
        padding: "40px 40px 60px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </div>
  );
}
