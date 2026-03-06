/**
 * OwnerDashboardLayout.tsx
 *
 * Shell layout for all protected /owner/* routes.
 *
 * Structure (mirrors property-owner-dashboard.html):
 *   ┌──────────┬──────────────────────────────┐
 *   │ sidebar  │  topbar                      │
 *   │          ├──────────────────────────────┤
 *   │          │  <Outlet />                  │
 *   └──────────┴──────────────────────────────┘
 *
 * Design tokens used:
 *   --ink, --paper, --cream, --accent, --gold,
 *   --muted, --border, --card
 */

import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useOwnerAuth } from "../contexts/OwnerAuth";

// ---------------------------------------------------------------------------
// Icons (inline SVG to avoid extra deps)
// ---------------------------------------------------------------------------

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );
}

function LogOutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function Sidebar({ onLogout }: { onLogout: () => void }) {
  const navItemBase: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    padding: "0.5rem 0.75rem",
    borderRadius: 7,
    fontSize: "0.85rem",
    fontWeight: 500,
    textDecoration: "none",
    color: "var(--muted, #6b7280)",
    transition: "background 0.15s, color 0.15s",
  };

  return (
    <aside
      style={{
        width: 220,
        minWidth: 220,
        background: "var(--paper, #fff)",
        borderRight: "1px solid var(--border, #e5e7eb)",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        position: "sticky",
        top: 0,
        overflowY: "auto",
        padding: "1.25rem 0.75rem",
        boxSizing: "border-box",
      }}
    >
      {/* Logo */}
      <div
        style={{
          fontSize: "1.15rem",
          fontWeight: 700,
          color: "var(--ink, #1a1a2e)",
          letterSpacing: "-0.02em",
          padding: "0 0.25rem 1rem",
          borderBottom: "1px solid var(--border, #e5e7eb)",
          marginBottom: "0.75rem",
        }}
      >
        PropVault{" "}
        <span
          style={{
            fontSize: "0.7rem",
            fontWeight: 600,
            color: "var(--accent, #2563eb)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Owner
        </span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        <NavLink
          to="/owner"
          end
          style={({ isActive }) => ({
            ...navItemBase,
            background: isActive ? "var(--cream, #f8f7f4)" : "transparent",
            color: isActive ? "var(--ink, #1a1a2e)" : "var(--muted, #6b7280)",
          })}
        >
          <HomeIcon />
          Dashboard
        </NavLink>

        <NavLink
          to="/owner"
          style={({ isActive }) => ({
            ...navItemBase,
            // Properties is the same home link — highlight when on a property sub-route
            background: !isActive && window.location.pathname.startsWith("/owner/properties")
              ? "var(--cream, #f8f7f4)"
              : "transparent",
            color: !isActive && window.location.pathname.startsWith("/owner/properties")
              ? "var(--ink, #1a1a2e)"
              : "var(--muted, #6b7280)",
            display: "none", // hidden for now; re-enable when a /owner/properties index exists
          })}
        >
          <BuildingIcon />
          Properties
        </NavLink>
      </nav>

      {/* User card */}
      <div
        style={{
          borderTop: "1px solid var(--border, #e5e7eb)",
          paddingTop: "0.75rem",
          marginTop: "0.75rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
        }}
      >
        <div>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--ink, #1a1a2e)" }}>
            Owner
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--muted, #6b7280)" }}>
            Dashboard
          </div>
        </div>
        <button
          onClick={onLogout}
          title="Sign out"
          style={{
            background: "none",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: 6,
            padding: "0.3rem 0.45rem",
            cursor: "pointer",
            color: "var(--muted, #6b7280)",
            display: "flex",
            alignItems: "center",
          }}
        >
          <LogOutIcon />
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------

function Topbar() {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <header
      style={{
        height: 56,
        borderBottom: "1px solid var(--border, #e5e7eb)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 1.5rem",
        background: "var(--paper, #fff)",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      {/* Page title slot — child pages can override this via document.title */}
      <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--ink, #1a1a2e)" }}>
        Owner Portal
      </span>
      <span style={{ fontSize: "0.75rem", color: "var(--muted, #6b7280)" }}>
        {today}
      </span>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export default function OwnerDashboardLayout() {
  const { logout } = useOwnerAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/owner/login", { replace: true });
  };

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "var(--cream, #f8f7f4)",
        fontFamily:
          "'Inter', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <Sidebar onLogout={handleLogout} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar />
        <main
          style={{
            flex: 1,
            padding: "1.75rem 1.5rem",
            overflowY: "auto",
          }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
