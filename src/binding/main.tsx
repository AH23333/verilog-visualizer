import React from "react";
import ReactDOM from "react-dom/client";
import BindingApp from "./BindingApp";
import ErrorBoundary from "../components/ErrorBoundary";
import "../index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BindingApp />
    </ErrorBoundary>
  </React.StrictMode>,
);
