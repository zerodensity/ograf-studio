# Contributing to OGraf Studio

Thank you for your interest in contributing to OGraf Studio.

OGraf Studio is publicly distributed under the GNU Affero General Public License v3.0 (`AGPL-3.0-only`). To allow Zero Density to maintain, distribute, commercially license, dual-license, and otherwise develop the Project over time, contributions are accepted subject to the Contributor License Agreement below.

By submitting a Contribution to this repository, you agree to the terms in this document.

If you do not agree to these terms, please do not submit a Contribution.

## 1. Definitions

**"Project"** means OGraf Studio and associated software, documentation, examples, assets, and other materials maintained by Zero Density.

**"Zero Density"** means Zero Density and its affiliates, successors, and assigns.

**"Contribution"** means any code, patch, bug fix, documentation, artwork, design, test, configuration, or other material that you intentionally submit to the Project for inclusion, including material submitted through a pull request, commit, patch, or other contribution mechanism.

**"You"** means the individual submitting the Contribution, or the legal entity on whose behalf the Contribution is submitted where applicable.

## 2. Ownership of Your Contribution

You retain ownership of the copyright in your Contribution.

Nothing in this Agreement prevents you from using, licensing, distributing, or otherwise exploiting your Contribution independently of the Project.

The rights granted to Zero Density below are non-exclusive.

## 3. License Under the Project's Open-Source License

Contributions incorporated into the publicly available version of OGraf Studio may be distributed under the license applicable to that version of the Project, currently `AGPL-3.0-only`.

The following additional license grant to Zero Density exists independently of the license under which the public Project is distributed.

## 4. Copyright License Grant to Zero Density

You hereby grant Zero Density a perpetual, worldwide, non-exclusive, irrevocable, royalty-free, fully paid-up, transferable and sublicensable license, with the right to sublicense through multiple tiers, to:

- use and reproduce your Contribution;
- modify, adapt and prepare derivative works from your Contribution;
- combine your Contribution with other software or materials;
- publicly or privately display and perform your Contribution;
- distribute and make available your Contribution and derivative works in source-code, object-code, binary, hosted-service, or any other form;
- manufacture, market, sell, offer for sale, license and otherwise commercially exploit products and services incorporating your Contribution; and
- exercise all other copyright and related rights necessary to use and exploit your Contribution as part of the Project or products or services derived from the Project.

### Relicensing and Dual Licensing

The rights granted above expressly include the right for Zero Density to license, sublicense, distribute, or relicense your Contribution, as part of the Project or a derivative work, under **any license terms chosen by Zero Density**.

This includes, without limitation:

- the GNU Affero General Public License;
- other open-source licenses;
- source-available licenses;
- commercial licenses;
- proprietary or closed-source licenses; and
- different licenses offered simultaneously to different users or customers.

Zero Density may therefore distribute an open-source version of the Project while also distributing the same Project, portions of the Project, or derivative works incorporating your Contribution under different commercial or proprietary licensing terms.

Zero Density is not required to make source code available for versions distributed under a separate license where that separate license does not require source-code disclosure.

You acknowledge that Zero Density may charge fees for products, licenses, subscriptions, services, or other offerings incorporating your Contribution, and no royalty or other compensation will be owed to you as a result.

## 5. Patent License

To the extent your Contribution is covered by patent claims that you own or control and that would necessarily be infringed by your Contribution alone or by its combination with the Project as submitted, you grant Zero Density and recipients of software incorporating your Contribution a perpetual, worldwide, non-exclusive, royalty-free patent license to make, have made, use, offer to sell, sell, import, distribute, sublicense, and otherwise transfer such software.

This patent license applies only to patent claims that you have the authority to license.

## 6. Moral and Similar Rights

To the maximum extent permitted by applicable law, you waive and agree not to assert moral rights, droit moral, or similar rights in your Contribution to the extent necessary for Zero Density and its licensees to exercise the rights granted by this Agreement.

Where such rights cannot legally be waived, you consent, to the maximum extent permitted by applicable law, to Zero Density and its licensees exercising the rights granted by this Agreement without further approval from you.

## 7. Your Representations

By submitting a Contribution, you represent that:

1. you are legally entitled to grant the rights described in this Agreement;

2. the Contribution is your original work, except for material that you clearly identify as originating from a third party;

3. if your employer or another organization owns rights in the Contribution, you have obtained permission to make the Contribution and grant the rights described in this Agreement;

4. you are not knowingly submitting material subject to terms that would prevent Zero Density from exercising the rights granted by this Agreement; and

5. you will clearly identify any third-party code or other third-party material included in the Contribution and provide applicable copyright, attribution, and license information.

Do not submit third-party material unless its license permits its inclusion in the Project and you clearly identify the applicable license.

## 8. No Obligation to Use a Contribution

Submission of a Contribution does not require Zero Density to accept, incorporate, distribute, maintain, or continue using that Contribution.

Zero Density may modify, replace, remove, or discontinue Contributions or portions of the Project at its discretion.

Unless separately agreed in writing, Contributions are provided without compensation.

## 9. Agreement to These Terms

By intentionally submitting a Contribution to the Project, you confirm that you have read and agree to this Contributor License Agreement.

Pull requests from external contributors should include confirmation of the following:

> I have read and agree to the Contributor License Agreement in `CONTRIBUTING.md`, including the grant allowing Zero Density to use and relicense my Contribution under other open-source, commercial, or proprietary licenses.

Zero Density may require a separate signed Individual Contributor License Agreement or Corporate Contributor License Agreement for substantial contributions or where ownership of a Contribution requires additional clarification.

---

# Development Workflow

Create your feature or fix branch from `dev` and open pull requests against `dev`.

Keep each pull request focused on one change.

`stable` is the default branch and contains stable code. Maintainers promote tested changes from `dev` to `stable` when ready.

If you started from `stable`, `main`, or an older release, update your branch with `dev` before submitting.

The pull-request target check accepts contributions to `dev` and promotions from this repository's `dev` branch to `stable`.

Before requesting review or handing work over, run:

```bash
npm run verify
```

Update the relevant public guide or release notes when user-facing behavior changes.

Describe both the change and its verification in the pull request.

Keep internal planning, handover notes, and company documents outside the repository.
