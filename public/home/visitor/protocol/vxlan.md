# VXLAN wire format (as gasoline speaks it)

[VXLAN header:8][inner Eth:14][inner IP:N]

VXLAN header (RFC 7348):
  byte 0       flags      0x08 = I bit (VNI valid)
  bytes 1..3   reserved   0
  bytes 4..6   VNI        24-bit tenant identifier
  byte 7       reserved   0

Inner Eth:
  bytes 0..5   dst MAC    forwarding key on the remote operator
  bytes 6..11  src MAC    used for MAC learning at the ingress
  bytes 12..13 ethType    0x0800 IPv4 | 0x86DD IPv6 | 0x0806 ARP
                                    | 0x88B5 gasoline keepalive

The operator MAC-learns from the inner src MAC on every inbound VXLAN
datagram, so (VNI, srcMAC) → source operator UDP endpoint is the only
discovery protocol needed for pure data-plane delivery.
