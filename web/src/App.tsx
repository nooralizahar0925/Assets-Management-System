import { BrowserRouter as Router, Routes, Route } from "react-router";
import { AuthProvider } from "./context/AuthContext";
import RequireAuth from "./components/auth/RequireAuth";
import AppLayout from "./layout/AppLayout";
import { ScrollToTop } from "./components/common/ScrollToTop";

import SignIn from "./pages/AuthPages/SignIn";
import NotFound from "./pages/OtherPage/NotFound";
import Dashboard from "./pages/Dashboard/Home";
import AssetList from "./pages/Assets/AssetList";
import AssetDetail from "./pages/Assets/AssetDetail";
import TagRedirect from "./pages/Assets/TagRedirect";
import AssetForm from "./pages/Assets/AssetForm";
import ImportWizard from "./pages/Import/ImportWizard";
import MaintenanceList from "./pages/Maintenance/MaintenanceList";
import WhatsNew from "./pages/WhatsNew";
import StocktakeList from "./pages/Stocktake/StocktakeList";
import StocktakeSession from "./pages/Stocktake/StocktakeSession";
import ReportGallery from "./pages/Reports/ReportGallery";
import ReportViewer from "./pages/Reports/ReportViewer";
import EmailSettings from "./pages/Settings/EmailSettings";
import NotificationSettings from "./pages/Settings/NotificationSettings";
import Categories from "./pages/Catalog/Categories";
import Locations from "./pages/Catalog/Locations";
import Users from "./pages/Settings/Users";
import ApiKeys from "./pages/Settings/ApiKeys";
import Roles from "./pages/Settings/Roles";

/**
 * The whole route table exists from this task onward. Screens a later task
 * builds render a placeholder, so the shell, the sidebar and the auth guard are
 * all exercisable now rather than only once every page is written.
 */
export default function App() {
  return (
    <AuthProvider>
      <Router>
        <ScrollToTop />
        <Routes>
          <Route path="/signin" element={<SignIn />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route index path="/" element={<Dashboard />} />

              <Route path="/assets" element={<AssetList />} />
              <Route path="/assets/new" element={<AssetForm mode="create" />} />
              <Route path="/assets/:id" element={<AssetDetail />} />
              <Route path="/assets/:id/edit" element={<AssetForm mode="edit" />} />
              {/* Scanned QR codes land here and resolve to the asset. */}
              <Route path="/a/:tag" element={<TagRedirect />} />

              <Route path="/import" element={<ImportWizard />} />
              <Route path="/maintenance" element={<MaintenanceList />} />
              <Route path="/whats-new" element={<WhatsNew />} />
              <Route path="/stocktakes" element={<StocktakeList />} />
              <Route path="/stocktakes/:id" element={<StocktakeSession />} />
              <Route path="/reports" element={<ReportGallery />} />
              <Route path="/reports/:key" element={<ReportViewer />} />

              <Route path="/categories" element={<Categories />} />
              <Route path="/locations" element={<Locations />} />

              <Route path="/settings/users" element={<Users />} />
              <Route path="/settings/roles" element={<Roles />} />
              <Route path="/settings/api-keys" element={<ApiKeys />} />
              <Route path="/settings/email" element={<EmailSettings />} />
              <Route path="/settings/notifications" element={<NotificationSettings />} />

            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
