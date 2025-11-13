/**
 * React 19 Compatibility Type Declarations
 *
 * This file provides type compatibility fixes for React 19 with Radix UI components
 * that are still typed for React 18. This allows the application to use React 19
 * while maintaining compatibility with third-party component libraries.
 *
 * Issue: React 19's ReactNode type changed - ReactPortal now requires 'children' property
 * Solution: Augment module declarations to make components compatible
 */

/// <reference types="react" />
/// <reference types="react-dom" />

declare module 'react' {
  // Make React.Component compatible with React 19
  interface Component<P = {}, S = {}, SS = any> {
    refs: {
      [key: string]: ReactInstance;
    };
  }

  // Extend ReactNode to be more permissive with React 18 types
  type CompatReactNode = ReactNode | import('@types/react').ReactNode;
}

// Global JSX namespace augmentation for React 19 compatibility
declare global {
  namespace JSX {
    interface IntrinsicElements {
      style: React.DetailedHTMLProps<
        React.StyleHTMLAttributes<HTMLStyleElement> & {
          jsx?: boolean;
          global?: boolean;
        },
        HTMLStyleElement
      >;
    }
  }
}

export {};
