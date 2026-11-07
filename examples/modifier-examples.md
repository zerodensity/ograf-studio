# Modifier examples

Open [modifier-examples.ogs](modifier-examples.ogs) in Studio. This editable set
contains Grid Arrange, Radial Arrange, Justify, Look At, Spline Path and Responsive
Text examples at 1600 × 900, 50 fps.

Use **Templates** or Preview & Export's Previous/Next buttons to select an example.
Take it in to play its entrance. In fullscreen, Left/Right visits the current
template's steps before moving to the neighboring template and playing its entrance.

## Data to try

- **Justify:** clear **Sponsor 2**, enter a long sponsor name, then restore `SPORT`.
  Empty or whitespace-only values hide the middle card and center the remaining
  cards. Long labels squeeze within their card.
- **Responsive Text:** change **Headline** to `LIVE`, a long sentence, Unicode
  text or an empty value. The backing and badge follow the rendered text; empty
  content hides the group. Restore `DESIGNED TO ADAPT` afterward.

Radial, Look At and Spline animate over their 100-frame entrance. The other
examples demonstrate arrangement and data-driven layout. These examples have no
loop groups.

## Coordinated export

The set includes one lane, **Modifier example**, with six template states. Export
the set as a coordinated `.ograf.zip` using the dual profile to exercise real-time
and non-real-time playback in OGraf Devtool.

Use **Take / update a slot** to select a state. Before using the main **Update**
button to send data, select that same state under **Input Data → Playout slots**.
The main Update payload includes its state selection; custom actions do not rewrite
Devtool's input form. For non-real-time sampling, add a **Play** event at time zero
before seeking. Wait for actions to complete before judging a settled preview.

The authored exit is 25 frames (0.5 seconds). Switching waits for that exit, then
plays the next 100-frame entrance. Static examples hold their design during that
exit; this deliberate timing is not a render stall.
