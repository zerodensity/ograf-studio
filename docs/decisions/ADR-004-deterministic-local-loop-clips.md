# ADR-004: Deterministic local loop clips

Status: accepted

## Context

Ambient backgrounds, flashing text, pulses, and tickers must continue while an OGraf Graphic is
parked at a Step. Repeating composition keys would contaminate lifecycle transitions, while
autonomous CSS/GSAP timers cannot reproduce arbitrary `goToTime()` frames reliably.

## Decision

Allow one layer-local loop clip with independent numeric property tracks on a local
`0..durationFrames` ruler. Activate it either while the Graphic is on-air or at one explicit Step.
All properties share the clip clock but keep independent keys, incoming easing, and curves.

Compile the clip into the shared descriptor and derive phase from an absolute OGraf action epoch
and timestamp. Realtime redraw callbacks never advance phase themselves. A loop never invokes or
advances an OGraf lifecycle action, and an infinite loop never delays `playAction()` resolution.

## Consequences

- Entrance/exit tracks and OGraf Step markers remain finite and unchanged.
- Editor preview, exported realtime playback, and scheduled non-realtime seeking use the same pure
  sampler.
- Repeat seams are validated; masked offscreen ticker wraps may intentionally differ.
- Another OGraf renderer can play the compiled Web Component, but editable loop reconstruction from
  a package remains outside the OGraf authoring contract.
