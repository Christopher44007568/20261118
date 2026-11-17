// Catmull-Clark subdivision core, compiled to WebAssembly (wasm32-freestanding).
// Supports mixed triangle/quad/n-gon control meshes with open boundaries.
// Edge points are shared between adjacent faces, so mixed meshes stay watertight.

typedef unsigned int u32;
typedef int i32;
typedef float f32;

#define MAX_VERTS   65536
#define MAX_FACES   65536
#define MAX_CORNERS 262144
#define MAX_TMP_FACE 64
#define EDGE_HASH_SIZE (1 << 18)
#define EDGE_HASH_MASK (EDGE_HASH_SIZE - 1)

static f32 g_pos[3 * MAX_VERTS];        // current positions (x,y,z interleaved)
static f32 g_next[3 * MAX_VERTS];       // subdivision scratch buffer
static i32 g_face_off[MAX_FACES + 1];   // offsets into g_face_vert
static i32 g_face_vert[MAX_CORNERS];    // face corner vertex indices
static i32 g_next_off[MAX_FACES + 1];
static i32 g_next_vert[MAX_CORNERS];
static i32 g_bnd_flag[MAX_VERTS];       // 1 if vertex is on the open boundary

static i32 g_num_verts = 0;
static i32 g_num_faces = 0;
static i32 g_num_corners = 0;

// per-vertex accumulators used during one subdivision step
static f32 g_acc_q[3 * MAX_VERTS];      // sum of adjacent face points
static f32 g_acc_r[3 * MAX_VERTS];      // sum of adjacent edge midpoints
static i32 g_valence[MAX_VERTS];
static i32 g_bnd_nb[2 * MAX_VERTS];     // up to 2 boundary neighbours
static i32 g_bnd_cnt[MAX_VERTS];

// edge hash table: key = (min<<16)|max packed into u32, value = edge index + 1
static u32 g_ehash_key[EDGE_HASH_SIZE];
static i32 g_ehash_val[EDGE_HASH_SIZE];
static i32 g_edge_v0[MAX_CORNERS];
static i32 g_edge_v1[MAX_CORNERS];
static i32 g_edge_faces[2 * MAX_CORNERS];   // adjacent face ids (2 per edge)
static i32 g_edge_nfaces[MAX_CORNERS];
static i32 g_num_edges = 0;

static i32 g_tmp_face[MAX_TMP_FACE];
static i32 g_tmp_len = 0;

static void *mem_set(void *dst, int val, u32 n) {
    unsigned char *d = (unsigned char *)dst;
    for (u32 i = 0; i < n; i++) d[i] = (unsigned char)val;
    return dst;
}

void cc_reset(void) {
    g_num_verts = 0;
    g_num_faces = 0;
    g_num_corners = 0;
    g_tmp_len = 0;
}

i32 cc_add_vertex(f32 x, f32 y, f32 z) {
    if (g_num_verts >= MAX_VERTS) return -1;
    i32 idx = g_num_verts++;
    g_pos[3 * idx + 0] = x;
    g_pos[3 * idx + 1] = y;
    g_pos[3 * idx + 2] = z;
    return idx;
}

void cc_begin_face(void) { g_tmp_len = 0; }

void cc_add_face_vertex(i32 v) {
    if (g_tmp_len < MAX_TMP_FACE) g_tmp_face[g_tmp_len++] = v;
}

i32 cc_end_face(void) {
    if (g_tmp_len < 3) return -1;
    if (g_num_faces >= MAX_FACES) return -1;
    if (g_num_corners + g_tmp_len > MAX_CORNERS) return -1;
    i32 f = g_num_faces++;
    g_face_off[f] = g_num_corners;
    for (i32 i = 0; i < g_tmp_len; i++) g_face_vert[g_num_corners++] = g_tmp_face[i];
    g_face_off[g_num_faces] = g_num_corners;
    g_tmp_len = 0;
    return f;
}

i32 cc_num_vertices(void) { return g_num_verts; }
i32 cc_num_faces(void) { return g_num_faces; }
i32 cc_num_corners(void) { return g_num_corners; }

f32 *cc_positions(void) { return g_pos; }
i32 *cc_face_offsets(void) { return g_face_off; }
i32 *cc_face_verts(void) { return g_face_vert; }
i32 *cc_boundary_flags(void) { return g_bnd_flag; }

