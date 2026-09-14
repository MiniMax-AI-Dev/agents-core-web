import { createRoot } from "react-dom/client";

import { App } from "./App";
import { ToastProvider } from "./components/Toast";
import { ThemeProvider } from "./lib/ThemeProvider";
import "./style.css";

const root = document.getElementById("root");

if (!root) throw new Error("Missing #root element.");

createRoot(root).render(
  <ThemeProvider>
    <ToastProvider>
      <App />
    </ToastProvider>
  </ThemeProvider>,
);
