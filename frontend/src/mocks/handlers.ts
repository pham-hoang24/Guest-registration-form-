import { http, HttpResponse } from 'msw'
import type { OwnerPropertiesResponse } from '../api/contracts'

/** Mock only missing endpoints. Real APIs (register, PDF download) passthrough. */

const mockProperties: OwnerPropertiesResponse = {
  properties: [
    { id: 'prop-1', name: 'Riverside Apartments – Unit 4A', address: '12 Riverside Drive, Helsinki, 00100' },
    { id: 'prop-2', name: 'Old Town Studio', address: '3 Aleksanterinkatu, Helsinki, 00170' },
  ],
}

export const handlers = [
  http.get('/api/v1/owner/properties', ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return HttpResponse.json(mockProperties)
  }),

  http.get('/api/v1/owner/properties/:propertyId/submissions', ({ params }) => {
    const { propertyId } = params
    return HttpResponse.json({
      submissions: [
        { id: 'mock-sub-1', createdAt: new Date().toISOString(), status: 'READY', propertyId },
        { id: 'mock-sub-2', createdAt: new Date(Date.now() - 86400000).toISOString(), status: 'PENDING_PDF', propertyId },
      ],
      total: 2,
      offset: 0,
      limit: 50,
    })
  }),

  http.post('/api/v1/owner/properties/:propertyId/guest-tokens', ({ params }) => {
    const { propertyId } = params
    const mockToken = `mock.${btoa(JSON.stringify({ propertyId, iat: Date.now() }))}.sig`
    return HttpResponse.json({ token: mockToken })
  }),
]