static u32 edge_key(i32 a, i32 b) {
    u32 lo = (u32)(a < b ? a : b);
    u32 hi = (u32)(a < b ? b : a);
    return (lo << 16) | hi;
}

static u32 edge_key_of(i32 a, i32 b, i32 *va, i32 *vb) {
    if (a < b) { *va = a; *vb = b; }
    else       { *va = b; *vb = a; }
    return ((u32)*va << 16) | (u32)*vb;
}

static u32 hash_key(u32 k) {
    k *= 2654435761u;
    return (k >> 14) & EDGE_HASH_MASK;
}

// Find or insert edge (a,b); returns edge index.
static i32 edge_find_insert(i32 a, i32 b) {
    i32 va, vb;
    u32 key = edge_key_of(a, b, &va, &vb);
    u32 h = hash_key(key);
    for (;;) {
        i32 val = g_ehash_val[h];
        if (val == 0) {
            i32 e = g_num_edges++;
            g_ehash_key[h] = key;
            g_ehash_val[h] = e + 1;
            g_edge_v0[e] = va;
            g_edge_v1[e] = vb;
            g_edge_nfaces[e] = 0;
            return e;
        }
        if (g_ehash_key[h] == key) return val - 1;
        h = (h + 1) & EDGE_HASH_MASK;
    }
}

