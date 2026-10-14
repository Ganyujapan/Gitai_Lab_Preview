# GITAI LAB — Motion Home Study 01

2026-10-15 / **independent design prototype**. The public `index.html` was not replaced.

## Preview

[Open the prototype](https://ganyujapan.github.io/Gitai_Lab_Preview/dev/motion_home_lab.html?v=20261015-01)

The goal is to test smooth, layered illustration movement similar in *principle* to an editorial landing page. It is not a pixel-art design and does not copy SoundCloud's identity, illustrations, source code, or imagery. The actual SoundCloud motion reference has not yet been matched frame-by-frame; use a captured reference clip for precise timing and trajectories.

## Design composition and future asset workflow

- `motion_home_lab.html`: layout, copy, **12 individually replaceable image elements**. Current placeholders are original inline SVG / CSS drawings, not final branding illustrations.
- `motion_home_lab.css`: type system, palette, background, desktop / iPhone compositions, focus states, motion-reduction styles.
- `motion_home_lab.js`: per-object smooth translation/rotation, mouse parallax, two adjustable preset styles, transition to existing game menu.

### On-screen controls

- **DRIFT** (initial): quietly floating elements and independent oscillations.
- **FLOW** (switch in header): large horizontal motion, slightly more energetic.
- Tap/click anywhere except the motion toggle (or select **この世界へ**) to enter the existing 2026 entertainment mode menu. This does not change evolution data.

Vector illustrations are separate `.shape[data-motion]` containers; replace only their SVG nodes or supply asset images without changing the animation math. For an exact reference match, measure movement from video and adjust `config` in `motion_home_lab.js`.

## Behavior and scope

- Separate test URL. Existing entertainment top and menu, education `?model=morph_v1`, stored progression, and evolution model remain unchanged.
- Uses `requestAnimationFrame` and transform-only movement, pauses when tab hidden, disables motion for `prefers-reduced-motion`.
- Touch targets stay accessible; tested structurally and in a mocked runtime. **Real iOS Safari and GitHub Pages deployed rendering remain to be visually checked.**
