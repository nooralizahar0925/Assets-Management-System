import { BrowserRouter as Router, Routes, Route } from "react-router";
import { AuthProvider } from "./context/AuthContext";
import RequireAuth from "./components/auth/RequireAuth";
import AppLayout from "./layout/AppLayout";
import { ScrollToTop } from "./components/common/ScrollToTop";

import SignIn from "./pages/AuthPages/SignIn";
import NotFound from "./pages/OtherPage/NotFound";
import Dashboard from "./pages/Dashboard/Home";
import ComingSoon from "./pages/ComingSoon";
import UserProfiles from "./pages/UserProfiles";
import AssetList from "./pages/Assets/AssetList";
import AssetDetail from "./pages/Assets/AssetDetail";
import TagRedirect from "./pages/Assets/TagRedirect";

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
              <Route path="/assets/new" element={<ComingSoon title="New asset" />} />
              <Route path="/assets/:id" element={<AssetDetail />} />
              <Route path="/assets/:id/edit" element={<ComingSoon title="Edit asset" />} />
              {/* Scanned QR codes land here and resolve to the asset. */}
              <Route path="/a/:tag" element={<TagRedirect />} />

              <Route path="/import" element={<ComingSoon title="Import" />} />
              <Route path="/reports" element={<ComingSoon title="Reports" />} />
              <Route path="/reports/:key" element={<ComingSoon title="Report" />} />

              <Route path="/categories" element={<ComingSoon title="Categories" />} />
              <Route path="/locations" element={<ComingSoon title="Locations" />} />

              <Route path="/settings/users" element={<ComingSoon title="People" />} />
              <Route path="/settings/roles" element={<ComingSoon title="Roles" />} />
              <Route path="/settings/api-keys" element={<ComingSoon title="API keys" />} />
              <Route path="/settings/email" element={<ComingSoon title="Email" />} />
              <Route
                path="/settings/notifications"
                element={<ComingSoon title="Notifications" />}
              />

              <Route path="/whats-new" element={<ComingSoon title="What's new" />} />
              <Route path="/help" element={<ComingSoon title="Help" />} />
              <Route path="/profile" element={<UserProfiles />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
