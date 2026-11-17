//! Software rasterizer compiled to WebAssembly.
//!
//! Pipeline: vertex transform -> near-plane clip (clip space) -> perspective
//! divide -> backface culling -> barycentric rasterization with
//! perspective-correct interpolation -> depth test -> RGBA8 framebuffer.
//!
//! The framebuffer row 0 is the BOTTOM row (GL window-coordinate order) so it
//! can be compared directly against WebGL `readPixels` output.

// ---------------------------------------------------------------------------
// Math (column-major mat4, same layout as WebGL uniform matrices)
// ---------------------------------------------------------------------------

pub type Mat4 = [f32; 16];

pub fn mat4_identity() -> Mat4 {
    let mut m = [0.0f32; 16];
    m[0] = 1.0;
    m[5] = 1.0;
    m[10] = 1.0;
    m[15] = 1.0;
    m
}

/// C = A * B (B applied first), column-major.
pub fn mat4_mul(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut c = [0.0f32; 16];
    for col in 0..4 {
        for row in 0..4 {
            let mut s = 0.0;
            for k in 0..4 {
                s += a[k * 4 + row] * b[col * 4 + k];
            }
            c[col * 4 + row] = s;
        }
    }
    c
}

/// OpenGL-style perspective projection (right-handed, NDC z in [-1, 1]).
pub fn mat4_perspective(fovy_rad: f32, aspect: f32, near: f32, far: f32) -> Mat4 {
    let f = 1.0 / (fovy_rad * 0.5).tan();
    let mut m = [0.0f32; 16];
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) / (near - far);
    m[11] = -1.0;
    m[14] = 2.0 * far * near / (near - far);
    m
}

pub fn mat4_translate(x: f32, y: f32, z: f32) -> Mat4 {
    let mut m = mat4_identity();
    m[12] = x;
    m[13] = y;
    m[14] = z;
    m
}

pub fn mat4_rotate_x(a: f32) -> Mat4 {
    let (s, c) = a.sin_cos();
    let mut m = mat4_identity();
    m[5] = c;
    m[6] = s;
    m[9] = -s;
    m[10] = c;
    m
}

pub fn mat4_rotate_y(a: f32) -> Mat4 {
    let (s, c) = a.sin_cos();
    let mut m = mat4_identity();
    m[0] = c;
    m[2] = -s;
    m[8] = s;
    m[10] = c;
    m
}

/// clip = m * v (v is a column vector).
pub fn mat4_mul_vec4(m: &Mat4, v: [f32; 4]) -> [f32; 4] {
    let mut o = [0.0f32; 4];
    for row in 0..4 {
        o[row] = m[row] * v[0] + m[4 + row] * v[1] + m[8 + row] * v[2] + m[12 + row] * v[3];
    }
    o
}

// ---------------------------------------------------------------------------
// Scene: interleaved vertices [px,py,pz, r,g,b, u,v] shared with WebGL2.
// Camera sits at the origin looking down -Z (identity view matrix).
// ---------------------------------------------------------------------------

pub const FLOATS_PER_VERTEX: usize = 8;
pub const TEX_SIZE: usize = 64;

// Mesh 0: two large triangles that intersect each other in 3D.
#[rustfmt::skip]
const TRIS_VERTS: &[f32] = &[
    // tri A (red/green/blue corners)
    -2.0, -1.0, -2.5,   1.0, 0.2, 0.2,   0.0, 0.0,
     2.0, -1.0, -4.5,   0.2, 1.0, 0.2,   2.0, 0.0,
     0.0,  1.8, -3.5,   0.2, 0.2, 1.0,   1.0, 2.0,
    // tri B (yellow/cyan/magenta corners), crosses tri A
    -1.8,  0.9, -4.2,   1.0, 1.0, 0.2,   0.0, 0.0,
     1.8,  0.9, -2.6,   0.2, 1.0, 1.0,   2.0, 0.0,
     0.0, -1.4, -3.4,   1.0, 0.2, 1.0,   1.0, 2.0,
];

