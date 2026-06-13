/**
 * useFocusTrap — accessibility focus management for modal dialogs.
 *
 * On mount:
 *   1. Saves the previously focused element so it can be restored on close.
 *   2. Moves focus to the first focusable descendant of `ref`.
 *
 * While mounted:
 *   3. Intercepts Tab / Shift+Tab so focus cycles within the container
 *      instead of escaping into the page behind the modal overlay.
 *
 * On unmount:
 *   4. Returns focus to the element that was active before the modal opened.
 *
 * The focusable query is re-run on each keydown so it stays correct when
 * modal content changes dynamically (e.g. switching tabs in SignatureModal).
 */
import { useEffect, type RefObject } from "react";

/** CSS selector that matches every interactive / focusable element. */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function useFocusTrap(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    // Remember who had focus so we can restore it when the modal closes.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the modal on the next paint (the DOM must be visible
    // before browsers will accept programmatic focus).
    const raf = requestAnimationFrame(() => {
      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      focusable[0]?.focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      // Re-query so dynamic content (hidden tabs, newly rendered elements)
      // is always included in the cycle.
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if we're on the first element, wrap to the last.
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if we're on the last element, wrap to the first.
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [ref]);
}
