import React from "react";
import ReactDOM from "react-dom/client";
import CanvasApp from "./CanvasApp";
import ErrorBoundary from "../components/ErrorBoundary";
import "../index.css";
import { initLocale } from "../i18n";


initLocale();   // i18n：宿主 meta → navigator 回落（I18N_DESIGN §一）
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <CanvasApp />
    </ErrorBoundary>
  </React.StrictMode>,
);
