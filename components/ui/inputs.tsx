'use client';

import React from 'react';
import { Icon } from '@/components/Icon';

// ========== Field ==========
interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  full?: boolean;
}

export function Field({ label, hint, error, children, full = false }: FieldProps) {
  return (
    <div className={full ? 'grid-column-full' : ''}>
      {label && <label className="block text-sm font-medium text-slate-900 mb-2">{label}</label>}
      {children}
      {error ? (
        <p className="text-xs text-danger-600 mt-1">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-500 mt-1">{hint}</p>
      ) : null}
    </div>
  );
}

// ========== Input ==========
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: string;
}

export function Input({ icon, className = '', ...props }: InputProps) {
  return (
    <div className="relative">
      {icon && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          <Icon name={icon as any} size={16} />
        </div>
      )}
      <input
        className={`w-full px-3 py-2.5 rounded-md border border-slate-200 text-slate-900 placeholder-slate-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none transition-all ${icon ? 'pl-10' : ''} ${className}`}
        {...props}
      />
    </div>
  );
}

// ========== Select ==========
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  children: React.ReactNode;
}

export function Select({ children, className = '', ...props }: SelectProps) {
  return (
    <select
      className={`w-full px-3 py-2.5 rounded-md border border-slate-200 bg-white text-slate-900 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none transition-all appearance-none cursor-pointer ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}
