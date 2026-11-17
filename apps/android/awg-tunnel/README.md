# Pinned AmneziaWG Android 3.1 engine

Upstream: https://github.com/amnezia-vpn/amneziawg-android/tree/v3.1.20260814

Java sources are copied from the official tag. `libwg-go.so` (arm64-v8a) is
extracted from the matching official release APK, not from the obsolete Maven
2.3.7 library. The APK SHA-256 matches the GitHub release asset digest.
See `docs/awg31-components.json` at the repository root for exact hashes.
Source license: `COPYING`; the Go implementation and dependencies retain their
upstream licenses: https://github.com/amnezia-vpn/amneziawg-go/tree/v3.1.20260814

Local changes from upstream:
- Gradle module uses Connect's existing Android Gradle Plugin 8.10.1, SDK 36,
  Java 17, and ships the pinned userspace JNI binary rather than rebuilding it.
- GoBackend preserves Connect's metered VPN policy (`setMetered(true)`).
- Java 9 List/Set factories are replaced with Arrays/HashSet for API 26 support.
- Only arm64-v8a JNI is bundled, matching Connect's current ABI filter.
- Root/kernel helper executables are not bundled; Connect uses GoBackend only.

The application must declare `GoBackend$VpnService`, not the previous fork's
`AbstractBackend$VpnService`. Its manifest service is not exported and requires
BIND_VPN_SERVICE. Connect still rejects configuration hooks and per-app bypass.

A successful parser/unit test or Java compilation does not test the Android
VPN permission, native loading, routing, handshake, or internet access on a device.
