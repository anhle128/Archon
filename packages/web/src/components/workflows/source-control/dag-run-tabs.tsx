import { MessageSquare } from 'lucide-react';
import type { ReactElement } from 'react';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type WorkflowRunView = 'graph' | 'logs' | 'chat' | 'source-control' | 'terminal';

export interface DagRunTabsProps {
  activeView: WorkflowRunView;
  parentPlatformId: string | null;
  onValueChange: (view: WorkflowRunView) => void;
}

export function DagRunTabs(props: DagRunTabsProps): ReactElement {
  return (
    <Tabs
      value={props.activeView}
      onValueChange={(value): void => {
        props.onValueChange(value as WorkflowRunView);
      }}
    >
      <TabsList>
        <TabsTrigger value="graph">Graph</TabsTrigger>
        <TabsTrigger value="logs">Logs</TabsTrigger>
        {props.parentPlatformId ? (
          <TabsTrigger value="chat">
            <MessageSquare className="mr-1 h-3 w-3" />
            Chat
          </TabsTrigger>
        ) : null}
        <TabsTrigger value="source-control">Source Control</TabsTrigger>
        <TabsTrigger value="terminal">Terminal</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
