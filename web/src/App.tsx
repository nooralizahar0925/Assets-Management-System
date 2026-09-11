import { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router";
import { AuthProvider } from "./context/AuthContext";
import RequireAuth from "./components/auth/RequireAuth";
import { TourProvider } from "./components/help/TourProvider";
import AppLayout from "./layout/AppLayout";
import { ScrollToTop } from "./components/common/ScrollToTop";

import SignIn from "./pages/AuthPages/SignIn";
import AcceptInvitation from "./pages/AuthPages/AcceptInvitation";
import NotFound from "./pages/OtherPage/NotFound";
import Dashboard from "./pages/Dashboard/Home";
import AssetList from "./pages/Assets/AssetList";
import AssetDetail from "./pages/Assets/AssetDetail";
import TagRedirect from "./pages/Assets/TagRedirect";
import AssetForm from "./pages/Assets/AssetForm";
import ImportWizard from "./pages/Import/ImportWizard";
import ImportJob from "./pages/Import/ImportJob";
import MaintenanceList from "./pages/Maintenance/MaintenanceList";
import WhatsNew from "./pages/WhatsNew";
import Help from "./pages/Help";
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
import WebhookSettings from "./pages/Settings/Webhooks";
import Roles from "./pages/Settings/Roles";

/**
 * The developer portal is lazy: it is read by integrators, not by the people
 * using the application all day, and there is no reason for its prose to sit in
 * the bundle every operator downloads.
 */
const DevelopersLayout = lazy(() => import("./pages/developers/DevelopersLayout"));
const DevOverview = lazy(() => import("./pages/developers/Overview"));
const DevAuthentication = lazy(() => import("./pages/developers/Authentication"));
const DevConventions = lazy(() => import("./pages/developers/Conventions"));
const DevReference = lazy(() => import("./pages/developers/Reference"));
const DevErrors = lazy(() => import("./pages/developers/Errors"));
const DevRecipes = lazy(() => import("./pages/developers/Recipes"));
const DevWebhooks = lazy(() => import("./pages/developers/Webhooks"));
const DevChangelog = lazy(() => import("./pages/developers/Changelog"));

/**
 * The operator's console, lazy like the developer portal and for the same
 * reason: no customer should download it on every page load. It is guarded by
 * its own context rather than RequireAuth, which would send an operator to the
 * customers' sign-in - the wrong door.
 */
const PlatformAuthProvider = lazy(() =>
  import("./platform/PlatformAuthContext")
    .then((m) => ({ default: m.PlatformAuthProvider })));
const PlatformLayout = lazy(() => import("./platform/PlatformLayout"));
const Organisations = lazy(() => import("./platform/Organisations"));
const NewOrganisation = lazy(() => import("./platform/NewOrganisation"));
const Organisation = lazy(() => import("./platform/Organisation"));
const Attention = lazy(() => import("./platform/Attention"));

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
          {/*
            Public, like sign-in: whoever holds an invitation link has no
            account yet, which is the entire point of the link.
          */}
          <Route path="/accept-invitation/:token" element={<AcceptInvitation />} />

          {/*
            Public on purpose, outside RequireAuth: an integrator reads these
            pages to decide whether to build against the API, which happens
            before anyone has issued them a credential. Nothing under
            /developers calls a tenant-scoped endpoint.
          */}
          <Route
            path="/developers"
            element={
              <Suspense fallback={null}>
                <DevelopersLayout />
              </Suspense>
            }
          >
            <Route index element={<Suspense fallback={null}><DevOverview /></Suspense>} />
            <Route path="authentication" element={<Suspense fallback={null}><DevAuthentication /></Suspense>} />
            <Route path="conventions" element={<Suspense fallback={null}><DevConventions /></Suspense>} />
            <Route path="reference" element={<Suspense fallback={null}><DevReference /></Suspense>} />
            <Route path="recipes" element={<Suspense fallback={null}><DevRecipes /></Suspense>} />
            <Route path="webhooks" element={<Suspense fallback={null}><DevWebhooks /></Suspense>} />
            <Route path="errors" element={<Suspense fallback={null}><DevErrors /></Suspense>} />
            <Route path="changelog" element={<Suspense fallback={null}><DevChangelog /></Suspense>} />
          </Route>

          <Route
            path="/platform"
            element={
              <Suspense fallback={null}>
                <PlatformAuthProvider>
                  <PlatformLayout />
                </PlatformAuthProvider>
              </Suspense>
            }
          >
            <Route index element={<Suspense fallback={null}><Attention /></Suspense>} />
            <Route path="customers" element={<Suspense fallback={null}><Organisations /></Suspense>} />
            <Route path="new" element={<Suspense fallback={null}><NewOrganisation /></Suspense>} />
            <Route path=":id" element={<Suspense fallback={null}><Organisation /></Suspense>} />
          </Route>

          <Route element={<RequireAuth />}>
            <Route element={<TourProvider><AppLayout /></TourProvider>}>
              <Route index path="/" element={<Dashboard />} />

              <Route path="/assets" element={<AssetList />} />
              <Route path="/assets/new" element={<AssetForm mode="create" />} />
              <Route path="/assets/:id" element={<AssetDetail />} />
              <Route path="/assets/:id/edit" element={<AssetForm mode="edit" />} />
              {/* Scanned QR codes land here and resolve to the asset. */}
              <Route path="/a/:tag" element={<TagRedirect />} />

              <Route path="/import" element={<ImportWizard />} />

              <Route path="/import/:id" element={<ImportJob />} />
              <Route path="/maintenance" element={<MaintenanceList />} />
              <Route path="/whats-new" element={<WhatsNew />} />
              <Route path="/help" element={<Help />} />
              <Route path="/help/:slug" element={<Help />} />
              <Route path="/stocktakes" element={<StocktakeList />} />
              <Route path="/stocktakes/:id" element={<StocktakeSession />} />
              <Route path="/reports" element={<ReportGallery />} />
              <Route path="/reports/:key" element={<ReportViewer />} />

              <Route path="/categories" element={<Categories />} />
              <Route path="/locations" element={<Locations />} />

              <Route path="/settings/users" element={<Users />} />
              <Route path="/settings/roles" element={<Roles />} />
              <Route path="/settings/api-keys" element={<ApiKeys />} />
              <Route path="/settings/webhooks" element={<WebhookSettings />} />
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
