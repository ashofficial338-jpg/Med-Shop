import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import { listRacks } from "../api/racks";
import { useAuth } from "../context/AuthContext";
import { can } from "../utils/permissions";
import { parseRackCode } from "../utils/rack";
import RackOverview from "../components/rack/RackOverview";
import RackStockView from "../components/rack/RackStockView";
import MedicineLocator from "../components/rack/MedicineLocator";
import StockAuditView from "../components/rack/StockAuditView";
import { RackExpiry, RackHistory } from "../components/rack/RackExpiryHistory";
import RackLabels from "../components/rack/RackLabels";

const TABS = [
  ["overview", "Overview"],
  ["scan", "Scan / Rack Stock"],
  ["locate", "Locate & Move"],
  ["audit", "Stock Audit"],
  ["expiry", "Expiry Alerts"],
  ["history", "History"],
  ["labels", "QR Labels"],
];

// Advanced rack tools. Stock locations are read from each batch's rack
// positions, so everything here reflects purchases, sales, transfers and
// audits immediately. A rack QR label opens /rack-center?loc=<code>.
export default function RackCenter() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const initialLoc = parseRackCode(params.get("loc"));
  const [tab, setTab] = useState(initialLoc ? "scan" : params.get("tab") || "overview");
  const [scope, setScope] = useState(initialLoc || "");
  const [racks, setRacks] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    listRacks().then(setRacks).catch(() => setRacks([]));
  }, [reloadKey]);

  const go = (nextTab, nextScope) => {
    setTab(nextTab);
    if (nextScope !== undefined) setScope(nextScope);
    setParams(nextScope ? { tab: nextTab, loc: nextScope } : { tab: nextTab }, { replace: true });
  };
  const changed = () => setReloadKey((k) => k + 1);
  const canStock = can(user, "stock.edit");

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Rack Center</h1>
        <Link to="/racks" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-surface">
          Rack Finder
        </Link>
      </div>

      <div className="-mx-4 mt-4 overflow-x-auto px-4" role="tablist" aria-label="Rack tools">
        <div className="flex w-max gap-1 rounded-xl bg-surface p-1 shadow-sm">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => go(key, ["scan", "audit", "history"].includes(key) ? scope : undefined)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${tab === key ? "bg-primary text-white" : "text-muted hover:text-text"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {tab === "overview" && <RackOverview canEditRacks={can(user, "racks.edit")} onOpenScope={(code) => go("scan", code)} reloadKey={reloadKey} />}
        {tab === "scan" && <RackStockView scope={scope} onScope={(code) => go("scan", code)} racks={racks} reloadKey={reloadKey} />}
        {tab === "locate" && <MedicineLocator canTransfer={canStock} onChanged={changed} reloadKey={reloadKey} />}
        {tab === "audit" && <StockAuditView scope={scope} onScope={(code) => go("audit", code)} canApply={canStock} onChanged={changed} />}
        {tab === "expiry" && <RackExpiry racks={racks} reloadKey={reloadKey} />}
        {tab === "history" && <RackHistory scope={scope} onScope={(code) => go("history", code)} reloadKey={reloadKey} />}
        {tab === "labels" && <RackLabels racks={racks} />}
      </div>
    </Layout>
  );
}
