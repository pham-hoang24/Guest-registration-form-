import type { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: "primary" | "secondary";
}

export function Button({
  children,
  loading = false,
  disabled,
  variant = "primary",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      type={props.type ?? "button"}
      disabled={disabled ?? loading}
      className={`
        inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3
        text-base font-medium transition-colors
        disabled:opacity-60 disabled:cursor-not-allowed
        focus:outline-none focus:ring-2 focus:ring-offset-2
        ${
          variant === "primary"
            ? "bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500"
            : "bg-gray-200 text-gray-900 hover:bg-gray-300 focus:ring-gray-500"
        }
        ${className}
      `}
      {...props}
    >
      {loading && (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}
