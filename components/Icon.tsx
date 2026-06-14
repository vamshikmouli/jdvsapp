import * as Icons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface IconProps {
  name: keyof typeof Icons;
  className?: string;
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, className = '', size = 24, strokeWidth = 1.5 }: IconProps) {
  const IconComponent = Icons[name] as unknown as LucideIcon | undefined;

  if (!IconComponent) {
    console.warn(`Icon "${name}" not found in lucide-react`);
    return null;
  }

  return (
    <IconComponent
      size={size}
      strokeWidth={strokeWidth}
      className={`inline-block ${className}`}
    />
  );
}
