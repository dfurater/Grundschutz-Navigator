import type { Control } from '@/domain/models';
import { ControlDetailSection } from './ControlDetailSection';

export interface ControlStatementProps {
  readonly statement: Control['statement'];
}

export function ControlStatement({ statement }: ControlStatementProps) {
  if (!statement) {
    return null;
  }

  return (
    <ControlDetailSection heading="Anforderung">
      <p className="w-full break-words text-sm text-slate-700 leading-relaxed whitespace-pre-line [hyphens:auto]">
        {statement}
      </p>
    </ControlDetailSection>
  );
}
