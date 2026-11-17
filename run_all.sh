#!/usr/bin/env bash
# Reproduce every artifact under outputs/.
set -e
cd "$(dirname "$0")"
PY=.venv/bin/python
[ -x "$PY" ] || PY=python3
$PY src/experiment.py
$PY src/ablation_edge.py
$PY src/make_figures.py
$PY src/make_montage.py
$PY src/make_tables.py
