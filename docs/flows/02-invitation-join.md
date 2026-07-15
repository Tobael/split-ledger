# Invitation and join flow

```mermaid
sequenceDiagram
    actor Creator
    participant CreatorApp
    participant Link as HTTPS join link
    participant Recipient
    participant Client as Web or Tauri client
    participant Relay
    Creator->>CreatorApp: Create targeted or generic invite
    CreatorApp->>CreatorApp: Create single-use claim capability
    CreatorApp->>Relay: Publish encrypted issue operation
    CreatorApp-->>Link: Share signed invite
    Recipient->>Link: Open from messenger
    Link->>Client: Universal/App Link or web fallback
    Client->>Relay: Fetch encrypted group history
    Client->>Client: Validate invite scope, expiry, and capability
    opt Generic invite
        Client-->>Recipient: Show currently unclaimed participant identities
        Recipient->>Client: Choose one participant identity
    end
    Recipient->>Client: Confirm identity and claim
    Client->>Relay: Publish signed claim operation
```

## Embedded-browser behavior

The web fallback remains fully functional. It warns that an embedded iOS browser may not share identity storage with Safari or the installed application and offers Open App, Install App, Copy Code, and Continue in Browser.

Targeted invites display their fixed participant identity. Generic invites display the currently unclaimed participant identities after group history is available. A generic capability is still single-use: the first valid claim consumes it, regardless of which slot was selected.

## Lost invite

The creator revokes all active capabilities for the unclaimed slot and issues a new one. Historical expenses and balances continue referencing the same participant ID.

## Rejection conditions

- Invalid signature or malformed link.
- Expired, revoked, consumed, wrong-group, or wrong-slot capability.
- Slot already claimed or disabled.
- Claimant proof does not match the submitted identity key.