// One Catmull-Clark subdivision step. Returns 0 on success.
i32 cc_subdivide(void) {
    i32 nv = g_num_verts, nf = g_num_faces;
    if (nv == 0 || nf == 0) return -1;
    i32 new_faces = g_num_corners;  // each old corner spawns one quad

    mem_set(g_ehash_val, 0, sizeof(g_ehash_val));
    g_num_edges = 0;
    mem_set(g_acc_q, 0, (u32)nv * 3 * sizeof(f32));
    mem_set(g_acc_r, 0, (u32)nv * 3 * sizeof(f32));
    mem_set(g_valence, 0, (u32)nv * sizeof(i32));
    mem_set(g_bnd_cnt, 0, (u32)nv * sizeof(i32));
    mem_set(g_bnd_flag, 0, (u32)nv * sizeof(i32));

    // 1. face points -> new vertices [nv, nv+nf); accumulate Q per vertex
    for (i32 f = 0; f < nf; f++) {
        i32 s = g_face_off[f], e = g_face_off[f + 1];
        i32 n = e - s;
        f32 cx = 0, cy = 0, cz = 0;
        for (i32 i = s; i < e; i++) {
            i32 v = g_face_vert[i];
            cx += g_pos[3 * v + 0];
            cy += g_pos[3 * v + 1];
            cz += g_pos[3 * v + 2];
        }
        f32 inv = 1.0f / (f32)n;
        cx *= inv; cy *= inv; cz *= inv;
        i32 fp = nv + f;
        g_next[3 * fp + 0] = cx;
        g_next[3 * fp + 1] = cy;
        g_next[3 * fp + 2] = cz;
        for (i32 i = s; i < e; i++) {
            i32 v = g_face_vert[i];
            g_acc_q[3 * v + 0] += cx;
            g_acc_q[3 * v + 1] += cy;
            g_acc_q[3 * v + 2] += cz;
        }
    }

    // 2. build edge table; accumulate R (edge midpoints) and valence
    for (i32 f = 0; f < nf; f++) {
        i32 s = g_face_off[f], e = g_face_off[f + 1];
        i32 n = e - s;
        for (i32 i = 0; i < n; i++) {
            i32 a = g_face_vert[s + i];
            i32 b = g_face_vert[s + (i + 1) % n];
            i32 ei = edge_find_insert(a, b);
            i32 cnt = g_edge_nfaces[ei];
            if (cnt < 2) g_edge_faces[2 * ei + cnt] = f;
            g_edge_nfaces[ei] = cnt + 1;
        }
    }
    for (i32 ei = 0; ei < g_num_edges; ei++) {
        i32 a = g_edge_v0[ei], b = g_edge_v1[ei];
        f32 mx = 0.5f * (g_pos[3 * a + 0] + g_pos[3 * b + 0]);
        f32 my = 0.5f * (g_pos[3 * a + 1] + g_pos[3 * b + 1]);
        f32 mz = 0.5f * (g_pos[3 * a + 2] + g_pos[3 * b + 2]);
        g_acc_r[3 * a + 0] += mx; g_acc_r[3 * a + 1] += my; g_acc_r[3 * a + 2] += mz;
        g_acc_r[3 * b + 0] += mx; g_acc_r[3 * b + 1] += my; g_acc_r[3 * b + 2] += mz;
        g_valence[a]++; g_valence[b]++;
        if (g_edge_nfaces[ei] == 1) {
            // boundary edge: register boundary neighbours
            for (i32 k = 0; k < 2; k++) {
                i32 v = k == 0 ? a : b;
                i32 other = k == 0 ? b : a;
                if (g_bnd_cnt[v] < 2) g_bnd_nb[2 * v + g_bnd_cnt[v]] = other;
                g_bnd_cnt[v]++;
            }
            g_bnd_flag[a] = 1;
            g_bnd_flag[b] = 1;
        }
    }

    // 3. edge points -> new vertices [nv+nf, nv+nf+ne)
    for (i32 ei = 0; ei < g_num_edges; ei++) {
        i32 a = g_edge_v0[ei], b = g_edge_v1[ei];
        i32 ep = nv + nf + ei;
        if (g_edge_nfaces[ei] >= 2) {
            i32 f0 = nv + g_edge_faces[2 * ei + 0];
            i32 f1 = nv + g_edge_faces[2 * ei + 1];
            for (i32 c = 0; c < 3; c++) {
                g_next[3 * ep + c] = 0.25f * (g_pos[3 * a + c] + g_pos[3 * b + c]
                                            + g_next[3 * f0 + c] + g_next[3 * f1 + c]);
            }
        } else {
            // boundary edge point: simple midpoint keeps the outline
            for (i32 c = 0; c < 3; c++) {
                g_next[3 * ep + c] = 0.5f * (g_pos[3 * a + c] + g_pos[3 * b + c]);
            }
        }
    }

    // 4. updated positions for original vertices -> [0, nv)
    for (i32 v = 0; v < nv; v++) {
        f32 px = g_pos[3 * v + 0], py = g_pos[3 * v + 1], pz = g_pos[3 * v + 2];
        if (g_bnd_cnt[v] >= 2) {
            // boundary vertex: sharp-corner rule keeps corners fixed,
            // straight boundary points stay on the boundary line
            i32 b1 = g_bnd_nb[2 * v + 0], b2 = g_bnd_nb[2 * v + 1];
            f32 d1x = g_pos[3 * b1 + 0] - px, d1y = g_pos[3 * b1 + 1] - py, d1z = g_pos[3 * b1 + 2] - pz;
            f32 d2x = g_pos[3 * b2 + 0] - px, d2y = g_pos[3 * b2 + 1] - py, d2z = g_pos[3 * b2 + 2] - pz;
            f32 l1 = d1x * d1x + d1y * d1y + d1z * d1z;
            f32 l2 = d2x * d2x + d2y * d2y + d2z * d2z;
            f32 dot = d1x * d2x + d1y * d2y + d1z * d2z;
            f32 cos2 = (l1 > 0 && l2 > 0) ? (dot * dot) / (l1 * l2) : 1.0f;
            if (cos2 > 0.9999f && dot < 0) {
                // straight boundary: standard boundary rule (stays on the line)
                g_next[3 * v + 0] = (6.0f * px + g_pos[3 * b1 + 0] + g_pos[3 * b2 + 0]) * 0.125f;
                g_next[3 * v + 1] = (6.0f * py + g_pos[3 * b1 + 1] + g_pos[3 * b2 + 1]) * 0.125f;
                g_next[3 * v + 2] = (6.0f * pz + g_pos[3 * b1 + 2] + g_pos[3 * b2 + 2]) * 0.125f;
            } else {
                // corner vertex: keep exactly in place
                g_next[3 * v + 0] = px;
                g_next[3 * v + 1] = py;
                g_next[3 * v + 2] = pz;
            }
        } else {
            // interior vertex: Q/n + 2R/n + S(n-3)/n
            f32 n = (f32)g_valence[v];
            f32 inv = 1.0f / (n * n);
            for (i32 c = 0; c < 3; c++) {
                f32 q = g_acc_q[3 * v + c];
                f32 r = g_acc_r[3 * v + c];
                f32 s = g_pos[3 * v + c];
                g_next[3 * v + c] = (q + 2.0f * r + s * (n - 3.0f) * n) * inv;
            }
        }
    }

    // 5. topology: each n-gon -> n quads
    //    quad: (v_i, edgePoint(v_i,v_{i+1}), facePoint, edgePoint(v_{i-1},v_i))
    i32 nc = 0;
    i32 nf2 = 0;
    for (i32 f = 0; f < nf; f++) {
        i32 s = g_face_off[f], e = g_face_off[f + 1];
        i32 n = e - s;
        for (i32 i = 0; i < n; i++) {
            i32 vi = g_face_vert[s + i];
            i32 vprev = g_face_vert[s + (i + n - 1) % n];
            i32 vnext = g_face_vert[s + (i + 1) % n];
            i32 e_next = edge_find_insert(vi, vnext);
            i32 e_prev = edge_find_insert(vprev, vi);
            g_next_off[nf2++] = nc;
            g_next_vert[nc++] = vi;
            g_next_vert[nc++] = nv + nf + e_next;
            g_next_vert[nc++] = nv + f;
            g_next_vert[nc++] = nv + nf + e_prev;
        }
    }
    g_next_off[new_faces] = nc;

    // 6. swap buffers
    i32 total_v = nv + nf + g_num_edges;
    for (i32 i = 0; i < 3 * total_v; i++) g_pos[i] = g_next[i];
    for (i32 i = 0; i <= new_faces; i++) g_face_off[i] = g_next_off[i];
    for (i32 i = 0; i < nc; i++) g_face_vert[i] = g_next_vert[i];
    g_num_verts = total_v;
    g_num_faces = new_faces;
    g_num_corners = nc;
    return 0;
}

