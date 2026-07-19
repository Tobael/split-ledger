# Manual web release test plan

Run this checklist on the deployed HTTPS web application before starting Tauri integration. Use two unrelated browser profiles or physical devices so IndexedDB and identities are genuinely isolated.

## Deployment smoke test

1. Open the web domain and confirm onboarding loads without console errors.
2. Open `https://<relay-domain>/api/v2/health` and confirm a successful v2 health response.
3. Confirm an unauthenticated request to `/api/v2/admin/storage` returns `401` in the project deployment, then authenticate with the operator token and confirm the response contains only counts, byte totals, timestamps, and opaque namespace IDs.
4. Confirm the browser connects to `wss://<relay-domain>/ws`, not the web domain.
5. Reload after creating an identity and confirm the identity survives.

## Targeted invitation

1. On device A, create a group and add named, unclaimed participants.
2. Create a targeted invite for one participant and open it on device B.
3. Confirm B sees only the targeted identity, claims it, and reaches the group.
4. Reopen the same link in an isolated profile and confirm replay is rejected.
5. Replace an unclaimed participant's invite and confirm the old link fails while the replacement succeeds.

## Generic invitation

1. Create at least two unclaimed participants and generate an open invite.
2. Open it on device B and confirm only currently unclaimed identities appear.
3. Claim one identity and confirm the other remains unclaimed.
4. Reopen the link elsewhere and confirm the single-use capability cannot claim another identity.

## Expenses and corrections

1. Create an expense including both claimed and unclaimed participants.
2. Switch to custom distribution and exclude one participant.
3. Confirm the amount redistributes across the remaining participants and every included share remains editable.
4. Save, reopen the expense for editing, and confirm all stored shares are prefilled.
5. Correct the description, amount, payer, and shares; confirm both devices converge.
6. Remove the expense and confirm it disappears through a void operation rather than history deletion.

## Settlements

1. Create expenses that produce a non-zero balance.
2. Confirm both devices show identical payment suggestions.
3. Confirm only the paying participant can record the suggested settlement.
4. Record it and confirm balances update on both devices.

## Disposable relay behavior

1. Keep a complete group on device A, then stop or empty the relay database in a test deployment.
2. Open device B first and confirm it says that another group member must come online.
3. Bring A online and wait for synchronization.
4. Confirm A republishes its retained operation set and B recovers without a server backup.
5. Stop the relay and confirm existing local groups, expenses, and balances remain usable.

## Identity and device transfer

1. Export the v2 identity-transfer QR or password-encrypted file from device A.
2. Import it into a clean device B profile.
3. Confirm B generates a distinct device public key and regains every transferred group.
4. From A, revoke B and confirm B can no longer publish valid operations.
5. Confirm A remains usable and historical operations attributed to B remain visible.

## iOS messenger test

1. Send both targeted and generic HTTPS invite links through the actual messenger applications in scope.
2. Open each link inside the messenger's embedded browser and confirm the complete fragment survives.
3. Continue in the web application and confirm the isolated-browser warning is understandable.
4. Verify that an identity created in Safari is not misleadingly claimed to exist inside an isolated embedded browser.
5. Record which messengers strip fragments or force an external browser; these results drive Universal Link and landing-page behavior in Tauri.

## Release evidence

Record the web and relay commit, devices, OS/browser versions, relay host, pass/fail result, console errors, and screenshots for every failure. Do not begin Tauri deep-link work until targeted invites, generic selection, transfer, corrections, and empty-relay recovery pass on physical devices.