// Mesh 1: unit cube (vertex-colored, textured), 8 corners / 36 indices.
#[rustfmt::skip]
const CUBE_VERTS: &[f32] = &[
    // 0..7 corners, colored by position
    -0.5, -0.5, -0.5,   0.2, 0.2, 0.2,   0.0, 0.0,
     0.5, -0.5, -0.5,   1.0, 0.2, 0.2,   1.0, 0.0,
     0.5,  0.5, -0.5,   1.0, 1.0, 0.2,   1.0, 1.0,
    -0.5,  0.5, -0.5,   0.2, 1.0, 0.2,   0.0, 1.0,
    -0.5, -0.5,  0.5,   0.2, 0.2, 1.0,   0.0, 0.0,
     0.5, -0.5,  0.5,   1.0, 0.2, 1.0,   1.0, 0.0,
     0.5,  0.5,  0.5,   1.0, 1.0, 1.0,   1.0, 1.0,
    -0.5,  0.5,  0.5,   0.2, 1.0, 1.0,   0.0, 1.0,
];

#[rustfmt::skip]
const CUBE_IDX: &[u32] = &[
    0, 3, 2,  0, 2, 1, // back  (z-)
    4, 5, 6,  4, 6, 7, // front (z+)
    0, 1, 5,  0, 5, 4, // bottom
    3, 7, 6,  3, 6, 2, // top
    0, 4, 7,  0, 7, 3, // left
    1, 2, 6,  1, 6, 5, // right
];

// Mesh 2: quad that flies through the camera plane (crosses the near plane,
// so it must be clipped). Two triangles.
#[rustfmt::skip]
const QUAD_VERTS: &[f32] = &[
    -0.9, -0.7, 0.0,   1.0, 0.6, 0.2,   0.0, 0.0,
     0.9, -0.7, 0.0,   0.2, 1.0, 0.6,   1.5, 0.0,
     0.9,  0.7, 0.0,   0.6, 0.2, 1.0,   1.5, 1.5,
    -0.9,  0.7, 0.0,   1.0, 1.0, 1.0,   0.0, 1.5,
];

const QUAD_IDX: &[u32] = &[0, 1, 2, 0, 2, 3];

pub const MESH_COUNT: usize = 3;

/// Per-mesh vertex/index slices into the shared buffers.
pub fn mesh_vertices(mesh: usize) -> &'static [f32] {
    match mesh {
        0 => TRIS_VERTS,
        1 => CUBE_VERTS,
        _ => QUAD_VERTS,
    }
}

pub fn mesh_indices(mesh: usize) -> &'static [u32] {
    match mesh {
        0 => &[0, 1, 2, 3, 4, 5],
        1 => CUBE_IDX,
        _ => QUAD_IDX,
    }
}

/// Model matrix for a mesh at time `t` (seconds).
pub fn model_matrix(mesh: usize, t: f32) -> Mat4 {
    match mesh {
        0 => mat4_identity(),
        1 => {
            // Rotating cube off to the right.
            let tr = mat4_translate(1.7, 0.2, -4.0);
            let ry = mat4_rotate_y(t * 0.9);
            let rx = mat4_rotate_x(t * 0.6);
            mat4_mul(&tr, &mat4_mul(&ry, &rx))
        }
        _ => {
            // Quad flies along +Z, passing through the camera (z = 0) and the
            // near plane. Cycle: z from -2.6 to +1.4 over ~4.1 s.
            let cycle = (t * 1.2) % 5.0;
            let z = -2.6 + cycle;
            let tr = mat4_translate(-1.1, 0.1 * (t * 2.0).sin(), z);
            let ry = mat4_rotate_y(0.35 * t.sin());
            mat4_mul(&tr, &ry)
        }
    }
}

// ---------------------------------------------------------------------------
// Procedural checkerboard texture (RGBA8), shared with the WebGL texture.
// Row 0 of the data corresponds to v = 0 (GL texture order).
// ---------------------------------------------------------------------------

pub fn build_texture() -> [u8; TEX_SIZE * TEX_SIZE * 4] {
    let mut tex = [0u8; TEX_SIZE * TEX_SIZE * 4];
    for y in 0..TEX_SIZE {
        for x in 0..TEX_SIZE {
            let cell = ((x / 8) + (y / 8)) % 2;
            let (mut r, mut g, mut b) = if cell == 0 {
                (235u8, 235u8, 235u8)
            } else {
                (45u8, 110u8, 190u8)
            };
            if x < 8 && y < 8 {
                // red marker cell so UV orientation is visible
                r = 220;
                g = 40;
                b = 40;
            }
            let i = (y * TEX_SIZE + x) * 4;
            tex[i] = r;
            tex[i + 1] = g;
            tex[i + 2] = b;
            tex[i + 3] = 255;
        }
    }
    tex
}

// ---------------------------------------------------------------------------
// Global renderer state (allocated once in `init`; never grows per frame).
// ---------------------------------------------------------------------------

