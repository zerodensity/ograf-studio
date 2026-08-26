# News Lower Third — OGraf Template

An EBU OGraf v1 lower third converted from the supplied `News-LT.SVG` / `NEWS_LT.css` design,
authored in OGraf Studio and certified against the official v1 specification.

Two deliverable packages are provided — real-time and non-real-time — built from one source project
so appearance, fields, states, and timing cannot drift between them.

---

## Folder structure

```
news-lower-third/
├── README.md
├── news-lower-third.ogs                     editable source (single source of truth)
├── assets/                                  original plate artwork, both themes
│   ├── back-standard.png   mid-standard.png   strip-standard.png
│   └── back-breaking.png   mid-breaking.png   strip-breaking.png
├── realtime/
│   └── news-lower-third-realtime.ograf.zip
└── non-realtime/
    └── news-lower-third-non-realtime.ograf.zip
```

Each `.ograf.zip` contains the OGraf manifest (`*.ograf.json`), the `main.js` graphic module, and an
`assets/` directory. Extract before loading into a devtool that expects a directory.

## Composition

|            |                            |
| ---------- | -------------------------- |
| Resolution | 1920 × 1080                |
| Frame rate | 50 fps                     |
| Duration   | 65 frames (1.30 s)         |
| Background | transparent (keyed output) |
| Safe areas | fits EBU R 95 title-safe   |

## The three editable text properties

Exposed through the OGraf data model with GDD metadata and operator-side validation:

| Property   | Label    | Type          | Max length | Default       |
| ---------- | -------- | ------------- | ---------- | ------------- |
| `liveTag`  | Live Tag | `single-line` | 13         | `LIVE`        |
| `headline` | Headline | `single-line` | 26         | `HEADLINES`   |
| `location` | Location | `single-line` | 17         | `NETHERLANDS` |

Every field carries a `description` so a controller's form can explain itself.

**The `maxLength` values are measured, not guessed.** Each was derived by rendering the real text in
the browser and finding the length at which the string exactly fills its box without triggering the
shrink-to-fit legibility floor. At those limits the design holds; beyond them a controller should
refuse the input rather than let the graphic degrade on air.

Text updates apply through any OGraf-compatible controller via the standard update mechanism.

## The Breaking News checkbox

| Property       | Label         | Type      | Default |
| -------------- | ------------- | --------- | ------- |
| `breakingNews` | Breaking News | `boolean` | `false` |

- **`false`** — the standard theme from the supplied design: blue plates, silver headline plate,
  navy headline text.
- **`true`** — the red Breaking News theme. All three plates switch to a red gradient and the
  headline and locator text switch to white for contrast.

| Element       | Standard              | Breaking              |
| ------------- | --------------------- | --------------------- |
| Back plate    | `#0046B7` → `#001845` | `#C8102E` → `#4A0512` |
| Mid plate     | `#F3F3F3` → `#B9B9B9` | `#A80D26` → `#3D040F` |
| Lower strip   | `#0047B7` → `#001034` | `#C8102E` → `#3D0410` |
| Live tag text | `#FFFFFF`             | `#FFFFFF`             |
| Headline text | `#001E4F`             | `#FFFFFF`             |
| Location text | `#ECECEC`             | `#FFECEE`             |

The standard palette was sampled directly from the supplied artwork. The red palette is a hue
rotation of the source blue holding saturation and lightness, so the two themes share the same
tonal structure.

Theme switching is fully declarative — a data binding with a value map. No scripting, no custom
runtime, and it does not affect geometry or animation.

## The three states

Standard OGraf lifecycle with three pausable steps (`stepCount: 3`). The controller advances through
them in order with normal step actions.

| State      | Frame | On screen                                 |
| ---------- | ----- | ----------------------------------------- |
| Start      | 0     | nothing — all elements off-frame left     |
| **Step 1** | 25    | back plate + **Live Tag**                 |
| **Step 2** | 35    | + mid plate + **Headline**                |
| **Step 3** | 45    | + lower strip + **Location**              |
| End        | 65    | nothing — all elements below frame bottom |

The build is **progressive**: each state adds its plate and its text together, so the graphic grows
rather than swapping content in a fixed shell.

## Animations

