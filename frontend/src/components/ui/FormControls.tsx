'use client';

import React from 'react';

export const inputClasses =
  'block w-full rounded-lg border border-input-border bg-white px-2xl py-lg text-sm shadow-sm placeholder:text-light-silver focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-border disabled:bg-smoke-white';

export const Label: React.FC<React.LabelHTMLAttributes<HTMLLabelElement>> = ({ className = '', ...props }) => (
  <label className={`mb-sm block text-sm font-medium text-charcoal-gray ${className}`} {...props} />
);

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({ className = '', ...props }) => (
  <input className={`${inputClasses} ${className}`} {...props} />
);

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ className = '', ...props }) => (
  <select className={`${inputClasses} ${className}`} {...props} />
);

export const TextArea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({ className = '', ...props }) => (
  <textarea className={`${inputClasses} ${className}`} {...props} />
);

interface FieldProps {
  id: string;
  label: string;
  className?: string;
  children: React.ReactNode;
}

/** A label above a control. */
export const Field: React.FC<FieldProps> = ({ id, label, className = '', children }) => (
  <div className={className}>
    <Label htmlFor={id}>{label}</Label>
    {children}
  </div>
);
