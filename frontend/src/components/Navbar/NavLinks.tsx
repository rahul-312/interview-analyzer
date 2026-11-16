"use client";

import Link from "next/link";
import { useRouter } from "next/router";
import { navItems } from "@/config/navItems";

/**
 * The sidebar's page links, with an icon each and a bar beside the current page.
 * `compact` shows only the icons, with the label as a tooltip.
 */
export default function NavLinks({ compact = false }: { compact?: boolean }) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-sm">
      {navItems.map(({ href, label, icon: Icon }) => {
        const active = router.pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            aria-label={compact ? label : undefined}
            className={`group relative flex items-center gap-2xl whitespace-nowrap rounded-xl py-xl text-sm font-medium transition-[color,background-color,border-color,padding] duration-300 ease-in-out motion-reduce:transition-none ${
              // 14px centres the icon under the logo in the collapsed rail
              compact ? "px-3xl" : "px-2xl"
            } ${
              active ? "glass text-ink" : "border border-transparent text-dark-gray hover:bg-white/50 hover:text-ink"
            }`}
          >
            {active && <span className="absolute -left-4xl inset-y-lg w-sm rounded-r-full bg-brand" />}
            <Icon size={20} strokeWidth={1.75} className="shrink-0" />
            <span
              className={`transition-[opacity,visibility] duration-300 ease-in-out motion-reduce:transition-none ${
                compact ? "invisible opacity-0" : "opacity-100"
              }`}
            >
              {label}
            </span>
            {/* Shows on hover and keyboard focus, unlike a native title tooltip */}
            {compact && (
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-full z-50 ml-6xl -translate-y-1/2 rounded-lg bg-ink px-lg py-sm text-xs text-white opacity-0 shadow-card transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
              >
                {label}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
