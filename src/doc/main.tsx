import React from "react";
import ReactDOM from "react-dom/client";
import DocApp from "./DocApp";
import ErrorBoundary from "../components/ErrorBoundary";
import "../index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <DocApp />
    </ErrorBoundary>
  </React.StrictMode>,
);
