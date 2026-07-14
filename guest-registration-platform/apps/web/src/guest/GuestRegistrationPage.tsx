import { useCallback, useEffect, useState } from "react";
import {
  useForm,
  useFieldArray,
  type UseFormRegister,
  type FieldErrors,
  type FieldPath,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PURPOSES_OF_STAY, type RegistrationLinkInfo } from "@gr/shared";
import { apiGet, apiPostMultipart } from "../api/client.js";
import i18n from "../i18n/index.js";
import SignatureField, { dataUrlToPngBlob } from "./SignatureField.js";
import {
  registrationFormSchema,
  groupIntoCards,
  toPayloadPeople,
  identityLabel,
  type RegistrationForm,
  type PersonForm,
} from "./formSchema.js";
import { countryOptions } from "./countryOptions.js";
import { guestSubmissionErrorMessage } from "./submissionErrors.js";

type PageState =
  | { kind: "loading" }
  | { kind: "invalid_link" }
  | { kind: "form"; info: RegistrationLinkInfo }
  | { kind: "submitting"; info: RegistrationLinkInfo }
  | { kind: "success" }
  | { kind: "error"; info: RegistrationLinkInfo; message: string };

const SUPPORTED_UI_LANGS = ["en", "fi", "sv"] as const;
type SupportedLang = (typeof SUPPORTED_UI_LANGS)[number];

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none";

const readOnlyValueClass =
  "rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-base text-slate-900";

