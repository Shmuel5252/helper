# Oracle Gemini host — setup status

Updated 2026-10-22. The owner authorized an Always Free server only; no paid
upgrade, trial-credit-dependent resource, or paid Gemini API fallback is allowed.

## Verified in Oracle console

- Instance: `ai-chat-gemini`, **Running**.
- Region: `il-jerusalem-1`, availability domain AD-1.
- Shape: `VM.Standard.A1.Flex`, 1 OCPU, 6 GB RAM; Always Free-eligible.
- Image: Canonical Ubuntu 24.04 Minimal aarch64, build 2026.09.18-0.
- Default boot volume: 46.6 GB; in-transit encryption enabled, no extra volumes.
- Optional Cloud Guard Workload Protection was excluded from the creation form.
- VCN/subnet: `ai-chat-network` / `ai-chat-subnet`, 10.0.0.0/24.
- Private address: 10.0.0.145. Public address: 151.145.89.185 (ephemeral).
- The VCN already has an internet gateway and the required default route.
- The owner personally entered the dedicated SSH public key and continued.
- The owner explicitly approved public-IP detection via api.ipify.org and SSH
  access restricted to their current connection. That check succeeded. The
  subnet's TCP/22 ingress rule now uses only the approved /32 source, verified
  in the console. The default ICMP network-error rules remain unchanged.
- SSH connected successfully as `ubuntu`; the dedicated local known_hosts file
  now pins the host key and subsequent connections require an exact match.
- `scripts/oracle/bootstrap.sh` was installed successfully on the host.
- Display, private desktop and login-viewer services are active.
- Ports 5900 and 6080 listen only on loopback. There is no public browser UI.
- Google rejected sign-in in the Playwright-launched browser. That browser's
  `ai-chat-browser.service` is now disabled and stopped.
- Canonical's stable Chromium snap 155.0.8059.84 (revision 3564) is installed.
  `scripts/oracle/regular-browser.sh` launches it as the dedicated unprivileged
  `gemini-browser` user, with a separate private profile and a lingering user
  service. The owner completed sign-in in this browser. The worker subsequently
  attaches through CDP on **127.0.0.1:9222 only**, retaining the authenticated
  profile and standard sandbox. No public debugging port is exposed.
- Do not rerun bootstrap.sh blindly: it enables the older browser service.
- Ubuntu's global AppArmor user-namespace restriction remains enabled. A profile
  allows user namespaces for the exact root-owned Chromium executable only.
  Renderer processes were verified with `NoNewPrivs: 1` and `Seccomp: 2`.
- A local SSH tunnel exposes the login viewer at
  `http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale` while maintained.
- The signed-in server browser and its image/video menu were verified visually.
- `ai-chat-worker.service` polls the production Vercel endpoint outbound. It runs
  as `gemini-browser`; its separate credential is in a root-owned, group-readable
  environment file. It does not use the paid Gemini API key.
- Queue migrations 003, 004 and 005 are applied. Source chat links, response text and
  original media are persisted through the private archive protocol.

Instance OCID:
`ocid1.instance.oc1.il-jerusalem-1.anwxiljrg2yvflqcvsx3dcdqnamqwssl6p2hlyrzxp2kwnh3e33hm2r336jq`

The private SSH key is local and git-ignored. Do not publish it or include it in
deployment files. Public key fingerprint can be checked locally before connecting.

## Operation

- Production: https://helper-zeta-eight.vercel.app/gemini . Select the account
  image/video options. Paid API options and credentials were removed on 2026-10-22.
- Owner archive: `/admin/archive`, protected by the separate owner code.
- Device chats remain isolated by their private device cookie. The owner archive
  can show all of them; ordinary chat has no archive status or backup messages.
- If Google asks for sign-in or verification, the owner must resolve it in the
  server browser. No local-PC cookies are exported or verification bypassed.
- Do not rerun `regular-browser.sh` on this configured host: it recreates the
  initial login unit without the worker's loopback CDP arguments.
