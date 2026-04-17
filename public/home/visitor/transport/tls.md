# TLS transport

Same framing as TCP but wrapped in crypto/tls.  Adds TLS 1.3 on top
of our own AEAD — redundant but useful when you need SNI-compatible
traffic that looks like HTTPS on the wire.

ALPN: "gasoline" (server generates self-signed ECDSA cert on startup).
For production, wire your own tls.Config with a real certificate.
