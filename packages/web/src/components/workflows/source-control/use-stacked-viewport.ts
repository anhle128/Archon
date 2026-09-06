import { useEffect, useState } from 'react';

const STACKED_QUERY = '(max-width: 899px)';

type MatchMedia = (query: string) => Pick<MediaQueryList, 'matches'>;

export function initialStackedViewport(matchMedia: MatchMedia | undefined): boolean {
  return matchMedia?.(STACKED_QUERY).matches ?? false;
}

export function useStackedViewport(): boolean {
  const [stacked, setStacked] = useState(() =>
    initialStackedViewport(
      typeof window === 'undefined' ? undefined : window.matchMedia.bind(window)
    )
  );

  useEffect(() => {
    const media = window.matchMedia(STACKED_QUERY);
    const onChange = (): void => {
      setStacked(media.matches);
    };
    onChange();
    media.addEventListener('change', onChange);
    return (): void => {
      media.removeEventListener('change', onChange);
    };
  }, []);

  return stacked;
}
