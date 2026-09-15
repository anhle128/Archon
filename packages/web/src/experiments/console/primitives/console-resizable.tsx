import type { ReactElement } from 'react';
import {
  Group,
  Panel,
  Separator,
  type GroupProps,
  type PanelProps,
  type SeparatorProps,
} from 'react-resizable-panels';

import type { PanelPercent } from '@/lib/room-split-layout';

type ConsolePanelProps = Omit<PanelProps, 'defaultSize' | 'minSize' | 'maxSize'> & {
  defaultSize?: PanelPercent;
  minSize?: PanelPercent;
  maxSize?: PanelPercent;
};

function ConsolePanelGroup(props: GroupProps): ReactElement {
  return <Group data-slot="console-panel-group" {...props} />;
}

function ConsolePanel(props: ConsolePanelProps): ReactElement {
  return <Panel data-slot="console-panel" {...props} />;
}

function ConsolePanelSeparator(props: SeparatorProps): ReactElement {
  return <Separator data-slot="console-panel-separator" {...props} />;
}

export { ConsolePanel, ConsolePanelGroup, ConsolePanelSeparator };
