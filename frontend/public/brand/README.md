# TrojanConnect brand marks

The mark is a cardinal arch framing a Trojan helmet, with a gold orbit sweeping
through it and a four-point spark at the upper right. All exports have
transparent backgrounds and use the product palette (`#990000` cardinal,
`#FFCC00` gold, near-black, white).

Generated from the masters in `TrojanLogo2/` at the repository root.

## The files

Each mark ships in two artworks. The suffix names **the surface the mark sits
on**, not the colour of the mark itself:

| File | Use on | Size |
| --- | --- | --- |
| `wordmark-on-light.png` | white and light surfaces — "Trojan" in cardinal, "Connect" in near-black | 1599 × 400 |
| `wordmark-on-dark.png` | black surfaces — "Trojan" in gold, "Connect" in white | 1599 × 400 |
| `mark-on-light.png` | light surfaces | 512 × 512 |
| `mark-on-dark.png` | dark surfaces | 512 × 512 |
| `mark.png` | the standalone icon, full-bleed artwork | 512 × 512 |

**Every file is trimmed to its content.** The masters carry roughly 20% of
their height as transparent margin, which made the logo look far smaller than
the box it was given. Trimming means a rendered height of 36px is 36px of
visible logo. The wordmark's aspect ratio is therefore 4:1, not the 3.2:1 of
the untrimmed master, and both wordmark variants are padded onto one identical
canvas so cross-fading between them never shifts a pixel.

## Using them

Reach for these through `src/components/brand/Logo.tsx` (`<Wordmark>`,
`<Mark>`) rather than referencing the files directly. It keeps both artworks
mounted and cross-fades between them, so a surface that changes tone while you
scroll never flashes.

**On cardinal, pass `plate`.** Neither artwork works on a cardinal background,
because both keep a cardinal arch that disappears into it — and cardinal on
cardinal is a palette violation besides. `plate` sets the logo on a paper chip,
which is cardinal on white, and that is allowed. The landing header does this
automatically for its cardinal scene; the sign-in panel passes it directly.

## App icons

`src/app/icon.png` and `src/app/apple-icon.png` are the browser-tab and
home-screen icons; Next.js picks those up from the file name and emits the
`<link>` tags, so there is no `favicon.ico`. The tab icon stays transparent so
it works against light and dark browser chrome. The Apple icon gets an explicit
white field, because iOS composites a home-screen icon onto whatever is behind
it and cardinal on black is a palette violation.
