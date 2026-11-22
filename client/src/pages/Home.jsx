import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon";
import BrandLogo from "../components/BrandLogo";
import { resolveAssetUrl } from "../api/client";
import { getShowcase } from "../api/public";
import { useAuth } from "../context/AuthContext";
import { useParallax, useReveal } from "../hooks/useMotion";
import { BRAND, CONTACT, TESTIMONIALS } from "../config/brand";

const NAV = [
  { id: "products", label: "Products" },
  { id: "categories", label: "Categories" },
  { id: "about", label: "About" },
  { id: "why-us", label: "Why us" },
  { id: "contact", label: "Contact" },
];

// Category icon by keyword, so any category the shop creates gets a fitting one.
const CATEGORY_ICONS = [
  [/baby|infant|kid|child/i, "baby"],
  [/skin|derma|cream|ointment|beauty|cosmetic/i, "droplet"],
  [/syrup|liquid|drop/i, "droplet"],
  [/vitamin|supplement|nutrition|protein|health drink/i, "leaf"],
  [/device|equipment|monitor|thermometer|bp|glucometer/i, "stethoscope"],
  [/first aid|bandage|dressing|surgical/i, "bandage"],
  [/heart|cardio|bp/i, "heart"],
  [/ayur|herbal|natural|organic/i, "leaf"],
  [/tablet|capsule|medicine|drug|antibiotic|pain|fever/i, "pill"],
];
const categoryIcon = (name) => CATEGORY_ICONS.find(([re]) => re.test(name))?.[1] || "pill";
const TONES = [
  "from-[#E9F1FB] to-[#DCEBFA] text-primary",
  "from-[#E7F7EF] to-[#D5F1E3] text-secondary",
  "from-[#E6F8FB] to-[#D3F1F7] text-[#0E86B5]",
];

const WHY = [
  { icon: "shield", title: "100% genuine medicines", text: "Sourced only from licensed distributors, stored the right way and checked batch by batch." },
  { icon: "hourglass", title: "Freshest stock first", text: "Every sale is picked first-expiry-first-out, so you always take home well-dated medicine." },
  { icon: "stethoscope", title: "Expert pharmacist advice", text: "Ask us about dosage, side effects or alternatives. Clear answers, no rush." },
  { icon: "receipt", title: "Transparent GST billing", text: "Itemised, GST-compliant bills with batch and expiry printed on every line." },
  { icon: "bolt", title: "Quick, friendly service", text: "A well-organised store and smart rack system mean you are served in minutes." },
  { icon: "heart", title: "Care that knows you", text: "We remember regular customers and keep their routine medicines in stock." },
];

const TRUST = [
  "Genuine medicines",
  "Licensed pharmacists",
  "GST invoices",
  "FEFO stock rotation",
  "Prescription & OTC",
  "Healthcare essentials",
  "Baby & personal care",
  "Wellness & supplements",
];

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const telHref = (p) => `tel:${p.replace(/[^\d+]/g, "")}`;
const whatsappHref = (text) =>
  CONTACT.whatsapp ? `https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(text)}` : null;

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ───────────────────────── Navbar ───────────────────────── */

