# OGraf Studio Runtime Exception

> **Draft for discussion (#37).** This wording is a starting point for Zero Density's counsel,
> not a final license text.

Version 1.0, draft

## Additional permission

The OGraf Studio graphic runtime is licensed under the GNU Affero General Public License,
version 3 (the "AGPL"). As an additional permission under section 7 of the AGPL, Zero Density
gives you permission to convey a Graphic Package, and to make it available to users over a
network, under terms of your choice, even though the Graphic Package contains the Runtime,
provided that you retain the Runtime's license notice in the Graphic Package.

This permission covers the Graphic Package and the graphics it renders. It does not change the
license of the Runtime itself: if you convey the Runtime, or a modified version of it, other
than as part of a Graphic Package, the AGPL applies to it without this exception.

If you modify the Runtime, you may extend this exception to your version, but you are not
obliged to do so. If you do not wish to do so, delete this exception statement from your
version.

## Definitions

"Runtime" means the source code in `packages/ograf-runtime` of OGraf Studio, together with the
portions of `packages/scene-model` and `packages/ograf-types` that are compiled into the runtime
bundle (`graphic-runtime.js`), in any version published by Zero Density or modified from such a
version.

"Graphic Package" means an OGraf package, consisting of a manifest, a `main.js` module and its
resources, produced by exporting a project from OGraf Studio or from a modified version of it,
in which the Runtime is combined with the compiled description of that project.
