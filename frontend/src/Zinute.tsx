import type { ZinutesDuomenys } from './useZinute'

export default function Zinute({ zinute, onUzdaryti }: { zinute: ZinutesDuomenys | null; onUzdaryti: () => void }) {
  if (!zinute) return null
  return (
    <div className="zinute" role="status" aria-live="polite">
      <span>{zinute.tekstas}</span>
      {zinute.veiksmas && (
        <button
          className="zinute-veiksmas"
          onClick={() => {
            zinute.veiksmas!.atlikti()
            onUzdaryti()
          }}
        >
          {zinute.veiksmas.pavadinimas}
        </button>
      )}
    </div>
  )
}
