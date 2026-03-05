import { z } from 'zod'

const documentTypeEnum = z.enum(['passport', 'id', 'other'])

const PASSPORT_REGEX = /^[A-Za-z0-9]{6,12}$/
const FINNISH_ID_REGEX = /^\d{6}[-+ABCDEFUVWXY]\d{3}[0-9A-Y]$/
const OTHER_DOC_REGEX = /^[A-Za-z0-9]{1,20}$/

function isValidFinnishId(value: string): boolean {
  if (!FINNISH_ID_REGEX.test(value)) return false
  const day = parseInt(value.slice(0, 2), 10)
  const month = parseInt(value.slice(2, 4), 10)
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  return true
}

/** Nordic countries: Finnish ID or no travel document required. */
export const NORDIC_COUNTRY_CODES = ['FI', 'SE', 'NO', 'DK', 'IS'] as const
export function isNordicCountry(code: string): boolean {
  return NORDIC_COUNTRY_CODES.includes(code as (typeof NORDIC_COUNTRY_CODES)[number])
}
export function isFinnishNationality(code: string): boolean {
  return code === 'FI'
}

const baseSchema = z.object({
  schemaVersion: z.literal('v1'),
  fullName: z.string().min(1, 'Full name is required'),
  nationality: z.string().optional(),
  documentType: documentTypeEnum.optional(),
  documentNumber: z.string().optional(),
  dateOfBirth: z.string().optional(),
  checkInDate: z.string().min(1, 'Check-in date is required'),
  checkOutDate: z.string().min(1, 'Check-out date is required'),
  phoneCountryCode: z.string().optional(),
  phoneNumber: z.string().optional(),
  phone: z.string().optional(),
  email: z.union([z.string().email(), z.literal('')]).optional(),
  address: z.string().min(1, 'Residential address is required'),
})

export const RegistrationPayloadV1Schema = baseSchema
  .refine(
    (data) => {
      if (!data.checkInDate || !data.checkOutDate) return true
      return new Date(data.checkOutDate) >= new Date(data.checkInDate)
    },
    { message: 'Check-out date must be on or after check-in date', path: ['checkOutDate'] }
  )
  .superRefine((data, ctx) => {
    const nat = (data.nationality ?? '').trim().toUpperCase()
    const isNordic = isNordicCountry(nat)
    const isFinnish = isFinnishNationality(nat)
    const num = data.documentNumber?.trim() ?? ''
    const docType = data.documentType

    if (isNordic && !isFinnish) return

    if (isFinnish) {
      if (!num) {
        ctx.addIssue({ code: 'custom', message: 'Personal identity code is required', path: ['documentNumber'] })
        return
      }
      if (!isValidFinnishId(num)) {
        ctx.addIssue({ code: 'custom', message: 'Finnish ID must be 11 characters (DDMMYYXNNNC format)', path: ['documentNumber'] })
      }
      return
    }

    if (!docType || !num) {
      if (!num) ctx.addIssue({ code: 'custom', message: 'Travel document number is required', path: ['documentNumber'] })
      if (!docType) ctx.addIssue({ code: 'custom', message: 'Document type is required', path: ['documentType'] })
      return
    }
    let valid = false
    let msg = 'Invalid document number'
    switch (docType) {
      case 'passport':
        valid = PASSPORT_REGEX.test(num)
        msg = 'Passport number must be 6–12 alphanumeric characters'
        break
      case 'id':
        valid = isValidFinnishId(num)
        msg = 'Finnish ID must be 11 characters (DDMMYYXNNNC format)'
        break
      case 'other':
        valid = OTHER_DOC_REGEX.test(num)
        msg = 'Document number must be 1–20 alphanumeric characters'
        break
    }
    if (!valid) ctx.addIssue({ code: 'custom', message: msg, path: ['documentNumber'] })
  })
  .refine(
    (data) => {
      const hasCode = (data.phoneCountryCode ?? '').trim().length > 0
      const hasNum = (data.phoneNumber ?? '').trim().replace(/\D/g, '').length > 0
      if (!hasCode && !hasNum) return true
      if (!hasCode || !hasNum) return false
      const digits = (data.phoneNumber ?? '').replace(/\D/g, '')
      return digits.length >= 5 && digits.length <= 15
    },
    { message: 'Provide both country code and number; number should be 5–15 digits (omit leading 0)', path: ['phoneNumber'] }
  )

export type RegistrationPayloadV1 = z.infer<typeof RegistrationPayloadV1Schema>

export interface FormState {
  fullName: string
  nationality: string
  documentType: 'passport' | 'id' | 'other'
  documentNumber: string
  dateOfBirth: string
  checkInDate: string
  checkOutDate: string
  phoneCountryCode: string
  phoneNumber: string
  email: string
  address: string
}

export const defaultFormState: FormState = {
  fullName: '',
  nationality: '',
  documentType: 'passport',
  documentNumber: '',
  dateOfBirth: '',
  checkInDate: '',
  checkOutDate: '',
  phoneCountryCode: '+358',
  phoneNumber: '',
  email: '',
  address: '',
}

/** Build object for schema validation (includes phoneCountryCode/phoneNumber and form document fields) */
export function formToValidationInput(form: FormState) {
  const base = formToPayload(form)
  return {
    ...base,
    phoneCountryCode: form.phoneCountryCode,
    phoneNumber: form.phoneNumber,
    documentType: form.documentType,
    documentNumber: form.documentNumber,
  }
}

export function formToPayload(form: FormState): RegistrationPayloadV1 {
  const isFinnish = isFinnishNationality(form.nationality.trim())
  const isNordic = isNordicCountry(form.nationality.trim())
  const payload: RegistrationPayloadV1 = {
    schemaVersion: 'v1',
    fullName: form.fullName.trim(),
    checkInDate: form.checkInDate,
    checkOutDate: form.checkOutDate,
    address: form.address.trim(),
  }
  if (form.nationality.trim()) payload.nationality = form.nationality.trim()
  if (form.dateOfBirth.trim()) payload.dateOfBirth = form.dateOfBirth.trim()
  const code = form.phoneCountryCode.trim()
  const num = form.phoneNumber.trim().replace(/\D/g, '')
  if (code && num) payload.phone = `${code}${num}`
  if (form.email.trim()) payload.email = form.email.trim()
  // Document: Finnish → id + number; other Nordic → omit; not Nordic → passport/other + number
  if (isFinnish) {
    payload.documentType = 'id'
    payload.documentNumber = form.documentNumber.trim()
  } else if (!isNordic && form.documentNumber.trim()) {
    payload.documentType = form.documentType
    payload.documentNumber = form.documentNumber.trim()
  }
  return payload
}

export type FieldErrors = Record<string, string>

export function zodErrorsToFieldErrors(
  error: z.ZodError
): FieldErrors {
  const out: FieldErrors = {}
  for (const issue of error.issues) {
    const path = issue.path.join('.')
    if (path && !out[path]) {
      out[path] = issue.message
    }
  }
  return out
}
