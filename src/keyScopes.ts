// Per-view key handlers. A view that owns keys (the course, a review
// session, a deck browser) registers one here instead of adding a window
// listener: the dispatcher in shortcuts.ts runs them in a fixed order after
// the app-wide keys, and the first handler that consumes the key stops it.

import { useEffect, useRef } from "react";

export type KeyScope = "course" | "study" | "browse";

/** True when the handler dealt with the key (and called preventDefault). */
export type ScopeHandler = (e: KeyboardEvent) => boolean;

const handlers: Partial<Record<KeyScope, ScopeHandler>> = {};

/** The live handler of a scope, or undefined when no view registered one. */
export function scopeHandler(scope: KeyScope): ScopeHandler | undefined {
  return handlers[scope];
}

/**
 * Register a view's keys for as long as the view is mounted. The latest
 * handler is always the one the dispatcher reads, so re-renders do not
 * re-register anything.
 */
export function useKeyScope(scope: KeyScope, handler: ScopeHandler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    handlers[scope] = (e) => ref.current(e);
    return () => {
      delete handlers[scope];
    };
  }, [scope]);
}