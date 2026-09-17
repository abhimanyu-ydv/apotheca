import "./storage.js"; // must come first — the app reads window.storage on mount
import "./index.css";

import React from "react";
import ReactDOM from "react-dom/client";
import PharmacySystem from "./PharmacyManagementSystem.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PharmacySystem />
  </React.StrictMode>
);
