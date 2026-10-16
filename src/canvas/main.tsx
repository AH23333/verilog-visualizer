import React from "react";
import ReactDOM from "react-dom/client";
import CanvasApp from "./CanvasApp";
import ErrorBoundary from "../components/ErrorBoundary";
import "../index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <CanvasApp />
    </ErrorBoundary>
  </React.StrictMode>,
);