**In** — each plate and its text translate together from off-frame left to their authored position
with a decelerating `cubic-out` ease. Because a plate and its text share an identical delta, the text
never slides across its own plate.

| Group                  | Arrives         | Duration      |
| ---------------------- | --------------- | ------------- |
| Back plate + Live Tag  | Start → Step 1  | 25 f (500 ms) |
| Mid plate + Headline   | Step 1 → Step 2 | 10 f (200 ms) |
| Lower strip + Location | Step 2 → Step 3 | 10 f (200 ms) |

**Out** — from the current on-screen position, the whole assembly translates straight down and exits
through the bottom of frame over 20 f (400 ms) with an accelerating `cubic-in` ease.

All motion is authored as ordinary keyframed property tracks. There are no timers, no controller
callbacks, and no vendor APIs — the graphic is a pure function of lifecycle time, which is what makes
the non-real-time build deterministic.

## Real-time vs non-real-time

Both packages are generated from the same project and compile to the same descriptor. The **only**
differences are the declared capability flags and the graphic identity:

|                       | Real-time | Non-real-time |
| --------------------- | --------- | ------------- |
| `supportsRealTime`    | `true`    | `false`       |
| `supportsNonRealTime` | `false`   | `true`        |
| Graphic id suffix     | `-rt`     | `-nrt`        |

- **Real-time** — interactive playout. The controller drives play/step/stop actions and may update
  data live while the graphic is on air.
- **Non-real-time** — deterministic offline rendering. The renderer seeks with `goToTime()` and every
  frame is reproducible, including after a data update and on reverse seeks.

Appearance, data fields, states, Breaking News behaviour, and timing are identical.

## How to load and test

**Extract first** — the `.ograf.zip` must be unpacked; the devtool expects a directory.

1. Extract the package for the profile you want.
2. Load the extracted folder in an OGraf-compatible controller or the EBU OGraf devtool.
3. Fill `liveTag`, `headline`, `location`; leave `breakingNews` unchecked.
4. Play in — the graphic builds to **Step 1**.
5. Step twice more to reach **Step 2** and **Step 3**.
6. Tick **Breaking News** and update — the theme switches red without interrupting motion.
7. Take out — the assembly exits downward.

To edit the design, open `news-lower-third.ogs` in OGraf Studio and re-export. Do not hand-edit
the packages; that bypasses certification.

## Certification

Both packages pass all five OGraf gates:

| Gate                                  | Result |
| ------------------------------------- | ------ |
| Project semantics                     | pass   |
| Official OGraf v1 manifest schema     | pass   |
| OGraf package layout                  | pass   |
| Graphic module / default export / API | pass   |
| Real-time and non-real-time lifecycle | pass   |

Deterministic design QA scores **100/100** with zero errors and zero warnings.

## Compliance decisions and limitations

**Standard mechanisms only.** Lifecycle steps, the manifest data schema, standard update actions, and
keyframed properties. No vendor APIs, no controller-specific behaviour, no external network
dependencies. All assets are packaged locally.

**Fonts — the one known limitation.** The design specifies **Rubik**, which is not a web-safe face and
is not embedded in the package. The template declares `Rubik, Arial, Helvetica, sans-serif`, so a
renderer without Rubik installed falls back to Arial. Verified behaviour: on the test machine it
resolved to Arial. For pixel-identical playout, install Rubik on the render nodes. The measured
`maxLength` values were calibrated against the Arial fallback, which is the wider of the two, so text
that fits the fallback also fits Rubik.

**Plate artwork is raster.** The supplied SVG contained rasterised Photoshop output rather than vector
shapes, so the plates ship as PNGs at native resolution — the standard theme uses your original
artwork pixel-for-pixel. The Breaking News plates are vector SVG generated from the measured geometry
(shear 0.535 dx/dy) and the approved palette, so they are resolution-independent and share exactly the
same silhouette.

**Text is live, not baked.** All three text elements are real text with shrink-to-fit, not images, so
they update correctly from controller data.

**Transparent output.** The composition renders on a transparent background for downstream keying.

**Not covered.** Text longer than the declared `maxLength` is the controller's responsibility to
reject. The template has no built-in overflow marquee, no multi-line headline mode, and no per-word
animation.
