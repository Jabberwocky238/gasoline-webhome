# Features

✓ Zero-trust: packets drop by default; no flow learning = no flow.
✓ L2 semantics: ARP, broadcast flood, MAC learning — standard Ethernet.
✓ VXLAN wire format (RFC 7348) — OVS and Linux kernel compatible.
✓ Userspace ARP: works on TUN (no kernel TAP needed).
✓ Multi-transport: UDP (lowest overhead), TCP, TLS, QUIC.
✓ AEAD encryption: ChaCha20-Poly1305 per session.
✓ Deterministic IPv6: no pool coordination across operators.
✓ Pool-allocated frame buffers: near-zero GC pressure on hot path.
✓ Cross-operator mesh: gRPC control plane discovers peers.
✓ Per-tenant rate limiting + stats HTTP API.

Roadmap:
  □ Flow table (stateful conntrack, directional ACL)
  □ DHCPv6 reply simulation
  □ Windows TAP-Windows6 driver integration
