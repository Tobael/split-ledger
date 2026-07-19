# Manual web release results

Complete this record against the deployed HTTPS application before initializing Tauri. Do not mark an item passed from automated tests alone.

## Release under test

| Field | Value |
|---|---|
| Web commit | Pending deployment |
| Relay commit | Pending deployment |
| Web URL | `https://money.betz.coffee` |
| Relay URL | `https://relay.betz.coffee` |
| Test date | Pending |
| Tester | Pending |

## Devices

| Label | Hardware | OS version | Browser or messenger | Version |
|---|---|---|---|---|
| A | Pending | Pending | Pending | Pending |
| B | Pending | Pending | Pending | Pending |
| iOS embedded | Pending | Pending | Pending | Pending |

## Results

Use `Pass`, `Fail`, or `Blocked`. Link screenshots or logs only after removing invite fragments, capabilities, identity exports, and private data.

| Area | Result | Evidence or failure notes |
|---|---|---|
| Deployment and authenticated relay administration | Pending | |
| Identity persistence after reload | Pending | |
| Targeted invite and replay rejection | Pending | |
| Reissued targeted invite invalidates the old link | Pending | |
| Generic invite slot selection and replay rejection | Pending | |
| Expense custom distribution and editable shares | Pending | |
| Expense correction and void convergence | Pending | |
| Settlement authorization and convergence | Pending | |
| Empty-relay recovery from an online member | Pending | |
| Local group use while relay is unavailable | Pending | |
| Password-encrypted identity transfer to a fresh device | Pending | |
| New device receives a distinct key | Pending | |
| Device revocation | Pending | |
| iOS messenger fragment preservation | Pending | |
| Isolated-browser explanation | Pending | |

## Go or no-go

Tauri initialization is permitted only when targeted and generic invitations, corrections, transfer, and empty-relay recovery pass on physical devices and no unresolved failure threatens identity persistence or synchronization correctness.

Decision: **Pending**

Blocking failures: None recorded yet.
