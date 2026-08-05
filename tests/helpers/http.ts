export interface JsonResponseOptions {
  readonly status?: number
  readonly headers?: Readonly<Record<string, string>>
}

export function jsonResponse(
  body: unknown,
  options: JsonResponseOptions = {}
): Response {
  const headers = new Headers(options.headers)
  headers.set('content-type', 'application/json')

  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers
  })
}
