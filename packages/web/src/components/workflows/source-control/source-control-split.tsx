import type { ReactElement, ReactNode } from 'react';

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

export function SourceControlSplit(props: {
  stacked: boolean;
  list: ReactNode;
  viewer: ReactNode;
}): ReactElement {
  return (
    <ResizablePanelGroup
      orientation={props.stacked ? 'vertical' : 'horizontal'}
      className="h-full min-h-0 min-w-0"
    >
      <ResizablePanel id="source-control-list" defaultSize="30%" minSize="20%" maxSize="70%">
        {props.list}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id="source-control-viewer" defaultSize="70%" minSize="30%" maxSize="80%">
        {props.viewer}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
