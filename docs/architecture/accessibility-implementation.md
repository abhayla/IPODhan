# Accessibility Implementation

## WCAG AA Compliance Strategy

**Target:** WCAG 2.1 Level AA compliance for all user-facing interfaces

### Semantic HTML and ARIA Implementation

```typescript
// components/common/ScoreDisplay/ScoreDisplay.tsx
import React from 'react';

interface ScoreDisplayProps {
  score: number;
  size?: 'small' | 'medium' | 'large';
  showLabel?: boolean;
}

export const ScoreDisplay: React.FC<ScoreDisplayProps> = ({
  score,
  size = 'medium',
  showLabel = true,
}) => {
  const getScoreCategory = (score: number) => {
    if (score >= 70) return { label: 'Strong Buy', color: 'green' };
    if (score >= 40) return { label: 'Consider', color: 'yellow' };
    return { label: 'Avoid', color: 'red' };
  };

  const { label, color } = getScoreCategory(score);

  return (
    <div
      role="meter"
      aria-valuenow={score}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`IPODhan Score: ${score} out of 100 - ${label}`}
      aria-describedby={showLabel ? `score-desc-${score}` : undefined}
      className={`score-display score-${size} score-${color}`}
    >
      <span className="score-value" aria-hidden="true">
        {score}
      </span>
      {showLabel && (
        <span id={`score-desc-${score}`} className="sr-only">
          This IPO has a score of {score} out of 100, which indicates a {label} recommendation
        </span>
      )}
    </div>
  );
};
```

### Keyboard Navigation Patterns

```typescript
// hooks/useKeyboardNavigation.ts
import { useEffect, useCallback } from 'react';

export const useKeyboardNavigation = () => {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Skip if user is typing in an input
    if (event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement) {
      return;
    }

    switch (event.key) {
      case '/':
        // Focus search
        event.preventDefault();
        document.getElementById('search-input')?.focus();
        break;

      case 'Escape':
        // Close modals or clear focus
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        break;

      case 'Tab':
        // Ensure focus indicators are visible
        document.body.classList.add('keyboard-nav');
        break;

      case '?':
        // Show keyboard shortcuts help
        if (event.shiftKey) {
          event.preventDefault();
          showKeyboardHelp();
        }
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);

    // Remove keyboard nav indicator on mouse use
    window.addEventListener('mousedown', () => {
      document.body.classList.remove('keyboard-nav');
    });

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
};

// components/layout/SkipLinks.tsx
export const SkipLinks: React.FC = () => {
  return (
    <div className="skip-links">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <a href="#primary-nav" className="skip-link">
        Skip to navigation
      </a>
      <a href="#ipo-list" className="skip-link">
        Skip to IPO listings
      </a>
    </div>
  );
};
```

### Focus Management

```typescript
// utils/focusManager.ts
export class FocusManager {
  private focusTrap: HTMLElement | null = null;
  private previousFocus: HTMLElement | null = null;

  trapFocus(container: HTMLElement) {
    this.previousFocus = document.activeElement as HTMLElement;
    this.focusTrap = container;

    const focusableElements = container.querySelectorAll(
      'a[href], button, textarea, input[type="text"], input[type="radio"], input[type="checkbox"], select, [tabindex]:not([tabindex="-1"])'
    );

    const firstFocusable = focusableElements[0] as HTMLElement;
    const lastFocusable = focusableElements[focusableElements.length - 1] as HTMLElement;

    container.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === firstFocusable) {
            e.preventDefault();
            lastFocusable.focus();
          }
        } else {
          if (document.activeElement === lastFocusable) {
            e.preventDefault();
            firstFocusable.focus();
          }
        }
      }
    });

    firstFocusable?.focus();
  }

  releaseFocus() {
    if (this.previousFocus) {
      this.previousFocus.focus();
    }
    this.focusTrap = null;
    this.previousFocus = null;
  }
}

// components/common/Modal.tsx
export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, children, title }) => {
  const focusManager = useRef(new FocusManager());

  useEffect(() => {
    if (isOpen) {
      const modal = document.getElementById('modal-content');
      if (modal) {
        focusManager.current.trapFocus(modal);
      }
    } else {
      focusManager.current.releaseFocus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="modal-overlay"
    >
      <div id="modal-content" className="modal-content">
        <h2 id="modal-title">{title}</h2>
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="modal-close"
        >
          ×
        </button>
        {children}
      </div>
    </div>
  );
};
```

