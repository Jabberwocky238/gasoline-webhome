# gasoline

A zero-trust L2 overlay network written in Go.

Think of it as: WireGuard's simplicity + VXLAN's L2 semantics + userspace ARP.

------------------------------------------------------------
 .--.                                        .---.
 |  |   OS tun0 (1400B MTU)                  |   |
 |  |──────IP──────▶ [client] ─AEAD─▶ [operator] ─VXLAN─▶ peer op
 '--'              vtap.Device              vxlan.Plane
                   (ARP, Eth wrap)          (MAC learn, fwd)
------------------------------------------------------------

Explore this tree:

  ls / ll            list contents
  cat README.md      read a file
  cd <dir>           change directory
  cat transport/quic.md
  cat protocol/vxlan.md
  about              one-paragraph pitch

Type 'help' to see all commands.
