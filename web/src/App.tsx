import { AuthProvider, useAuth } from "./auth/AuthContext.tsx";
import { SignIn } from "./pages/SignIn.tsx";
import { Shell } from "./pages/Shell.tsx";

function Router() {
  const { status } = useAuth();
  if (status.kind === "loading") {
    return (
      <div
        className="h-full w-full flex items-center justify-center"
        style={{ background: "var(--bg-canvas)" }}
      />
    );
  }
  return status.kind === "authed" ? <Shell /> : <SignIn />;
}

export function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