function Navbar({ isAuthenticated }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const go = (id) => {
    setOpen(false);
    scrollToId(id);
  };
  const solid = scrolled || open;

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        solid ? "glass border-b border-white/70 shadow-[0_10px_30px_-20px_rgba(11,40,90,0.45)]" : "bg-transparent"
      }`}
    >
      <nav className="mx-auto flex h-[72px] max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8" aria-label="Primary">
        <a href="#top" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }} aria-label={`${BRAND.name} home`}>
          <BrandLogo tone={solid ? "dark" : "light"} size={40} />
        </a>

        <ul className="ml-auto hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => go(n.id)}
                className={`group relative rounded-full px-4 py-2 text-sm font-semibold ${
                  solid ? "text-text/80 hover:text-primary" : "text-white/80 hover:text-white"
                }`}
              >
                {n.label}
                <span className="absolute inset-x-4 -bottom-0.5 h-0.5 origin-left scale-x-0 rounded-full bg-gradient-to-r from-cyan to-secondary transition-transform duration-300 group-hover:scale-x-100" />
              </button>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2 lg:ml-4">
          <Link
            to={isAuthenticated ? "/" : "/login"}
            className={`hidden items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold sm:inline-flex ${
              solid
                ? "bg-primary text-white"
                : "glass-dark text-white hover:bg-white/20"
            }`}
          >
            <Icon name={isAuthenticated ? "dashboard" : "lock"} size={15} strokeWidth={2} />
            {isAuthenticated ? "Open workspace" : "Staff sign in"}
          </Link>
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className={`rounded-xl p-2 lg:hidden ${solid ? "text-text hover:bg-primary-soft" : "text-white hover:bg-white/10"}`}
          >
            <Icon name={open ? "close" : "menu"} size={22} />
          </button>
        </div>
      </nav>

      {open && (
        <div className="pop-in border-t border-border/60 px-4 pb-5 pt-2 lg:hidden">
          <ul className="space-y-1">
            {NAV.map((n) => (
              <li key={n.id}>
                <button onClick={() => go(n.id)} className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-[15px] font-semibold text-text hover:bg-primary-soft hover:text-primary">
                  {n.label}
                  <Icon name="arrowRight" size={16} className="text-muted" />
                </button>
              </li>
            ))}
          </ul>
          <Link to={isAuthenticated ? "/" : "/login"} className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white">
            <Icon name={isAuthenticated ? "dashboard" : "lock"} size={15} strokeWidth={2} />
            {isAuthenticated ? "Open workspace" : "Staff sign in"}
          </Link>
        </div>
      )}
    </header>
  );
}

/* ───────────────────────── Hero ───────────────────────── */

function Capsule({ className = "", style }) {
  return (
    <div className={`pointer-events-none absolute ${className}`} style={style} aria-hidden="true">
      <div className="flex h-9 w-24 overflow-hidden rounded-full shadow-[0_18px_30px_-12px_rgba(3,12,30,0.6)] ring-1 ring-white/40">
        <span className="h-full w-1/2 bg-gradient-to-b from-white to-[#D9E8F7]" />
        <span className="h-full w-1/2 bg-gradient-to-b from-[#4ADE9B] to-[#12A06A]" />
      </div>
    </div>
  );
}

function HeroVisual({ data }) {
  const productCount = data?.productCount;
  return (
    <div className="relative mx-auto h-[420px] w-full max-w-[520px] sm:h-[460px]" aria-hidden="true">
      {/* Mouse/scroll parallax layers read --px/--py/--sy from the hero. */}
      <div
        className="absolute inset-0"
        style={{ transform: "translate3d(calc(var(--px,0) * -14px), calc(var(--py,0) * -10px + var(--sy,0) * -0.04px), 0)" }}
      >
        <div className="absolute left-1/2 top-1/2 h-[340px] w-[340px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-[#22B8CF]/40 via-white/10 to-[#12A06A]/30 blur-2xl" />
        <div className="absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />
        <div className="absolute left-1/2 top-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/10" />
      </div>

      {/* Main glass card: the prescription, filled. */}
      <div
        className="absolute left-1/2 top-1/2 w-[290px] sm:w-[320px]"
        style={{ transform: "translate3d(calc(-50% + var(--px,0) * 10px), calc(-50% + var(--py,0) * 8px), 0)" }}
      >
        <div className="glass-dark float-slow rounded-[28px] p-6 text-white">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
              <Icon name="clipboard" size={15} /> Prescription
            </span>
            <span className="rounded-full bg-[#12A06A]/25 px-2.5 py-1 text-[11px] font-bold text-[#7EE2B8] ring-1 ring-[#7EE2B8]/30">Ready</span>
          </div>
          <div className="mt-5 space-y-3">
            {[
              ["Checked by pharmacist", "w-[70%]"],
              ["Batch & expiry verified", "w-[82%]"],
              ["Packed with care", "w-[60%]"],
            ].map(([label, w], i) => (
              <div key={label} className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#4ADE9B] to-[#12A06A] shadow-[0_6px_14px_-6px_rgba(18,160,106,0.9)]">
                  <Icon name="check" size={14} strokeWidth={2.6} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{label}</p>
                  <div className="mt-1.5 h-1.5 rounded-full bg-white/10">
                    <div className={`h-full rounded-full bg-gradient-to-r from-[#9BE7F2] to-white/70 ${w}`} style={{ animation: `fadeUp .9s ${300 + i * 200}ms backwards` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex items-center gap-3 rounded-2xl bg-white/10 p-3 ring-1 ring-white/15">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-primary">
              <Icon name="pulse" size={20} strokeWidth={2} />
            </span>
            <div>
              <p className="text-xs text-white/60">Your health, our priority</p>
              <p className="font-display text-sm font-bold">{BRAND.tagline}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Floating chips and capsules at different parallax depths. */}
      <div className="absolute left-0 top-6 sm:-left-4" style={{ transform: "translate3d(calc(var(--px,0) * 22px), calc(var(--py,0) * 18px), 0)" }}>
        <div className="glass-panel float-mid flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Icon name="shield" size={18} />
          </span>
          <div className="leading-tight">
            <p className="text-[11px] text-muted">Quality assured</p>
            <p className="text-sm font-bold text-text">100% Genuine</p>
          </div>
        </div>
      </div>
      <div className="absolute bottom-8 right-0 sm:-right-2" style={{ transform: "translate3d(calc(var(--px,0) * 26px), calc(var(--py,0) * 20px), 0)" }}>
        <div className="glass-panel float-slow flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary-soft text-secondary">
            <Icon name="pill" size={18} />
          </span>
          <div className="leading-tight">
            <p className="text-[11px] text-muted">In our store</p>
            <p className="text-sm font-bold text-text">{productCount ? `${productCount.toLocaleString("en-IN")}+ products` : "Wide range"}</p>
          </div>
        </div>
      </div>
      <Capsule className="float-rot right-6 top-2" style={{ transform: "translate3d(calc(var(--px,0) * 34px), calc(var(--py,0) * 26px), 0)" }} />
      <Capsule className="float-rot bottom-4 left-6 scale-75 opacity-80" style={{ animationDelay: "-4s", transform: "translate3d(calc(var(--px,0) * -30px), calc(var(--py,0) * -22px), 0) scale(.75)" }} />
    </div>
  );
}

