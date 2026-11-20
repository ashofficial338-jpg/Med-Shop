import { lazy, Suspense, useCallback, useState } from "react";
import ConnectionStatus from "./components/ConnectionStatus";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import SessionExpiredModal from "./components/SessionExpiredModal";
import Login from "./pages/Login";
import Loader from "./components/Loader";
import Profile from "./pages/Profile";
import Users from "./pages/Users";
import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import RackFinder from "./pages/RackFinder";
import Vendors from "./pages/Vendors";
import PurchaseHistory from "./pages/PurchaseHistory";
import Checkout from "./pages/Checkout";
import BillPreview from "./pages/BillPreview";
import BillHistory from "./pages/BillHistory";
import Customers from "./pages/Customers";
import CustomerLedger from "./pages/CustomerLedger";
import VendorLedger from "./pages/VendorLedger";
import VendorAnalysis from "./pages/VendorAnalysis";
import Expenses from "./pages/Expenses";
import DayBook from "./pages/DayBook";
import StockManagement from "./pages/StockManagement";
import ProductProfitabilityReport from "./pages/ProductProfitabilityReport";
import RolesPermissions from "./pages/RolesPermissions";

// Reports & Analytics is large (charts, tables, export dialog) and only some
// users open it, so it loads on first visit instead of with the app.
const Reports = lazy(() => import("./pages/Reports"));
// The public website is only for visitors, so staff never download it.
const PublicHome = lazy(() => import("./pages/Home"));

const pageLoader = <Loader label="Gugan Medicals" className="min-h-screen" />;

function WorkspaceHome() {
  const { user } = useAuth();
  return <Navigate to={user.role === "admin" ? "/dashboard" : "/products"} replace />;
}

// "/": visitors get the public Gugan Medicals website; signed-in staff go
// straight to their workspace, exactly as before.
function Root() {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <WorkspaceHome />;
  return (
    <Suspense fallback={pageLoader}>
      <PublicHome />
    </Suspense>
  );
}

export default function App() {
  // Bumping this key re-mounts the page on screen so it fetches its data
  // again - how a failed load recovers without a browser refresh.
  const [reloadKey, setReloadKey] = useState(0);
  const reloadPage = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <>
      <SessionExpiredModal />
      <ConnectionStatus onReload={reloadPage} />
      <Routes key={reloadKey}>
        <Route path="/login" element={<Login />} />

        <Route path="/" element={<Root />} />
        {/* The public website, reachable even while signed in. */}
        <Route
          path="/site"
          element={
            <Suspense fallback={pageLoader}>
              <PublicHome />
            </Suspense>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          }
        />
        <Route
          path="/users"
          element={
            <ProtectedRoute roles={["admin"]}>
              <Users />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute permission="dashboard.view">
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/products"
          element={
            <ProtectedRoute>
              <Products />
            </ProtectedRoute>
          }
        />
        <Route
          path="/racks"
          element={
            <ProtectedRoute>
              <RackFinder />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vendors"
          element={
            <ProtectedRoute roles={["admin"]}>
              <Vendors />
            </ProtectedRoute>
          }
        />
        <Route
          path="/purchases"
          element={
            <ProtectedRoute roles={["admin"]}>
              <PurchaseHistory />
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkout"
          element={
            <ProtectedRoute>
              <Checkout />
            </ProtectedRoute>
          }
        />
        <Route
          path="/bills/:id"
          element={
            <ProtectedRoute>
              <BillPreview />
            </ProtectedRoute>
          }
        />
        <Route
          path="/bills"
          element={
            <ProtectedRoute>
              <BillHistory />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customers"
          element={
            <ProtectedRoute roles={["admin"]}>
              <Customers />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customers/:id/ledger"
          element={
            <ProtectedRoute roles={["admin"]}>
              <CustomerLedger />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vendors/:id/ledger"
          element={
            <ProtectedRoute roles={["admin"]}>
              <VendorLedger />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vendors/:id/analysis"
          element={
            <ProtectedRoute roles={["admin"]}>
              <VendorAnalysis />
            </ProtectedRoute>
          }
        />
        <Route
          path="/expenses"
          element={
            <ProtectedRoute roles={["admin"]}>
              <Expenses />
            </ProtectedRoute>
          }
        />
        <Route
          path="/day-book"
          element={
            <ProtectedRoute roles={["admin"]}>
              <DayBook />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock"
          element={
            <ProtectedRoute roles={["admin"]}>
              <StockManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/roles"
          element={
            <ProtectedRoute roles={["admin"]}>
              <RolesPermissions />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute permission="reports.view">
              <Suspense fallback={<Loader label="Loading reports" className="min-h-screen" />}>
                <Reports />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/profitability"
          element={
            <ProtectedRoute roles={["admin"]}>
              <ProductProfitabilityReport />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
