# Signal Blue news package

Open `signal-blue.ogs` with **File → Open Template Set** in Studio. The editable
set includes a headline, second line, three header states, bug with a live clock,
locator, continuous ticker, adjustable sidebar and Breaking takeover.

Use **Preview & Export** to take the headline first, then its second line and
header. The ticker reserves room before appearing and releases it after leaving.
Taking Breaking removes the headline family while retaining the other graphics;
taking Breaking out does not restore displaced templates.

Color controls target visible fills, gradient stops or text. The bug's **Channel
descriptor** and **Brand second line** controls edit the displayed labels. The
ticker measures the current text and repeats it with a 72-pixel gap at 140 pixels
per second; it has no fixed-distance x loop to retime when the text changes.

For external testing, export the set as a coordinated `.ograf.zip` with the dual
profile, extract it, and open its exact `.ograf.json` manifest in OGraf Devtool.
Use a 1920 × 1080 renderer viewport. See the [Devtool setup guide](../docs/guides/devtool-conditional-actions.md)
for the optional local conditional-form and remote-source integrations.
