# Example catalog

The project explorer (the window that starts a new project) lists three kinds of starting point:

- **Recipes**, which Studio builds itself for the canvas you choose.
- **Built-in examples**, shipped inside Studio in `apps/editor/public/explorer/examples/`.
- **Online examples**, downloaded from the examples repository.

Built-in and online examples use the same folder layout and the same generated `catalog.json`.
Studio reads one catalog file per source, so listing and searching need no further requests.

## Publish the shared order and details

The default **Featured** order is set by maintainers of
[the examples repository](https://github.com/zerodensity/ograf-studio-examples).

1. Edit `featured.json` and put example IDs in the order they should appear. Entries outside that
   list follow in order of latest update. Add an example's ID first to promote it.
2. Edit `<example-id>/example.json` for changes to the description, attribution, license, credits,
   or listing status.
3. From the Studio source checkout, run the catalog generator with the examples checkout path.

   ```bash
   npx tsx scripts/buildExampleCatalog.ts <examples-folder>
   ```

4. Commit the metadata and regenerated `catalog.json` in the examples repository and publish the
   changes to `main`. Studio picks up the shared order and details on its next catalog refresh.
   Metadata edits reuse the existing preview files.

Readers can also sort by **Latest updated** or **Name**. An example carries a **New** mark for
30 days after its `released` date.

## Add an example

1. Create a folder named by the example's ID: lowercase words joined by hyphens, such as
   `europe-weather`.
2. Put the Studio document in it. Exactly one `.ogs` file; a template set is fine.
3. Add `example.json` beside it:

   ```json
   {
     "title": "Europe weather",
     "summary": "A five-step weather show for a presenter on a live forecast.",
     "category": "Weather",
     "level": "Advanced",
     "tags": ["Live data", "Steps", "Shader"],
     "author": "Zero Density",
     "license": {
       "name": "AGPL-3.0-only",
       "url": "https://www.gnu.org/licenses/agpl-3.0.html"
     },
     "page": "https://ografstudio.org/examples/weather"
   }
   ```

4. Build the catalog:

   ```bash
   npx tsx scripts/buildExampleCatalog.ts <examples-folder>
   ```

The script reads each document for its canvas size, frame rate, template count, field count,
document version, size and hash. It plays the graphic in headless Chrome and writes, per example:

| File             | Use                                                         |
| ---------------- | ----------------------------------------------------------- |
| `thumbnail.webp` | The still picture on the card.                              |
| `preview.mp4`    | The loop that plays while the pointer rests on the card.    |
| `preview.gif`    | The same loop for a README or a web page.                   |
| `.preview.json`  | What the pictures were rendered from; unchanged means skip. |

It then writes `catalog.json` and checks it with the same reader Studio uses. Name example IDs
after the folder to render them again whatever changed:

```bash
npx tsx scripts/buildExampleCatalog.ts <examples-folder> europe-weather
```

Rendering needs Chrome and ffmpeg. Set `CHROME_PATH` or `FFMPEG_PATH` when they are not found, and
build the runtime once first: `npm run build --workspace @ograf-editor/ograf-runtime`.

## `example.json`

| Key        | Required | Meaning                                                                     |
| ---------- | -------- | --------------------------------------------------------------------------- |
| `title`    | yes      | Name on the card, up to 80 characters.                                      |
| `summary`  | yes      | One or two sentences, up to 300 characters.                                 |
| `category` | yes      | Sidebar group, such as `Weather` or `Sport`.                                |
| `level`    | yes      | `Basic`, `Intermediate` or `Advanced`.                                      |
| `tags`     | yes      | Up to 12 Studio features the example shows.                                 |
| `author`   | yes      | Who made it.                                                                |
| `license`  | no       | An object with `name` and optional `url` (HTTPS) and `attribution` text.    |
| `credits`  | no       | Third-party credit text for fonts, images, music, or other included assets. |
| `page`     | no       | An HTTPS page about the example.                                            |
| `unlisted` | no       | `true` keeps the example out of the explorer. Its files stay in the repo.   |
| `released` | no       | `YYYY-MM-DD`. Defaults to the document's first commit.                      |
| `updated`  | no       | `YYYY-MM-DD`. Defaults to the document's last commit.                       |
| `preview`  | no       | What the preview plays; see below.                                          |

An unlisted example is not secret: anyone who browses a public repository can see its files.

Use **License & Credits** in an example's details to see this information before downloading
the project. Zero Density's example work uses AGPL-3.0-only. List separately licensed assets and data
under credits and preserve their original terms and notices. For other catalogs, use an SPDX
identifier or the full license name when the project has a declared license.

## Preview

By default the preview takes the graphic in, advances through its steps and takes it out. A
graphic that only comes alive on an action can say what to play:

```json
{
  "preview": {
    "seconds": 6,
    "actions": [
      { "at": 0.4, "do": "play" },
      { "at": 2.0, "do": "action", "id": "homeGoal" },
      { "at": 3.0, "do": "update", "data": { "period": "2nd half" } },
      { "at": 4.5, "do": "stop" }
    ],
    "thumbnailAt": 3.5
  }
}
```

`at` and `thumbnailAt` are seconds from the start; a preview is at most 12 seconds. `action` IDs
and `update` fields are the graphic's own custom actions and data fields.

## Recipe pictures

Recipe cards get their pictures from a running Studio dev server, which builds each recipe:

```bash
npx tsx scripts/buildExampleCatalog.ts --recipes http://localhost:5173 apps/editor/public/explorer/recipes
```

Run it again after a recipe's look changes.

The Studio page it opens connects to the MCP editor bridge like any Studio tab, and the bridge
serves one editor at a time. Stop the MCP server first, or start that dev server with
`VITE_OGRAF_AGENT_BRIDGE_URL` set to an address nothing listens on.

## How Studio uses the catalog

- The online catalog is read from the examples repository. A build can point elsewhere with
  `VITE_OGRAF_EXAMPLE_CATALOG_URL`.
- Every file path in a catalog is relative to the catalog and must stay inside its folder.
- Studio saves the catalog, the pictures and each example you open. Without a connection it shows
  the saved list; examples not yet downloaded are dimmed, and no error appears.
- If a bundled and online document are identical, Studio uses the online details and opens the
  bundled copy offline. A newer online document replaces an older bundled copy, and the online
  listing choice applies in both cases.
- A download is checked against the catalog's hash before it opens.
- An example saved with a newer document version than Studio reads is shown as needing an update.