pub struct State {
    pub width: usize,
    pub height: usize,
    pub framebuffer: Vec<u8>, // RGBA8, row 0 = bottom (GL order)
    pub depth: Vec<f32>,      // [0,1], smaller = closer
    pub texture: Vec<u8>,     // TEX_SIZE^2 RGBA8
    pub mvp: [Mat4; MESH_COUNT],
    pub stats_clipped_tris: u32,
    pub stats_flipped_after_clip: u32,
}

static mut STATE: Option<State> = None;

fn state() -> &'static mut State {
    unsafe { (*core::ptr::addr_of_mut!(STATE)).as_mut() }.expect("init() must be called first")
}

// ---------------------------------------------------------------------------
// Near-plane clipping in homogeneous clip space (Sutherland-Hodgman against
// the single plane z >= -w, i.e. d(v) = z + w >= 0).
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
pub struct ClipVert {
    pub pos: [f32; 4], // clip-space position
    pub color: [f32; 3],
    pub uv: [f32; 2],
}

fn near_distance(v: &ClipVert) -> f32 {
    v.pos[2] + v.pos[3]
}

fn lerp_vert(a: &ClipVert, b: &ClipVert, t: f32) -> ClipVert {
    let mut out = *a;
    for i in 0..4 {
        out.pos[i] = a.pos[i] + (b.pos[i] - a.pos[i]) * t;
    }
    for i in 0..3 {
        out.color[i] = a.color[i] + (b.color[i] - a.color[i]) * t;
    }
    for i in 0..2 {
        out.uv[i] = a.uv[i] + (b.uv[i] - a.uv[i]) * t;
    }
    out
}

/// Clip a triangle against the near plane. Returns up to 4 vertices (a convex
/// polygon) preserving the original winding order, so a front-facing triangle
/// can never become back-facing after clipping.
pub fn clip_near(tri: &[ClipVert; 3]) -> ([ClipVert; 4], usize) {
    let mut out = [tri[0]; 4];
    let mut n = 0usize;
    for i in 0..3 {
        let cur = &tri[i];
        let prev = &tri[(i + 2) % 3];
        let d_cur = near_distance(cur);
        let d_prev = near_distance(prev);
        let cur_in = d_cur >= 0.0;
        let prev_in = d_prev >= 0.0;
        if cur_in != prev_in {
            out[n] = lerp_vert(prev, cur, d_prev / (d_prev - d_cur));
            n += 1;
        }
        if cur_in {
            out[n] = *cur;
            n += 1;
        }
    }
    (out, n)
}

// ---------------------------------------------------------------------------
// Rasterization: screen-space (GL window coords, y-up) with a top-left fill
// rule, perspective-correct attribute interpolation and a LESS depth test.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct ScreenVert {
    x: f64,
    y: f64,
    z: f32,      // NDC z mapped to [0,1] depth
    inv_w: f32,  // 1 / w_clip
    color: [f32; 3],
    uv: [f32; 2],
}

fn to_screen(v: &ClipVert, width: usize, height: usize) -> ScreenVert {
    let inv_w = 1.0 / v.pos[3];
    let ndc_x = v.pos[0] * inv_w;
    let ndc_y = v.pos[1] * inv_w;
    let ndc_z = v.pos[2] * inv_w;
    ScreenVert {
        x: ((ndc_x as f64) + 1.0) * 0.5 * (width as f64),
        y: ((ndc_y as f64) + 1.0) * 0.5 * (height as f64),
        z: (ndc_z + 1.0) * 0.5,
        inv_w,
        color: v.color,
        uv: v.uv,
    }
}

#[inline]
fn edge(ax: f64, ay: f64, bx: f64, by: f64, px: f64, py: f64) -> f64 {
    // 边 (a->b) 的 2D 叉积：对 CCW（y-up）三角形，内部点结果为正。
    (bx - ax) * (py - ay) - (by - ay) * (px - ax)
}

/// Top-left fill rule (y-up window coords): an edge a->b of a CCW triangle is
/// top-left if it is a left edge (goes down) or a top edge (horizontal, goes right).
#[inline]
fn is_top_left(ax: f64, ay: f64, bx: f64, by: f64) -> bool {
    (ay > by) || (ay == by && ax < bx)
}

