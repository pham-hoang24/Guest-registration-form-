import { useEffect, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  DOCUMENT_TYPES,
  PURPOSES_OF_STAY,
  guestSubmissionRequestSchema,
  type GuestSubmissionRequest,
  type RegistrationLinkInfo,
} from "@gr/shared";
import { ApiError, apiGet, apiPost } from "../api/client.js";
import i18n from "../i18n/index.js";

type PageState =
  | { kind: "loading" }
  | { kind: "invalid_link" }
  | { kind: "form"; info: RegistrationLinkInfo }
  | { kind: "submitting"; info: RegistrationLinkInfo }
  | { kind: "success"; submissionId: string }
  | { kind: "error"; info: RegistrationLinkInfo; message: string };

const SUPPORTED_UI_LANGS = ["en", "fi", "sv"] as const;
type SupportedLang = (typeof SUPPORTED_UI_LANGS)[number];

const emptyGuest = (isPrimary: boolean) => ({
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  nationality: "",
  address: "",
  documentType: "passport" as const,
  documentNumber: "",
  isPrimaryGuest: isPrimary,
});

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none";
const labelClass = "block text-sm font-medium text-slate-700 mb-1";

export default function GuestRegistrationPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const { t } = useTranslation();

  const form = useForm<GuestSubmissionRequest>({
    resolver: zodResolver(guestSubmissionRequestSchema),
    defaultValues: {
      arrivalDate: "",
      departureDate: "",
      purposeOfStay: "Leisure",
      guestEmail: "",
      guestPhone: "",
      guests: [emptyGuest(true)],
      privacyAccepted: undefined as unknown as true,
      accuracyConfirmed: undefined as unknown as true,
    },
  });
  const { register, handleSubmit, formState, control } = form;
  const errors = formState.errors;

  const { fields, append, remove } = useFieldArray({ control, name: "guests" });

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
          ? t("status.errorLinkExpired")
          : t("status.errorGeneric");
      setState({ kind: "error", info, message });
    }
  });

  const changeLang = (lang: SupportedLang) => {
    void i18n.changeLanguage(lang);
    localStorage.setItem("gr-lang", lang);
  };

  if (state.kind === "loading") {
    return <CenteredCard>{t("status.loading")}</CenteredCard>;
  }
  if (state.kind === "invalid_link") {
    return (
      <CenteredCard>
        <h1 className="text-xl font-semibold text-slate-900">{t("status.linkNotValid")}</h1>
        <p className="mt-2 text-slate-600">{t("status.linkExpiredDesc")}</p>
      </CenteredCard>
    );
  }
  if (state.kind === "success") {
    return (
      <CenteredCard>
        <h1 className="text-xl font-semibold text-green-700">{t("status.success")}</h1>
        <p className="mt-2 text-slate-600">
          {t("status.successDesc", { reference: state.submissionId })}
        </p>
      </CenteredCard>
    );
  }

  const info = state.info;
  const submitting = state.kind === "submitting";
  const currentLang = (i18n.language.slice(0, 2) ?? "en") as SupportedLang;

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6">
      <div className="mx-auto max-w-lg">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t("page.title")}</h1>
            <p className="text-slate-600">
              {info.propertyName}, {info.propertyCity}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {t("page.requirementVersion", { version: info.requirementVersion })}
            </p>
          </div>
          <div className="flex gap-1 text-sm">
            {SUPPORTED_UI_LANGS.map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => changeLang(lang)}
                className={`rounded px-2 py-1 font-medium uppercase ${
                  currentLang === lang
                    ? "bg-blue-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {lang}
              </button>
            ))}
          </div>
        </header>

        {state.kind === "error" && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.message}</div>
        )}

        <form onSubmit={onSubmit} className="space-y-6" noValidate>
          <Section title={t("section.stay")}>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("field.arrivalDate")} error={errors.arrivalDate?.message}>
                <input type="date" className={inputClass} {...register("arrivalDate")} />
              </Field>
              <Field label={t("field.departureDate")} error={errors.departureDate?.message}>
                <input type="date" className={inputClass} {...register("departureDate")} />
              </Field>
            </div>
            <Field label={t("field.purposeOfStay")} error={errors.purposeOfStay?.message}>
              <select className={inputClass} {...register("purposeOfStay")}>
                {PURPOSES_OF_STAY.map((purpose) => (
                  <option key={purpose} value={purpose}>
                    {t(`purpose.${purpose}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("field.email")} error={errors.guestEmail?.message}>
              <input
                type="email"
                autoComplete="email"
                className={inputClass}
                {...register("guestEmail")}
              />
            </Field>
            <Field label={t("field.phone")} error={errors.guestPhone?.message}>
              <input
                type="tel"
                autoComplete="tel"
                className={inputClass}
                {...register("guestPhone")}
              />
            </Field>
          </Section>

          {fields.map((field, index) => (
            <Section
              key={field.id}
              title={
                index === 0
                  ? t("section.primaryGuest")
                  : t("section.additionalGuest", { n: index })
              }
              action={
                index > 0 ? (
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    className="text-sm text-red-600 hover:text-red-800"
                  >
                    {t("action.removeGuest")}
                  </button>
                ) : undefined
              }
            >
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={t("field.firstName")}
                  error={errors.guests?.[index]?.firstName?.message}
                >
                  <input className={inputClass} {...register(`guests.${index}.firstName`)} />
                </Field>
                <Field
                  label={t("field.lastName")}
                  error={errors.guests?.[index]?.lastName?.message}
                >
                  <input className={inputClass} {...register(`guests.${index}.lastName`)} />
                </Field>
              </div>
              <Field
                label={t("field.dateOfBirth")}
                error={errors.guests?.[index]?.dateOfBirth?.message}
              >
                <input
                  type="date"
                  className={inputClass}
                  {...register(`guests.${index}.dateOfBirth`)}
                />
              </Field>
              <Field
                label={t("field.nationality")}
                error={errors.guests?.[index]?.nationality?.message}
              >
                <input
                  className={inputClass}
                  placeholder="FI"
                  maxLength={2}
                  {...register(`guests.${index}.nationality`)}
                />
              </Field>
              <Field
                label={t("field.address")}
                error={errors.guests?.[index]?.address?.message}
              >
                <input className={inputClass} {...register(`guests.${index}.address`)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={t("field.documentType")}
                  error={errors.guests?.[index]?.documentType?.message}
                >
                  <select className={inputClass} {...register(`guests.${index}.documentType`)}>
                    {DOCUMENT_TYPES.map((docType) => (
                      <option key={docType} value={docType}>
                        {t(`docType.${docType}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={t("field.documentNumber")}
                  error={errors.guests?.[index]?.documentNumber?.message}
                >
                  <input className={inputClass} {...register(`guests.${index}.documentNumber`)} />
                </Field>
              </div>
            </Section>
          ))}

          {fields.length < 20 && (
            <button
              type="button"
              onClick={() => append(emptyGuest(false))}
              className="w-full rounded-lg border-2 border-dashed border-slate-300 py-3 text-sm font-medium text-slate-600 hover:border-blue-400 hover:text-blue-600"
            >
              + {t("action.addGuest")}
            </button>
          )}

          <Section title={t("section.confirmation")}>
            <Checkbox
              label={t("confirmation.privacy")}
              error={errors.privacyAccepted?.message}
              {...register("privacyAccepted")}
            />
            <Checkbox
              label={t("confirmation.accuracy")}
              error={errors.accuracyConfirmed?.message}
              {...register("accuracyConfirmed")}
            />
          </Section>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? t("action.submitting") : t("action.submit")}
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

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
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
