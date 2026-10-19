import type React from 'react';
export const IconButton = ({
  title,
  children,
  onClick,
  active,
  className = '',
  disabled = false,
}: {
  title: string;
  children: React.ReactNode;
  onClick(): void;
  active?: boolean;
  className?: string;
  disabled?: boolean;
}) => (
  <button
    className={`icon-button ${active ? 'active' : ''} ${className}`}
    title={title}
    disabled={disabled}
    aria-label={title}
    onClick={onClick}
  >
    {children}
  </button>
);
