#!/bin/bash
# Double-click this file in Finder to upload the current branch to GitHub.
cd "$(dirname "$0")" || exit 1
git push -u origin "$(git branch --show-current)"
read -n 1 -s -r -p "Done. Press any key to close."
