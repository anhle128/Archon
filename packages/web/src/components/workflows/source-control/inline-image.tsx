import { useEffect, useState, type ReactElement } from 'react';

export function InlineImage(props: { bytes: Uint8Array; mediaType: string }): ReactElement {
  const [objectUrl, setObjectUrl] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(
      new Blob([props.bytes.slice().buffer], { type: props.mediaType })
    );
    setObjectUrl(url);
    return (): void => {
      URL.revokeObjectURL(url);
    };
  }, [props.bytes, props.mediaType]);
  return objectUrl ? <img alt="" src={objectUrl} /> : <div role="status" />;
}
