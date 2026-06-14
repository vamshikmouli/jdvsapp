'use client';

import React from 'react';
import { Icon } from '@/components/Icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: 'primary' | 'secondary' | 'tertiary' | 'danger';
  icon?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function Button({
  kind = 'secondary',
  icon,
  size = 'md',
  children,
  className = '',
  ...props
}: ButtonProps) {
  const kindClasses = {
    primary: 'bg-purple-500 text-white hover:bg-purple-600 active:bg-purple-700',
    secondary: 'bg-white border border-slate-200 text-slate-900 hover:bg-slate-100 active:bg-slate-200',
    tertiary: 'text-slate-700 hover:bg-slate-100 active:bg-slate-200',
    danger: 'bg-danger-500 text-white hover:bg-danger-600 active:bg-danger-700',
  };

  const sizeClasses = {
    sm: 'px-3 py-2 text-sm',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  return (
    <button
      className={`inline-flex items-center gap-2 rounded-md font-medium transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${kindClasses[kind]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {icon && <Icon name={icon as any} size={16} />}
      {children}
    </button>
  );
}
