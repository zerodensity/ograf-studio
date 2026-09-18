# Contributing

Create your feature or fix branch from `dev` and open pull requests against `dev`.
Keep each pull request focused on one change. `stable` is the default branch and
contains the stable code; maintainers promote tested changes from `dev` to `stable`
when ready.

If you started from `stable`, `main`, or an older release, update your branch with `dev` before
submitting. The PR target check accepts contributions to `dev` and promotions from
this repository's `dev` branch to `stable`.

Before requesting review or handing work over:

```bash
npm run verify
```

Update the relevant public guide or release notes when user-facing behavior changes. Describe the
change and verification in the pull request. Keep internal planning, handover notes and company
documents outside the repository.
