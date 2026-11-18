"""CPU reference implementation of screen-space reflection (SSR).

Modules:
    mat        - minimal vector / matrix helpers (numpy based)
    meshes     - procedural triangle meshes (ground, boxes, cylinders)
    rasterizer - software z-buffer rasterizer producing a G-buffer
    shading    - direct lighting and environment ambient fallback
    ssr        - screen-space ray march with binary refinement
    scenarios  - the three required test scenarios
"""

__all__ = ["mat", "meshes", "rasterizer", "shading", "ssr", "scenarios"]