static f32 g_normal_out[3];

static f32 sqrt_f(f32 x) {
    f32 r = x;
    if (x <= 0.0f) return 0.0f;
    for (i32 i = 0; i < 8; i++) r = 0.5f * (r + x / r);
    return r;
}

// Newell's method: robust normal for (possibly non-planar) polygons.
f32 *cc_face_normal(i32 f) {
    f32 nx = 0, ny = 0, nz = 0;
    i32 s = g_face_off[f], e = g_face_off[f + 1];
    i32 n = e - s;
    for (i32 i = 0; i < n; i++) {
        i32 a = g_face_vert[s + i];
        i32 b = g_face_vert[s + (i + 1) % n];
        f32 ax = g_pos[3 * a + 0], ay = g_pos[3 * a + 1], az = g_pos[3 * a + 2];
        f32 bx = g_pos[3 * b + 0], by = g_pos[3 * b + 1], bz = g_pos[3 * b + 2];
        nx += (ay - by) * (az + bz);
        ny += (az - bz) * (ax + bx);
        nz += (ax - bx) * (ay + by);
    }
    f32 len = sqrt_f(nx * nx + ny * ny + nz * nz);
    if (len > 0.0f) { nx /= len; ny /= len; nz /= len; }
    g_normal_out[0] = nx;
    g_normal_out[1] = ny;
    g_normal_out[2] = nz;
    return g_normal_out;
}

// Polygon area via fan triangulation from vertex 0.
f32 cc_face_area(i32 f) {
    i32 s = g_face_off[f], e = g_face_off[f + 1];
    i32 n = e - s;
    i32 v0 = g_face_vert[s];
    f32 ax = g_pos[3 * v0 + 0], ay = g_pos[3 * v0 + 1], az = g_pos[3 * v0 + 2];
    f32 total = 0.0f;
    for (i32 i = 1; i + 1 < n; i++) {
        i32 v1 = g_face_vert[s + i];
        i32 v2 = g_face_vert[s + i + 1];
        f32 ux = g_pos[3 * v1 + 0] - ax, uy = g_pos[3 * v1 + 1] - ay, uz = g_pos[3 * v1 + 2] - az;
        f32 wx = g_pos[3 * v2 + 0] - ax, wy = g_pos[3 * v2 + 1] - ay, wz = g_pos[3 * v2 + 2] - az;
        f32 cx = uy * wz - uz * wy;
        f32 cy = uz * wx - ux * wz;
        f32 cz = ux * wy - uy * wx;
        total += 0.5f * sqrt_f(cx * cx + cy * cy + cz * cz);
    }
    return total;
}

f32 cc_total_area(void) {
    f32 total = 0.0f;
    for (i32 f = 0; f < g_num_faces; f++) total += cc_face_area(f);
    return total;
}
