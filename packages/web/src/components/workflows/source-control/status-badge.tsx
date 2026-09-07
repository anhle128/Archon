import type { ReactElement } from 'react';

import type { GitChangedFile } from '@/lib/api';

type GitFileStatus = GitChangedFile['status'];

const STATUS_LABELS: Record<GitFileStatus, string> = {
  M: 'M, modified',
  A: 'A, added',
  D: 'D, deleted',
};

const STATUS_TEXT_COLOR: Record<GitFileStatus, string> = {
  M: 'text-warning',
  A: 'text-success',
  D: 'text-error',
};

export function StatusBadge(props: { status: GitFileStatus }): ReactElement {
  return (
    <span
      aria-label={STATUS_LABELS[props.status]}
      className={`min-w-5 shrink-0 rounded-sm bg-muted px-[5px] py-px text-center text-[0.6875rem] leading-[1.2] font-semibold ${STATUS_TEXT_COLOR[props.status]}`}
    >
      {props.status}
    </span>
  );
}
