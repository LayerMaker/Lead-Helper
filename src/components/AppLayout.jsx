import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useAppState } from "../state/AppState";

const navItems = [
  { to: "/", label: "Dash" },
  { to: "/map", label: "Map" },
  { to: "/map-v2", label: "Map V2" },
  { to: "/location", label: "+ Location" },
  { to: "/route", label: "Route" },
  { to: "/leads", label: "Leads" },
  { to: "/email", label: "Email" },
  { to: "/reports", label: "Report" },
  { to: "/settings", label: "Settings" },
];

function NotificationWatcher() {
  const { pendingActions, settings, getDealershipById, dispatch } = useAppState();

  useEffect(() => {
    if (!settings?.notificationsEnabled) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (window.Notification.permission !== "granted") return;

    const leadMinutes = Math.max(1, Number(settings.notificationLeadMinutes || 30));
    const now = Date.now();

    pendingActions.forEach((action) => {
      if (!action?.dueAt || action?.notifiedAt) return;
      const dueAt = new Date(action.dueAt).getTime();
      if (Number.isNaN(dueAt)) return;
      const deltaMinutes = (dueAt - now) / 60000;
      if (deltaMinutes < -10 || deltaMinutes > leadMinutes) return;

      const dealership = getDealershipById(action.dealershipId);
      const title = dealership?.name ? `${dealership.name}: ${action.title}` : action.title;
      const body = `${action.note || "Action due"} • ${action.dueText}`;
      const notification = new window.Notification(title, {
        body,
        tag: action.id,
      });
      notification.onclick = () => window.focus();

      dispatch({
        type: "mark-action-notified",
        actionId: action.id,
        notifiedAt: new Date().toISOString(),
      });
    });
  }, [dispatch, getDealershipById, pendingActions, settings?.notificationLeadMinutes, settings?.notificationsEnabled]);

  return null;
}

export function AppLayout({ statusLine, children }) {
  const { selectedCluster } = useAppState();

  return (
    <>
      <NotificationWatcher />
      <main className="app">
        <header className="topbar">
          <NavLink className="brand" to="/">
            <span className="mark">LH</span>
            <span>Lead Helper</span>
          </NavLink>
          <span className="status-line">{statusLine || `${selectedCluster.name} field workflow`}</span>
        </header>
        {children}
      </main>
      <nav className="bottom-nav" aria-label="App navigation">
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === "/"}>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
