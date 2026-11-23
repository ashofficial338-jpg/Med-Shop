import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import ConnectionStatus from "./components/ConnectionStatus";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import SessionExpiredModal from "./components/SessionExpiredModal";
import Login from "./pages/Login";
import Loader from "./components/Loader";

// Every page loads on first visit instead of with the app, so the first
// screen (login / dashboard) comes up fast. Once the app is idle, all pages
// are fetched in the background, so moving between them stays instant.
const pageImports = {
  Profile: () => import("./pages/Profile"),
  Users: () => import("./pages/Users"),
  Dashboard: () => import("./pages/Dashboard"),
  Products: () => import("./pages/Products"),
  RackFinder: () => import("./pages/RackFinder"),
  Vendors: () => import("./pages/Vendors"),
  PurchaseHistory: () => import("./pages/PurchaseHistory"),
  Checkout: () => import("./pages/Checkout"),
  BillPreview: () => import("./pages/BillPreview"),
  BillHistory: () => import("./pages/BillHistory"),
  Customers: () => import("./pages/Customers"),
  CustomerLedger: () => import("./pages/CustomerLedger"),
  VendorLedger: () => import("./pages/VendorLedger"),
  VendorAnalysis: () => import("./pages/VendorAnalysis"),
  Expenses: () => import("./pages/Expenses"),
  DayBook: () => import("./pages/DayBook"),
  StockManagement: () => import("./pages/StockManagement"),
  RackCenter: () => import("./pages/RackCenter"),
  ProductProfitabilityReport: () => import("./pages/ProductProfitabilityReport"),
  RolesPermissions: () => import("./pages/RolesPermissions"),
  Reports: () => import("./pages/Reports"),
};
const Profile = lazy(pageImports.Profile);
const Users = lazy(pageImports.Users);
const Dashboard = lazy(pageImports.Dashboard);
const Products = lazy(pageImports.Products);
const RackFinder = lazy(pageImports.RackFinder);
const Vendors = lazy(pageImports.Vendors);
const PurchaseHistory = lazy(pageImports.PurchaseHistory);
const Checkout = lazy(pageImports.Checkout);
const BillPreview = lazy(pageImports.BillPreview);
const BillHistory = lazy(pageImports.BillHistory);
const Customers = lazy(pageImports.Customers);
const CustomerLedger = lazy(pageImports.CustomerLedger);
const VendorLedger = lazy(pageImports.VendorLedger);
const VendorAnalysis = lazy(pageImports.VendorAnalysis);
const Expenses = lazy(pageImports.Expenses);
const DayBook = lazy(pageImports.DayBook);
const StockManagement = lazy(pageImports.StockManagement);
const RackCenter = lazy(pageImports.RackCenter);
const ProductProfitabilityReport = lazy(pageImports.ProductProfitabilityReport);
const RolesPermissions = lazy(pageImports.RolesPermissions);
// Reports & Analytics is large (charts, tables, export dialog).
const Reports = lazy(pageImports.Reports);
// The public website is only for visitors, so staff never download it.
const PublicHome = lazy(() => import("./pages/Home"));

// Signed-in staff: fetch every workspace page in the background once the
// browser is idle, so no page shows a loader when it is opened later.
function usePreloadPages(enabled) {
  useEffect(() => {
    if (!enabled) return;
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 1500));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const id = idle(() => {
      Object.values(pageImports).forEach((load) => load().catch(() => {}));
    });
    return () => cancel(id);
  }, [enabled]);
}

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
  const { isAuthenticated } = useAuth();
  usePreloadPages(isAuthenticated);

  return (
    <>
      <SessionExpiredModal />
      <ConnectionStatus onReload={reloadPage} />
      <Suspense fallback={pageLoader}>
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
            path="/rack-center"
            element={
              <ProtectedRoute>
                <RackCenter />
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
                <Reports />
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
      </Suspense>
    </>
  );
}
