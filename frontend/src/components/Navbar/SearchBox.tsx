"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Search } from "lucide-react";

const APPLICATIONS = "/applications";

/**
 * Searches applications from anywhere. The query lives in the URL (`/applications?q=…`), which the
 * Applications page reads; typing elsewhere opens that page. Ctrl/⌘ K focuses the box.
 */
export default function SearchBox() {
  const router = useRouter();
  const urlQuery = typeof router.query.q === "string" ? router.query.q : "";
  const [value, setValue] = useState(urlQuery);
  const [mac, setMac] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /** The last query we put in the URL. */
  const sent = useRef(urlQuery);
  /** True while our jump from another page to Applications is loading. */
  const jumping = useRef(false);
  const lastPath = useRef(router.pathname);

  // Follow the URL when it changes on its own (back button, a link), not by our typing.
  // Going to another page drops whatever was typed but not yet searched.
  useEffect(() => {
    const moved = lastPath.current !== router.pathname;
    const arrived = jumping.current && router.pathname === APPLICATIONS;
    lastPath.current = router.pathname;
    if (moved) jumping.current = false;
    if ((moved && !arrived) || urlQuery !== sent.current) setValue(urlQuery);
    sent.current = urlQuery;
  }, [router.pathname, urlQuery]);

  // Debounce so we don't hit the API on every keystroke. While the jump to Applications loads,
  // wait: once there, this runs again and catches up with anything typed meanwhile.
  useEffect(() => {
    const q = value.trim();
    if (q === urlQuery || jumping.current) return;
    const onApplications = router.pathname === APPLICATIONS;
    if (!q && !onApplications) return;
    const timer = setTimeout(() => {
      sent.current = q;
      const url = q ? `${APPLICATIONS}?q=${encodeURIComponent(q)}` : APPLICATIONS;
      if (onApplications) {
        router.replace(url, undefined, { shallow: true });
      } else {
        jumping.current = true;
        router.push(url).then((ok) => {
          if (!ok) jumping.current = false;
        });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [value, urlQuery, router]);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <label className="flex w-full items-center gap-xl glass rounded-2xl px-4xl py-xl focus-within:ring-2 focus-within:ring-primary-border">
      <Search size={18} className="shrink-0 text-medium-gray" />
      <input
        ref={inputRef}
        type="search"
        aria-label="Search applications"
        placeholder="Search company or role…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Leave the box without the browser also clearing the search
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.currentTarget.blur();
        }}
        className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-light-silver focus:outline-none"
      />
      <kbd className="hidden shrink-0 rounded-md bg-white/70 px-md py-xs font-sans text-xs text-medium-gray md:inline">
        {mac ? "⌘ K" : "Ctrl K"}
      </kbd>
    </label>
  );
}