- Worker source is `/opt/ai-chat-gemini/worker`. Update files then restart only
  `ai-chat-worker`, leaving the authenticated browser and its profile running.
- Download/input staging is under the private snap profile's sibling
  `worker-downloads` directory, accessible to both snap Chromium and the worker.
- Video generation explicitly selects the existing account's 3.1 Pro mode.
  Flash returned a language-model refusal in the live test. No subscription or
  API purchase is triggered by the worker.
- Download completion uses a browser CDP session and correlates the download URL
  and filename with Playwright's page-scoped download event. Video downloads can
  originate in a popup, so comparing only the main frame ID is incorrect.
- Submitted jobs are never automatically regenerated after a timeout or crash.
  They become uncertain and retain the Gemini source link for owner inspection.
- An explicit owner maintenance recovery can queue a failed job with a saved
  source and no reserved file. It opens that exact source and downloads its
  existing result; it skips prompt preparation and Send. Completed/deleted jobs
  cannot be recovered. This operation is service-only, not a public API.
- Temporary renewal transport failures do not revoke an unexpired claim. Actual
  rejection or expiry stops work. Independent health reporting cannot revoke a
  claim, and renewal uses a conservative request-start deadline.
- Archive deletion cancels queued browser jobs and fences active claims. Reserved
  upload paths retain a delayed cleanup record until signed upload URLs expire.
- Free-tier availability, storage allowance and Gemini account limits still apply.
  No paid upgrade or payment was enabled as part of this installation.

`scripts/oracle/connect.ps1` reopens the private maintenance/login tunnel. Normal
phone operation does not use this tunnel; the worker runs entirely on the VM.
If the owner's WAN address changes, the SSH source rule needs updating. An IP rule
identifies a connection/network, not a unique physical computer; SSH also requires
the private key. Do not silently broaden the source range.

Sandbox configuration reference:
https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md

## Verification

Production build is READY (`dpl_6MJTT2inE5U2dMMf9tEAmu2m8Tos`). Unit suite (71 tests), worker lifecycle/download/lease tests (9),
typecheck and lint pass. Live database tests verify exclusive claims, device
ownership, idempotency and no requeue after a submitted job's lease expires.
End-to-end media verification results are recorded below after live checks.

- Image job `625c67d8-9f6c-40c7-9894-3354f9ec7e70` completed through production:
  JPEG, 3,031,017 bytes. Private Storage size and SHA256 match; unrelated-device
  read returns 404; owner archive returns 200 and visibly renders the image.
- Existing video download check passed: MP4, 4,444,337 bytes. This maintenance
  check downloads only the exact currently displayed source; it never generates.
- Video job `b4c30020-4e0c-4b6f-b36d-da3f1558f9b6` was recovered from its saved
  source after the download correction: 4,898,929 bytes, matching Storage SHA256,
  unrelated-device 404 and owner archive 200.
- Video job `861613c1-e415-4136-a9cc-a0bb4e1898f7` was recovered after transient
  network failures: 4,195,642 bytes with matching SHA256 and the same access
  checks. Its inline 1280px video played to the end (10.005 seconds, no media
  error) at a 390x844 mobile viewport. This is browser emulation, not a physical
  phone test. Neither recovery submitted a new generation prompt.
- Worker/display services are enabled and active; the regular browser user
  service is enabled. Normal operation is independent of the maintenance tunnel.
- Final fresh video test `a08cd9b9-4b78-4bd1-819e-9354149ad0c3` stopped before
  Send: Gemini's video tool was disabled. The signed-in website also displayed
  a usage-limit warning. Do not describe this as an uninterrupted successful
  final generation or guarantee future availability; the account must make the
  tool available again. No paid fallback or extra prompt was sent for this job.
- Live cancellation test verifies deletion of a submitted browser job invalidates
  the old claim and prevents enqueue/recreation of the deleted conversation.
- Fixed a browser UI race: a poll returning 404 while a new conversation POST is
  still in flight must not remove the newly remembered local history entry.
