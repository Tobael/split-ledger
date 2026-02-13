# 10. Key Management UX Design

## Design Principle

> The user should never see a raw public key or think in terms of cryptographic primitives. They interact with **devices**, **groups**, and **recovery contacts**.

---

## 10.1 First Launch (Identity Creation)

### Flow

```
┌───────────────────────────────┐
│   Welcome to SplitLedger      │
│                               │
│   Your expenses. Your data.   │
│   No account needed.          │
│                               │
│   ┌─────────────────────┐     │
│   │  Enter your name    │     │
│   └─────────────────────┘     │
│                               │
│   [Get Started]               │
│                               │
│   Your identity is created    │
│   entirely on this device.    │
│   No email or password.       │
└───────────────────────────────┘
```

### Behind the Scenes

1. Generate root Ed25519 keypair → store in `expo-secure-store` (native) or Web Crypto `CryptoKey` with `extractable: false` (web)
2. Generate device keypair → store alongside
3. Create device authorization (self-signed by root key)
4. Display: "✓ Identity created on [Device Name]"

### UX Notes

- **No seed phrase on first launch.** Showing 12/24 words to a new user who just wants to split dinner is hostile UX.
- Instead, prompt for backup **after first group creation** with a gentle nudge:
  - "You've created your first group! To protect your account if you lose this device, add another device or set up recovery."

---

## 10.2 Device Management

### Settings → My Devices

```
┌───────────────────────────────┐
│  My Devices                   │
│                               │
│  ● Tobias's iPhone (this)     │
│    Added: Jan 15, 2026        │
│    Last active: just now      │
│                               │
│  ● Tobias's iPad              │
│    Added: Feb 1, 2026         │
│    Last active: 2 hours ago   │
│    [Revoke]                   │
│                               │
│  [+ Add Device]               │
└───────────────────────────────┘
```

### Add Device Flow

```
Device A (existing)                    Device B (new)
─────────────────                      ─────────────
1. Tap [+ Add Device]                 1. Install app, tap "I have an account"
2. Display QR code containing:        2. Scan QR code
   - root public key                  3. Display confirmation:
   - one-time pairing token              "Link to Tobias's account?"
   - expiry (5 minutes)               4. Tap [Confirm]
3. Scan succeeds →                    5. Device B operational
   "Device B linked ✓"
```

### Revoke Device Flow

1. Tap [Revoke] on a device
2. Confirmation dialog: "Revoke Tobias's iPad? This device will no longer be able to post expenses."
3. On confirm: create `DeviceRevoked` ledger entry for all groups
4. Show: "Device revoked ✓"

---

## 10.3 Root Key Backup Options

### Settings → Security → Backup

Three progressive options, ordered by ease of use:

| Method | UX | Security | When to Suggest |
|--------|-------|----------|----------------|
| **Multi-device** | Add a second device (QR scan) | Device diversity | After first group created |
| **Social recovery** | "Your group can help you recover" | Majority threshold | After joining a group with 3+ members |
| **Manual backup** | Export encrypted seed (advanced) | BIP39 mnemonic | Advanced settings, power users |

### Social Recovery Setup

Social recovery requires no explicit "setup" — it's available by default for any group with 3+ members.

**Settings → Security:**
```
┌───────────────────────────────────────┐
│  Account Recovery                     │
│                                       │
│  If you lose all your devices, your   │
│  group members can help you recover.  │
│                                       │
│  Recovery status by group:            │
│                                       │
│  🏠 Apartment 4B                      │
│     4 members → need 3 to recover ✓   │
│                                       │
│  🍕 Pizza Night                       │
│     2 members → need 2 to recover ⚠   │
│     (consider adding more members)    │
│                                       │
│  [Learn how recovery works →]         │
└───────────────────────────────────────┘
```

---

## 10.4 Recovery Ceremony UX

### Lost Device — Initiating Recovery

```
New device / reinstall:

┌───────────────────────────────────────┐
│  Welcome back                         │
│                                       │
│  ○ Link to existing device (QR)       │
│  ○ Recover with group help            │
│  ○ Restore from backup phrase         │
│  ○ New identity                       │
│                                       │
│  [Continue]                           │
└───────────────────────────────────────┘
```

### Recovery with Group Help

**Step 1 — Alice (recovering) selects group:**
```
┌───────────────────────────────────────┐
│  Group Recovery                       │
│                                       │
│  Enter the name of a group you        │
│  belong to, or scan a recovery QR     │
│  from a group member.                 │
│                                       │
│  ┌─────────────────────────┐          │
│  │  Group name or ID       │          │
│  └─────────────────────────┘          │
│                                       │
│  [Request Recovery]                   │
└───────────────────────────────────────┘
```

**Step 2 — Group members receive recovery request:**
```
┌───────────────────────────────────────┐
│  🔔 Recovery Request                  │
│                                       │
│  Alice is requesting account          │
│  recovery for group "Apartment 4B".   │
│                                       │
│  Please verify Alice's identity       │
│  through a separate channel           │
│  (call, in person, etc.)              │
│                                       │
│  ⚠ Only approve if you are SURE       │
│  this is really Alice.                │
│                                       │
│  [Approve Recovery]  [Deny]           │
└───────────────────────────────────────┘
```

**Step 3 — Alice sees progress:**
```
┌───────────────────────────────────────┐
│  Recovery in progress...              │
│                                       │
│  ✓ Bob approved                       │
│  ✓ Carol approved                     │
│  ◻ Dave (pending)                     │
│                                       │
│  Need 3 of 4 members.                │
│  2 of 3 received ──────────░░         │
│                                       │
│  Share this screen with your group    │
│  to let them know you need help.      │
└───────────────────────────────────────┘
```

**Step 4 — Threshold reached:**
```
┌───────────────────────────────────────┐
│  ✓ Recovery Complete!                 │
│                                       │
│  Your account has been restored.      │
│  Your old devices have been           │
│  automatically revoked.               │
│                                       │
│  [Go to Apartment 4B →]              │
└───────────────────────────────────────┘
```

---

## 10.5 Key Visibility

| Context | What User Sees | What Happens |
|---------|----------------|-------------|
| Profile | Display name + avatar | Root pubkey is the underlying ID |
| Device list | Device names + last active | Device pubkeys are hidden |
| Group members | Names | Root pubkeys shown only in "Advanced info" |
| Debug/advanced | Truncated pubkey: `ed25519:a1b2...f3e4` | Copy-to-clipboard for support |

---

## 10.6 Security Indicators

```
Group Header:
┌────────────────────────────────────┐
│  🏠 Apartment 4B          🔒      │
│  4 members · synced 2s ago         │
└────────────────────────────────────┘

🔒 = all entries validated, chain intact
🔶 = sync in progress
🔴 = validation error detected (tap for details)
```