function formatStayDate(iso: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

const emptyPerson = (guestType: PersonForm["guestType"]): PersonForm => ({
  guestType,
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  address: "",
  documentNumber: "",
  citizenship: "",
  countryOfEntryToFinland: "",
  finnishPersonalIdentityCode: "",
});

export default function GuestRegistrationPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [reviewing, setReviewing] = useState(false);
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const { t } = useTranslation();

  const form = useForm<RegistrationForm>({
    resolver: zodResolver(registrationFormSchema),
    defaultValues: {
      arrivalDate: "",
      departureDate: "",
      purposeOfStay: "Leisure",
      privacyAccepted: undefined as unknown as true,
      accuracyConfirmed: undefined as unknown as true,
      people: [emptyPerson("primary")],
    },
  });
  const { register, handleSubmit, formState, control, watch, setValue, getValues, setError, clearErrors } =
    form;
  const errors = formState.errors;
  const { fields, append, remove } = useFieldArray({ control, name: "people" });

  const people = watch("people");

  useEffect(() => {
    if (!token) {
      setState({ kind: "invalid_link" });
      return;
    }
    apiGet<RegistrationLinkInfo>(`/v1/public/registration-links/${token}`)
      .then((info) => {
        setValue("arrivalDate", info.arrivalDate);
        setValue("departureDate", info.departureDate);
        setState({ kind: "form", info });
      })
      .catch(() => setState({ kind: "invalid_link" }));
  }, [token]);

  const setSignature = useCallback((field: string, dataUrl: string) => {
    setSignatures((prev) => ({ ...prev, [field]: dataUrl }));
  }, []);

  const goToReview = async () => {
    // Step 1 must run the full registration schema (including superRefine rules
    // for conditional adult fields). Partial trigger("people") only validates
    // personFormSchema where those fields are optional at the field level.
    clearErrors();
    const values = getValues();
    const parsed = registrationFormSchema.safeParse({
      ...values,
      privacyAccepted: true,
      accuracyConfirmed: true,
    });
    if (!parsed.success) {
      let firstField: FieldPath<RegistrationForm> | null = null;
      for (const issue of parsed.error.issues) {
        const root = issue.path[0];
        if (root === "privacyAccepted" || root === "accuracyConfirmed") continue;
        const path = issue.path.join(".") as FieldPath<RegistrationForm>;
        setError(path, { type: "manual", message: issue.message });
        firstField ??= path;
      }
      if (firstField) {
        document.querySelector<HTMLElement>(`[name="${firstField}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    setReviewing(true);
  };

  const onSubmit = handleSubmit(async (data) => {
    if (state.kind !== "form" && state.kind !== "error") return;
    const info = state.info;

    const cards = groupIntoCards(data.people);
    // Every card needs a signature from its adult card holder.
    for (const card of cards) {
      if (!signatures[card.signatureField]) {
        setState({ kind: "error", info, message: t("status.errorSignatureMissing") });
        return;
      }
    }

    setState({ kind: "submitting", info });
    try {
      const payload = JSON.stringify({
        arrivalDate: data.arrivalDate,
        departureDate: data.departureDate,
        purposeOfStay: data.purposeOfStay,
        privacyAccepted: true,
        accuracyConfirmed: true,
        people: toPayloadPeople(data.people),
      });

      const fd = new FormData();
      fd.append("payload", payload);
      for (const card of cards) {
        fd.append(card.signatureField, dataUrlToPngBlob(signatures[card.signatureField]!), `${card.signatureField}.png`);
      }

      await apiPostMultipart(`/v1/public/registration-links/${token}/submissions`, fd);
      setState({ kind: "success" });
    } catch (error) {
      setState({ kind: "error", info, message: guestSubmissionErrorMessage(error, t) });
    }
  });

  const changeLang = (lang: SupportedLang) => {
    void i18n.changeLanguage(lang);
    localStorage.setItem("gr-lang", lang);
  };

  if (state.kind === "loading") return <CenteredCard>{t("status.loading")}</CenteredCard>;
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
        <p className="mt-2 text-slate-600">{t("status.successDescCard")}</p>
      </CenteredCard>
    );
  }

  const info = state.info;
  const submitting = state.kind === "submitting";
  const currentLang = (i18n.language.slice(0, 2) ?? "en") as SupportedLang;
  const cards = groupIntoCards(people as PersonForm[]);

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6">
      <div className="mx-auto max-w-lg">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t("page.title")}</h1>
            <p className="text-slate-600">{info.propertyName}, {info.propertyCity}</p>
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
                  currentLang === lang ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
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

        {!reviewing ? (
          <form className="space-y-6" noValidate>
            <Section title={t("section.stay")}>
              <p className="text-sm text-slate-600">{t("field.stayDatesHint")}</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("field.arrivalDate")}>
                  <p className={readOnlyValueClass}>{formatStayDate(info.arrivalDate, currentLang)}</p>
                </Field>
                <Field label={t("field.departureDate")}>
                  <p className={readOnlyValueClass}>{formatStayDate(info.departureDate, currentLang)}</p>
                </Field>
              </div>
              <Field label={t("field.purposeOfStay")} error={errors.purposeOfStay?.message}>
                <select className={inputClass} {...register("purposeOfStay")}>
                  {PURPOSES_OF_STAY.map((p) => (
                    <option key={p} value={p}>{t(`purpose.${p}`)}</option>
                  ))}
                </select>
              </Field>
            </Section>

            {fields.map((field, index) => (
              <PersonSection
                key={field.id}
                index={index}
                register={register}
                errors={errors}
                guestType={people?.[index]?.guestType ?? "primary"}
                locale={currentLang}
                t={t}
                isResident={people?.[index]?.isResidentInFinland}
                onResidentChange={(v) =>
                  setValue(`people.${index}.isResidentInFinland`, v, { shouldValidate: true })
                }
                onRemove={index > 0 ? () => remove(index) : undefined}
              />
            ))}

            <div className="flex flex-wrap gap-2">
              <AddButton label={t("action.addSpouse")} onClick={() => append(emptyPerson("spouse"))} />
              <AddButton label={t("action.addChild")} onClick={() => append(emptyPerson("child"))} />
              <AddButton label={t("action.addAdult")} onClick={() => append(emptyPerson("additional_adult"))} />
            </div>

            <button
              type="button"
              onClick={goToReview}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700"
            >
              {t("action.review")}
            </button>
          </form>
        ) : (
          <form onSubmit={onSubmit} className="space-y-6" noValidate>
            <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
              {t("review.cardNotice")}
            </div>

            {cards.map((card) => (
              <Section
                key={card.signatureField}
                title={
                  card.holder.guestType === "primary"
                    ? t("review.primaryCard")
                    : t("review.adultCard")
                }
              >
                <p className="font-medium text-slate-900">
                  {card.holder.firstName} {card.holder.lastName}
                </p>
                <p className="text-sm text-slate-500">{identityLabel(card.holder)}</p>
                {card.riders.map((r, i) => (
                  <p key={i} className="text-sm text-slate-600">
                    {t(`guestType.${r.guestType}`)}: {r.firstName} {r.lastName} ({identityLabel(r)})
                  </p>
                ))}
                <div className="mt-3">
                  <SignatureField
                    label={t("review.signatureFor", { name: `${card.holder.firstName} ${card.holder.lastName}` })}
                    onChange={(d) => setSignature(card.signatureField, d)}
                  />
                  {!signatures[card.signatureField] && (
                    <p className="mt-1 text-xs text-amber-600">{t("review.signatureRequired")}</p>
                  )}
                </div>
              </Section>
            ))}

            <Section title={t("section.confirmation")}>
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                {t("confirmation.penaltyNotice")}
              </p>
              <Checkbox label={t("confirmation.privacy")} error={errors.privacyAccepted?.message} {...register("privacyAccepted")} />
              <Checkbox label={t("confirmation.accuracy")} error={errors.accuracyConfirmed?.message} {...register("accuracyConfirmed")} />
            </Section>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setReviewing(false)}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-3 font-semibold text-slate-700 hover:bg-slate-50"
              >
                {t("action.back")}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? t("action.submitting") : t("action.submit")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function PersonSection({
  index,
  register,
  errors,
  guestType,
  locale,
  t,
  isResident,
  onResidentChange,
  onRemove,
}: {
  index: number;
  register: UseFormRegister<RegistrationForm>;
  errors: FieldErrors<RegistrationForm>;
  guestType: PersonForm["guestType"];
  locale: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  isResident: boolean | undefined;
  onResidentChange: (value: boolean) => void;
  onRemove?: () => void;
}) {
  const isAdult = guestType === "primary" || guestType === "additional_adult";
  const pe = errors.people?.[index];
  const title =
    index === 0 ? t("section.primaryGuest") : t(`guestType.${guestType}`);
  const countries = countryOptions(locale);
  const residencyButton = (value: boolean, label: string) => (
    <button
      type="button"
      onClick={() => onResidentChange(value)}
      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
        isResident === value
          ? "border-blue-600 bg-blue-50 text-blue-700"
          : "border-slate-300 text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );

  return (
    <Section
      title={title}
      action={
        onRemove ? (
          <button type="button" onClick={onRemove} className="text-sm text-red-600 hover:text-red-800">
            {t("action.remove")}
          </button>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("field.firstName")} error={pe?.firstName?.message}>
          <input className={inputClass} {...register(`people.${index}.firstName`)} />
        </Field>
        <Field label={t("field.lastName")} error={pe?.lastName?.message}>
          <input className={inputClass} {...register(`people.${index}.lastName`)} />
        </Field>
      </div>

      {/* Residency drives the conditional fields below; an explicit choice is required. */}
      {isAdult && (
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("field.residencyQuestion")}
          </span>
          <div className="flex gap-2">
            {residencyButton(true, t("field.residentYes"))}
            {residencyButton(false, t("field.residentNo"))}
          </div>
          {pe?.isResidentInFinland?.message && (
            <p className="mt-1 text-sm text-red-600">{pe.isResidentInFinland.message}</p>
          )}
        </div>
      )}

      {/* Identity is PIC-or-DOB: provide exactly one. */}
      <Field label={t("field.dateOfBirth")} error={pe?.dateOfBirth?.message} hint={t("field.identityHint")}>
        <input type="date" className={inputClass} {...register(`people.${index}.dateOfBirth`)} />
      </Field>
      <Field label={t("field.finnishPic")} error={pe?.finnishPersonalIdentityCode?.message} hint={t("field.finnishPicHint")}>
        <input className={inputClass} {...register(`people.${index}.finnishPersonalIdentityCode`)} />
      </Field>

      {isAdult && (
        <>
          {/* Nationality (field 4) is always required — a Finnish PIC does not encode it. */}
          <Field label={t("field.citizenship")} error={pe?.citizenship?.message}>
            <CountrySelect options={countries} placeholder={t("field.countrySelect")} {...register(`people.${index}.citizenship`)} />
          </Field>
          <Field label={t("field.address")} error={pe?.address?.message}>
            <input className={inputClass} {...register(`people.${index}.address`)} />
          </Field>
          {/* Country of entry (field 12) and passport/ID (field 6) apply only to non-residents. */}
          {isResident === false && (
            <>
              <Field label={t("field.countryOfEntry")} error={pe?.countryOfEntryToFinland?.message}>
                <CountrySelect options={countries} placeholder={t("field.countrySelect")} {...register(`people.${index}.countryOfEntryToFinland`)} />
              </Field>
              <Field label={t("field.documentNumber")} error={pe?.documentNumber?.message}>
                <input className={inputClass} {...register(`people.${index}.documentNumber`)} />
              </Field>
            </>
          )}
        </>
      )}
    </Section>
  );
}

const CountrySelect = ({
  options,
  placeholder,
  ...selectProps
}: {
  options: { code: string; name: string }[];
  placeholder: string;
} & React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={inputClass} {...selectProps}>
    <option value="">{placeholder}</option>
    {options.map((o) => (
      <option key={o.code} value={o.code}>
        {o.name}
      </option>
    ))}
  </select>
);

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow">{children}</div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
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

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-lg border-2 border-dashed border-slate-300 py-2 text-sm font-medium text-slate-600 hover:border-blue-400 hover:text-blue-600"
    >
      + {label}
    </button>
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
