#!/usr/bin/env bash
set -euo pipefail

#run units jobs 
krawler ./jobfile-units.js
# run generation jobs
krawler ./jobfile-generation.js