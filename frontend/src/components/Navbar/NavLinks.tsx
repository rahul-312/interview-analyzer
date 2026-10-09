"use client";

import Link from "next/link";
import { useRouter } from "next/router";
import { navItems } from "@/config/navItems";

export default function NavLinks() {
  const router = useRouter();

  return (
    <div className="flex items-center gap-sm text-sm">
      {navItems.map((item) => {
        const active = router.pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-2xl py-lg font-medium transition-colors ${
              active ? "bg-primary-light text-primary-dark" : "text-medium-gray hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
