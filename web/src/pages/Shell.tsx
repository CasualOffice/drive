import { useState } from "react";

import { Sidebar, type NavId } from "../components/Sidebar.tsx";
import { TopBar } from "../components/TopBar.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { Files } from "./Files.tsx";

export function Shell() {
  const [nav, setNav] = useState<NavId>("home");

  return (
    <div className="h-full w-full flex" style={{ background: "var(--bg-canvas)" }}>
      <Sidebar current={nav} onSelect={setNav} />
      <div className="flex-1 flex flex-col" style={{ minWidth: 0 }}>
        <TopBar />
        <main style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {nav === "home" && <Files />}
          {nav === "trash" && (
            <div style={{ paddingTop: "var(--space-12)", flex: 1 }}>
              <EmptyState
                title="Trash is empty."
                subtitle="Files you delete will appear here."
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
