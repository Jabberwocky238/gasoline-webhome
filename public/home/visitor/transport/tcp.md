# TCP transport

Framing: length-prefix [frameLen:2][counter:8][ciphertext + tag].

Pros:
  + 0% loss (TCP guarantees delivery).
  + Head-of-line blocking is actually OK for VPN-style bulk flow.
  + Passes most corporate firewalls.

Cons:
  - Nagle + delayed-ACK adds jitter — set TCP_NODELAY for real use.
  - Slow-start wastes the first RTTs.

When to pick: admin reliability first, latency second.
