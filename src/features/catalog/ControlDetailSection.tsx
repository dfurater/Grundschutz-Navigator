interface ControlDetailSectionProps {
  heading: string;
  children: React.ReactNode;
}

export function ControlDetailSection({ heading, children }: ControlDetailSectionProps) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-800 mb-2">
        {heading}
      </h3>
      {children}
    </section>
  );
}
