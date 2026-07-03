import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useParams } from "react-router-dom";
import {
  DOCUMENT_TYPES,
  PURPOSES_OF_STAY,
  guestSubmissionRequestSchema,
  type GuestSubmissionRequest,
  type RegistrationLinkInfo,
} from "@gr/shared";
import { ApiError, apiGet, apiPost } from "../api/client.js";

type PageState =
  | { kind: "loading" }
  | { kind: "invalid_link" }
  | { kind: "form"; info: RegistrationLinkInfo }
  | { kind: "submitting"; info: RegistrationLinkInfo }
  | { kind: "success"; submissionId: string }
  | { kind: "error"; info: RegistrationLinkInfo; message: string };

const emptyGuest = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  nationality: "",
  address: "",
  documentType: "passport" as const,
  documentNumber: "",
  isPrimaryGuest: true,
};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none";
const labelClass = "block text-sm font-medium text-slate-700 mb-1";

export default function GuestRegistrationPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<PageState>({ kind: "loading" });

  const form = useForm<GuestSubmissionRequest>({
    resolver: zodResolver(guestSubmissionRequestSchema),
    defaultValues: {
      arrivalDate: "",
      departureDate: "",
      purposeOfStay: "Leisure",
      guestEmail: "",
      guestPhone: "",
      guests: [emptyGuest],
      privacyAccepted: undefined as unknown as true,
      accuracyConfirmed: undefined as unknown as true,
    },
  });
  const { register, handleSubmit, formState } = form;
  const errors = formState.errors;

  useEffect(() => {
    if (!token) {
      setState({ kind: "invalid_link" });
      return;
    }
    apiGet<RegistrationLinkInfo>(`/v1/public/registration-links/${token}`)
      .then((info) => setState({ kind: "form", info }))
      .catch(() => setState({ kind: "invalid_link" }));
  }, [token]);

  const onSubmit = handleSubmit(async (data) => {
    if (state.kind !== "form" && state.kind !== "error") return;
    const info = state.info;
    setState({ kind: "submitting", info });
    try {
      const result = await apiPost<{ submissionId: string; status: string }>(
        `/v1/public/registration-links/${token}/submissions`,
        data,
      );
      setState({ kind: "success", submissionId: result.submissionId });
    } catch (error) {
      const message =
        error instanceof ApiError && error.code === "invalid_or_expired_link"
          ? "This registration link is no longer valid."
          : "Submission failed. Please try again.";
      setState({ kind: "error", info, message });
    }
  });

  if (state.kind === "loading") {
    return <CenteredCard>Loading…</CenteredCard>;
  }
  if (state.kind === "invalid_link") {
    return (
      <CenteredCard>
        <h1 className="text-xl font-semibold text-slate-900">Link not valid</h1>
        <p className="mt-2 text-slate-600">
          This registration link is invalid or has expired. Please contact your host for a new
          link.
        </p>
      </CenteredCard>
    );
  }
  if (state.kind === "success") {
    return (
      <CenteredCard>
        <h1 className="text-xl font-semibold text-green-700">Registration complete</h1>
        <p className="mt-2 text-slate-600">
          Thank you. Your registration has been received. Reference:{" "}
          <span className="font-mono text-sm">{state.submissionId}</span>
        </p>
      </CenteredCard>
    );
  }

  const info = state.info;
  const submitting = state.kind === "submitting";

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6">
      <div className="mx-auto max-w-lg">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Guest registration</h1>
          <p className="text-slate-600">
            {info.propertyName}, {info.propertyCity}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Requirement version {info.requirementVersion}
          </p>
        </header>

        {state.kind === "error" && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.message}</div>
        )}

        <form onSubmit={onSubmit} className="space-y-6" noValidate>
          <Section title="Stay">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Arrival date" error={errors.arrivalDate?.message}>
                <input type="date" className={inputClass} {...register("arrivalDate")} />
              </Field>
              <Field label="Departure date" error={errors.departureDate?.message}>
                <input type="date" className={inputClass} {...register("departureDate")} />
              </Field>
            </div>
            <Field label="Purpose of stay" error={errors.purposeOfStay?.message}>
              <select className={inputClass} {...register("purposeOfStay")}>
                {PURPOSES_OF_STAY.map((purpose) => (
                  <option key={purpose} value={purpose}>
                    {purpose}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Email" error={errors.guestEmail?.message}>
              <input type="email" autoComplete="email" className={inputClass} {...register("guestEmail")} />
            </Field>
            <Field label="Phone" error={errors.guestPhone?.message}>
              <input type="tel" autoComplete="tel" className={inputClass} {...register("guestPhone")} />
            </Field>
          </Section>

          <Section title="Primary guest">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" error={errors.guests?.[0]?.firstName?.message}>
                <input className={inputClass} {...register("guests.0.firstName")} />
              </Field>
              <Field label="Last name" error={errors.guests?.[0]?.lastName?.message}>
                <input className={inputClass} {...register("guests.0.lastName")} />
              </Field>
            </div>
            <Field label="Date of birth" error={errors.guests?.[0]?.dateOfBirth?.message}>
              <input type="date" className={inputClass} {...register("guests.0.dateOfBirth")} />
            </Field>
            <Field
              label="Nationality (2-letter code)"
              error={errors.guests?.[0]?.nationality?.message}
            >
              <input
                className={inputClass}
                placeholder="FI"
                maxLength={2}
                {...register("guests.0.nationality")}
              />
            </Field>
            <Field label="Home address" error={errors.guests?.[0]?.address?.message}>
              <input className={inputClass} {...register("guests.0.address")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Document type" error={errors.guests?.[0]?.documentType?.message}>
                <select className={inputClass} {...register("guests.0.documentType")}>
                  {DOCUMENT_TYPES.map((docType) => (
                    <option key={docType} value={docType}>
                      {docType.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Document number" error={errors.guests?.[0]?.documentNumber?.message}>
                <input className={inputClass} {...register("guests.0.documentNumber")} />
              </Field>
            </div>
            {/* isPrimaryGuest stays true via defaultValues; single-guest MVP */}
          </Section>

          <Section title="Confirmation">
            <Checkbox
              label="I accept the privacy notice and understand my data is processed to meet accommodation registration obligations."
              error={errors.privacyAccepted?.message}
              {...register("privacyAccepted")}
            />
            <Checkbox
              label="I confirm the information provided is accurate."
              error={errors.accuracyConfirmed?.message}
              {...register("accuracyConfirmed")}
            />
          </Section>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit registration"}
          </button>
        </form>
      </div>
    </div>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold text-slate-900">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

const Checkbox = ({
  label,
  error,
  ...inputProps
}: { label: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <div>
    <label className="flex items-start gap-2 text-sm text-slate-700">
      <input type="checkbox" className="mt-1" {...inputProps} />
      <span>{label}</span>
    </label>
    {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
  </div>
);