function Hero({ data, onSearch }) {
  const ref = useRef(null);
  useParallax(ref);
  const [q, setQ] = useState("");

  return (
    <section id="top" ref={ref} className="hero-surface relative overflow-hidden pb-24 pt-[120px] text-white sm:pb-28 lg:pt-[140px]">
      <div className="login-grid pointer-events-none absolute inset-0 opacity-[0.06]" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ transform: "translate3d(0, calc(var(--sy,0) * 0.25px), 0)" }}
        aria-hidden="true"
      >
        <div className="blob absolute -left-20 top-20 h-72 w-72 rounded-full bg-[#22B8CF]/25 blur-3xl" />
        <div className="blob blob-b absolute right-0 top-0 h-96 w-96 rounded-full bg-[#1A6FC4]/40 blur-3xl" />
        <div className="blob blob-c absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-[#12A06A]/25 blur-3xl" />
      </div>

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:px-8">
        <div className="max-w-2xl">
          <p className="glass-dark fade-up inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold tracking-wide text-white/90">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4ADE9B]/70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#4ADE9B]" />
            </span>
            Licensed pharmacy · Genuine medicines
          </p>
          <h1 className="fade-up mt-6 font-display text-[40px] font-extrabold leading-[1.05] tracking-tight sm:text-[54px] lg:text-[62px]" style={{ animationDelay: "80ms" }}>
            Your health, in <span className="text-gradient-brand">trusted hands.</span>
          </h1>
          <p className="fade-up mt-5 max-w-xl text-base leading-relaxed text-white/75 sm:text-lg" style={{ animationDelay: "160ms" }}>
            {BRAND.description}
          </p>

          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              onSearch(q);
            }}
            className="fade-up glass-dark mt-8 flex max-w-xl items-center gap-2 rounded-2xl p-2"
            style={{ animationDelay: "240ms" }}
          >
            <label htmlFor="hero-search" className="sr-only">Search medicines</label>
            <span className="pl-3 text-white/60">
              <Icon name="search" size={19} />
            </span>
            <input
              id="hero-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search medicines, brands or categories…"
              className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] text-white placeholder:text-white/50 focus:outline-none focus:!shadow-none"
              style={{ border: 0 }}
            />
            <button type="submit" className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-primary shadow-[0_10px_24px_-12px_rgba(0,0,0,0.6)] hover:-translate-y-0.5 hover:bg-[#F1F7FD]">
              Search
            </button>
          </form>

          <div className="fade-up mt-6 flex flex-wrap gap-3" style={{ animationDelay: "320ms" }}>
            <button
              onClick={() => scrollToId("products")}
              className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#12A06A] to-[#16B57A] px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_-12px_rgba(18,160,106,0.9)] hover:-translate-y-0.5 hover:brightness-110"
            >
              Browse products
              <Icon name="arrowRight" size={16} strokeWidth={2} className="transition-transform group-hover:translate-x-1" />
            </button>
            <button
              onClick={() => scrollToId("contact")}
              className="glass-dark inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white hover:-translate-y-0.5 hover:bg-white/20"
            >
              <Icon name="mapPin" size={16} />
              Visit our store
            </button>
          </div>

          <dl className="fade-up mt-10 grid max-w-lg grid-cols-3 gap-3" style={{ animationDelay: "400ms" }}>
            {[
              [data?.productCount ? `${data.productCount.toLocaleString("en-IN")}+` : "Wide", "Products"],
              [data?.categories?.length ? `${data.categories.length}` : "Many", "Categories"],
              ["100%", "Genuine"],
            ].map(([value, label]) => (
              <div key={label} className="glass-dark rounded-2xl px-4 py-3">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">{label}</dt>
                <dd className="mt-0.5 font-display text-xl font-extrabold tnum sm:text-2xl">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="fade-up hidden md:block" style={{ animationDelay: "200ms" }}>
          <HeroVisual data={data} />
        </div>
      </div>

      {/* Soft wave into the page body. */}
      <svg className="absolute inset-x-0 -bottom-px h-16 w-full text-bg sm:h-20" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true">
        <path fill="currentColor" d="M0 48c180 26 360 32 540 22S900 22 1080 20s300 12 360 18v42H0z" />
      </svg>
    </section>
  );
}

/* ───────────────────────── Sections ───────────────────────── */

function SectionHeading({ eyebrow, title, text, align = "center" }) {
  return (
    <div className={`reveal max-w-2xl ${align === "center" ? "mx-auto text-center" : ""}`}>
      <p className={`inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-primary ring-1 ring-primary/10`}>
        <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-cyan to-secondary" />
        {eyebrow}
      </p>
      <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-text sm:text-[40px] sm:leading-[1.1]">{title}</h2>
      {text && <p className="mt-3 text-base leading-relaxed text-muted">{text}</p>}
    </div>
  );
}

function TrustMarquee() {
  const items = [...TRUST, ...TRUST];
  return (
    <div className="marquee relative -mt-8 overflow-hidden py-4" aria-label="What we offer">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-bg to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-bg to-transparent" />
      <ul className="marquee-track flex w-max gap-3">
        {items.map((t, i) => (
          <li key={i} aria-hidden={i >= TRUST.length || undefined} className="glass-panel flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold text-text">
            <Icon name="check" size={14} strokeWidth={2.4} className="text-secondary" />
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProductCard({ product, index = 0 }) {
  const wa = whatsappHref(`Hello ${BRAND.name}, is ${product.name}${product.strength ? ` ${product.strength}` : ""} available?`);
  return (
    <article
      className="reveal reveal-zoom card lift-card group flex h-full flex-col overflow-hidden"
      style={{ "--d": `${(index % 4) * 70}ms` }}
    >
      <div className="relative flex h-40 items-center justify-center overflow-hidden bg-gradient-to-br from-[#EEF5FD] via-white to-[#E6F8FB]">
        {product.image ? (
          <img
            src={resolveAssetUrl(product.image)}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover transition duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.07]"
          />
        ) : (
          <>
            <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-[#22B8CF]/15 blur-2xl" />
            <div className="absolute -bottom-10 -left-6 h-28 w-28 rounded-full bg-[#12A06A]/12 blur-2xl" />
            <span className="icon-pop relative flex h-16 w-16 items-center justify-center rounded-2xl bg-white/90 text-primary shadow-[0_14px_28px_-14px_rgba(11,74,143,0.6)] ring-1 ring-white">
              <Icon name={categoryIcon(`${product.category} ${product.name}`)} size={28} strokeWidth={1.6} />
            </span>
          </>
        )}
        {product.category && (
          <span className="absolute left-3 top-3 max-w-[70%] truncate rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-primary shadow-sm ring-1 ring-primary/10 backdrop-blur">
            {product.category}
          </span>
        )}
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/85 px-2 py-1 text-[10px] font-bold text-success shadow-sm ring-1 ring-success/15 backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          In stock
        </span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-2 font-display text-[15px] font-bold leading-snug text-text transition-colors group-hover:text-primary">
          {product.name}
        </h3>
        <p className="mt-1 truncate text-xs text-muted">
          {[product.brand, product.strength].filter(Boolean).join(" · ") || " "}
        </p>
        <div className="flex-1" />
        <div className="mt-4 flex items-end justify-between gap-2">
          <p className="leading-tight">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">MRP</span>
            <span className="font-display text-lg font-extrabold tracking-tight text-text tnum">{money(product.price)}</span>
            <span className="ml-1 text-xs text-muted">/ {product.packUnit}</span>
          </p>
          {wa ? (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-xl bg-secondary-soft px-3 py-2 text-xs font-bold text-secondary ring-1 ring-secondary/15 hover:bg-secondary hover:text-white"
            >
              Enquire
              <Icon name="arrowRight" size={13} strokeWidth={2.2} />
            </a>
          ) : (
            <button
              onClick={() => scrollToId("contact")}
              className="inline-flex items-center gap-1 rounded-xl bg-secondary-soft px-3 py-2 text-xs font-bold text-secondary ring-1 ring-secondary/15 hover:bg-secondary hover:text-white"
            >
              Enquire
              <Icon name="arrowRight" size={13} strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function ProductSkeletons({ n = 8 }) {
  return Array.from({ length: n }).map((_, i) => (
    <div key={i} className="card overflow-hidden">
      <div className="skeleton h-40 rounded-none" />
      <div className="space-y-2 p-4">
        <div className="skeleton h-4 w-3/4" />
        <div className="skeleton h-3 w-1/2" />
        <div className="skeleton mt-4 h-6 w-1/3" />
      </div>
    </div>
  ));
}

function Products({ data, loading, failed, query, setQuery, category, setCategory, onRetry }) {
  const PAGE = 12;
  const [shown, setShown] = useState(PAGE);
  // Optional extra filters - only offered when the products actually vary.
  const [brand, setBrand] = useState("");
  const [form, setForm] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const items = useMemo(() => data?.featured || [], [data]);
  const brands = useMemo(() => [...new Set(items.map((p) => p.brand).filter(Boolean))].sort(), [items]);
  const forms = useMemo(() => [...new Set(items.map((p) => p.dosageForm).filter(Boolean))].sort(), [items]);
  const prices = items.map((p) => Number(p.price) || 0);
  const priceSpread = prices.length > 1 && Math.max(...prices) > Math.min(...prices);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const min = minPrice === "" ? null : Number(minPrice);
    const max = maxPrice === "" ? null : Number(maxPrice);
    return items.filter(
      (p) =>
        (!category || p.category === category) &&
        (!brand || p.brand === brand) &&
        (!form || p.dosageForm === form) &&
        (min === null || p.price >= min) &&
        (max === null || p.price <= max) &&
        (!q || `${p.name} ${p.brand} ${p.category} ${p.composition || ""} ${p.strength || ""}`.toLowerCase().includes(q))
    );
  }, [items, query, category, brand, form, minPrice, maxPrice]);
  useEffect(() => setShown(PAGE), [query, category, brand, form, minPrice, maxPrice]);
  const filterCls = "h-10 rounded-xl border border-border bg-white/80 px-3 text-sm text-text focus:outline-none";
  const anyExtra = brand || form || minPrice || maxPrice;
  useReveal([list, shown]);

  const chips = data?.categories || [];

  return (
    <section id="products" data-section className="relative py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading
            align="left"
            eyebrow="Featured products"
            title="Healthcare essentials, ready on our shelves"
            text="Search what you need and check it is in stock before you visit."
          />
          <div className="reveal relative w-full max-w-sm" style={{ "--d": "120ms" }}>
            <label htmlFor="product-search" className="sr-only">Filter products</label>
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted">
              <Icon name="search" size={17} />
            </span>
            <input
              id="product-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, brand, category or composition"
              className="h-12 w-full rounded-2xl border border-border bg-white/80 pl-11 pr-4 text-sm text-text shadow-[var(--shadow-card)] backdrop-blur placeholder:text-muted/70 focus:outline-none"
            />
          </div>
        </div>

        {chips.length > 0 && (
          <div className="reveal thin-scroll mt-8 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Filter by category">
            {[{ name: "" }, ...chips].map((c) => {
              const active = category === c.name;
              return (
                <button
                  key={c.name || "all"}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setCategory(c.name)}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ring-1 ${
                    active
                      ? "bg-gradient-to-r from-primary to-[#1466B8] text-white ring-transparent shadow-[0_10px_20px_-12px_rgba(11,74,143,0.8)]"
                      : "bg-white/80 text-text ring-border hover:text-primary hover:ring-primary/30"
                  }`}
                >
                  {c.name || "All"}
                </button>
              );
            })}
          </div>
        )}

        {(brands.length > 1 || forms.length > 0 || priceSpread) && (
          <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="More filters">
            {brands.length > 1 && (
              <select aria-label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} className={filterCls}>
                <option value="">All brands</option>
                {brands.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            )}
            {forms.length > 0 && (
              <select aria-label="Type" value={form} onChange={(e) => setForm(e.target.value)} className={filterCls}>
                <option value="">All types</option>
                {forms.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            )}
            {priceSpread && (
              <>
                <input type="number" min="0" aria-label="Minimum price" placeholder="Min ₹" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} className={`${filterCls} w-24`} />
                <span className="text-muted">–</span>
                <input type="number" min="0" aria-label="Maximum price" placeholder="Max ₹" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className={`${filterCls} w-24`} />
              </>
            )}
            {anyExtra && (
              <button
                type="button"
                onClick={() => {
                  setBrand("");
                  setForm("");
                  setMinPrice("");
                  setMaxPrice("");
                }}
                className="text-sm font-semibold text-primary hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        )}

        <div className="mt-8 grid grid-cols-1 gap-5 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {loading ? (
            <ProductSkeletons />
          ) : (
            list.slice(0, shown).map((p, i) => <ProductCard key={p._id} product={p} index={i} />)
          )}
        </div>

        {!loading && failed && (
          <div className="card mx-auto mt-4 max-w-lg p-8 text-center">
            <p className="font-display text-lg font-bold text-text">Our product list is taking a moment</p>
            <p className="mt-1 text-sm text-muted">Please try again, or call us and we will check for you.</p>
            <button onClick={onRetry} className="mt-5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white">Try again</button>
          </div>
        )}
        {!loading && !failed && list.length === 0 && (
          <div className="card mx-auto mt-4 max-w-lg p-8 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <Icon name="search" size={22} />
            </span>
            <p className="mt-3 font-display text-lg font-bold text-text">Not in this list</p>
            <p className="mt-1 text-sm text-muted">We stock far more than we show here. Ask us and we will check or order it for you.</p>
            <button onClick={() => scrollToId("contact")} className="mt-5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white">Contact us</button>
          </div>
        )}

        {!loading && list.length > shown && (
          <div className="mt-10 text-center">
            <button
              onClick={() => setShown((n) => n + PAGE)}
              className="group inline-flex items-center gap-2 rounded-full border border-border bg-white/80 px-6 py-3 text-sm font-semibold text-primary shadow-[var(--shadow-card)] hover:-translate-y-0.5"
            >
              Show more products
              <Icon name="chevronDown" size={16} className="transition-transform group-hover:translate-y-0.5" />
            </button>
          </div>
        )}

        <p className="mt-8 text-center text-xs text-muted">
          Prices shown are MRP per pack. Prescription medicines are dispensed only against a valid prescription.
        </p>
      </div>
    </section>
  );
}

function Categories({ data, loading, onPick }) {
  const cats = data?.categories || [];
  useReveal([cats.length]);
  if (!loading && cats.length === 0) return null;
  return (
    <section id="categories" data-section className="relative py-20 sm:py-24">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-full bg-gradient-to-b from-white/70 via-white/30 to-transparent" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Popular categories" title="Find what you need, faster" text="Browse by category to jump straight to the right shelf." />
        <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="card skeleton h-36" />)
            : cats.slice(0, 12).map((c, i) => (
                <button
                  key={c._id}
                  onClick={() => onPick(c.name)}
                  className="reveal card lift-card group flex flex-col items-center gap-3 px-4 py-6 text-center"
                  style={{ "--d": `${(i % 6) * 60}ms` }}
                >
                  <span className={`icon-pop flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${TONES[i % TONES.length]} ring-1 ring-white shadow-[0_12px_24px_-14px_rgba(11,74,143,0.5)]`}>
                    <Icon name={categoryIcon(c.name)} size={24} />
                  </span>
                  <span className="line-clamp-2 font-display text-sm font-bold text-text group-hover:text-primary">{c.name}</span>
                  <span className="text-xs font-medium text-muted tnum">{c.count} {c.count === 1 ? "product" : "products"}</span>
                </button>
              ))}
        </div>
      </div>
    </section>
  );
}

function BestSellers({ data }) {
  const items = data?.bestSellers || [];
  useReveal([items.length]);
  if (items.length === 0) return null;
  return (
    <section id="best-sellers" data-section className="py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Best sellers" title="What our customers pick up most" text="Our most-requested products over the last three months." />
        <div className="mt-12 grid grid-cols-1 gap-5 min-[480px]:grid-cols-2 lg:grid-cols-4">
          {items.slice(0, 8).map((p, i) => (
            <div key={p._id} className="relative">
              <span className="absolute -left-2 -top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#4ADE9B] to-[#12A06A] font-display text-sm font-extrabold text-white shadow-[0_8px_18px_-8px_rgba(18,160,106,0.9)] ring-2 ring-white">
                {i + 1}
              </span>
              <ProductCard product={p} index={i} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function About() {
  const points = [
    ["shield", "Genuine, licensed supply"],
    ["hourglass", "Expiry-safe stock rotation"],
    ["users", "Friendly, trained team"],
    ["receipt", "Clear GST billing"],
  ];
  return (
    <section id="about" data-section className="relative overflow-hidden py-20 sm:py-24">
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
        <div className="reveal relative order-2 lg:order-1">
          <div className="hero-surface relative overflow-hidden rounded-[32px] p-8 text-white shadow-[var(--shadow-xl)] sm:p-10">
            <div className="login-grid pointer-events-none absolute inset-0 opacity-[0.07]" />
            <div className="blob absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#22B8CF]/30 blur-3xl" />
            <div className="relative">
              <BrandLogo tone="light" size={52} subtitle={BRAND.tagline} />
              <p className="mt-8 font-display text-2xl font-bold leading-snug sm:text-3xl">
                “Every customer leaves with the right medicine and the confidence to use it well.”
              </p>
              <p className="mt-4 text-sm text-white/65">Our promise at {BRAND.name}</p>
              <div className="mt-8 grid grid-cols-2 gap-3">
                {points.map(([icon, label]) => (
                  <div key={label} className="glass-dark flex items-center gap-2.5 rounded-2xl p-3">
                    <Icon name={icon} size={18} className="shrink-0 text-[#9BE7F2]" />
                    <span className="text-sm font-semibold leading-tight">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="glass-panel float-mid absolute -bottom-6 -right-2 hidden items-center gap-3 rounded-2xl px-4 py-3 sm:flex">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary-soft text-secondary">
              <Icon name="heart" size={20} />
            </span>
            <div className="leading-tight">
              <p className="text-xs text-muted">Caring for</p>
              <p className="text-sm font-bold text-text">our neighbourhood</p>
            </div>
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <SectionHeading
            align="left"
            eyebrow={`About ${BRAND.name}`}
            title="A neighbourhood pharmacy you can rely on"
          />
          <div className="reveal mt-5 space-y-4 text-base leading-relaxed text-muted" style={{ "--d": "100ms" }}>
            <p>
              {BRAND.name} brings genuine medicines and everyday healthcare essentials together under one roof, with
              pharmacists who take the time to explain what you are taking and why.
            </p>
            <p>
              Behind the counter, every product is tracked by batch and expiry date, and stock is dispensed first-expiry-first-out.
              So the medicine you take home is always well within date, and the bill you receive is clear, itemised and GST-compliant.
            </p>
          </div>
          <div className="reveal mt-8 flex flex-wrap gap-3" style={{ "--d": "180ms" }}>
            <button onClick={() => scrollToId("products")} className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white">
              Explore products
            </button>
            <button onClick={() => scrollToId("contact")} className="rounded-full border border-border bg-white/80 px-6 py-3 text-sm font-semibold text-primary hover:border-primary/40">
              Get in touch
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function WhyUs() {
  useReveal([]);
  return (
    <section id="why-us" data-section className="relative py-20 sm:py-24">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-white/60 to-transparent" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Why choose us" title="Care you can count on" text="What makes a visit to Gugan Medicals simple, safe and reassuring." />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {WHY.map((w, i) => (
            <div key={w.title} className="reveal card lift-card ring-gradient group rounded-[22px] p-6" style={{ "--d": `${(i % 3) * 90}ms` }}>
              <span className={`icon-pop flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${TONES[i % TONES.length]} ring-1 ring-white`}>
                <Icon name={w.icon} size={22} />
              </span>
              <h3 className="mt-5 font-display text-lg font-bold text-text">{w.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{w.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Testimonials() {
  useReveal([]);
  if (TESTIMONIALS.length === 0) return null;
  return (
    <section id="testimonials" data-section className="py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Testimonials" title="Kind words from our customers" />
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {TESTIMONIALS.map((t, i) => (
            <figure key={i} className="reveal card lift-card flex flex-col rounded-[22px] p-6" style={{ "--d": `${(i % 3) * 90}ms` }}>
              <Icon name="quote" size={28} className="text-cyan" strokeWidth={2} />
              <div className="mt-3 flex gap-0.5 text-[#F5B015]" aria-label="5 out of 5">
                {Array.from({ length: 5 }).map((_, k) => (
                  <svg key={k} width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z" /></svg>
                ))}
              </div>
              <blockquote className="mt-4 flex-1 text-[15px] leading-relaxed text-text">“{t.quote}”</blockquote>
              <figcaption className="mt-6 flex items-center gap-3 border-t border-border pt-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-cyan font-display text-sm font-bold text-white">
                  {t.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                </span>
                <span className="leading-tight">
                  <span className="block text-sm font-bold text-text">{t.name}</span>
                  {t.detail && <span className="block text-xs text-muted">{t.detail}</span>}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function Contact() {
  useReveal([]);
  const address = [CONTACT.addressLine1, CONTACT.addressLine2].filter(Boolean);
  const wa = whatsappHref(`Hello ${BRAND.name}, I have a question.`);
  const rows = [
    CONTACT.phone && { icon: "phone", label: "Call us", value: CONTACT.phone, href: telHref(CONTACT.phone) },
    wa && { icon: "globe", label: "WhatsApp", value: "Message us anytime", href: wa, external: true },
    CONTACT.email && { icon: "mail", label: "Email", value: CONTACT.email, href: `mailto:${CONTACT.email}` },
    address.length > 0 && { icon: "mapPin", label: "Visit us", value: address.join(", "), href: CONTACT.mapUrl || null, external: true },
  ].filter(Boolean);

  return (
    <section id="contact" data-section className="relative py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="reveal hero-surface relative overflow-hidden rounded-[36px] p-6 text-white shadow-[var(--shadow-xl)] sm:p-10 lg:p-14">
          <div className="login-grid pointer-events-none absolute inset-0 opacity-[0.06]" />
          <div className="blob absolute -left-10 -top-10 h-64 w-64 rounded-full bg-[#22B8CF]/25 blur-3xl" />
          <div className="blob blob-b absolute -bottom-16 right-0 h-72 w-72 rounded-full bg-[#12A06A]/25 blur-3xl" />

          <div className="relative grid gap-10 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <p className="glass-dark inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-[#9BE7F2]">
                <Icon name="phone" size={13} /> Contact
              </p>
              <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight sm:text-[40px] sm:leading-[1.1]">
                We are here to help.
              </h2>
              <p className="mt-3 max-w-md text-base leading-relaxed text-white/70">
                Questions about a medicine, need something we do not usually stock, or want a refill kept ready?
                Reach out, or simply drop by the counter.
              </p>
              {rows.length > 0 ? (
                <ul className="mt-8 space-y-3">
                  {rows.map((r) => {
                    const inner = (
                      <>
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
                          <Icon name={r.icon} size={20} />
                        </span>
                        <span className="min-w-0 leading-tight">
                          <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-white/55">{r.label}</span>
                          <span className="mt-0.5 block font-semibold">{r.value}</span>
                        </span>
                      </>
                    );
                    return (
                      <li key={r.label}>
                        {r.href ? (
                          <a
                            href={r.href}
                            {...(r.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                            className="glass-dark flex items-center gap-4 rounded-2xl p-3 hover:-translate-y-0.5 hover:bg-white/20"
                          >
                            {inner}
                          </a>
                        ) : (
                          <div className="glass-dark flex items-center gap-4 rounded-2xl p-3">{inner}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="glass-dark mt-8 flex items-center gap-4 rounded-2xl p-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15">
                    <Icon name="mapPin" size={20} />
                  </span>
                  <p className="text-sm leading-relaxed text-white/80">Visit us at the {BRAND.name} counter. Our team will be happy to help you.</p>
                </div>
              )}
            </div>

            <div className="glass-dark self-start rounded-[28px] p-6 sm:p-8">
              <p className="flex items-center gap-2 font-display text-lg font-bold">
                <Icon name="clock" size={20} className="text-[#9BE7F2]" />
                Opening hours
              </p>
              <ul className="mt-5 divide-y divide-white/10">
                {CONTACT.hours.map((h) => (
                  <li key={h.days} className="flex items-center justify-between gap-4 py-3 text-sm">
                    <span className="text-white/70">{h.days}</span>
                    <span className="font-semibold tnum">{h.time}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 rounded-2xl bg-white/10 p-4 text-sm leading-relaxed text-white/75 ring-1 ring-white/10">
                <p className="flex items-center gap-2 font-semibold text-white">
                  <Icon name="info" size={16} className="text-[#9BE7F2]" /> Bring your prescription
                </p>
                <p className="mt-1">Prescription medicines are dispensed against a valid doctor’s prescription.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer({ isAuthenticated }) {
  const year = new Date().getFullYear();
  return (
    <footer className="relative mt-8 overflow-hidden bg-[#061A3A] text-white">
      <div className="pointer-events-none absolute -top-24 left-1/4 h-64 w-64 rounded-full bg-[#22B8CF]/15 blur-3xl" />
      <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div>
          <BrandLogo tone="light" size={44} />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/60">{BRAND.description}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">Explore</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            {NAV.map((n) => (
              <li key={n.id}>
                <button onClick={() => scrollToId(n.id)} className="text-white/75 hover:translate-x-0.5 hover:text-[#9BE7F2]">
                  {n.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">For our team</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li>
              <Link to={isAuthenticated ? "/" : "/login"} className="inline-flex items-center gap-2 text-white/75 hover:text-[#9BE7F2]">
                <Icon name="lock" size={14} /> {isAuthenticated ? "Open workspace" : "Staff sign in"}
              </Link>
            </li>
            {CONTACT.phone && (
              <li>
                <a href={telHref(CONTACT.phone)} className="inline-flex items-center gap-2 text-white/75 hover:text-[#9BE7F2]">
                  <Icon name="phone" size={14} /> {CONTACT.phone}
                </a>
              </li>
            )}
          </ul>
        </div>
      </div>
      <div className="relative border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-white/50 sm:px-6 lg:px-8">
          <p>© {year} {BRAND.name}. All rights reserved.</p>
          <p>Information on this site is not a substitute for professional medical advice.</p>
        </div>
      </div>
    </footer>
  );
}

/* ───────────────────────── Page ───────────────────────── */

export default function Home() {
  const { isAuthenticated } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");

  useEffect(() => {
    document.title = `${BRAND.name} | Trusted Pharmacy & Healthcare Essentials`;
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    getShowcase()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [attempt]);

  useReveal([]);

  const searchFromHero = (q) => {
    setCategory("");
    setQuery(q);
    scrollToId("products");
  };
  const pickCategory = (name) => {
    setQuery("");
    setCategory(name);
    scrollToId("products");
  };

  return (
    <div className="min-h-screen overflow-x-clip">
      <a href="#products" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-primary">
        Skip to products
      </a>
      <Navbar isAuthenticated={isAuthenticated} />
      <main>
        <Hero data={data} onSearch={searchFromHero} />
        <TrustMarquee />
        <Categories data={data} loading={loading} onPick={pickCategory} />
        <Products
          data={data}
          loading={loading}
          failed={failed}
          query={query}
          setQuery={setQuery}
          category={category}
          setCategory={setCategory}
          onRetry={() => setAttempt((n) => n + 1)}
        />
        <BestSellers data={data} />
        <About />
        <WhyUs />
        <Testimonials />
        <Contact />
      </main>
      <Footer isAuthenticated={isAuthenticated} />
    </div>
  );
}
