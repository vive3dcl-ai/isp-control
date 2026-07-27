import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  applyPlatformBrandingToDocument,
  DEFAULT_PLATFORM_BRANDING,
  type PlatformBranding,
} from '../lib/branding'

const BrandingContext = createContext<PlatformBranding>(DEFAULT_PLATFORM_BRANDING)

export function BrandingProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ['public', 'branding'],
    queryFn: () => apiFetch<PlatformBranding>('/public/branding'),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const branding = query.data ?? DEFAULT_PLATFORM_BRANDING

  useEffect(() => {
    applyPlatformBrandingToDocument(branding)
  }, [branding])

  return (
    <BrandingContext.Provider value={branding}>
      {children}
    </BrandingContext.Provider>
  )
}

export function useBranding() {
  return useContext(BrandingContext)
}
