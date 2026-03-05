import { useState, useEffect, useCallback } from "react";
import { Button, TextField, ErrorSummary, CountrySelect } from "../components";
import { apiFetch, ApiError } from "../api/client";
import { toUserMessage } from "../api/errors";
import type { RegistrationResponse } from "../api/contracts";
import {
  defaultFormState,
  formToPayload,
  formToValidationInput,
  zodErrorsToFieldErrors,
  RegistrationPayloadV1Schema,
  type FormState,
  type FieldErrors,
} from "../schemas/registration";
import { getTokenFromUrl } from "../utils/token";
import { phoneCountryCodes } from "../data/phoneCodes";
import { codeToFlag } from "../data/countries";

type Screen = "form" | "success" | "invalid_token" | "replay" | "error";

export function Register() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<Screen | null>(null);

  const [form, setForm] = useState<FormState>(defaultFormState);
  const [propertyName] = useState<string | null>(null); // Placeholder until backend provides
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("form");
  const [submitting, setSubmitting] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const t = getTokenFromUrl();
    if (t) {
      setToken(t);
    } else if (import.meta.env.DEV) {
      // In development, show the form without a real token so you can see the UI at /
      setToken("dev");
    } else {
      setTokenError("invalid_token");
    }
  }, []);

  useEffect(() => {
    const handler = () => setOffline(!navigator.onLine);
    handler();
    window.addEventListener("online", handler);
    window.addEventListener("offline", handler);
    return () => {
      window.removeEventListener("online", handler);
      window.removeEventListener("offline", handler);
    };
  }, []);

  const update = useCallback((updates: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...updates }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(updates)) delete next[k];
      return next;
    });
    setGlobalError(null);
  }, []);

  const validate = useCallback((): boolean => {
    const input = formToValidationInput(form);
    const result = RegistrationPayloadV1Schema.safeParse(input);
    if (result.success) return true;
    setFieldErrors(zodErrorsToFieldErrors(result.error));
    setGlobalError("Please fix the errors below.");
    return false;
  }, [form]);

  const submit = useCallback(async () => {
    if (!token) return;
    setSubmitting(true);
    setGlobalError(null);
    setFieldErrors({});

    try {
      const input = formToValidationInput(form);
      const result = RegistrationPayloadV1Schema.safeParse(input);
      if (!result.success) {
        setFieldErrors(zodErrorsToFieldErrors(result.error));
        setGlobalError("Please fix the errors below.");
        setSubmitting(false);
        return;
      }

      // In development with the dev token, skip the API so the success screen is shown
      if (import.meta.env.DEV && token === "dev") {
        setScreen("success");
        setSubmitting(false);
        return;
      }

      const payload = formToPayload(form);
      await apiFetch<RegistrationResponse>("/v1/guest/register", {
        method: "POST",
        body: { payload },
        token,
      });
      setScreen("success");
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) setScreen("invalid_token");
        else if (e.status === 409) setScreen("replay");
        else if (e.fieldErrors && Object.keys(e.fieldErrors).length > 0) {
          setFieldErrors(e.fieldErrors);
          setGlobalError(toUserMessage(e.code));
        } else {
          setGlobalError(toUserMessage(e.code));
        }
      } else if (offline || !navigator.onLine) {
        setGlobalError(
          "You appear to be offline. Please check your connection and try again."
        );
      } else {
        setGlobalError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }, [token, form, offline]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) submit();
  };

  if (tokenError === "invalid_token") {
    return (
      <RegisterLayout>
        <h1 className="text-xl font-semibold text-gray-900">Invalid Link</h1>
        <p className="mt-2 text-gray-600">
          This registration link is invalid or has expired. Please request a new
          link.
        </p>
      </RegisterLayout>
    );
  }

  if (!token) {
    return (
      <RegisterLayout>
        <div aria-live="polite" aria-busy="true">
          <SpinnerPlaceholder />
        </div>
      </RegisterLayout>
    );
  }

  if (screen === "success") {
    return (
      <RegisterLayout>
        <h1 className="text-xl font-semibold text-green-800">
          Registration Complete
        </h1>
        <p className="mt-2 text-gray-600">
          Thank you. Your registration has been submitted successfully.
        </p>
        {import.meta.env.DEV && token === "dev" && (
          <p className="mt-3 text-sm text-gray-500">
            (Demo mode – use a real registration link to submit to the server.)
          </p>
        )}
      </RegisterLayout>
    );
  }

  if (screen === "invalid_token") {
    return (
      <RegisterLayout>
        <h1 className="text-xl font-semibold text-gray-900">Invalid Link</h1>
        <p className="mt-2 text-gray-600">
          This registration link is invalid or has expired. Please request a new
          link.
        </p>
      </RegisterLayout>
    );
  }

  if (screen === "replay") {
    return (
      <RegisterLayout>
        <h1 className="text-xl font-semibold text-gray-900">
          Already Submitted
        </h1>
        <p className="mt-2 text-gray-600">
          This registration has already been submitted. No further action is
          needed.
        </p>
      </RegisterLayout>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const checkInMin = today;

  return (
    <RegisterLayout>
      <h1 className="text-xl font-semibold text-gray-900">
        Guest Registration
      </h1>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <p className="text-sm text-gray-600">
          Staying at: {propertyName ?? "Name will be filled in later"}
        </p>
        <div aria-live="polite" aria-busy={submitting}>
          {submitting && <p className="text-sm text-gray-500">Submitting...</p>}
        </div>

        {globalError && <ErrorSummary errors={[globalError]} title="" />}

        <TextField
          id="fullName"
          label="Full name"
          value={form.fullName}
          onChange={(e) => update({ fullName: e.target.value })}
          onBlur={() => validate()}
          error={fieldErrors.fullName}
          autoComplete="name"
          required
        />
        <CountrySelect
          id="nationality"
          label="Nationality"
          value={form.nationality}
          onChange={(code) => update({ nationality: code })}
          error={fieldErrors.nationality}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="documentType"
              className="text-sm font-medium text-gray-700"
            >
              Document type
            </label>
            <select
              id="documentType"
              value={form.documentType}
              onChange={(e) =>
                update({
                  documentType: e.target.value as FormState["documentType"],
                })
              }
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="passport">Passport</option>
              <option value="id">Finnish ID</option>
              <option value="other">Other</option>
            </select>
            {fieldErrors.documentType && (
              <p className="mt-1 text-sm text-red-600">
                {fieldErrors.documentType}
              </p>
            )}
          </div>
          <TextField
            id="documentNumber"
            label="Document number"
            value={form.documentNumber}
            onChange={(e) => update({ documentNumber: e.target.value })}
            onBlur={() => validate()}
            error={fieldErrors.documentNumber}
            autoComplete="off"
            inputMode={form.documentType === "passport" ? "text" : form.documentType === "id" ? "text" : "text"}
            required
          />
        </div>
        <TextField
          id="dateOfBirth"
          label="Date of birth"
          type="date"
          value={form.dateOfBirth}
          onChange={(e) => update({ dateOfBirth: e.target.value })}
          error={fieldErrors.dateOfBirth}
        />
        <TextField
          id="checkInDate"
          label="Check-in date"
          type="date"
          value={form.checkInDate}
          onChange={(e) => update({ checkInDate: e.target.value })}
          min={checkInMin}
          error={fieldErrors.checkInDate}
          required
        />
        <TextField
          id="checkOutDate"
          label="Check-out date"
          type="date"
          value={form.checkOutDate}
          onChange={(e) => update({ checkOutDate: e.target.value })}
          min={form.checkInDate || checkInMin}
          error={fieldErrors.checkOutDate}
          required
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="phoneNumber" className="text-sm font-medium text-gray-700">
            Phone
          </label>
          <div className="flex gap-2">
            <select
              id="phoneCountryCode"
              value={form.phoneCountryCode}
              onChange={(e) => update({ phoneCountryCode: e.target.value })}
              className="w-28 shrink-0 rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {phoneCountryCodes.map((item) => (
                <option key={item.code} value={item.code}>
                  {codeToFlag(item.isoCode)} {item.code}
                </option>
              ))}
            </select>
            <div className="flex flex-1 flex-col gap-1">
              <input
                id="phoneNumber"
                type="tel"
                value={form.phoneNumber}
                onChange={(e) => update({ phoneNumber: e.target.value })}
                onBlur={() => validate()}
                autoComplete="tel-national"
                inputMode="tel"
                maxLength={15}
                placeholder="401234567"
                aria-invalid={!!fieldErrors.phoneNumber}
                aria-describedby={fieldErrors.phoneNumber ? "phoneNumber-error" : "phoneNumber-help"}
                className={`block w-full rounded-lg border px-3 py-2 text-base focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100 disabled:cursor-not-allowed ${fieldErrors.phoneNumber ? "border-red-500" : "border-gray-300"}`}
              />
              {fieldErrors.phoneNumber ? (
                <p id="phoneNumber-error" className="text-sm text-red-600" role="alert">
                  {fieldErrors.phoneNumber}
                </p>
              ) : (
                <p id="phoneNumber-help" className="text-sm text-gray-500">
                  Omit leading 0 (e.g. 401234567)
                </p>
              )}
            </div>
          </div>
        </div>
        <TextField
          id="email"
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => update({ email: e.target.value })}
          error={fieldErrors.email}
          autoComplete="email"
        />
        <TextField
          id="address"
          label="Residential address"
          value={form.address}
          onChange={(e) => update({ address: e.target.value })}
          onBlur={() => validate()}
          error={fieldErrors.address}
          autoComplete="street-address"
          required
        />

        <div className="sticky bottom-0 mt-2 flex justify-end bg-gray-50 pt-4 pb-2">
          <Button type="submit" loading={submitting} disabled={submitting}>
            Submit
          </Button>
        </div>
      </form>
    </RegisterLayout>
  );
}

function RegisterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-lg">{children}</div>
    </div>
  );
}

function SpinnerPlaceholder() {
  return (
    <div className="flex justify-center py-8">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
    </div>
  );
}
