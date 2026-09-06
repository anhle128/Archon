import { useEffect, useState } from 'react';

const STACKED_QUERY = '(max-width: 899px)';

export function useStackedViewport(): boolean {
  const [stacked, setStacked] = useState(false);

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
