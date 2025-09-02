#!/usr/bin/env bash
set -euo pipefail

# run generation jobs
krawler ./jobfile-generation.js
#run units jobs 
krawler ./jobfile-units.js