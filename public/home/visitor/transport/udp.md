# UDP transport

Pros:
  + Lowest per-packet overhead: no framing (one packet = one datagram).
  + Lowest latency: no flow-control.
  + Works on every NAT that passes UDP (most of them).

Cons:
  - Lossy by default: bench shows ~5–15% loss at 25k pps sustained.
  - No reordering / retransmission — application must tolerate loss.

Tuning:
  • per-peer incoming chan = 8192 (see transport/udp/listener.go).
  • SO_RCVBUF / SO_SNDBUF = 8 MB.
  • AEAD runs single-goroutine per peer; parallelisation is TODO.

When to pick: VoIP-style traffic, game state sync, anything that already
tolerates UDP semantics.
