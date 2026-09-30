# Windows installer hardening and release gate

## Implemented in the project

- Windows releases are built as an NSIS installer; development startup remains unchanged.
- The app payload is packed into `app.asar`; Electron's embedded ASAR integrity check is enabled and unpacked-app fallback is disabled.
- Node inspector command-line switches are disabled in the packaged Electron runtime.
- The app remains per-user installable and keeps local user data when uninstalled.
- The renderer still uses `file://`, so the file-protocol fuse remains enabled. DSH is launched through Electron with `ELECTRON_RUN_AS_NODE`; `runAsNode` must remain enabled until DSH is moved to a separately bundled Node runtime.
- The installer file list contains the built UI and compiled desktop runtime, not the TypeScript source, tests, scripts, or docs. Packaged JavaScript can still be extracted; ASAR is integrity protection, not encryption.
- Full edition uses an offline Ed25519 device license. The private signing key and issue ledger live under the seller's local app-data directory, never in the installer; the installer contains only the public verification key. Each activation is bound to a Windows MachineGuid-derived opaque code. The seller-side ledger permits up to two distinct devices per order; there is no server-side revocation or remote seat counting.
- The trial edition intentionally has no activation requirement and contains only its standalone historical-case replay UI/data, not the live DSH/search backend. Production bundling/minification and ASAR integrity are not encryption; do not claim trial algorithms are impossible to extract.

Build commands:

```powershell
npm run dist:win:dir  # unpacked Windows app for smoke tests
npm run dist:win      # Alias of dist:editions
npm run dist:editions # Separate offline trial and full installers; the full build verifies and bundles locked DSH
```

The older `dist:win:dir` command builds an unpacked development app without DSH provisioning; do not distribute it as the paid full edition.

## Before selling a release

1. Build and test the installer on a clean Windows account or VM. Confirm first launch, key entry, map load, search, DSH availability, restart, upgrade, and uninstall/reinstall data retention.
2. **DSH provisioning was added to the dual-edition build on 2026-09-24.** `npm run dist:editions` checks the pinned DSH tree and includes it only in the full installer under `resources/capabilities/dsh/0.1.1-rc.2`; the installed runtime verifies the same lock. The trial installer is built from a separate minimal directory and must contain no full backend or DSH. The following 0.2.26 installation and trial observations are historical; the current 0.2.27 installed-package and real-search results are recorded below.
   The initial trial installer `Shiji-Trial-Setup-0.2.26-x64.exe` opened a blank window: its `file://` UI was blocked by a trial-only Electron fuse override. It was also based on a separate simplified UI, contrary to the product requirement. The replacement is `Shiji-Trial-Setup-0.2.26-r1-x64.exe`: it keeps the file-protocol fuse enabled and uses the original 识机 frontend with two labeled historical cases. The packaged executable loaded the original UI; project detail, timeline, and drag-to-compare were exercised in the runtime check. Do not distribute the initial file; it has been removed from this release directory. A clean Windows installer acceptance run is still required before distribution.
   `Shiji-Trial-Setup-0.2.26-r1-x64.exe` is also superseded: its analysis buttons were disabled, so it did not demonstrate the paid workflow. `Shiji-Trial-Setup-0.2.26-r2-x64.exe` retains the original UI and replays dated, source-bound historical results through the existing timeline / policy / industry / credit-risk / leads result contracts without bundling the live backend. The final r2 installer was installed over r1 on the development machine (silent installer exit 0); the installed UI produced policy, industry, leads, timeline and public-risk cards for both cases. Dragging a case from 总览 into 行动清单 generated evidence-backed historical review actions, including timeline, agent contact and tender-detail steps. Final guide text appeared after reinstall. Final r2 SHA-256: `881885930DB4135822C375366B5184B40FE50C38D79ED61F07ACA08823A6F008`. This is offline replay, not a new search or validation of current project status. Clean-account acceptance is still required before distribution.
3. For public Windows distribution, sign the final installer and executable with a publisher certificate, keep the same publisher identity for updates, and timestamp signatures. Supply signing credentials only through the build environment (for electron-builder, `CSC_LINK` and `CSC_KEY_PASSWORD`); never commit the certificate or password.
4. Record the release version, installer SHA-256, DSH release-lock hash, test result, and signing identity. Distribute the hash beside the download so buyers can detect a damaged or replaced installer.

## Security boundary

