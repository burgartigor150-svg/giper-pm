'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Global keyboard shortcuts (Linear-style):
 *   c        — quick-add task popup (dispatches `giper:quick-add-task`)
 *   t        — toggle the active timer (dispatches `giper:toggle-timer`)
 *   /        — focus the ⌘K palette via custom event
 *   g d/m/p/t/c/r/s — go to dashboard / me / projects / time / team / reports / settings
 *
 * G-prefix: pressing `g` arms a one-shot listener with a 1.2s window. The
 * second key picks the destination. Releases on any timeout or navigation.
 *
 * Suppression: shortcuts are ignored while the user is typing in an input,
 * textarea, contenteditable, or any element marked `data-no-shortcuts`.
 * That keeps inline-edit and forms safe — if the user is composing text,
 * `c` should land in the textarea, not open the quick-add dialog.
 */
export function KeyboardShortcuts() {
  const router = useRouter();
  const gMode = useRef<number | null>(null);

  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (t.isContentEditable) return true;
      if (t.closest('[data-no-shortcuts]')) return true;
      return false;
    }

    function clearG() {
      if (gMode.current !== null) {
        window.clearTimeout(gMode.current);
        gMode.current = null;
      }
    }

    function onKey(e: KeyboardEvent) {
      // Never swallow modified keys other than what we explicitly handle —
      // ⌘K is owned by CommandPalette; everything else with a modifier
      // belongs to the browser or OS.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      // G-prefix mode: second key after `g` picks the destination.
      if (gMode.current !== null) {
        const key = e.key.toLowerCase();
        const map: Record<string, string> = {
          d: '/dashboard',
          m: '/me',
          p: '/projects',
          t: '/time',
          c: '/team',
          r: '/reports',
          s: '/settings',
        };
        clearG();
        if (map[key]) {
          e.preventDefault();
          router.push(map[key]);
        }
        return;
      }

      const k = e.key.toLowerCase();
      switch (k) {
        case 'g':
          // Arm the prefix; keep listening for ~1.2s for the second key.
          e.preventDefault();
          gMode.current = window.setTimeout(clearG, 1200);
          break;
        case 'c':
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('giper:quick-add-task'));
          break;
        case 't':
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('giper:toggle-timer'));
          break;
        case '/':
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('giper:open-palette'));
          break;
      }
    }

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearG();
    };
  }, [router]);

  return null;
}
