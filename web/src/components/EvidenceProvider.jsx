import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import EvidenceDrawer from './EvidenceDrawer.jsx'

/* ── One drawer, one screen ───────────────────────────────────────────────────
 *
 * Evidence hangs off almost everything the adapter produces — every plain-English
 * card, every checklist row, and several of the maths rows carry the same
 * `evidence` shape (docs/API.md v2, built in adapter.js `toEvidence`). If each
 * claim owned its own drawer, a screen with a dozen claims would carry a dozen
 * mounted panels, any number of which could be open at once, and two overlapping
 * slide-overs is not a state anyone designed.
 *
 * So the state lives here, above the claims: ONE open evidence object, ONE mounted
 * drawer. `show()` replaces whatever was open, which is what "only one at a time"
 * means in practice — clicking a second claim's trigger moves the drawer to it
 * rather than refusing or stacking.
 *
 * A `<ViewEvidence>` outside a provider renders nothing at all rather than
 * throwing. Evidence is an enhancement to a claim, never the claim itself, and a
 * missing provider must not take the sentence down with it.
 */

const EvidenceContext = createContext(null)

export function useEvidence() {
  return useContext(EvidenceContext)
}

export default function EvidenceProvider({ children }) {
  /* `current` is the evidence being shown; `open` is tracked separately so the
     panel keeps its content while it tweens back out. Clearing them together
     would empty the drawer mid-exit and animate a blank rectangle off screen. */
  const [current, setCurrent] = useState(null)
  const [open, setOpen] = useState(false)

  const show = useCallback((evidence, claim) => {
    if (!evidence) return
    setCurrent({ evidence, claim: claim ?? null })
    setOpen(true)
  }, [])

  const close = useCallback(() => setOpen(false), [])

  const value = useMemo(() => ({ show, close, open }), [show, close, open])

  return (
    <EvidenceContext.Provider value={value}>
      {children}
      <EvidenceDrawer
        evidence={current?.evidence ?? null}
        claim={current?.claim ?? null}
        open={open}
        onClose={close}
      />
    </EvidenceContext.Provider>
  )
}
