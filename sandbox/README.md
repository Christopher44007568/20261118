# Headless GL sandbox

This directory holds the no-root OpenGL ES setup used to run the renderer and
tests without a display.

- `debs/` — locally downloaded Mesa/glvnd dev and runtime `.deb` packages.
- `headers/` — extracted EGL/GLES headers plus `libEGL` / `libGLESv2`.
  `libEGL.so.1` is symlinked to the system Mesa library; llvmpipe provides
  software rendering via `LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe`.
- `stb/stb_image_write.h` — public-domain PNG writer used by `sss_render.c`.
- `eglcheck/*.c` — small standalone probes used to validate EGL 1.5 / GLES 3.2,
  float FBOs, derivatives, culling, depth ordering and readback behaviour.
  They are diagnostics, not part of the shipped material pipeline.

The main build (`Makefile`) references `headers/` directly, so no system
package installation or root access is required.
