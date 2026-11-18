#include "platform/egl_app.h"
int main(void){
  egl_app_init(256,256);
  EGLint d=0; eglQueryContext(g_app.dpy,g_app.context,EGL_CONFIG_ID,&d);
  EGLint depth=0,stencil=0;
  eglGetConfigAttrib(g_app.dpy,g_app.config,EGL_DEPTH_SIZE,&depth);
  eglGetConfigAttrib(g_app.dpy,g_app.config,EGL_STENCIL_SIZE,&stencil);
  printf("EGL depth size=%d stencil=%d\n",depth,stencil);
  // check GL error
  glClearDepthf(1.0f); glClear(GL_DEPTH_BUFFER_BIT);
  printf("GL err after depth clear = 0x%x\n",(unsigned)glGetError());
  return 0;
}
