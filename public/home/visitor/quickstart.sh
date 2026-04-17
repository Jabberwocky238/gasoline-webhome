#!/usr/bin/env bash
# Spin up a single-node gasoline deployment.

set -e

# 1. Build
git clone https://github.com/jabberwocky238/gasoline
cd gasoline && make linux

# 2. Run the operator (server)
./bin/gasoline-linux-amd64 operator \
    --listen 0.0.0.0:20000 \
    --op-listen 0.0.0.0:6678 \
    --network "200:10.0.0.0/24" \
    --auth noauth

# 3. Run two clients (each in its own shell / VM)
./bin/gasoline-linux-amd64 client \
    --endpoint <operator-ip>:20000 \
    --vni 200 \
    --transport quic \
    --auth noauth

# 4. Ping across
ip a show cilium_vxlan  # check the assigned 10.0.0.x
ping 10.0.0.<peer>      # traffic flows L2 via operator
