import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/inter"; // variable — covers 450 body through 700 heavy display
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./styles/tokens.css";
import "./styles/dialog.css";
import "./styles/notes.css";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
