import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../../context/AuthContext";

export default function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  // Remember where they were headed so sign-in can return them there.
  if (!user) return <Navigate to="/signin" state={{ from: location }} replace />;
  return <Outlet />;
}
