'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { fetchClientLogos } from '@/lib/api';

interface ClientLogosCtx {
  logos: Record<string, string>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<ClientLogosCtx>({ logos: {}, refresh: async () => {} });

export const useClientLogos = () => useContext(Ctx);

// Loads the per-company logo map once (and on demand) so any ClientLogo in the
// tree can show the right image without prop drilling. Best-effort: on failure
// it just leaves the map empty and components fall back to initials.
export function ClientLogosProvider({ children }: { children: React.ReactNode }) {
  const [logos, setLogos] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const r = await fetchClientLogos();
      setLogos(r.logos || {});
    } catch {
      // ignore - initials fallback is fine
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <Ctx.Provider value={{ logos, refresh }}>{children}</Ctx.Provider>;
}
