import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { worker } from "./mocks/browser";

async function bootstrap() {
  if (import.meta.env.DEV && import.meta.env.VITE_MSW_ENABLED === "true") {
    await worker.start({ onUnhandledRequest: "bypass" });
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
bootstrap();
