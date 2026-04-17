# QUIC transport

quic-go under the hood.  Gets you:
  + 0-RTT connection resumption
  + Multiplexed streams (we use one per session, but room to grow)
  + Built-in congestion control
  + Connection migration (survives client NAT rebind)

Our benchmark: QUIC matches TCP on sustained throughput, beats it on
jittery networks due to congestion-control smarts.
