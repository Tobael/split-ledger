# Recover groups from a version 2 identity export

If a Fair Money session still shows your expenses, use **Settings → Account Transfer → Export identity and groups** there to create a current backup. It includes the locally retained expense history and can be imported directly.

The recovery tool is for older access-only exports with inner transfer version 2. These exports hold the root identity and group access credentials. The outer encrypted file can also say `"v": 2`, which identifies the encryption format and does not identify the inner transfer version.

From the repository root, install dependencies with `npm ci` and run the following in a terminal with Node.js 22 or newer:

```bash
npm run recover:identity -- "/path/to/fair-money-identity.json"
```

Enter the original export password at the hidden prompt. The tool requests encrypted operations from the relay associated with each group. It decrypts them locally, verifies signatures, validates the operation graph and authorization, and requires the exported identity to own a claimed participant slot. For each group it reports the number of accepted operations or the reason it could not recover the history.

If at least one group was recovered, the tool writes a new encrypted transfer version 3 file and prints its path. Copy the file out of the temporary directory if you want to keep it. In a separate browser profile, open Fair Money and import the new file using the original password. Import replaces the identity and groups in the receiving profile. Check the recovered expenses before using the new session as your main copy.

If a relay cannot supply the necessary history, have a device or another group member with that history come online and synchronize. Then rerun the tool against the original export. A malicious relay can delay, omit, replay, or reorder ciphertext even though it cannot forge valid operations. A valid recovered history may still omit recent operations that the relay never received or chose not to return.

The tool leaves the input file and browser storage untouched and publishes no operations. The resulting snapshot retains the original root identity and recovered group histories. It creates a fresh identity directory because the old export does not contain one. Devices using another directory for that same identity can still synchronize histories through the individual group relays if they share group access.
