export function JourneyGlyph({ stage }: { stage: number }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className="journey-glyph">
      {stage === 0 && (
        <>
          <path d="M12 11h17l7 7v21H12z" />
          <path d="M29 11v9h7M18 26h12M18 32h8" />
          <path className="glyph-fill" d="M8 7h13v4H12v24H8z" />
        </>
      )}
      {stage === 1 && (
        <>
          <path d="M8 14h23M8 24h15M8 34h20" />
          <circle cx="31" cy="24" r="9" />
          <path d="m37 31 5 6M28 24l2 2 4-5" />
        </>
      )}
      {stage === 2 && (
        <>
          <path d="M24 7 41 16v17L24 42 7 33V16z" />
          <path d="m16 24 6 6 11-13M24 7v6M7 33l6-3M41 33l-6-3" />
        </>
      )}
      {stage === 3 && (
        <>
          <path d="M10 13h15M10 13v26h26V27M17 32h13M19 24 34 9l6 6-15 15-8 2zM30 13l6 6" />
        </>
      )}
      {stage === 4 && (
        <>
          <path d="M7 23h34v17H7zM12 23V13h24v10M18 13V7h12v6M7 30h34M24 23v17" />
          <path className="glyph-fill" d="M12 13h6v10h-6zM30 13h6v10h-6z" />
        </>
      )}
    </svg>
  );
}
