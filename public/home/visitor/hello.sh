#!/usr/bin/env bash
# demo script — shows off the built-in bash parser
#
# run me with:   ./hello.sh
#                bash hello.sh

NAME="visitor"
GREETING="hello, ${NAME}"
HOST=$(uname)

echo "${GREETING}!"
echo "you are running on: ${HOST}"
echo "current time is: $(echo 2026-04-17)"

# line continuation
echo "this line \
continues"

# && chaining
echo "step 1" && echo "step 2"
