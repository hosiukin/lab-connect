#!/bin/zsh

cd "$(dirname "$0")"

if command -v python3 >/dev/null 2>&1; then
    exec python3 lab_connect.py
fi

echo "Python 3 is required. Install it from https://www.python.org/downloads/"
read -r "?Press Enter to close."
exit 1
