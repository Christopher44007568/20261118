#include <EGL/egl.h>
#include <GLES2/gl2.h>
#include <stdio.h>
int main(void){
  EGLDisplay dpy = eglGetDisplay(EGL_DEFAULT_DISPLAY);
  EGLint maj,min;
  if(!eglInitialize(dpy,&maj,&min)){printf("eglInitialize FAIL 0x%x\n",(unsigned)eglGetError());return 1;}
  printf("EGL %d.%d\n",maj,min);
  EGLint cfgAttribs[]={EGL_SURFACE_TYPE,EGL_PBUFFER_BIT,EGL_RENDERABLE_TYPE,EGL_OPENGL_ES2_BIT,EGL_NONE};
  EGLConfig cfg; EGLint n;
  if(!eglChooseConfig(dpy,cfgAttribs,&cfg,1,&n)||n<1){printf("chooseConfig FAIL\n");return 1;}
  EGLint surfAttribs[]={EGL_WIDTH,16,EGL_HEIGHT,16,EGL_NONE};
  EGLSurface surf=eglCreatePbufferSurface(dpy,cfg,surfAttribs);
  EGLint ctxAttribs[]={EGL_CONTEXT_CLIENT_VERSION,2,EGL_NONE};
  EGLContext ctx=eglCreateContext(dpy,cfg,EGL_NO_CONTEXT,ctxAttribs);
  if(!eglMakeCurrent(dpy,surf,surf,ctx)){printf("makeCurrent FAIL 0x%x\n",(unsigned)eglGetError());return 1;}
  const char* vs="attribute vec2 p; void main(){gl_Position=vec4(p,0.0,1.0);}";
  const char* fs="precision mediump float; void main(){gl_FragColor=vec4(1.0,0.5,0.25,1.0);}";
  GLuint vp=glCreateShader(GL_VERTEX_SHADER); glShaderSource(vp,1,&vs,0); glCompileShader(vp);
  GLuint fp=glCreateShader(GL_FRAGMENT_SHADER); glShaderSource(fp,1,&fs,0); glCompileShader(fp);
  GLint ok=0; glGetShaderiv(fp,GL_COMPILE_STATUS,&ok);
  if(!ok){char log[1024];glGetShaderInfoLog(fp,1024,0,log);printf("FS FAIL: %s\n",log);return 1;}
  GLuint prog=glCreateProgram(); glAttachShader(prog,vp); glAttachShader(prog,fp); glLinkProgram(prog);
  glUseProgram(prog);
  GLfloat verts[]={-1,-1, 1,-1, -1,1, 1,1};
  GLuint buf; glGenBuffers(1,&buf); glBindBuffer(GL_ARRAY_BUFFER,buf); glBufferData(GL_ARRAY_BUFFER,sizeof(verts),verts,GL_STATIC_DRAW);
  GLint loc=glGetAttribLocation(prog,"p"); glEnableVertexAttribArray(loc); glVertexAttribPointer(loc,2,GL_FLOAT,GL_FALSE,0,0);
  glViewport(0,0,16,16); glClearColor(0,0,0,1); glClear(GL_COLOR_BUFFER_BIT); glDrawArrays(GL_TRIANGLE_STRIP,0,4);
  unsigned char px[4]; glReadPixels(8,8,1,1,GL_RGBA,GL_UNSIGNED_BYTE,px);
  printf("pixel RGBA=%d %d %d %d\n",px[0],px[1],px[2],px[3]);
  eglTerminate(dpy);
  printf("SMOKE OK\n");
  return 0;
}
