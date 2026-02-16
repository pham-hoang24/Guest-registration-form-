import { useState, useRef, useEffect, useMemo } from "react";
import { countries, codeToFlag, getCountryByCode } from "../data/countries";

export interface CountrySelectProps {
  id?: string;
  label: string;
  value: string; // ISO code
  onChange: (code: string) => void;
  error?: string;
}

export function CountrySelect({
  id = "country-select",
  label,
  value,
  onChange,
  error,
}: CountrySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = getCountryByCode(value);
  const displayValue = selected ? `${codeToFlag(selected.code)} ${selected.name}` : "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter((c) => c.name.toLowerCase().includes(q));
  }, [query]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query]);

  useEffect(() => {
    if (open && listRef.current) {
      const el = listRef.current.children[highlightIndex] as HTMLElement;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [open, highlightIndex]);

  const select = (code: string) => {
    onChange(code);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[highlightIndex]) select(filtered[highlightIndex].code);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setQuery("");
        inputRef.current?.blur();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="text-sm font-medium text-gray-700"
      >
        {label}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={`${id}-list`}
          aria-activedescendant={
            open && filtered[highlightIndex]
              ? `${id}-option-${filtered[highlightIndex].code}`
              : undefined
          }
          value={open ? query : displayValue}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder="Type to search..."
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`
            block w-full rounded-lg border px-3 py-2 text-base
            focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
            ${error ? "border-red-500" : "border-gray-300"}
          `}
        />
        {open && filtered.length > 0 && (
          <ul
            ref={listRef}
            id={`${id}-list`}
            role="listbox"
            className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-300 bg-white py-1 shadow-lg"
          >
            {filtered.slice(0, 50).map((c, i) => (
              <li
                key={c.code}
                id={`${id}-option-${c.code}`}
                role="option"
                aria-selected={highlightIndex === i}
                className={`cursor-pointer px-3 py-2 ${
                  highlightIndex === i ? "bg-indigo-50" : ""
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(c.code);
                }}
              >
                <span className="mr-2">{codeToFlag(c.code)}</span>
                {c.name}
              </li>
            ))}
            {filtered.length > 50 && (
              <li className="px-3 py-2 text-sm text-gray-500">
                Keep typing to narrow results...
              </li>
            )}
          </ul>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
