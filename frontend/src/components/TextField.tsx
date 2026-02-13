import type { InputHTMLAttributes } from "react";

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  label: string;
  error?: string;
  helpText?: string;
  id?: string;
}

export function TextField({
  label,
  error,
  helpText,
  id: idProp,
  ...props
}: TextFieldProps) {
  const id = idProp ?? `field-${label.toLowerCase().replace(/\s/g, "-")}`;
  const errorId = `${id}-error`;
  const helpId = helpText ? `${id}-help` : undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={
          [error ? errorId : undefined, helpId].filter(Boolean).join(" ") ||
          undefined
        }
        aria-errormessage={error ? errorId : undefined}
        className={`
          rounded-lg border px-3 py-2 text-base
          focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
          disabled:bg-gray-100 disabled:cursor-not-allowed
          ${error ? "border-red-500" : "border-gray-300"}
        `}
        {...props}
      />
      {error && (
        <p id={errorId} className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {helpText && !error && (
        <p id={helpId} className="text-sm text-gray-500">
          {helpText}
        </p>
      )}
    </div>
  );
}
