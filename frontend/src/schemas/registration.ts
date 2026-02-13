import { z } from 'zod'

const documentTypeEnum = z.enum(['passport', 'id', 'other'])

export const RegistrationPayloadV1Schema = z
  .object({
    schemaVersion: z.literal('v1'),
    fullName: z.string().min(1, 'Full name is required'),
    nationality: z.string().optional(),
    documentType: documentTypeEnum,
    documentNumber: z.string().min(1, 'Document number is required'),
    dateOfBirth: z.string().optional(),
    checkInDate: z.string().min(1, 'Check-in date is required'),
    checkOutDate: z.string().min(1, 'Check-out date is required'),
    phone: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    address: z.string().optional(),
  })
  .refine(
    (data) => {
      if (!data.checkInDate || !data.checkOutDate) return true
      return new Date(data.checkOutDate) >= new Date(data.checkInDate)
    },
    { message: 'Check-out date must be on or after check-in date', path: ['checkOutDate'] }
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
  phone: string
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
  phone: '',
  email: '',
  address: '',
}

export function formToPayload(form: FormState): RegistrationPayloadV1 {
  const payload: RegistrationPayloadV1 = {
    schemaVersion: 'v1',
    fullName: form.fullName.trim(),
    documentType: form.documentType,
    documentNumber: form.documentNumber.trim(),
    checkInDate: form.checkInDate,
    checkOutDate: form.checkOutDate,
  }
  if (form.nationality.trim()) payload.nationality = form.nationality.trim()
  if (form.dateOfBirth.trim()) payload.dateOfBirth = form.dateOfBirth.trim()
  if (form.phone.trim()) payload.phone = form.phone.trim()
  if (form.email.trim()) payload.email = form.email.trim()
  if (form.address.trim()) payload.address = form.address.trim()
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
