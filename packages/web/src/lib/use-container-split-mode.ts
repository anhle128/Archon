import { useLayoutEffect, useState, type RefObject } from 'react';

export type ContainerSplitMode = 'split' | 'single';

const DEFAULT_MIN_REM = 60;
const FALLBACK_ROOT_FONT_PX = 16;

function rootFontPx(): number {
  const parsed = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_ROOT_FONT_PX;
}

function modeForWidth(width: number, minRem: number): ContainerSplitMode {
  return width >= minRem * rootFontPx() ? 'split' : 'single';
}

export function useContainerSplitMode(
  ref: RefObject<HTMLElement | null>,
  minRem = DEFAULT_MIN_REM
): ContainerSplitMode {
  const [mode, setMode] = useState<ContainerSplitMode>('split');

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;

    const applyWidth = (width: number): void => {
      setMode(modeForWidth(width, minRem));
    };

    applyWidth(el.getBoundingClientRect().width);

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry === undefined) return;
      applyWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return (): void => {
      observer.disconnect();
    };
  }, [minRem, ref]);

  return mode;
}
