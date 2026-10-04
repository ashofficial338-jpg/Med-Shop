import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { can } from "../utils/permissions";

// `roles` limits a route to those roles; `permission` lets in admins plus any
// user granted that permission on the Roles & Permissions page.
export default function ProtectedRoute({ roles, permission, children }) {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  if (permission && !can(user, permission)) {
    return <Navigate to="/" replace />;
  }

  return children;
}
