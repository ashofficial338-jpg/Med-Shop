import { useId } from "react";
import { BRAND } from "../config/brand";

// Gugan Medicals mark: a medical cross on a blue-to-cyan tile, with a green
// leaf accent for "fresh healthcare".
export function BrandMark({ size = 44, className = "" }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`gm-bg-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1A6FC4" />
          <stop offset="0.55" stopColor="#0B4A8F" />
          <stop offset="1" stopColor="#0E7FA8" />
        </linearGradient>
        <linearGradient id={`gm-leaf-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4ADE9B" />
          <stop offset="1" stopColor="#12A06A" />
        </linearGradient>
        <linearGradient id={`gm-shine-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="17" fill={`url(#gm-bg-${id})`} />
      <rect width="64" height="64" rx="17" fill={`url(#gm-shine-${id})`} />
      <path
        fill="#fff"
        d="M26.5 13h9a2.5 2.5 0 0 1 2.5 2.5V25h9.5a2.5 2.5 0 0 1 2.5 2.5v9a2.5 2.5 0 0 1-2.5 2.5H38v9.5a2.5 2.5 0 0 1-2.5 2.5h-9a2.5 2.5 0 0 1-2.5-2.5V39h-9.5a2.5 2.5 0 0 1-2.5-2.5v-9a2.5 2.5 0 0 1 2.5-2.5H24v-9.5a2.5 2.5 0 0 1 2.5-2.5z"
      />
      <path fill={`url(#gm-leaf-${id})`} d="M44 44c0-6 4.5-10 11-10 0 6.5-4 11-10 11h-1z" />
    </svg>
  );
}

// Mark + wordmark. `tone="light"` for dark backgrounds.
export default function BrandLogo({ tone = "dark", size = 40, subtitle = "Pharmacy & Wellness", className = "" }) {
  const light = tone === "light";
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <BrandMark size={size} className="shrink-0 drop-shadow-[0_8px_18px_rgba(11,74,143,0.35)]" />
      <span className="min-w-0 leading-tight">
        <span className={`block font-display text-[17px] font-extrabold tracking-tight ${light ? "text-white" : "text-text"}`}>
          {BRAND.short}
          <span className={light ? "text-[#9BE7F2]" : "text-primary"}> Medicals</span>
        </span>
        {subtitle && (
          <span className={`block text-[10.5px] font-semibold uppercase tracking-[0.16em] ${light ? "text-white/60" : "text-muted"}`}>
            {subtitle}
          </span>
        )}
      </span>
    </span>
  );
}
