'use client';

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import Button from '../ui/Button';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}

/** Overlay with a panel. Closes on Escape or a backdrop click. A bottom sheet on mobile. */
const Modal: React.FC<ModalProps> = ({ title, onClose, children, wide = false }) => {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', handleKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-overlay md:items-center md:p-4xl"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl md:rounded-2xl ${
          wide ? 'md:max-w-modal-wide' : 'md:max-w-modal'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-light-gray px-6xl py-4xl">
          <h2 className="font-serif text-xl font-medium">{title}</h2>
          <Button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-sm text-light-silver hover:bg-smoke-white hover:text-dark-gray"
          >
            <X size={20} />
          </Button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6xl py-4xl">{children}</div>
      </div>
    </div>
  );
};

export default Modal;
