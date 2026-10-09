'use client';
import React from "react";
import Logo from "../Logo";
import NavLinks from "./NavLinks";
import NavButton from "./NavButton";
import UserMenu from "./UserMenu";
import HamburgerMenu from "./HamburgerMenu";
import UsageBadge from "./UsageBadge";

const Navbar = () => {
  return (
    <nav className="mx-auto flex max-w-content items-center justify-between gap-4xl px-4xl py-2xl">
      <div className="flex items-center">
        <Logo />
      </div>

      <div className="hidden flex-1 justify-center md:flex">
        <NavLinks />
      </div>

      <div className="flex items-center gap-3xl">
        <div className="hidden xl:block">
          <UsageBadge />
        </div>
        <div className="hidden md:block">
          <NavButton />
        </div>
        <div className="hidden lg:block">
          <UserMenu />
        </div>
        <HamburgerMenu />
      </div>
    </nav>
  );
};

export default Navbar;
