/**
 * OwnerLogin.tsx
 *
 * Simple login page for the owner dashboard.
 *
 * • If the user is already authenticated they are immediately redirected to
 *   /owner (or a previously saved "from" location).
 * • Otherwise they can paste a JWT and press "Sign in".
 * • In dev, VITE_DEV_OWNER_TOKEN in .env is an alternative; a note is shown.
 */

import React, { useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useOwnerAuth } from "../contexts/OwnerAuth";

// Adapt these imports to whatever Button / TextField components exist in your
// project.  If they don't exist yet, the plain HTML fallbacks below are used.
let Button: React.ComponentType<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }
>;
let TextField: React.ComponentType<{
  label?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
  style?: React.CSSProperties;
}>;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Button = require("../components/Button").default;
} catch {
  Button = (props) => (
    <button
      {...props}
      style={{
        padding: "0.55rem 1.25rem",
        background: "var(--accent, #2563eb)",
        color: "#fff",
        border: "none",
        borderRadius: 6,
        fontSize: "0.875rem",
        fontWeight: 600,
        cursor: "pointer",
        ...props.style,
      }}
    />
  );
}

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  TextField = require("../components/TextField").default;
} catch {
  TextField = ({ label, value, onChange, placeholder, rows = 3, style }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      {label && (
        <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--ink, #1a1a2e)" }}>
          {label}
        </label>
      )}
      <textarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        style={{
          padding: "0.5rem 0.75rem",
          border: "1px solid var(--border, #d1d5db)",
          borderRadius: 6,
          fontSize: "0.8rem",
          fontFamily: "monospace",
          resize: "vertical",
          background: "var(--paper, #fff)",
          color: "var(--ink, #1a1a2e)",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function OwnerLogin() {
  const { isAuthenticated, setToken } = useOwnerAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Where to go after successful login
  const from =
    (location.state as { from?: { pathname: string } } | null)?.from
      ?.pathname ?? "/owner";

  // Already authenticated → redirect immediately
  if (isAuthenticated) {
    // Use a synchronous redirect-on-render pattern (avoids useEffect flash)
    navigate(from, { replace: true });
    return null;
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [jwt, setJwt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = jwt.trim();
    if (!trimmed) {
      setError("Please paste a JWT token first.");
      return;
    }
    setError(null);
    setToken(trimmed);
    navigate(from, { replace: true });
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--cream, #f8f7f4)",
        padding: "1rem",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "var(--paper, #fff)",
          borderRadius: 12,
          boxShadow: "0 2px 16px rgba(0,0,0,.08)",
          padding: "2rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
        }}
      >
        {/* Logo / title */}
        <div>
          <div
            style={{
              fontSize: "1.4rem",
              fontWeight: 700,
              color: "var(--ink, #1a1a2e)",
              letterSpacing: "-0.02em",
            }}
          >
            PropVault
          </div>
          <div
            style={{
              fontSize: "0.85rem",
              color: "var(--muted, #6b7280)",
              marginTop: 2,
            }}
          >
            Owner dashboard
          </div>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--border, #e5e7eb)" }} />

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
        >
          <TextField
            label="Owner JWT"
            value={jwt}
            onChange={(e) => setJwt(e.target.value)}
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
            rows={4}
          />

          {error && (
            <p
              style={{
                margin: 0,
                fontSize: "0.8rem",
                color: "var(--danger, #dc2626)",
              }}
            >
              {error}
            </p>
          )}

          <Button type="submit" style={{ alignSelf: "flex-end" }}>
            Sign in
          </Button>
        </form>

        {/* Dev hint */}
        {import.meta.env.DEV && (
          <p
            style={{
              margin: 0,
              fontSize: "0.75rem",
              color: "var(--muted, #6b7280)",
              background: "var(--cream, #f8f7f4)",
              borderRadius: 6,
              padding: "0.5rem 0.75rem",
            }}
          >
            <strong>Dev tip:</strong> You can also set{" "}
            <code>VITE_DEV_OWNER_TOKEN</code> in your <code>.env</code> file to
            skip this form. Use <code>node scripts/gen-owner-jwt.js</code> to
            generate a token.
          </p>
        )}
      </div>
    </div>
  );
}
