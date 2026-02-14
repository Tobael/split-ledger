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
        markAsPaid: string;
        settlementDescription: string;
        deleteGroup: string;
        confirmDelete: string;
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
        securityP2P: string;
        securityRecovery: string;
        languageTitle: string;
    };
    nav: {
        groups: string;
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
        taglineSub: 'Cryptographically secure. Peer-to-peer. Private.',
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
        markAsPaid: 'Mark as Paid',
        settlementDescription: 'Settlement',
        deleteGroup: 'Delete Group',
        confirmDelete: 'Are you sure you want to delete this group? This cannot be undone.',
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
        securityP2P: 'Peer-to-peer sync (no central server stores your data)',
        securityRecovery: 'Social recovery available for root key rotation',
        languageTitle: 'Language',
    },
    nav: {
        groups: 'Groups',
    },
};

export default en;
