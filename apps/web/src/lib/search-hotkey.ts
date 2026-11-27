import { useEffect } from "react";

/** True when a key press here is meant for typing, not for a shortcut. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
  return el.closest('[role="textbox"],[role="combobox"],[role="searchbox"]') !== null;
}

/** Put on the main search box of a page: `<Input {...searchHotkeyProps} />`. Esc leaves the box. */
export const searchHotkeyProps = {
  "data-page-search": "",
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") e.currentTarget.blur();
  },
} as const;

/** Mounted once, in the Shell: the key "/" jumps to the page's search box (the one marked with `searchHotkeyProps`). */
export function useSearchHotkey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.defaultPrevented) return;
      // Typing somewhere (an input, a cell being edited in the grid), or a dialog is open: leave the key alone.
      if (isTypingTarget(e.target) || document.querySelector('[role="dialog"],[role="alertdialog"]')) return;
      const box = Array.from(document.querySelectorAll<HTMLInputElement>("[data-page-search]")).find((b) => b.offsetParent !== null && !b.disabled);
      if (!box) return;
      e.preventDefault();
      e.stopPropagation(); // the grid would otherwise start editing the selected cell with "/"
      box.focus();
      box.select();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
}
