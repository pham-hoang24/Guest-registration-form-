import { describe, it, expect } from 'vitest'
import {
  RegistrationPayloadV1Schema,
  formToPayload,
  zodErrorsToFieldErrors,
  defaultFormState,
} from './registration'

describe('RegistrationPayloadV1Schema', () => {
  it('accepts valid payload with required fields', () => {
    const payload = {
      schemaVersion: 'v1' as const,
      fullName: 'John Doe',
      documentType: 'passport',
      documentNumber: 'AB123456',
      checkInDate: '2025-02-15',
      checkOutDate: '2025-02-17',
      address: 'Street 1, 00100 Helsinki',
    }
    const result = RegistrationPayloadV1Schema.safeParse(payload)
    expect(result.success).toBe(true)
  })

  it('rejects empty fullName', () => {
    const payload = {
      schemaVersion: 'v1',
      fullName: '',
      documentType: 'passport',
      documentNumber: 'AB123456',
      checkInDate: '2025-02-15',
      checkOutDate: '2025-02-17',
      address: 'Street 1, 00100 Helsinki',
    }
    const result = RegistrationPayloadV1Schema.safeParse(payload)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('fullName'))).toBe(true)
    }
  })

  it('rejects empty documentNumber', () => {
    const payload = {
      schemaVersion: 'v1',
      fullName: 'John Doe',
      documentType: 'passport',
      documentNumber: '',
      checkInDate: '2025-02-15',
      checkOutDate: '2025-02-17',
      address: 'Street 1, 00100 Helsinki',
    }
    const result = RegistrationPayloadV1Schema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it('rejects checkout before checkin', () => {
    const payload = {
      schemaVersion: 'v1',
      fullName: 'John Doe',
      documentType: 'passport',
      documentNumber: 'AB123456',
      checkInDate: '2025-02-17',
      checkOutDate: '2025-02-15',
      address: 'Street 1, 00100 Helsinki',
    }
    const result = RegistrationPayloadV1Schema.safeParse(payload)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message?.includes('Check-out'))).toBe(true)
    }
  })

  it('accepts checkout equal to checkin', () => {
    const payload = {
      schemaVersion: 'v1',
      fullName: 'John Doe',
      documentType: 'passport',
      documentNumber: 'AB123456',
      checkInDate: '2025-02-15',
      checkOutDate: '2025-02-15',
      address: 'Street 1, 00100 Helsinki',
    }
    const result = RegistrationPayloadV1Schema.safeParse(payload)
    expect(result.success).toBe(true)
  })

  it('accepts optional fields (non-Nordic)', () => {
    const payload = {
      schemaVersion: 'v1',
      fullName: 'John Doe',
      nationality: 'US',
      documentType: 'passport',
      documentNumber: 'AB123456',
      dateOfBirth: '1990-01-01',
      checkInDate: '2025-02-15',
      checkOutDate: '2025-02-17',
      address: 'Street 1, 00100 Helsinki',
      phoneCountryCode: '+358',
      phoneNumber: '401234567',
      email: 'john@example.com',
    }
    const result = RegistrationPayloadV1Schema.safeParse(payload)
    expect(result.success).toBe(true)
  })

  it('accepts Finnish nationality with valid henkilötunnus', () => {
    const payload = {
      schemaVersion: 'v1',
      fullName: 'Matti Meikäläinen',
      nationality: 'FI',
      documentType: 'id',
      documentNumber: '010190-123A',
      checkInDate: '2025-02-15',
      checkOutDate: '2025-02-17',
      address: 'Katu 1, 00100 Helsinki',
    }
    const result = RegistrationPayloadV1Schema.safeParse(payload)
    expect(result.success).toBe(true)
  })

  it('accepts Nordic (non-Finnish) without travel document', () => {
    const payload = {
      schemaVersion: 'v1',
      fullName: 'Anna Andersson',
      nationality: 'SE',
      checkInDate: '2025-02-15',
      checkOutDate: '2025-02-17',
      address: 'Storgatan 1, 111 23 Stockholm',
    }
    const result = RegistrationPayloadV1Schema.safeParse(payload)
    expect(result.success).toBe(true)
  })
})

describe('formToPayload', () => {
  it('maps form to payload with schemaVersion', () => {
    const form = {
      ...defaultFormState,
      fullName: 'Jane',
      documentType: 'passport' as const,
      documentNumber: 'AB12345',
      checkInDate: '2025-02-15',
      checkOutDate: '2025-02-17',
      address: 'Street 1, City',
    }
    const payload = formToPayload(form)
    expect(payload.schemaVersion).toBe('v1')
    expect(payload.fullName).toBe('Jane')
    expect(payload.documentNumber).toBe('AB12345')
    expect(payload.checkInDate).toBe('2025-02-15')
    expect(payload.address).toBe('Street 1, City')
  })

  it('omits empty optional fields', () => {
    const form = {
      ...defaultFormState,
      fullName: 'Jane',
      documentType: 'passport' as const,
      documentNumber: 'AB12345',
      checkInDate: '2025-02-15',
      checkOutDate: '2025-02-17',
      address: 'Street 1',
      phoneCountryCode: '',
      phoneNumber: '',
      email: '',
    }
    const payload = formToPayload(form)
    expect(payload.phone).toBeUndefined()
    expect(payload.email).toBeUndefined()
  })
})

describe('zodErrorsToFieldErrors', () => {
  it('maps zod issues to field errors', () => {
    const result = RegistrationPayloadV1Schema.safeParse({
      schemaVersion: 'v1',
      fullName: '',
      documentType: 'passport',
      documentNumber: '',
      checkInDate: '2025-02-15',
      checkOutDate: '2025-02-17',
      address: 'Street 1',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const fieldErrors = zodErrorsToFieldErrors(result.error)
      expect(Object.keys(fieldErrors).length).toBeGreaterThan(0)
      expect(fieldErrors.fullName || fieldErrors.documentNumber).toBeDefined()
    }
  })
})
