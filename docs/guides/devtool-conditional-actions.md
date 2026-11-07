# Conditional lane, state and data controls in OGraf Devtool

Coordinated exports label `slotId` as **Lane** and `stateId` as **Template state**.
The initial pair selects a state from the first populated lane. Each lane has a
standard JSON Schema `allOf` branch with an `if` matching its `slotId` and a `then`
containing that lane's state choices and default. **Off** (`stateId:""`) is valid
in every lane.

A form host must interpret these conditional schemas to filter its controls.
JSON Schema validates data; its `default` annotation does not itself change an
operator's selection. The flat top-level state list remains available for
controllers without conditional form support. In those controllers, choose a
state belonging to the selected lane. The graphic validates lane/state membership
when an action is submitted.

## Configure a local Devtool checkout

The optional integration adapts both the main graphic-data form and custom-action
forms to these conditional schemas, recursively through nested objects and arrays.
From the Studio repository, run:

```sh
node scripts/configureDevtoolConditionalForms.mjs --devtool /path/to/ograf-devtool
```

Changing the lane or template state updates its public controls and supplies
defaults for newly available fields.
Fields belonging only to the previous state are removed, so hidden keys are not
resubmitted. Valid values in the selected branch are retained, as are unrelated
values in open schema objects; closed objects follow `additionalProperties:false`.
The package also enforces field exposure when external data arrives.

The current Devtool checkout also needs a resource URL fix when loading graphics
from its nested `/graphic/<manifest>` route. Its resource helper otherwise uses
the full page path as a service-worker resource origin; a second load, including
an in-depth check, can request `/graphic/<manifest>/REMOTE/main.js`. It can also
mistake an HTTP page for HTTPS when a remote URL in its query contains `https`.
Apply the focused local correction before rebuilding:

```sh
node scripts/configureDevtoolResourcePaths.mjs --devtool /path/to/ograf-devtool
```

This guarded, repeatable script backs up the original `client/src/lib/lib.js`
under `.ograf-studio-integration-backups/` and changes only its protocol/host
selection. It preserves absolute-resource handling, the `LOCAL`/`REMOTE` routes,
and path joining. Unexpected upstream edits require review. It changes no
exported graphic, schema validator, lifecycle checker, or test assertions and is
not an upstream Devtool release change. Its URL regression cases can be run with
`node --test scripts/configureDevtoolResourcePaths.test.mjs`.

For remote packages, also install per-page source recovery:

```sh
node scripts/configureDevtoolRemoteConfig.mjs --devtool /path/to/ograf-devtool
```

The upstream worker keeps its selected remote base and permitted origins in
memory. Browsers can stop that worker while a preview remains open. Its next
module import, such as an additional instance in the in-depth check, can then
fail with **No remote base url has been set**. This integration asks the requesting
controlled page for its current source through a private message port, so fresh
workers recover the correct base and packaged-resource permissions. Separate
Devtool pages retain their own source. Closing a source still clears it.

The guarded script backs up and updates `ServiceWorkerHandler.js` and
`service-worker.js`, and copies `lib/remoteClientConfig.js`. Rebuild and refresh
the client as described below. It changes no graphic exports, validation rules,
lifecycle checks, or test assertions. Other external origins still produce
permission warnings. Run its restart, page isolation, source clearing, and
permission regression cases with:

```sh
node --test scripts/configureDevtoolRemoteConfig.test.mjs
```

For reloadable links to graphics on ordinary file servers, also run:

```sh
node scripts/configureDevtoolRemoteRestore.mjs --devtool /path/to/ograf-devtool
node --test scripts/configureDevtoolRemoteRestore.test.mjs
```

The upstream URL synchronizer replaces a manifest's `remoteUrl` with its resource
folder, which cannot be rediscovered on a generic file server. This correction
keeps the exact manifest in shared links, including through service-worker
activation reloads, and preserves the current route, other query parameters, and
fragment. Older folder-only links recover the manifest from their retained
`/graphic/<manifest>.ograf.json` route before generic-folder discovery. Known
GitHub, OGraf-server, and sample-pack discovery retain their normal behavior.
The guarded script backs up `App.jsx` and `RemoteHandler.js` and copies
`lib/remoteGraphicLocation.js`; rebuild and refresh the client afterward.

Rapid renderer-setting changes can overlap imports, graphic loads, and disposal
in the upstream preview host. This can append two graphic elements or let a
delayed disposal remove the replacement. Install the request-ownership correction
before rebuilding:

```sh
node scripts/configureDevtoolLoadLifecycle.mjs --devtool /path/to/ograf-devtool
node --test scripts/configureDevtoolLoadLifecycle.test.mjs
```

The guarded integration updates `LayerHandler.js`, `Renderer.js`, and
`GraphicTester.jsx`, and copies `renderer/graphicLoadLifecycle.js`. The latest
request owns the host and its settings. Superseded imports never create a graphic
instance; superseded instances detach immediately and are disposed once their
load finishes. Delayed cleanup only touches its own instance. Previous
non-real-time seeks cannot consume or reset the replacement's seek queue.
Dynamic imports themselves are browser-managed and cannot be canceled.

