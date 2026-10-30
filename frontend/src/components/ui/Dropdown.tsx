'use client';

import React, { useCallback, useId, useRef, useState } from 'react';
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
}

const defaultButton = 'glass rounded-xl px-2xl py-xl text-charcoal-gray hover:bg-white/70';

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
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  // -1 when value isn't one of the options, so nothing is shown as chosen
  const selected = options.findIndex((o) => o.value === value);

  const show = (at = Math.max(selected, 0)) => {
    if (!options.length) return;
    setActive(at);
    setOpen(true);
  };

  const choose = (i: number) => {
    onChange(options[i].value);
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
    if (moves[e.key]) {
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
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        className={`flex w-full cursor-pointer items-center gap-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-border ${buttonClassName}`}
      >
        {icon && <span className="flex shrink-0">{icon}</span>}
        {/* Every label sits in the same cell, so the button is as wide as the longest and doesn't resize */}
        <span className="grid flex-1 text-left whitespace-nowrap">
          {options.map((o, i) => (
            <span key={o.value} aria-hidden={i !== selected} className={`col-start-1 row-start-1 ${i === selected ? '' : 'invisible'}`}>
              {o.label}
            </span>
          ))}
        </span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Stays in the DOM while closed so aria-controls always points at it */}
      <ul
        id={`${id}-list`}
        role="listbox"
        aria-label={label}
        hidden={!open}
        className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} top-full z-20 mt-sm min-w-full rounded-xl border border-light-gray bg-white p-sm shadow-lg`}
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
              className={`flex cursor-pointer items-center justify-between gap-2xl whitespace-nowrap rounded-lg px-xl py-lg text-sm ${
                i === active ? 'bg-smoke-white' : ''
              } ${isSelected ? 'font-medium text-ink' : 'text-charcoal-gray'}`}
            >
              <span className="flex items-center gap-lg">
                {optionIcon?.(o.value)}
                {o.label}
              </span>
              {isSelected && <Check size={16} className="text-primary" />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default Dropdown;
