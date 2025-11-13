'use client';

import { useState } from 'react';
import { Menu, X } from 'lucide-react';

interface MobileMenuButtonProps {
  onToggle?: (isOpen: boolean) => void;
}

export function MobileMenuButton({ onToggle }: MobileMenuButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = () => {
    const newState = !isOpen;
    setIsOpen(newState);
    onToggle?.(newState);
  };

  return (
    <button
      className="group md:hidden p-2 rounded-lg hover:bg-accent transition-colors"
      onClick={handleToggle}
      aria-label={isOpen ? "Close navigation menu" : "Open navigation menu"}
      aria-expanded={isOpen}
    >
      {isOpen ? (
        <X className="h-6 w-6 transition-transform" />
      ) : (
        <Menu className="h-6 w-6 transition-transform" />
      )}
    </button>
  );
}
