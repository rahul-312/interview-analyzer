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
            title={compact ? label : undefined}
            className={`relative flex items-center gap-2xl whitespace-nowrap rounded-xl px-2xl py-xl text-sm font-medium transition-colors ${
              active ? "glass text-ink" : "border border-transparent text-dark-gray hover:bg-white/50 hover:text-ink"
            }`}
          >
            {active && <span className="absolute -left-4xl inset-y-lg w-sm rounded-r-full bg-primary" />}
            <Icon size={20} strokeWidth={1.75} className="shrink-0" />
            <span
              className={`transition-[opacity,visibility] duration-300 ease-in-out ${
                compact ? "invisible opacity-0" : "opacity-100"
              }`}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
