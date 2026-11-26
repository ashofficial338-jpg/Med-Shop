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
  Billing: () => import("./pages/Billing"),
  PurchaseEntry: () => import("./pages/PurchaseEntry"),
  PurchaseOrders: () => import("./pages/PurchaseOrders"),
  PurchaseOrderForm: () => import("./pages/PurchaseOrderForm"),
  PurchaseOrderDetail: () => import("./pages/PurchaseOrderDetail"),
  PurchaseReturns: () => import("./pages/PurchaseReturns"),
  PurchaseReturnForm: () => import("./pages/PurchaseReturnForm"),
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
  ClearRecords: () => import("./pages/ClearRecords"),
  ManagementReports: () => import("./pages/ManagementReports"),
  PartyDetail: () => import("./pages/PartyDetail"),
};
const Profile = lazy(pageImports.Profile);
const Users = lazy(pageImports.Users);
const Dashboard = lazy(pageImports.Dashboard);
const Products = lazy(pageImports.Products);
const RackFinder = lazy(pageImports.RackFinder);
const Vendors = lazy(pageImports.Vendors);
const PurchaseHistory = lazy(pageImports.PurchaseHistory);
const Billing = lazy(pageImports.Billing);
const PurchaseEntry = lazy(pageImports.PurchaseEntry);
const PurchaseOrders = lazy(pageImports.PurchaseOrders);
const PurchaseOrderForm = lazy(pageImports.PurchaseOrderForm);
const PurchaseOrderDetail = lazy(pageImports.PurchaseOrderDetail);
const PurchaseReturns = lazy(pageImports.PurchaseReturns);
const PurchaseReturnForm = lazy(pageImports.PurchaseReturnForm);
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
const ClearRecords = lazy(pageImports.ClearRecords);
const ManagementReports = lazy(pageImports.ManagementReports);
const PartyDetail = lazy(pageImports.PartyDetail);
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
  return <Navigate to={user.role === "admin" ? "/dashboard" : "/billing"} replace />;
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
            path="/purchases/new"
            element={
              <ProtectedRoute roles={["admin"]}>
                <PurchaseEntry />
              </ProtectedRoute>
            }
          />
          <Route
            path="/purchases/:id/edit"
            element={
              <ProtectedRoute roles={["admin"]}>
                <PurchaseEntry />
              </ProtectedRoute>
            }
          />
          <Route
            path="/purchase-orders"
            element={
              <ProtectedRoute roles={["admin"]}>
                <PurchaseOrders />
              </ProtectedRoute>
            }
          />
          <Route
            path="/purchase-orders/new"
            element={
              <ProtectedRoute roles={["admin"]}>
                <PurchaseOrderForm />
              </ProtectedRoute>
            }
          />
          <Route
            path="/purchase-orders/:id"
            element={
              <ProtectedRoute roles={["admin"]}>
                <PurchaseOrderDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/purchase-orders/:id/edit"
            element={
              <ProtectedRoute roles={["admin"]}>
                <PurchaseOrderForm />
              </ProtectedRoute>
            }
          />
          <Route
            path="/purchase-returns"
            element={
              <ProtectedRoute roles={["admin"]}>
                <PurchaseReturns />
              </ProtectedRoute>
            }
          />
          <Route
            path="/purchase-returns/new"
            element={
              <ProtectedRoute roles={["admin"]}>
                <PurchaseReturnForm />
              </ProtectedRoute>
            }
          />
          <Route
            path="/billing"
            element={
              <ProtectedRoute>
                <Billing />
              </ProtectedRoute>
            }
          />
          {/* Old address of the billing screen. */}
          <Route path="/checkout" element={<Navigate to="/billing" replace />} />
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

          <Route
            path="/customers/:id"
            element={
              <ProtectedRoute roles={["admin"]}>
                <PartyDetail key="customer" side="customer" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vendors/:id"
            element={
              <ProtectedRoute roles={["admin"]}>
                <PartyDetail key="vendor" side="vendor" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/management"
            element={
              <ProtectedRoute permission="reports.view">
                <ManagementReports />
              </ProtectedRoute>
            }
          />
          <Route
            path="/clear-records"
            element={
              <ProtectedRoute roles={["admin"]}>
                <ClearRecords />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
