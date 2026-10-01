import { NavLink, Outlet } from "react-router-dom"

const tabs = [
  ["/chat", "Chat"],
  ["/records", "Records"],
  ["/envelopes", "Envelopes"],
  ["/gallery", "Gallery"],
  ["/settings", "Settings"],
] as const

export function AppShell() {
  return <div>
    <Outlet />
    <nav aria-label="Main navigation">
      {tabs.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
    </nav>
  </div>
}