fn sample_texture(st: &State, u: f32, v: f32) -> (u8, u8, u8) {
    // REPEAT wrap + NEAREST filtering, matching the WebGL sampler.
    let uu = u - u.floor();
    let vv = v - v.floor();
    let x = ((uu * TEX_SIZE as f32) as usize).min(TEX_SIZE - 1);
    let y = ((vv * TEX_SIZE as f32) as usize).min(TEX_SIZE - 1);
    let i = (y * TEX_SIZE + x) * 4;
    (st.texture[i], st.texture[i + 1], st.texture[i + 2])
}

fn raster_triangle(st: &mut State, tri: &[ScreenVert; 3]) {
    let (v0, v1, v2) = (&tri[0], &tri[1], &tri[2]);
    let area = edge(v0.x, v0.y, v1.x, v1.y, v2.x, v2.y);
    if area <= 0.0 {
        return; // degenerate
    }
    let w = st.width as f64;
    let h = st.height as f64;
    let min_x = v0.x.min(v1.x).min(v2.x).floor().max(0.0) as i64;
    let max_x = v0.x.max(v1.x).max(v2.x).ceil().min(w) as i64;
    let min_y = v0.y.min(v1.y).min(v2.y).floor().max(0.0) as i64;
    let max_y = v0.y.max(v1.y).max(v2.y).ceil().min(h) as i64;

    let tl0 = is_top_left(v0.x, v0.y, v1.x, v1.y);
    let tl1 = is_top_left(v1.x, v1.y, v2.x, v2.y);
    let tl2 = is_top_left(v2.x, v2.y, v0.x, v0.y);

    for py in min_y..max_y {
        for px in min_x..max_x {
            let cx = px as f64 + 0.5;
            let cy = py as f64 + 0.5;
            let e0 = edge(v0.x, v0.y, v1.x, v1.y, cx, cy);
            let e1 = edge(v1.x, v1.y, v2.x, v2.y, cx, cy);
            let e2 = edge(v2.x, v2.y, v0.x, v0.y, cx, cy);
            let in0 = e0 > 0.0 || (e0 == 0.0 && tl0);
            let in1 = e1 > 0.0 || (e1 == 0.0 && tl1);
            let in2 = e2 > 0.0 || (e2 == 0.0 && tl2);
            if !(in0 && in1 && in2) {
                continue;
            }
            // Barycentric weights (screen space): e0 is edge v0->v1, opposite v2.
            let b2 = e0 / area;
            let b0 = e1 / area;
            let b1 = e2 / area;

            let depth = (b0 * v0.z as f64 + b1 * v1.z as f64 + b2 * v2.z as f64) as f32;
            let idx = py as usize * st.width + px as usize;
            if depth < 0.0 || depth > 1.0 || depth >= st.depth[idx] {
                continue; // LESS depth test
            }
            // Perspective-correct interpolation via 1/w.
            let l0 = b0 as f32 * v0.inv_w;
            let l1 = b1 as f32 * v1.inv_w;
            let l2 = b2 as f32 * v2.inv_w;
            let lsum = l0 + l1 + l2;
            let (mut cr, mut cg, mut cb) = (0.0f32, 0.0f32, 0.0f32);
            let (mut u, mut vv) = (0.0f32, 0.0f32);
            for (l, sv) in [(l0, v0), (l1, v1), (l2, v2)] {
                cr += l * sv.color[0];
                cg += l * sv.color[1];
                cb += l * sv.color[2];
                u += l * sv.uv[0];
                vv += l * sv.uv[1];
            }
            cr /= lsum;
            cg /= lsum;
            cb /= lsum;
            u /= lsum;
            vv /= lsum;
            let (tr, tg, tb) = sample_texture(st, u, vv);
            let f = |c: f32, t: u8| -> u8 { (c * (t as f32 / 255.0) * 255.0).round().clamp(0.0, 255.0) as u8 };
            let fi = idx * 4;
            st.framebuffer[fi] = f(cr, tr);
            st.framebuffer[fi + 1] = f(cg, tg);
            st.framebuffer[fi + 2] = f(cb, tb);
            st.framebuffer[fi + 3] = 255;
            st.depth[idx] = depth;
        }
    }
}

// ---------------------------------------------------------------------------
// Frame render: transform -> clip -> divide -> cull -> rasterize.
// ---------------------------------------------------------------------------

pub const CLEAR_COLOR: [u8; 4] = [15, 15, 23, 255];

