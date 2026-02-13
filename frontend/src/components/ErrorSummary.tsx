export interface ErrorSummaryProps {
  title?: string;
  errors: string[];
  id?: string;
}

export function ErrorSummary({
  title = "Please fix the following:",
  errors,
  id = "error-summary",
}: ErrorSummaryProps) {
  if (errors.length === 0) return null;

  return (
    <div
      id={id}
      role="alert"
      aria-labelledby={`${id}-title`}
      className="rounded-lg border border-red-200 bg-red-50 p-4"
    >
      <h2 id={`${id}-title`} className="text-sm font-semibold text-red-800">
        {title}
      </h2>
      <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-red-700">
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </div>
  );
}
