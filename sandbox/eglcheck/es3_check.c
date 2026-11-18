#include <EGL/egl.h>
#include <GLES3/gl3.h>
#include <stdio.h>
static GLuint mk(GLenum t,const char*s){GLuint sh=glCreateShader(t);glShaderSource(sh,1,&s,0);glCompileShader(sh);GLint ok;glGetShaderiv(sh,GL_COMPILE_STATUS,&ok);if(!ok){char b[2048];glGetShaderInfoLog(sh,2048,0,b);printf("SHADER FAIL:\n%s\n",b);}return sh;}
int main(void){
  EGLDisplay d=eglGetDisplay(EGL_DEFAULT_DISPLAY);EGLint a,b;eglInitialize(d,&a,&b);
  EGLint ca[]={EGL_SURFACE_TYPE,EGL_PBUFFER_BIT,EGL_RENDERABLE_TYPE,EGL_OPENGL_ES3_BIT,EGL_NONE};
  EGLConfig c;EGLint n;eglChooseConfig(d,ca,&c,1,&n);
  EGLSurface s=eglCreatePbufferSurface(d,c,(EGLint[]){EGL_WIDTH,32,EGL_HEIGHT,32,EGL_NONE});
  EGLContext ctx=eglCreateContext(d,c,EGL_NO_CONTEXT,(EGLint[]){EGL_CONTEXT_CLIENT_VERSION,3,EGL_NONE});
  eglMakeCurrent(d,s,s,ctx);
  printf("version: %s\n",glGetString(GL_VERSION));
  printf("GLSL: %s\n",glGetString(GL_SHADING_LANGUAGE_VERSION));
  const char*vs="#version 300 es\nlayout(location=0) in vec2 p; void main(){gl_Position=vec4(p,0.,1.);}";
  const char*fs="#version 300 es\nprecision highp float;\nout vec4 o; uniform sampler2D t; void main(){vec3 x=texture(t,vec2(.5)).xyz; vec3 d=vec3(dFdx(x.x),dFdy(x.y),0.0); o=vec4(length(d),1,1,1);}";
  GLuint p=glCreateProgram();GLuint v=mk(GL_VERTEX_SHADER,vs),f=mk(GL_FRAGMENT_SHADER,fs);
  glAttachShader(p,v);glAttachShader(p,f);glLinkProgram(p);GLint ok;glGetProgramiv(p,GL_LINK_STATUS,&ok);
  if(!ok){char lb[2048];glGetProgramInfoLog(p,2048,0,lb);printf("LINK FAIL:\n%s\n",lb);return 1;}
  GLint texu=glGetUniformLocation(p,"t"); printf("uniform tex loc=%d\n",texu);
  GLfloat tex[4]={0.2f,0.4f,0.6f,1.0f}; GLuint tx;glGenTextures(1,&tx);glBindTexture(GL_TEXTURE_2D,tx);
  glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA32F,1,1,0,GL_RGBA,GL_FLOAT,tex);
  glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
  glUseProgram(p);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,tx);glUniform1i(texu,0);
  GLuint vbo;glGenBuffers(1,&vbo);glBindBuffer(GL_ARRAY_BUFFER,vbo);
  GLfloat q[]={-1,-1,1,-1,-1,1,1,1};glBufferData(GL_ARRAY_BUFFER,sizeof(q),q,GL_STATIC_DRAW);
  glEnableVertexAttribArray(0);glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,0,0);
  GLuint fbo;glGenFramebuffers(1,&fbo);glBindFramebuffer(GL_FRAMEBUFFER,fbo);
  GLuint rt;glGenTextures(1,&rt);glBindTexture(GL_TEXTURE_2D,rt);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA32F,32,32,0,GL_RGBA,GL_FLOAT,0);
  glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
  glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,rt,0);
  printf("FBO status=0x%x (0x%x=complete)\n",(unsigned)glCheckFramebufferStatus(GL_FRAMEBUFFER),(unsigned)GL_FRAMEBUFFER_COMPLETE);
  glViewport(0,0,32,32);glClearColor(0,0,0,1);glClear(GL_COLOR_BUFFER_BIT);glDrawArrays(GL_TRIANGLE_STRIP,0,4);
  GLfloat px[4];glReadPixels(16,16,1,1,GL_RGBA,GL_FLOAT,px);
  printf("float readback: %.3f %.3f %.3f %.3f\n",px[0],px[1],px[2],px[3]);
  printf("ES3 OK\n");return 0;
}
