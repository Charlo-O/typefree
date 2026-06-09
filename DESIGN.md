# Design

## Surface

The current design system covers the Typefree marketing landing page. The page is a brand surface for a practical desktop utility, not an app dashboard.

## Visual Direction

Restrained technical utility with a visible grid, tinted neutrals, compact product evidence, and direct bilingual copy. The page should feel installable and work-focused rather than magical or decorative.

## Color

- Use OKLCH tokens scoped to `.landing-page`.
- Backgrounds are cool tinted neutrals, never pure white.
- Primary ink is a near-black tinted toward blue.
- Accent is a controlled blue-violet used for labels, icons, provider chips, and focus states.
- Do not add privacy-colored greens or trust badges unless the claim is explicit and verified.

## Typography

- Chinese is primary. English supports but should not duplicate every sentence.
- Use one sans stack with strong weight contrast.
- Hero type may be large; panels, cards, and utility rows should stay compact.
- Avoid long paragraphs. Keep body text under roughly 65 characters per line.

## Layout

- First viewport should show the product name, one promise, one primary action, and one focused product preview.
- Product workflow should be demonstrated through concrete steps rather than generic feature cards.
- Use cards only for distinct items such as platform downloads. Avoid cards inside cards.
- Platform downloads must keep Linux, Mac, and Windows equally scannable.

## Interaction

- Download buttons resolve the latest GitHub release asset by platform.
- Async download resolution must show a loading status and a fallback message.
- Focus states must remain visible.
- Motion should be subtle and respect reduced-motion preferences.

## Copy Rules

- Do not claim local privacy, private offline processing, or local-first privacy unless the app explicitly guarantees it.
- Prefer concrete workflow language: hotkey, speak, paste, app, model, provider.
- Use precise metrics only when benchmark context or source is shown near the claim.