ASAR integrity catches modification of the packaged app archive at startup, and a valid code signature lets Windows detect post-signing changes to signed binaries. These measures raise the cost of casual repackaging and make tampering detectable; they cannot stop a determined owner with local administrator/debugger access from reverse engineering or patching a client they control. Do not put provider secrets, private signing keys, or other durable server secrets in the desktop package. Avoid obfuscators or self-modifying/encrypted bundles: they add update and support risk without making a local client uncrackable.

The 0.2.27 installed-package DSH gate and a real search passed on the development Windows account, as recorded below. A clean Windows account or second computer has not yet been tested. Both installers are currently unsigned (`Get-AuthenticodeSignature: NotSigned`), so Windows may show an unknown-publisher warning. Do not represent the release as signed or independently verified on another computer.

## 0.2.27 installed-package acceptance (2026-09-26)

- The full installer completed a silent install with exit code 0 at `D:\ShijiAccept027`. The device-bound Ed25519 activation screen displayed a device code, accepted a locally issued test activation code, and relaunched into the original full UI. No private signing key or seller ledger was included in the installer.
- The seller issue command was exercised with a clearly named internal acceptance order: the first and second distinct device codes succeeded, a repeat request for the second code succeeded idempotently, and a third distinct device was rejected with exit code 1. The internal acceptance order remains in the seller-only ledger and does not consume a buyer order.
- In the installed app with the developer's already configured local credentials, DeepSeek connection reported two available models and the Doubao Custom connection diagnostic returned one result. The Doubao diagnostic consumed one search call. The actual nearby free query `成都附近施工招标公告，金额不限，时间不限，只要1个具体项目` subsequently returned five search sources, four readable bodies, one DSH-structured project, and one final project card. The map loaded its center; that announcement had no extracted project address, so it correctly showed zero project pins and did not substitute the procurer's address.
- The first free radar query with an empty long-term business profile stopped after model intent parsing and did not start a provider search; this is an existing product condition, not evidence that the installed search backend failed. The nearby query above exercised the paid search, DSH structuring, local result card and map flow.
- The packaged Windows x64 DSH payload uses a separate release lock from the all-platform developer tree. It excludes declaration/source-map files and ARM64 native binaries. The installed payload passed the x64 manifest check: 12,573 files, SHA-256 `4cb425ab5e50edf3eb1ccadad2b0851ff052fe9d0adbc8fbd9528e6360c05ee5`.
- The separately rebuilt delivery full archive has the same `app.asar` SHA-256 as the installed and tested build: `8F00CB8FE1E93D4C2145BB6A7F1468145F6408D2404CDE5DF18069B98C710908`. Both trial and full installers completed the edition build. The trial archive isolation check found only its 11 allowed entries, with no full desktop backend or DSH package. Full suite: 67 test files / 481 tests passed; typecheck, production build and selfcheck passed.
- Clean handoff folder: `D:\工作学习文档总结\商机安装包\识机-0.2.27-可交付` (two EXEs plus buyer instructions; `.blockmap` is not needed for direct installer handoff). Installer SHA-256: full `E6E6A435A266D2C28337C6B5F00E879FAD58EE872A390690CCC3FA146DF8A65A`; trial `ABAA7E38B85833B79FCC6ED96113EDEF0CB03F6A2542801841F76533269A2E10`.
- The two editions now use different builder output directories. When both reused `win-unpacked/resources/app.asar` in one build process, electron-builder's archive checker saw the earlier trial header and incorrectly reported the full entry point missing, even though the final archive contained and exposed `main.js`. The isolated output paths resolve this packaging failure without changing the runtime UI.
- Remaining external acceptance: install both final EXEs on a clean Windows account or a second PC; verify activation, user Key entry, one live query, restart and uninstall/reinstall. Record the result before promoting beyond a controlled sale. Obtain a publisher signing certificate if the unknown-publisher warning is unacceptable.

## Offline license issuing

1. Run `node scripts/license-admin.mjs generate` once on the seller Windows account. It creates the app's public key in `licenses/`, an encrypted Ed25519 private key, and a DPAPI-protected random passphrase outside the repository. The private key can only be unlocked by the Windows account that generated it; a Windows-account migration or OS reinstall needs a planned key migration and a rebuilt package.
2. The buyer installs the full package and sends the displayed device code. Run `node scripts/license-admin.mjs issue --order <internal-order-id> --device <device-code>` and send only the output activation code back to that buyer.
3. The issuer ledger allows two distinct machine codes for each order and makes reissuing the same device idempotent. Keep the issuer directory; the ledger is not synchronized or remotely enforced, and the DPAPI passphrase blob is not a portable backup.
4. For a replacement computer, handle a seat transfer manually and preserve the original order record. The local app cannot remotely revoke an already issued offline token.
