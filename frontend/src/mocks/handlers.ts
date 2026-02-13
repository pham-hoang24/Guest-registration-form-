import { http, HttpResponse } from 'msw'

/** Mock only missing endpoints. Real APIs (register, PDF download) passthrough. */

export const handlers = [
  http.get('/api/v1/owner/properties/:propertyId/submissions', ({ params }) => {
    const { propertyId } = params
    return HttpResponse.json({
      submissions: [
        {
          id: 'mock-sub-1',
          createdAt: new Date().toISOString(),
          status: 'READY',
          propertyId,
        },
        {
          id: 'mock-sub-2',
          createdAt: new Date(Date.now() - 86400000).toISOString(),
          status: 'PENDING_PDF',
          propertyId,
        },
      ],
    })
  }),

  http.post('/api/v1/owner/properties/:propertyId/guest-tokens', ({ params }) => {
    const { propertyId } = params
    const mockToken = `mock.${btoa(JSON.stringify({ propertyId, iat: Date.now() }))}.sig`
    return HttpResponse.json({ token: mockToken })
  }),
]