### Screen Reader Optimization

```typescript
// components/common/LiveRegion.tsx
export const LiveRegion: React.FC<{ message: string; priority?: 'polite' | 'assertive' }> = ({
  message,
  priority = 'polite'
}) => {
  return (
    <div
      role="status"
      aria-live={priority}
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  );
};

// Usage in IPO updates
export const IPOSubscriptionStatus: React.FC<{ ipo: IPO }> = ({ ipo }) => {
  const [status, setStatus] = useState(ipo.subscriptionStatus);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const ws = subscribeToIPOUpdates(ipo.id);

    ws.on('subscription-update', (newStatus) => {
      setStatus(newStatus);
      setAnnouncement(
        `${ipo.companyName} subscription updated: ${newStatus.retail}x in retail category`
      );
    });

    return () => ws.close();
  }, [ipo]);

  return (
    <>
      <LiveRegion message={announcement} priority="polite" />
      <div className="subscription-status">
        {/* Visual subscription display */}
      </div>
    </>
  );
};
```

### Color Contrast and Visual Indicators

```css
/* styles/accessibility.css */

/* Ensure WCAG AA contrast ratios */
:root {
  --color-text-primary: #111827; /* 17.5:1 on white */
  --color-text-secondary: #4B5563; /* 7.5:1 on white */
  --color-success: #059669; /* 4.5:1 on white */
  --color-warning: #D97706; /* 4.5:1 on white */
  --color-error: #DC2626; /* 4.5:1 on white */
}

/* Focus indicators */
*:focus {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

/* Keyboard navigation mode */
body.keyboard-nav *:focus {
  outline: 3px solid var(--color-primary);
  outline-offset: 4px;
}

/* Skip links */
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: var(--color-primary);
  color: white;
  padding: 8px;
  text-decoration: none;
  z-index: 100;
}

.skip-link:focus {
  top: 0;
}

/* Screen reader only content */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Ensure interactive elements have minimum size */
button,
a,
input,
select,
textarea {
  min-height: 44px;
  min-width: 44px;
}
```

## Accessibility Testing Tools and Process

### Automated Testing

```typescript
// tests/accessibility/a11y.test.ts
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

describe('Accessibility Tests', () => {
  it('IPOCard should have no accessibility violations', async () => {
    const { container } = render(<IPOCard ipo={mockIPO} score={mockScore} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('ScoreDisplay should have proper ARIA attributes', () => {
    const { getByRole } = render(<ScoreDisplay score={75} />);
    const meter = getByRole('meter');

    expect(meter).toHaveAttribute('aria-valuenow', '75');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-label', expect.stringContaining('75'));
  });
});
```

### Manual Testing Checklist

```markdown
# Accessibility Testing Checklist

## Keyboard Navigation
- [ ] All interactive elements reachable via Tab key
- [ ] Tab order follows logical reading order
- [ ] Focus indicators clearly visible
- [ ] Escape key closes modals/dropdowns
- [ ] Enter/Space activate buttons
- [ ] Arrow keys navigate menus and lists

## Screen Reader Testing (NVDA/JAWS/VoiceOver)
- [ ] All images have appropriate alt text
- [ ] Form fields have associated labels
- [ ] Error messages announced when they appear
- [ ] Dynamic content updates announced
- [ ] Page structure communicated through headings
- [ ] Tables have proper headers and captions

## Visual Testing
- [ ] Text has 4.5:1 contrast ratio (normal text)
- [ ] Text has 3:1 contrast ratio (large text)
- [ ] UI usable at 200% zoom
- [ ] No information conveyed by color alone
- [ ] Focus indicators visible in all color modes

## Cognitive Accessibility
- [ ] Clear, consistent navigation
- [ ] Plain language used
- [ ] Error messages provide guidance
- [ ] No time limits without warning
- [ ] Predictable UI behavior
```

### Continuous Monitoring

```yaml
# .github/workflows/accessibility.yml
name: Accessibility Testing

on: [push, pull_request]

jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: pnpm install

      - name: Run accessibility tests
        run: pnpm test:a11y

      - name: Run Pa11y CI
        run: pnpm pa11y-ci

      - name: Lighthouse CI
        uses: treosh/lighthouse-ci-action@v10
        with:
          urls: |
            http://localhost:3000
            http://localhost:3000/ipo/sample
          uploadArtifacts: true
```
