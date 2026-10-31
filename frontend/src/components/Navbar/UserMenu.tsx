"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, CreditCard, LogOut } from "lucide-react";
import Button from "../ui/Button";
import { useAuth } from "@/context/AuthContext";
import { useDismiss } from "@/hooks/useDismiss";

/** "Rahul Siddappa" -> "RS", "rahul" -> "R". */
const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

function Avatar({ initials }: { initials: string }) {
  return (
    <span className="flex size-16xl shrink-0 items-center justify-center glass rounded-full font-serif text-base font-medium text-ink">
      {initials}
    </span>
  );
}

/** Avatar with a dropdown on desktop; `inline` lays the same details out flat for the mobile menu. */
export default function UserMenu({ inline = false }: { inline?: boolean }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  const name = user?.first_name || user?.username || "";
  const initials = initialsOf(name);

  const profile = (
    <div className="flex min-w-0 items-center gap-xl">
      <Avatar initials={initials} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{name}</p>
        {user?.email && <p className="truncate text-xs text-medium-gray">{user.email}</p>}
      </div>
    </div>
  );

  const logoutButton = (
    <Button
      onClick={logout}
      className="flex w-full items-center gap-lg rounded-lg px-xl py-lg text-sm text-charcoal-gray hover:bg-smoke-white hover:text-crimson-red"
    >
      <LogOut size={16} /> Log out
    </Button>
  );

  const billingLink = (
    <Link
      href="/billing"
      onClick={close}
      className="flex w-full items-center gap-lg rounded-lg px-xl py-lg text-sm text-charcoal-gray hover:bg-smoke-white hover:text-ink"
    >
      <CreditCard size={16} /> Plans &amp; billing
    </Link>
  );

  if (inline) {
    return (
      <div className="flex w-full flex-col gap-lg">
        {profile}
        <div className="-mx-xl">
          {billingLink}
          {logoutButton}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <Button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-sm rounded-full p-xs text-medium-gray hover:bg-smoke-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-border"
      >
        <Avatar initials={initials} />
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-lg w-64 rounded-2xl border border-light-gray bg-white p-lg shadow-lg"
        >
          <div className="px-xl py-lg">{profile}</div>
          <div className="my-sm border-t border-light-gray" />
          {billingLink}
          {logoutButton}
        </div>
      )}
    </div>
  );
}
