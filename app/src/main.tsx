import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "overlayscrollbars/overlayscrollbars.css";
import "./styles.css";
import "./skins/picker.css";
import "./skins/paper.css";
import "./skins/studio.css";
import "./skins/notebook.css";
import "./skins/mono.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
