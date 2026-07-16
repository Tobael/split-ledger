// ─── English Translations ───

export interface Translations {
    common: {
        cancel: string;
        back: string;
        save: string;
        copy: string;
        copied: string;
        loading: string;
        you: string;
        creator: string;
        active: string;
        settledUp: string;
        youOwe: string;
        youAreOwed: string;
        members: string;
        member: string;
    };
    onboarding: {
        tagline: string;
        taglineSub: string;
        featureEncrypted: string;
        featureDevice: string;
        featureNoAccount: string;
        getStarted: string;
        whatsYourName: string;
        nameSubtitle: string;
        namePlaceholder: string;
        createIdentity: string;
        keyHint: string;
        generatingTitle: string;
        generatingSub: string;
        importTitle: string;
        scanQrTitle: string;
        importInvalid: string;
        cameraError: string;
    };
    dashboard: {
        title: string;
        subtitle: string;
        joinGroup: string;
        newGroup: string;
        noGroupsTitle: string;
        noGroupsText: string;
        createGroup: string;
        viewDetails: string;
    };
    createGroup: {
        title: string;
        subtitle: string;
        nameLabel: string;
        namePlaceholder: string;
        currencyLabel: string;
        creating: string;
        createButton: string;
    };
    joinGroup: {
        title: string;
        subtitle: string;
        inviteLabel: string;
        invitePlaceholder: string;
        nameLabel: string;
        namePlaceholder: string;
        syncing: string;
        joining: string;
        joinButton: string;
        waitingForMember: string;
        loadInvite: string;
        invitedAs: string;
        chooseParticipant: string;
        chooseParticipantPlaceholder: string;
    };
    groupDetail: {
        backToGroups: string;
        invite: string;
        addExpense: string;
        inviteLinkTitle: string;
        membersTitle: string;
        balancesTitle: string;
        settlementsTitle: string;
        allSettled: string;
        expensesTitle: string;
        noExpenses: string;
        paidBy: string;
        viewChain: string;
        hideChain: string;
        removeMember: string;
        confirmRemove: string;
        settleUp: string;
        confirmSettleUp: string;
        markAsPaid: string;
        settlementDescription: string;
        deleteGroup: string;
        confirmDelete: string;
        accessDeniedTitle: string;
        accessDeniedText: string;
        exportData: string;
        waitingForMemberTitle: string;
        waitingForMemberText: string;
        addParticipant: string;
        participantNamePlaceholder: string;
        createInviteForParticipant: string;
        replaceInviteForParticipant: string;
        copyInvite: string;
        inviteCopied: string;
        voidExpense: string;
        payerMustSettle: string;
        settling: string;
        renameParticipant: string;
        saveParticipantName: string;
        disableParticipant: string;
        resetParticipant: string;
        confirmDisableParticipant: string;
        confirmResetParticipant: string;
        createGenericInvite: string;
        replaceGenericInvite: string;
        genericInviteHelp: string;
    };
    chain: {
        title: string;
        genesis: string;
        expense: string;
        memberAdded: string;
        memberRemoved: string;
        deviceAuthorized: string;
        deviceRevoked: string;
        rootKeyRotation: string;
        hash: string;
        previousHash: string;
        clock: string;
        signedBy: string;
        genesisBlock: string;
    };
    addExpense: {
        backTo: string;
        title: string;
        descriptionLabel: string;
        descriptionPlaceholder: string;
        amountLabel: string;
        currencyLabel: string;
        paidByLabel: string;
        splitLabel: string;
        equal: string;
        custom: string;
        eligible: string;
        excluded: string;
        customSplitHelp: string;
        splitEqually: string;
        perPerson: string;
        splitMismatch: (splitTotal: string, amount: string) => string;
        invalidAmount: string;
        invalidLedger: string;
        adding: string;
        addButton: string;
    };
    settings: {
        title: string;
        subtitle: string;
        identityTitle: string;
        displayNameLabel: string;
        rootKeyLabel: string;
        deviceTitle: string;
        transferTitle: string;
        transferDescription: string;
        exportButton: string;
        importButton: string;
        passwordPrompt: string;
        passwordMinLength: string;
        exporting: string;
        importing: string;
        exportSuccess: string;
        importSuccess: string;
        renameSuccess: string;
        importWarning: string;
        importError: string;
        wrongPassword: string;
        authorizedDevices: string;
        unknownDevice: string;
        thisDevice: string;
        revoke: string;
        confirmRevoke: string;
        securityTitle: string;
        securityEd25519: string;
        securitySigned: string;
        securityRelay: string;
        languageTitle: string;
        relayTitle: string;
        relayDescription: string;
        relayUrlLabel: string;
        relaySaved: string;
        relayInvalid: string;
        exportIdentityTitle: string;
        exportIdentitySubtitle: string;
        exportWarning: string;
        revealQr: string;
        keepPrivate: string;
        dangerZone: string;
        dangerZoneDesc: string;
        deleteAccount: string;
        deleteConfirm: string;
    };
    nav: {
        groups: string;
    };
    connection: {
        offline: string;
        relayUnavailable: string;
    };
    footer: {
        impressum: string;
        privacy: string;
    };
}

