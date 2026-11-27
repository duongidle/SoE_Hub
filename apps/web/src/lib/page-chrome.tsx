import * as React from "react";

/**
 * What a page can hand to the shell's top bar: the last breadcrumb (a name the menu does not know, such as a datahub
 * or a form) and its action buttons (rendered into the slot at the right of the bar, before the bell).
 */
export type PageChrome = {
  setLeaf: (name: string | null) => void;
  /** Called with +1 / -1 while a page has actions in the slot (the shell shows the "..." button on a narrow screen). */
  addActions: (delta: number) => void;
  /** The node the actions are portaled into (null until the shell has mounted it). */
  actionsEl: HTMLElement | null;
};

export const PageChromeContext = React.createContext<PageChrome | null>(null);

export const usePageChrome = () => React.useContext(PageChromeContext);

/** Puts the page's own name (datahub, form, plan...) at the end of the breadcrumb instead of printing another title line. */
export function useCrumbs(name: string | null | undefined) {
  const setLeaf = usePageChrome()?.setLeaf;
  React.useEffect(() => {
    if (!setLeaf || !name) return;
    setLeaf(name);
    return () => setLeaf(null);
  }, [setLeaf, name]);
}
