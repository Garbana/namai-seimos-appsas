import { useEffect, useState } from 'react'

/**
 * Telefone plati mėnesių matrica netelpa ir verčia slinkti puslapį į šoną,
 * todėl ten rodom kitokį vaizdą — vieną mėnesį iš karto. Tai sprendžiama
 * ne CSS'u, o komponentu: skiriasi ne dydžiai, o pats turinys.
 */
export function useSiauras(riba = 640) {
  const [siauras, setSiauras] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${riba}px)`).matches
  )

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${riba}px)`)
    const keisti = (e: MediaQueryListEvent) => setSiauras(e.matches)
    mq.addEventListener('change', keisti)
    setSiauras(mq.matches)
    return () => mq.removeEventListener('change', keisti)
  }, [riba])

  return siauras
}
