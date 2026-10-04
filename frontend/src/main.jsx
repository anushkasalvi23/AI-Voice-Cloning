import React from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import App from "./App.jsx";
import "./styles.css";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!publishableKey) throw new Error("VITE_CLERK_PUBLISHABLE_KEY is not set. Copy frontend/.env.example to frontend/.env.");

createRoot(document.getElementById("root")).render(
  <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
    <App />
  </ClerkProvider>
);
