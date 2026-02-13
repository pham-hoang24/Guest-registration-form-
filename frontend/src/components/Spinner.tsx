export interface SpinnerProps {
  /** Accessible label for screen readers */
  "aria-label"?: string;
}

export function Spinner({ "aria-label": ariaLabel = "Loading" }: SpinnerProps) {
  return (
    <div
      className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"
      role="status"
      aria-label={ariaLabel}
    />
  );
}
