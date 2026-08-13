import type { WorkflowDefinition } from '@/lib/api';
import { cn } from '@/lib/utils';
import { serializeWorkflowToYaml } from '@/lib/workflow-yaml';

interface YamlCodeViewProps {
  definition: WorkflowDefinition | null;
  mode: 'split' | 'full';
}

export const serializeToYaml = serializeWorkflowToYaml;

export function YamlCodeView({ definition, mode }: YamlCodeViewProps): React.ReactElement {
  const yamlText = definition ? serializeWorkflowToYaml(definition) : '';

  return (
    <div className="flex h-full flex-col bg-surface-inset">
      {mode === 'full' && (
        <div className="flex items-center border-b border-border px-3 py-2">
          <span className="text-xs text-text-tertiary">Read-only YAML preview</span>
        </div>
      )}
      <pre
        className={cn(
          'flex-1 overflow-auto p-4',
          'font-mono text-xs leading-relaxed text-text-primary',
          'whitespace-pre-wrap break-words'
        )}
      >
        {yamlText || '# No workflow definition'}
      </pre>
    </div>
  );
}
