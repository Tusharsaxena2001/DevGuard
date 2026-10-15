# ADR-010: Platform scope for the MVP/hackathon: Linux first

**Status:** accepted
**Decision:** The MVP is built and tested on **Linux** only (developed on Ubuntu, Node >= 22, Git from the distro). macOS is expected to work because it is also POSIX (same permission, symlink and hook semantics), but it is **not tested** and is not claimed as supported. **Windows is out of scope** for the hackathon and is documented below as future work. No code is written to be deliberately Windows-hostile: pure logic (`packages/shared`, `packages/policy-engine`) has no OS dependence.
**Why:** a hackathon time box and a Linux dev/test environment. Claiming support for platforms we cannot test would be dishonest and would hide real gaps (see below).
**Consequences:**
- Every claim of "works" in docs, demos and the README means Linux. Platform-specific tests may skip on other platforms; skipped tests are not evidence.
- Local-state protection (AG-1) relies on POSIX mode bits, ownership and `O_NOFOLLOW`; on Windows these checks do nothing, so credentials there would be unprotected beyond default profile ACLs.

## Future work: Windows (and macOS verification)
Unverified list, from review, to be turned into modules when a Windows target is required:
1. **Credential and state protection:** replace mode-bit checks with Windows ACLs or, better, the Windows Credential Manager/DPAPI; move state to `%APPDATA%` instead of `~/.config`.
2. **Git hook launch:** Git for Windows runs hooks via its bundled shell; `#!/usr/bin/env node` does not run natively, so ship a `.cmd` shim or a single packaged executable (a packaged executable also removes the "Node must be installed" requirement on every OS).
3. **Paths and file names:** backslash vs `/` normalisation at the Git boundary; NTFS tricks (`.env ` trailing space, `::$DATA`, 8.3 short names like `ENV~1`) that SH-3 does not normalise; long-path handling.
4. **Atomic writes:** renaming over an existing file can fail on Windows while another process (e.g. antivirus) has it open; add retry or a different strategy.
5. **Git and process handling:** locating `git.exe`, quoting, no shell (`execFile`) must be re-verified; `core.hooksPath` and global config locations differ.
6. **Tests/CI:** symlink, FIFO and mode tests are POSIX-only and skip or fail on Windows; a Windows CI runner is required before any support claim.
7. **macOS:** run the full suite and the Gate 1 demo on a Mac before claiming support (e.g. case-insensitive default filesystem, different default `/tmp` symlink, Git from Xcode vs Homebrew).
