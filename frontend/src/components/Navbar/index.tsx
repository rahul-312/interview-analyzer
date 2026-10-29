'use client';
import React from "react";
import Logo from "../Logo";
import NavButton from "./NavButton";
import UserMenu from "./UserMenu";
import HamburgerMenu from "./HamburgerMenu";
import SearchBox from "./SearchBox";
import UsageBadge from "./UsageBadge";

/** Top bar: search, plan badge, "Add application" and the account menu. The logo shows here on mobile. */
const Navbar = () => {
  return (
    <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-x-4xl gap-y-2xl px-4xl py-2xl md:flex-nowrap md:px-12xl md:py-6xl">
      <div className="md:hidden">
        <Logo />
      </div>

      <div className="order-last w-full md:order-none md:max-w-search md:flex-1">
        <SearchBox />
      </div>

      <div className="flex items-center gap-3xl">
        <div className="hidden xl:block">
          <UsageBadge />
        </div>
        <div className="hidden md:block">
          <NavButton />
        </div>
        <div className="hidden md:block">
          <UserMenu />
        </div>
        <HamburgerMenu />
      </div>
    </div>
  );
};

export default Navbar;
