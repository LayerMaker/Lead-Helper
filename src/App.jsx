import { Navigate, Route, Routes } from "react-router-dom";
import { DashboardPage } from "./pages/DashboardPage";
import { EmailPage } from "./pages/EmailPage";
import { LeadsPage } from "./pages/LeadsPage";
import { MapPage } from "./pages/MapPage";
import { ReportPrintPage } from "./pages/ReportPrintPage";
import { ReportsPage } from "./pages/ReportsPage";
import { RoutePage } from "./pages/RoutePage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/map" element={<MapPage />} />
      <Route path="/route" element={<RoutePage />} />
      <Route path="/leads" element={<LeadsPage />} />
      <Route path="/email" element={<EmailPage />} />
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="/reports/print" element={<ReportPrintPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
