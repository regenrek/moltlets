import { getRequest, getRequestHeader } from '@tanstack/react-start/server'

export function isSameOriginRequest() {
  const request = getRequest()
  const expectedOrigin = new URL(request.url).origin
  const origin = getRequestHeader('origin')
  if (origin && origin !== 'null' && origin !== expectedOrigin) {
    return false
  }
  const secFetchSite = getRequestHeader('sec-fetch-site')
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'same-site') {
    return false
  }
  const referer = getRequestHeader('referer')
  if (!origin && !secFetchSite && referer) {
    try {
      if (new URL(referer).origin !== expectedOrigin) return false
    } catch {
      return false
    }
  }
  return true
}

export function assertSameOriginRequest(message = 'Cross-site request blocked') {
  if (!isSameOriginRequest()) {
    throw new Error(message)
  }
}