pub fn render_frame(st: &mut State, t: f32) {
    let (w, h) = (st.width, st.height);
    for px in st.framebuffer.chunks_exact_mut(4) {
        px.copy_from_slice(&CLEAR_COLOR);
    }
    for d in st.depth.iter_mut() {
        *d = 1.0;
    }
    st.stats_clipped_tris = 0;
    st.stats_flipped_after_clip = 0;

    let proj = mat4_perspective(60.0f32.to_radians(), w as f32 / h as f32, 0.1, 100.0);

    for mesh in 0..MESH_COUNT {
        let mvp = mat4_mul(&proj, &model_matrix(mesh, t));
        st.mvp[mesh] = mvp;
        let verts = mesh_vertices(mesh);
        let indices = mesh_indices(mesh);

        for tri in indices.chunks_exact(3) {
            let mut ctri = [ClipVert {
                pos: [0.0; 4],
                color: [0.0; 3],
                uv: [0.0; 2],
            }; 3];
            for (k, &vi) in tri.iter().enumerate() {
                let base = vi as usize * FLOATS_PER_VERTEX;
                let p = &verts[base..base + FLOATS_PER_VERTEX];
                ctri[k] = ClipVert {
                    pos: mat4_mul_vec4(&mvp, [p[0], p[1], p[2], 1.0]),
                    color: [p[3], p[4], p[5]],
                    uv: [p[6], p[7]],
                };
            }

            // Winding of the unclipped triangle (only meaningful when the
            // whole triangle is in front of the near plane).
            let fully_in_front = ctri.iter().all(|v| near_distance(v) >= 0.0);
            let pre_sign = if fully_in_front {
                let s0 = to_screen(&ctri[0], w, h);
                let s1 = to_screen(&ctri[1], w, h);
                let s2 = to_screen(&ctri[2], w, h);
                Some((edge(s0.x, s0.y, s1.x, s1.y, s2.x, s2.y)).signum())
            } else {
                None
            };

            let (poly, n) = clip_near(&ctri);
            if n < 3 {
                continue;
            }
            if n > 3 {
                st.stats_clipped_tris += 1;
            }

            // Fan-triangulate the clipped convex polygon.
            let s0 = to_screen(&poly[0], w, h);
            for k in 1..n - 1 {
                let s1 = to_screen(&poly[k], w, h);
                let s2 = to_screen(&poly[k + 1], w, h);
                let area = edge(s0.x, s0.y, s1.x, s1.y, s2.x, s2.y);
                if let Some(sign) = pre_sign {
                    if sign != 0.0 && area.signum() != 0.0 && area.signum() != sign {
                        st.stats_flipped_after_clip += 1;
                    }
                }
                if area <= 0.0 {
                    continue; // backface culling (front = CCW in window coords)
                }
                raster_triangle(st, &[s0, s1, s2]);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// WASM exports
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn init(width: usize, height: usize) {
    let st = State {
        width,
        height,
        framebuffer: vec![0u8; width * height * 4],
        depth: vec![1.0f32; width * height],
        texture: build_texture().to_vec(),
        mvp: [mat4_identity(); MESH_COUNT],
        stats_clipped_tris: 0,
        stats_flipped_after_clip: 0,
    };
    unsafe { *core::ptr::addr_of_mut!(STATE) = Some(st) };
}

#[no_mangle]
pub extern "C" fn render(t: f32) {
    render_frame(state(), t);
}

#[no_mangle]
pub extern "C" fn framebuffer_ptr() -> *const u8 {
    state().framebuffer.as_ptr()
}

#[no_mangle]
pub extern "C" fn depth_ptr() -> *const f32 {
    state().depth.as_ptr()
}

#[no_mangle]
pub extern "C" fn width() -> usize {
    state().width
}

#[no_mangle]
pub extern "C" fn height() -> usize {
    state().height
}

#[no_mangle]
pub extern "C" fn mesh_count() -> usize {
    MESH_COUNT
}

#[no_mangle]
pub extern "C" fn mesh_vertices_ptr(mesh: usize) -> *const f32 {
    mesh_vertices(mesh).as_ptr()
}

#[no_mangle]
pub extern "C" fn mesh_vertex_count(mesh: usize) -> usize {
    mesh_vertices(mesh).len() / FLOATS_PER_VERTEX
}

#[no_mangle]
pub extern "C" fn mesh_indices_ptr(mesh: usize) -> *const u32 {
    mesh_indices(mesh).as_ptr()
}

#[no_mangle]
pub extern "C" fn mesh_index_count(mesh: usize) -> usize {
    mesh_indices(mesh).len()
}

/// MVP (column-major, 16 floats) for `mesh`, valid after `render(t)`.
#[no_mangle]
pub extern "C" fn mvp_ptr(mesh: usize) -> *const f32 {
    state().mvp[mesh].as_ptr()
}

#[no_mangle]
pub extern "C" fn texture_ptr() -> *const u8 {
    state().texture.as_ptr()
}

#[no_mangle]
pub extern "C" fn texture_size() -> usize {
    TEX_SIZE
}

#[no_mangle]
pub extern "C" fn stats_clipped_tris() -> u32 {
    state().stats_clipped_tris
}

#[no_mangle]
pub extern "C" fn stats_flipped_after_clip() -> u32 {
    state().stats_flipped_after_clip
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn cv(x: f32, y: f32, z: f32, w: f32) -> ClipVert {
        ClipVert {
            pos: [x, y, z, w],
            color: [1.0, 0.5, 0.25],
            uv: [0.25, 0.75],
        }
    }

    fn ndc_area_sign(poly: &[ClipVert], n: usize) -> Vec<f32> {
        let mut signs = Vec::new();
        let p0 = poly[0].pos;
        for k in 1..n - 1 {
            let a = [p0[0] / p0[3], p0[1] / p0[3]];
            let b = [
                poly[k].pos[0] / poly[k].pos[3],
                poly[k].pos[1] / poly[k].pos[3],
            ];
            let c = [
                poly[k + 1].pos[0] / poly[k + 1].pos[3],
                poly[k + 1].pos[1] / poly[k + 1].pos[3],
            ];
            let area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
            signs.push(area.signum());
        }
        signs
    }

    #[test]
    fn clip_preserves_winding_when_crossing_near_plane() {
        // One vertex behind the near plane (z + w < 0), two in front.
        let tri = [cv(-1.0, -1.0, -0.5, 1.0), cv(1.0, -1.0, -0.5, 1.0), cv(0.0, 1.0, -2.0, 1.0)];
        let (poly, n) = clip_near(&tri);
        assert_eq!(n, 4, "one vertex clipped -> quad");
        for v in &poly[..n] {
            assert!(near_distance(v) >= -1e-5);
        }
        // Winding of every fan triangle must match the original (CCW here).
        let orig = ndc_area_sign(&[tri[0], tri[1], tri[2], tri[0]], 3);
        let after = ndc_area_sign(&poly, n);
        assert_eq!(after.len(), 2);
        for s in &after {
            assert_eq!(s, &orig[0], "triangle flipped after clipping");
        }
    }

    #[test]
    fn clip_two_vertices_behind_produces_triangle_with_same_winding() {
        let tri = [cv(-1.0, -1.0, -2.0, 1.0), cv(1.0, -1.0, -0.5, 1.0), cv(0.0, 1.0, -2.0, 1.0)];
        let (poly, n) = clip_near(&tri);
        assert_eq!(n, 3, "two vertices clipped -> triangle");
        let signs = ndc_area_sign(&poly, n);
        assert!(signs.iter().all(|&s| s == signs[0] && s != 0.0));
    }

    #[test]
    fn clip_fully_behind_near_plane_yields_nothing() {
        let tri = [cv(-1.0, -1.0, -5.0, 1.0), cv(1.0, -1.0, -5.0, 1.0), cv(0.0, 1.0, -5.0, 1.0)];
        let (_, n) = clip_near(&tri);
        assert_eq!(n, 0);
    }

    #[test]
    fn perspective_maps_near_far_to_ndc() {
        let p = mat4_perspective(60.0f32.to_radians(), 4.0 / 3.0, 0.1, 100.0);
        let near = mat4_mul_vec4(&p, [0.0, 0.0, -0.1, 1.0]);
        let far = mat4_mul_vec4(&p, [0.0, 0.0, -100.0, 1.0]);
        assert!((near[2] / near[3] + 1.0).abs() < 1e-5);
        assert!((far[2] / far[3] - 1.0).abs() < 1e-4);
    }

    #[test]
    fn render_produces_geometry_and_no_flips() {
        init(320, 240);
        for frame in 0..120 {
            render(frame as f32 / 60.0);
            assert_eq!(stats_flipped_after_clip(), 0);
        }
        // Something was actually drawn.
        assert!(state().framebuffer.chunks(4).any(|p| p != CLEAR_COLOR));
        assert!(state().depth.iter().any(|&d| d < 1.0));
    }
}
