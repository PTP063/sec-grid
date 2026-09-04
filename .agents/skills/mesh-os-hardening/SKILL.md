---
name: mesh-os-hardening
description: Implements zero-infrastructure, offline-first mesh protocols (WebRTC via QR signaling, persistent IndexedDB WAL, Spray-and-Wait DTN routing, and heuristic fallbacks). Trigger this when generating or modifying Mesh·OS core engine code, serializers, or transport layers.
---

# Operational Rules & Constraints
1. **Zero External Network Dependencies:** Never inject external scripts, CDN URLs, remote STUN/TURN servers, or cloud analytics. All assets, schemas, and wasm workers must resolve locally from CacheStorage / Service Worker.
2. **Deterministic Data Contracts:** 
   - Never serialize payloads as unstructured JSON across the wire. 
   - All network frames MUST conform to the binary Protocol Buffers specification (`schema.proto`).
   - Standardize on little-endian Uint8Arrays for byte-level slicing (e.g., extracting IVs, signatures, and UUID payloads).
3. **Fail-Closed Offline Fallbacks:**
   - If WebGPU or `@mlc-ai/web-llm` is unavailable or models are un-cached, immediately fallback to local heuristic/regex parsing without raising unhandled runtime exceptions.
   - For inter-device signaling without a reachable Drop-Node (`drop-node-server.js`), always provide an animated QR-code SDP exchange fallback.
4. **Non-Blocking Execution & Lifecycle:**
   - All cryptographic hashing, key derivations (PBKDF2), and heavy inferences must reside off the UI thread (inside Web Workers).
   - Enforce persistent storage via `navigator.storage.persist()` and register audio/wake-lock keep-alives to prevent mobile OS tab freezing.
