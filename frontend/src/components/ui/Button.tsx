'use client';

import React from 'react';
import Link from 'next/link';
import { Spinner } from './Feedback';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'link';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: ButtonVariant;
  href?: string;
  target?: string;
  rel?: string;
  /** Shows a spinner and disables the button while its action runs. */
  loading?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-md rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-border disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary: `${base} px-4xl py-xl bg-primary text-white shadow-sm hover:bg-primary-dark`,
  secondary: `${base} px-4xl py-xl border border-input-border bg-white text-charcoal-gray hover:bg-page-bg`,
  danger: `${base} px-4xl py-xl border border-rose-light bg-white text-crimson-red hover:bg-rose-pale`,
  link: 'text-sm font-medium text-primary hover:underline',
};

const Button: React.FC<ButtonProps> = ({
  children,
  className = '',
  variant,
  href,
  target,
  rel,
  type = 'button',
  loading = false,
  disabled,
  ...props
}) => {
  const classes = `cursor-pointer ${variant ? variants[variant] : ''} ${className}`;

  if (href) {
    return (
      <Link
        href={href}
        className={classes}
        target={target}
        rel={rel || (target === '_blank' ? 'noopener noreferrer' : undefined)}
        {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {children}
      </Link>
    );
  }

  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <Spinner />}
      {children}
    </button>
  );
};

export default Button;
