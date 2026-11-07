# Roboto Condensed

OGraf Studio's built-in broadcast recipes embed this variable font as an ordinary, editable
project resource. It matches the Roboto Condensed font used by the Signal Blue example.
No network connection or separately installed system font is required for playback.

## Upstream source

The files are copied without conversion or subsetting from the official Google Fonts repository,
pinned at commit `69d0549e8fc7ad72e1531734c81237be401ec4fd`:

| Local file            | Upstream file                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RobotoCondensed.ttf` | [RobotoCondensed\[wght\].ttf](https://github.com/google/fonts/blob/69d0549e8fc7ad72e1531734c81237be401ec4fd/ofl/robotocondensed/RobotoCondensed%5Bwght%5D.ttf) |
| `OFL.txt`             | [OFL.txt](https://github.com/google/fonts/blob/69d0549e8fc7ad72e1531734c81237be401ec4fd/ofl/robotocondensed/OFL.txt)                                           |
| `METADATA.pb`         | [METADATA.pb](https://github.com/google/fonts/blob/69d0549e8fc7ad72e1531734c81237be401ec4fd/ofl/robotocondensed/METADATA.pb)                                   |

The font contains the normal style with a variable weight axis from 100 to 900.
Its original filename is retained in project asset metadata.

- Size: **371,616 bytes**
- SHA-256: `dace262afcee68a5276f200d8026c57221735c0118ab5fda8c2c0d3dc409a8d0`
- Distribution license: **SIL Open Font License 1.1**, supplied in full in `OFL.txt`.

The current upstream distribution's `OFL.txt` and `METADATA.pb` state the license. The unchanged
font binary retains older Apache license strings in its internal name table; these historical
strings are not used to infer the license of the current distribution. The upstream license
notice is embedded in the project asset and included in exported package notices.

## Generated source

Run `npm run fonts:generate` after an intentional upstream update, or `npm run fonts:check` to
verify the checked-in source. The generator verifies the pinned font's SHA-256, byte count and
TrueType signature. It writes deterministic TypeScript data without fetching resources at build
or playback time. Update the pin and its recorded provenance together when changing this font.

Recipes add one normal-style family resource only when it is used and the project has no existing
normal Roboto Condensed font resource. Existing user fonts are retained. Component sources carry
their font dependency; template-set storage pools identical font bytes as a shared resource.