After a non-real-time schedule changes, the integration invalidates the current
instance's cached seek timestamp. A fresh preview can be sampled while its
schedule is still empty during reload; replaying the same timestamp after the
schedule arrives must paint the scheduled graphics. Verify the visible frame at
the same playhead after a schedule edit, reload, or duration change, including a
nonzero timestamp. A pending sample retains its queue, and a superseded schedule
completion cannot invalidate a replacement instance's cache.

The regression suite reproduces the original duplicate-host failure using the
upstream lifecycle excerpts, and checks delayed imports, loads, disposals,
manifest responses, failures, and seek queues. The script backs up changed
sources, is safe to apply repeatedly, and rejects unfamiliar upstream edits.
This is a local Devtool host correction. It changes no exported graphic, schema,
OGraf action semantics, validator, lifecycle checker, or test assertions.

The conditional-form script updates the local action form (`GraphicAction.jsx`) and main
data form (`lib/GDD/ograf-form.jsx`), and adds the recursive conditional-form helper maintained
in `scripts/integrations/ograf-devtool/`. It backs up the replaced sources and rejects
unfamiliar upstream changes.
Rebuild the Devtool client using that checkout's normal build command, then run:

```sh
node scripts/configureDevtoolConditionalForms.mjs --devtool /path/to/ograf-devtool --refresh-client
```

This adds a content hash query to the built `index.js` entry in generated
`client/dist/index.html`. The upstream build uses a stable filename with a seven-day
cache lifetime; the query lets the browser fetch the changed client. It does not
edit additional tracked Devtool sources. Restart the server using that checkout's
normal start command, then reload using the full `remoteUrl` query pointing to the
exact exported `.ograf.json` manifest. This is a local integration, not a change
to an upstream OGraf Devtool release.

After loading a newly exported coordinated package, open **Graphic Control** and
find **Take**. Changing **Lane** now lists only that lane's states and **Off**, and
selects its first state (or **Off** for an empty lane). Choosing **Off** within the
current lane is preserved. Loading a valid supplied payload does not rewrite its
state; automatic selection happens when the operator changes lanes. The same
conditional handling applies to state-specific data controls in the main form
and nested custom-action payloads. Check that switching states loads defaults for
newly available fields and removes previous-state fields without discarding
unrelated open-context values.

## Template actions and loop groups

**Run an on-air template action** and the loop **Pause**, **Resume**, and **Advance**
commands also use dropdowns for `actionId` and `groupId`. Each command's **Lane**
list contains only lanes with executable template actions (including generated
clock/timer commands) or controllable timed
loop groups. Defaults select the first supported lane in lane order and its first
target. Changing lanes filters the target list and selects its default in a
conditional-aware form.

The choices combine targets from the relevant template states in that lane.
The static manifest does not know which template is currently on air: take the
matching template before running its action or loop command. The runtime checks
the current on-air template and rejects an unavailable target. These dropdowns
do not activate a template or change transition timing.

If no executable template actions exist in the set, that manifest command
and its duration entry are omitted. If no controllable timed loop groups exist,
the three loop commands and their duration entries are omitted. Untimed lifecycle
loops do not become controllable groups.

### Clock and timer commands

The **Run an on-air template action** selector includes each exported clock/timer's
**Start**, **Pause**, **Reset**, and **Restart** commands, labeled with its template
and layer. To exercise an automatic count-up or count-down timer:

1. In **Take**, select its lane and template state, then take it on air.
2. Under **Run an on-air template action**, select the same lane and the timer's
   **Reset** command. Run the action: its authored initial value appears and holds.
3. Choose **Start** and run it. The timer advances from that held value.
4. Choose **Pause** and run it. The displayed value stops advancing. **Start** resumes it.
5. Choose **Reset** again: the initial value returns and stays paused.
6. Choose **Restart**: the initial value returns and advances immediately.

These use the standard OGraf action envelope, without requiring a new renderer API:

```js
await graphic.customAction({
  id: 'template.action',
  payload: {
    slotId: 'your-lane-id',
    actionId: 'clock:' + encodeURIComponent('your-layer-id') + ':restart',
  },
});
```

Copy actual lane and action IDs from the package's operator guide. Commands are
validated against the current on-air template; the static dropdown can include
commands from other templates in the same lane. An unavailable target is rejected
without changing the active graphics. System-clock mode ignores timer commands.
For manual timers with alarms, the exported Reset and Restart commands rearm alarm
latches while the external feed keeps its value. Automatic timers retain their format,
limits, end behavior, bindings, paints and update Text FX. Commands do not alter
transition timing or dependencies.

For non-real-time output, scheduled commands and backward/repeated `goToTime`
sampling replay timer events on the shared playout clock. Wall time does not drive
these offline timer samples. Certification and Devtool runtime checks apply to
the exact exported package and its declared real-time/non-real-time profiles;
they do not establish support for every Studio feature or every external renderer.

**Clear** is unchanged: its form defaults to one lane, while API callers can omit
`slotId` to clear every lane. The integration does not change transition timing,
dependencies, or runtime action semantics.
