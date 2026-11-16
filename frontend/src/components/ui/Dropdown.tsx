'use client';

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { useDismiss } from '@/hooks/useDismiss';
import type { Option } from '@/models/Common';

interface DropdownProps<T extends string> {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  /** Read out by screen readers along with the chosen option. */
  label: string;
  /** Shown before the chosen option's label, e.g. an icon. */
  icon?: React.ReactNode;
  /** Shown before each option in the menu. */
  optionIcon?: (value: T) => React.ReactNode;
  /** Replaces the button's default glass look. */
  buttonClassName?: string;
  /** Which edge of the button the menu lines up with. */
  align?: 'left' | 'right';
  className?: string;
  /** The button's id, so a <label htmlFor> can point at it. */
  id?: string;
  /** Shown when the value isn't one of the options. */
  placeholder?: string;
  required?: boolean;
  /** Fills its container like a form field: the menu matches the button's width and long labels wrap. */
  stretch?: boolean;
}

/** The tallest the menu gets before it scrolls, and the gap kept from the button and the window edges. */
const MENU_MAX = 256;
const GAP = 4;
const EDGE = 8;

type MenuPosition = React.CSSProperties;

/**
 * Where the menu goes: fixed to the window so a scrolling parent (like a dialog body) can't clip it.
 * Opens below the button, or above when there's more room there and it wouldn't fit below.
 */
function placeMenu(button: HTMLElement, menu: HTMLElement, stretch: boolean, align: 'left' | 'right'): MenuPosition {
  const r = button.getBoundingClientRect();
  const want = Math.min(menu.scrollHeight, MENU_MAX);
  const below = window.innerHeight - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  const up = below < want && above > below;
  const pos: MenuPosition = {
    maxHeight: Math.min(MENU_MAX, up ? above : below),
    ...(up ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
  };
  if (stretch) return { ...pos, left: r.left, width: r.width };
  if (align === 'left') return { ...pos, left: r.left, minWidth: r.width };
  return { ...pos, right: window.innerWidth - r.right, minWidth: r.width };
}

const defaultButton = 'glass rounded-xl px-2xl py-xl font-medium text-charcoal-gray hover:bg-white/70';

/** The button look for a dropdown inside a form, matching the text inputs. */
export const fieldButton =
  'rounded-xl border border-input-border bg-white px-2xl py-lg text-ink shadow-sm hover:border-primary-border focus:border-primary focus:ring-2 focus:ring-primary-border aria-expanded:border-primary aria-expanded:ring-2 aria-expanded:ring-primary-border';

/** A select with our own menu instead of the browser's. Arrow keys, Home/End, typing a letter, Enter and Escape work like a native one. */
function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  icon,
  optionIcon,
  buttonClassName = defaultButton,
  align = 'right',
  className = '',
  id: buttonId,
  placeholder,
  required,
  stretch = false,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<MenuPosition>({});
  // The menu is portalled to <body>, which only exists in the browser
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss([ref, menuRef], open, close);

  useEffect(() => setMounted(true), []);

  // Placed before paint, and kept next to the button as the page or a parent scrolls or the window resizes
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (buttonRef.current && menuRef.current)
        setPosition(placeMenu(buttonRef.current, menuRef.current, stretch, align));
    };
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) place();
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, stretch, align]);

  // -1 when value isn't one of the options, so nothing is shown as chosen
  const selected = options.findIndex((o) => o.value === value);

  // Keep the highlighted option in view when the list scrolls
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, id]);

  const show = (at = Math.max(selected, 0)) => {
    if (!options.length) return;
    setActive(at);
    setOpen(true);
  };

  // Like a native select, picking the option that's already chosen only closes the menu
  const choose = (i: number) => {
    if (i !== selected) onChange(options[i].value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  // The next option after the current one that starts with this letter, wrapping around
  const matchLetter = (key: string, from: number) => {
    for (let step = 1; step <= options.length; step++) {
      const i = (from + step) % options.length;
      if (options[i].label.toLowerCase().startsWith(key.toLowerCase())) return i;
    }
    return -1;
  };

  // Focus stays on the button; the highlighted option is announced through aria-activedescendant
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!options.length) return;
    if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const i = matchLetter(e.key, open ? active : Math.max(selected, 0));
      if (i < 0) return;
      if (open) setActive(i);
      else show(i);
      return;
    }
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    const last = options.length - 1;
    const moves: Record<string, () => number> = {
      ArrowDown: () => Math.min(active + 1, last),
      ArrowUp: () => Math.max(active - 1, 0),
      Home: () => 0,
      End: () => last,
    };
    if (e.key === 'Escape') {
      // Handled here so it closes only the menu, not a dialog the dropdown sits in
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (moves[e.key]) {
      e.preventDefault();
      setActive(moves[e.key]());
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Tab') {
      close();
    }
  };

  // A button clicks on Space key-up, and Firefox does so even when key-down was cancelled
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === ' ') e.preventDefault();
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        role="combobox"
        aria-label={label}
        aria-required={required || undefined}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        className={`flex w-full cursor-pointer items-center gap-lg text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-border ${buttonClassName}`}
      >
        {icon && <span className="flex shrink-0">{icon}</span>}
        {/* Every label sits in the same cell, so the button is as wide as the longest and doesn't resize */}
        <span className="grid min-w-0 flex-1 text-left whitespace-nowrap">
          {placeholder && (
            <span
              aria-hidden={selected >= 0}
              className={`col-start-1 row-start-1 truncate text-light-silver ${selected < 0 ? '' : 'invisible'}`}
            >
              {placeholder}
            </span>
          )}
          {options.map((o, i) => (
            <span
              key={o.value}
              aria-hidden={i !== selected}
              className={`col-start-1 row-start-1 truncate ${i === selected ? '' : 'invisible'}`}
            >
              {o.label}
            </span>
          ))}
        </span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Stays in the DOM while closed so aria-controls always points at it. Portalled so a dialog can't clip it. */}
      {mounted &&
        createPortal(
          <ul
            ref={menuRef}
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            hidden={!open}
            style={position}
            className="fixed z-60 overflow-y-auto overscroll-contain rounded-xl border border-light-gray bg-white p-sm shadow-lg [scrollbar-width:thin]"
          >
            {options.map((o, i) => {
              const isSelected = i === selected;
              return (
                <li
                  key={o.value}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActive(i)}
                  // Keep focus on the button so the menu doesn't count it as a click outside
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(i)}
                  className={`flex cursor-pointer items-center justify-between gap-2xl rounded-lg ${stretch ? '' : 'whitespace-nowrap'} px-xl py-lg text-sm ${
                    i === active ? 'bg-smoke-white' : ''
                  } ${isSelected ? 'font-medium text-ink' : 'text-charcoal-gray'}`}
                >
                  <span className="flex items-center gap-lg">
                    {optionIcon?.(o.value)}
                    {o.label}
                  </span>
                  {isSelected && <Check size={16} className="shrink-0 text-primary" />}
                </li>
              );
            })}
          </ul>,
          document.body
        )}
    </div>
  );
}

export default Dropdown;
