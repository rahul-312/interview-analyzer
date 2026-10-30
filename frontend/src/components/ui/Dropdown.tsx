'use client';

import React, { useCallback, useId, useRef, useState } from 'react';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import { useDismiss } from '@/hooks/useDismiss';
import type { Option } from '@/models/Common';

interface DropdownProps<T extends string> {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  /** Read out by screen readers along with the chosen option. */
  label: string;
  icon?: LucideIcon;
  className?: string;
}

/** A select with our own menu instead of the browser's. Arrow keys, Home/End, Enter and Escape work like a native one. */
function Dropdown<T extends string>({ value, options, onChange, label, icon: Icon, className = '' }: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );

  const show = () => {
    setActive(selected);
    setOpen(true);
  };

  const choose = (i: number) => {
    onChange(options[i].value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  // Focus stays on the button; the highlighted option is announced through aria-activedescendant
  const onKeyDown = (e: React.KeyboardEvent) => {
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
        className="glass flex w-full cursor-pointer items-center gap-lg rounded-xl px-2xl py-xl text-sm font-medium text-charcoal-gray transition-colors hover:bg-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-border"
      >
        {Icon && <Icon size={16} className="shrink-0" />}
        <span className="flex-1 text-left whitespace-nowrap">{options[selected]?.label}</span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className="absolute right-0 top-full z-20 mt-sm min-w-full rounded-xl border border-light-gray bg-white p-sm shadow-lg"
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
                {o.label}
                {isSelected && <Check size={16} className="text-primary" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default Dropdown;
