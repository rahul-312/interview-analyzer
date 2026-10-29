"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { ArrowLeft, Menu } from "lucide-react";
import Button from "../ui/Button";
import NavButton from "./NavButton";
import UserMenu from "./UserMenu";
import UsageBadge from "./UsageBadge";
import { navItems } from "@/config/navItems";

const HamburgerMenu = () => {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  const openMenu = () => setIsOpen(true);
  const closeMenu = () => setIsOpen(false);

  return (
    <div className="flex md:hidden">
      {/* Menu button */}
      {!isOpen && (
        <Button onClick={openMenu} aria-label="Open menu" className="rounded-lg p-lg text-charcoal-gray hover:bg-smoke-white">
          <Menu size={24} />
        </Button>
      )}

      {/* Fullscreen menu */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-page-bg">
          {/* Back button */}
          <div className="border-b border-light-gray px-6xl py-lg">
            <Button
              onClick={closeMenu}
              aria-label="Close menu"
              className="flex w-fit items-center rounded-full border border-primary-border bg-primary-light p-xl text-primary-dark"
            >
              <ArrowLeft size={14} />
            </Button>
          </div>

          {/* Scrollable menu links */}
          <div className="mt-6xl flex flex-1 flex-col gap-3xl overflow-y-auto px-6xl">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={closeMenu}
                className={`flex items-center gap-2xl text-base font-medium ${
                  router.pathname.startsWith(href) ? "text-primary" : "text-ink"
                }`}
              >
                <Icon size={20} strokeWidth={1.75} />
                {label}
              </Link>
            ))}
          </div>

          {/* Bottom section */}
          <div className="flex flex-col items-start gap-4xl border-t border-light-gray px-6xl pt-6xl pb-8xl">
            <UsageBadge />
            <NavButton onClick={closeMenu} />
            <UserMenu inline />
          </div>
        </div>
      )}
    </div>
  );
};

export default HamburgerMenu;
