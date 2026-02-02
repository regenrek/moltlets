import { createServerFn } from '@tanstack/react-start'
import { getCookie, setCookie } from '@tanstack/react-start/server'
import { assertSameOriginRequest } from './request-security'

export type Theme = 'light' | 'dark' | 'system'
const COOKIE = 'clawlets-theme'

export const getTheme = createServerFn().handler(async () => {
  const raw = getCookie(COOKIE)
  return raw === 'light' || raw === 'dark' || raw === 'system' ? (raw as Theme) : 'system'
})

export const setTheme = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown): Theme => {
    if (data !== 'light' && data !== 'dark' && data !== 'system') {
      throw new Error('theme must be light | dark | system')
    }
    return data
  })
  .handler(async ({ data }) => {
    assertSameOriginRequest('Theme update requires same-origin request')
    setCookie(COOKIE, data, { path: '/', maxAge: 60 * 60 * 24 * 365 })
  })
