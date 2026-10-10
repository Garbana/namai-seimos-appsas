import { useNariai } from './nariai'

/**
 * Kas naudoja įrenginį — paklausiam kartą ir įsimenam šiame įrenginyje (ne pagal
 * prisijungimo paštą). Tai lemia, kas pažymimas pridėjęs ar atlikęs darbą, ką rodo
 * „Mano“ ir kam ateina pranešimai; visi vis tiek mato viską.
 */
export default function KasAs({ onUzdaryti }: { onUzdaryti?: () => void }) {
  const { nariai, as, keistiAs } = useNariai()
  const naudoja = nariai.filter((n) => n.uses_app)

  return (
    <div className="modal-fonas" role="presentation" onClick={onUzdaryti}>
      <div className="modal" role="dialog" aria-label="Kas naudoja šį įrenginį?" onClick={(e) => e.stopPropagation()}>
        <h3>Kas naudoja šį įrenginį?</h3>
        <p className="paaiskinimas">
          Pagal tai pažymima, kas pridėjo ar atliko darbą, „Mano“ rodo tavo darbus, o pranešimai šiame įrenginyje
          ateina tau. Visi vis tiek mato viską. Pakeisti galima bet kada („Daugiau“ arba šoninėje juostoje).
        </p>
        <div className="kas-as-mygtukai">
          {naudoja.map((n) => (
            <button
              key={n.id}
              className={n.id === as ? undefined : 'ghost'}
              onClick={() => {
                keistiAs(n.id)
                onUzdaryti?.()
              }}
            >
              <span className="uzd-narys" style={{ background: n.color }} aria-hidden="true">
                {n.name.slice(0, 2)}
              </span>
              {n.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