const en: Translations = {
    common: {
        cancel: 'Cancel',
        back: 'Back',
        save: 'Save',
        copy: 'Copy to Clipboard',
        copied: '✓ Copied!',
        loading: 'Loading…',
        you: 'you',
        creator: 'Creator',
        active: 'Active',
        settledUp: 'settled up',
        youOwe: 'you owe',
        youAreOwed: 'you are owed',
        members: 'members',
        member: 'member',
    },
    onboarding: {
        tagline: 'Split expenses with friends.',
        taglineSub: 'Cryptographically secure. Offline-first. Private.',
        featureEncrypted: 'End-to-end encrypted',
        featureDevice: 'Works on any device',
        featureNoAccount: 'No account required',
        getStarted: 'Get Started',
        whatsYourName: "What's your name?",
        nameSubtitle: 'This is how other group members will see you.',
        namePlaceholder: 'Enter your display name',
        createIdentity: 'Create Identity',
        keyHint: '🔑 A unique cryptographic identity will be generated on your device. No passwords, no accounts.',
        generatingTitle: 'Generating your identity…',
        generatingSub: 'Creating cryptographic keys on your device',
        importTitle: 'Scan QR to import identity',
        scanQrTitle: 'Scan Identity QR',
        importInvalid: 'Invalid QR Code. Please try again.',
        cameraError: 'Could not access camera. Please check permissions.',
    },
    dashboard: {
        title: 'Your Groups',
        subtitle: 'Manage shared expenses',
        joinGroup: 'Join Group',
        newGroup: '+ New Group',
        noGroupsTitle: 'No groups yet',
        noGroupsText: 'Create a new group or join an existing one to start tracking shared expenses.',
        createGroup: 'Create Group',
        viewDetails: 'Click to view details →',
    },
    createGroup: {
        title: 'Create Group',
        subtitle: 'Start a new expense-sharing group',
        nameLabel: 'Group Name',
        namePlaceholder: 'e.g., Summer Trip 2026',
        currencyLabel: 'Currency',
        creating: 'Creating…',
        createButton: 'Create Group',
    },
    joinGroup: {
        title: 'Join Group',
        subtitle: 'Paste an invite link from a group member',
        inviteLabel: 'Invite Link',
        invitePlaceholder: 'Paste invite link here',
        nameLabel: 'Your Display Name',
        namePlaceholder: 'How others will see you',
        joining: 'Joining…',
        syncing: 'Syncing group data…',
        joinButton: 'Join Group',
        waitingForMember: 'This relay does not currently have the group history. Ask another group member with this group on their device to come online, then try again.',
        loadInvite: 'Load invite',
        invitedAs: 'You were invited as',
        chooseParticipant: 'Choose your participant identity',
        chooseParticipantPlaceholder: 'Select a participant',
    },
    groupDetail: {
        backToGroups: '← Groups',
        invite: '🔗 Invite',
        addExpense: '+ Add Expense',
        inviteLinkTitle: 'Invite Link',
        membersTitle: 'Members',
        balancesTitle: 'Balances',
        settlementsTitle: 'Settlements',
        allSettled: 'All settled up! 🎉',
        expensesTitle: 'Expenses',
        noExpenses: 'No expenses yet. Add one to get started!',
        paidBy: 'Paid by',
        viewChain: '⛓ View Chain',
        hideChain: '⛓ Hide Chain',
        removeMember: 'Remove',
        confirmRemove: 'Are you sure you want to remove this member?',
        settleUp: 'Settle Up',
        confirmSettleUp: 'Are you sure you want to mark this as paid?',
        markAsPaid: 'Mark as Paid',
        settlementDescription: 'Settlement',
        deleteGroup: 'Delete Group',
        confirmDelete: 'Are you sure you want to delete this group? This cannot be undone.',
        accessDeniedTitle: 'Access Denied',
        accessDeniedText: 'You are not a member of this group or the group does not exist locally.',
        exportData: 'Export Data',
        waitingForMemberTitle: 'Waiting for group history',
        waitingForMemberText: 'Another group member who has the missing history needs to come online. Your existing local data remains available.',
        addParticipant: 'Add participant',
        participantNamePlaceholder: 'Participant name',
        createInviteForParticipant: 'Create invite',
        replaceInviteForParticipant: 'Replace invite',
        copyInvite: 'Copy invite',
        inviteCopied: 'Invite copied',
        voidExpense: 'Remove',
        payerMustSettle: 'The paying participant must record this payment.',
        settling: 'Recording…',
        renameParticipant: 'Rename',
        saveParticipantName: 'Save name',
        disableParticipant: 'Disable',
        resetParticipant: 'Reassign lost identity',
        confirmDisableParticipant: 'Disable this participant? Existing expenses remain in the history, but the participant cannot be used for new expenses.',
        confirmResetParticipant: 'Reset this claimed participant identity? This does not recover its key. It removes the current identity binding and allows a new person or device to claim the same participant and balances.',
        createGenericInvite: 'Create open invite',
        replaceGenericInvite: 'Replace open invite',
        genericInviteHelp: 'The recipient chooses one currently unclaimed participant.',
    },
    chain: {
        title: 'Hash Chain',
        genesis: 'Genesis',
        expense: 'Expense',
        memberAdded: 'Member Added',
        memberRemoved: 'Member Removed',
        deviceAuthorized: 'Device Authorized',
        deviceRevoked: 'Device Revoked',
        rootKeyRotation: 'Root Key Rotation',
        hash: 'Hash',
        previousHash: 'Previous',
        clock: 'Clock',
        signedBy: 'Signed by',
        genesisBlock: 'Genesis Block',
    },
    addExpense: {
        backTo: '← Back to',
        title: 'Add Expense',
        descriptionLabel: 'Description',
        descriptionPlaceholder: "e.g., Dinner at Luigi's",
        amountLabel: 'Amount',
        currencyLabel: 'Currency',
        paidByLabel: 'Paid by',
        splitLabel: 'Split',
        equal: 'Equal',
        custom: 'Custom',
        eligible: 'Included',
        excluded: 'Excluded',
        customSplitHelp: 'Click a participant to include or exclude them. Shares are redistributed equally and remain editable.',
        splitEqually: 'Split equally:',
        perPerson: 'per person',
        splitMismatch: (splitTotal: string, amount: string) =>
            `Split total (${splitTotal}) doesn't match amount (${amount})`,
        invalidAmount: 'Please enter a valid amount',
        invalidLedger: 'Invalid ledger state',
        adding: 'Adding…',
        addButton: 'Add Expense',
    },
    settings: {
        title: 'Settings',
        subtitle: 'Your identity and devices',
        identityTitle: 'Identity',
        displayNameLabel: 'Display Name',
        rootKeyLabel: 'Root Public Key',
        deviceTitle: 'This Device',
        transferTitle: 'Account Transfer',
        transferDescription: 'Move your identity to another browser or device',
        exportButton: '📤 Export Identity',
        importButton: '📥 Import Identity',
        passwordPrompt: 'Enter a password to protect the export:',
        passwordMinLength: 'Password must be at least 6 characters',
        exporting: 'Encrypting…',
        importing: 'Decrypting…',
        exportSuccess: 'Identity exported successfully!',
        importSuccess: 'Identity imported successfully! Reloading…',
        renameSuccess: 'Name updated successfully!',
        importWarning: 'This will replace your current identity. Make sure you have a backup.',
        importError: 'Failed to import identity',
        wrongPassword: 'Wrong password',
        authorizedDevices: 'Authorized Devices',
        unknownDevice: 'Unknown Device',
        thisDevice: 'This Device',
        revoke: 'Revoke',
        confirmRevoke: 'Are you sure you want to revoke this device? It will be removed from all groups.',
        securityTitle: 'Security',
        securityEd25519: 'Ed25519 cryptographic identity',
        securitySigned: 'All entries are signed and hash-linked',
        securityRelay: 'Disposable encrypted relays; complete history remains on member devices',
        languageTitle: 'Language',
        relayTitle: 'Relay server',
        relayDescription: 'New groups use this relay for encrypted synchronization. Existing groups keep the relay contained in their group access data.',
        relayUrlLabel: 'WebSocket relay URL',
        relaySaved: 'Relay preference saved',
        relayInvalid: 'Enter a valid secure relay URL, for example wss://relay.example.org/ws',
        exportIdentityTitle: 'Export Identity',
        exportIdentitySubtitle: 'Scan this QR code on another device to log in.',
        exportWarning: 'This QR code contains your private key. Do not share it!',
        revealQr: 'Reveal QR Code',
        keepPrivate: 'Keep this screen private!',
        dangerZone: 'Danger Zone',
        dangerZoneDesc: 'Irreversibly delete your account, keys, and local data from this device. You will lose access to all groups unless you have a backup.',
        deleteAccount: 'Delete Account',
        deleteConfirm: 'Are you absolutely sure? This will delete all your local keys and data irreversibly.',
    },
    nav: {
        groups: 'Groups',
    },
    connection: {
        offline: 'You are offline. Changes remain saved on this device and will synchronize when a connection returns.',
        relayUnavailable: 'The relay server is unavailable. You can keep working locally, but synchronization and invitations may not work until it reconnects.',
    },
    footer: {
        impressum: 'Legal Notice',
        privacy: 'Privacy Policy',
    },
};

export default en;
