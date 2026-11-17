#!/bin/sh
ZIG=/tmp/zig-linux-x86_64-0.13.0/zig
$ZIG cc -target wasm32-freestanding -nostdlib -O2 \
  -Wl,--no-entry -Wl,--export-memory \
  -Wl,--export=cc_reset -Wl,--export=cc_add_vertex -Wl,--export=cc_begin_face \
  -Wl,--export=cc_add_face_vertex -Wl,--export=cc_end_face -Wl,--export=cc_subdivide \
  -Wl,--export=cc_num_vertices -Wl,--export=cc_num_faces -Wl,--export=cc_num_corners \
  -Wl,--export=cc_positions -Wl,--export=cc_face_offsets -Wl,--export=cc_face_verts \
  -Wl,--export=cc_boundary_flags -Wl,--export=cc_face_normal -Wl,--export=cc_face_area \
  -Wl,--export=cc_total_area \
  -o build/catmull_clark.wasm src/catmull_clark.c
