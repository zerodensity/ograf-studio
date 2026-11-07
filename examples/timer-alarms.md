# Timer alarms

Open [timer-alarms.ogs](timer-alarms.ogs) in Studio. This editable set contains
three examples at 1920 × 1080, 25 fps:

- **Automatic countdown:** starts at seven seconds, warns at five seconds left,
  and shows the final effect at zero.
- **Manual countdown:** receives its remaining time from the **Remaining time**
  data field, with the same five-second and zero alarms.
- **Count-up counter:** starts at zero, warns at five seconds elapsed, and shows
  the final effect at its seven-second limit.

## Properties and Rules

Select **Question timer**. In **Properties → Clock / Timer → Alarms**, each row
has an enable checkbox, threshold and **Edit rule** button. Countdown rows follow
the countdown's order: five seconds, then zero.

**Edit rule** selects that alarm in the unified Rules pane. Its **When → Timer
alarm** trigger names the source timer, threshold and counting direction. Choose
actions and targets under **Then**; optional conditions and timing remain ordinary
Rules settings. **+ Add alarm** creates another linked rule with no actions until
you choose them. Enabling or deleting the alarm changes that same rule.

## Play the examples

Use **Preview & Export** to take an example in the **Game timer** lane. The
automatic examples wait for **Start**; they do not start simply because they were
taken on air. Use the timer's **Start**, **Pause**, **Reset** and **Restart**
controls to try another run.

Each alarm fires once per run. Pause/Resume preserves its fired state; Reset and
Restart rearm it. Reset pauses an automatic timer at its initial value; Restart
starts it again immediately. Rearming does not undo an alarm's artwork changes.
This example includes separate ordinary **Reset artwork** and **Restart artwork**
rules that restore the original colors and hide the warning/final graphics when
those timer commands run.

For **Manual countdown**, send these **Remaining time** updates separately:

1. `00:07` — establish the starting value.
2. `00:04` — cross five seconds and trigger the warning.
3. `00:00` — trigger the final effect.

Manual values advance only when data changes. Reset/Restart rearms the alarms
without overwriting the external value. After resetting, send `00:07` again before
repeating `00:04` and `00:00`. Repeated identical values do not fire twice. A direct
live jump from seven seconds to zero applies the final alarm instead of replaying
an obsolete warning.

## Coordinated export

Export the set as a coordinated `.ograf.zip` with the **dual** profile for
real-time playback and deterministic non-real-time sampling in OGraf Devtool.
The package contains the three states in the **Game timer** lane, their linked
Rules, and generated timer actions. Automatic timers expose **Start**, **Pause**,
**Reset** and **Restart**. The manual timer exposes **Reset** and **Restart** only;
its external feed controls the value and does not need Start/Pause commands.

In Devtool, select the lane/state under **Take / update a slot**, then use **Run an
on-air template action** for the timer commands. Before sending data with the main
**Update** button, select the matching state under **Input Data → Playout slots**;
custom Take actions do not change that input form's selection.

For a non-real-time automatic-countdown check, schedule **Play** and the generated
timer **Start** action at time zero. Sample before five seconds remain, after that
threshold, and after the timer reaches zero. With the seven-second starting value,
those crossings occur two and seven seconds after Start. Repeated or backward
seeks should reproduce the same artwork without issuing live operator commands.
