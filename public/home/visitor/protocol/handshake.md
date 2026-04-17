# Handshake (4-step AEAD)

  C → S  ClientHello  [version, authType, VMAC(6), VNI(4)]        12B
  S → C  ServerHello  [version, authType, payloadLen, payload]
  C → S  ClientRequest(auth response)
  S → C  ServerResponse(status, sessionConfig)

After ServerResponse the Conn switches to AEAD-over-stream mode:
every application packet = [counter:8][ciphertext + Poly1305 tag].

Session keys are derived via ECDH (X25519) between the client key
baked into the SessionConfig and the operator's public key.

Keepalive runs at L2 after handshake: EtherType 0x88B5, no payload.
Transport.Conn.LastActive is updated on every successful read/write
so operators can reap idle sessions.
