/**
 * Asistento veidas — japoniškas laimę nešantis katinukas (maneki-neko): balta katė su
 * raudonu antkakliu, auksiniu varpeliu ir moneta, kuri retkarčiais pamojuoja letenėle.
 * Spalvos fiksuotos (tai „gyvūnėlis“, ne sąsajos elementas), tad vienodos abiejose temose.
 */
export default function Katinukas({ dydis = 48, mojuoja = false }: { dydis?: number; mojuoja?: boolean }) {
  const linija = '#3d2c26'
  return (
    <svg
      className={`katinukas${mojuoja ? ' mojuoja' : ''}`}
      width={dydis}
      height={dydis}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      {/* Kūnas */}
      <path d="M15 64 C14 50 20 41 32 41 C44 41 50 50 49 64 Z" fill="#fff" stroke={linija} strokeWidth="1.6" />

      {/* Moneta (koban) kairėje letenoje */}
      <ellipse cx="22" cy="54" rx="5.2" ry="7" fill="#f6c343" stroke="#b9861a" strokeWidth="1.3" />
      <path d="M19.5 51.5 h5 M19.5 54 h5 M19.5 56.5 h5" stroke="#b9861a" strokeWidth="0.9" strokeLinecap="round" />
      <ellipse cx="25" cy="58.5" rx="4" ry="3" fill="#fff" stroke={linija} strokeWidth="1.4" />

      {/* Ausys */}
      <path d="M17.5 22 L19 7.5 L29 15 Z" fill="#fff" stroke={linija} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M20.5 18 L21.2 11.5 L26 15.3 Z" fill="#f4a6a6" />
      <path d="M46.5 22 L45 7.5 L35 15 Z" fill="#fff" stroke={linija} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M43.5 18 L42.8 11.5 L38 15.3 Z" fill="#f4a6a6" />

      {/* Galva */}
      <ellipse cx="32" cy="27" rx="16" ry="13.5" fill="#fff" stroke={linija} strokeWidth="1.6" />
      {/* Trispalvės katės dėmės */}
      <path d="M21 17.5 C23 14.5 27.5 14 29 15.8 C27 18.5 23.5 19.5 21 17.5 Z" fill="#f2994a" />
      <path d="M38.5 15.2 C40.5 14.2 43 15 44 16.8 C42 17.8 39.8 17.3 38.5 15.2 Z" fill="#3d2c26" />

      {/* Užmerktos laimingos akys */}
      <path d="M22.5 27.5 Q25 24.5 27.5 27.5" fill="none" stroke={linija} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M36.5 27.5 Q39 24.5 41.5 27.5" fill="none" stroke={linija} strokeWidth="1.7" strokeLinecap="round" />

      {/* Skruostai, nosis, burna */}
      <ellipse cx="21.5" cy="31.5" rx="2.6" ry="1.7" fill="#f7b3b3" opacity="0.75" />
      <ellipse cx="42.5" cy="31.5" rx="2.6" ry="1.7" fill="#f7b3b3" opacity="0.75" />
      <path d="M30.6 30 h2.8 L32 31.6 Z" fill="#e8807f" />
      <path d="M29.2 32.6 Q30.6 34.4 32 32.6 Q33.4 34.4 34.8 32.6" fill="none" stroke={linija} strokeWidth="1.2" strokeLinecap="round" />

      {/* Ūsai */}
      <path d="M17.5 30 L11 28.8 M17.5 32.4 L11.2 33.4 M46.5 30 L53 28.8 M46.5 32.4 L52.8 33.4" stroke={linija} strokeWidth="1" strokeLinecap="round" />

      {/* Antkaklis ir varpelis */}
      <path d="M19.5 38.2 Q32 44.5 44.5 38.2 L44.5 41.2 Q32 47.5 19.5 41.2 Z" fill="#d93a2f" stroke="#a52820" strokeWidth="0.8" />
      <circle cx="32" cy="45" r="3.4" fill="#f6c343" stroke="#b9861a" strokeWidth="1.1" />
      <path d="M28.8 44.6 h6.4" stroke="#b9861a" strokeWidth="0.9" />
      <circle cx="32" cy="46.6" r="0.8" fill="#8a6212" />

      {/* Pakelta letenėlė — priekyje, šalia galvos; mojuoja sukdamasi apie alkūnę */}
      <g className="katinuko-letena">
        <path
          d="M40.5 50 C41.5 43 44.5 36 48.5 30.5 L56 31.5 C54 38.5 50.5 45.5 47.5 50.5 C45.5 52 42 52 40.5 50 Z"
          fill="#fff"
          stroke={linija}
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <ellipse cx="52.6" cy="25.6" rx="5.2" ry="5.8" fill="#fff" stroke={linija} strokeWidth="1.6" />
        <path d="M49 30 C50.5 31.4 54.5 31.6 56 30" fill="none" stroke="#fff" strokeWidth="2.4" />
        <ellipse cx="52.6" cy="27" rx="2.1" ry="1.8" fill="#f4a6a6" />
        <circle cx="50.2" cy="23.3" r="1" fill="#f4a6a6" />
        <circle cx="52.6" cy="22.3" r="1" fill="#f4a6a6" />
        <circle cx="55" cy="23.3" r="1" fill="#f4a6a6" />
      </g>
    </svg>
  )
}
