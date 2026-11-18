#include "platform/egl_app.h"
int main(void){
  egl_app_init(512,512);
  GLuint vs=compile_shader(GL_VERTEX_SHADER,"#version 300 es\nlayout(location=0) in vec2 p; void main(){gl_Position=vec4(p,0.,1.);}");
  GLuint fs=compile_shader(GL_FRAGMENT_SHADER,"#version 300 es\nprecision highp float; out vec4 o; void main(){o=vec4(1.0,0.0,1.0,1.0);}");
  GLuint pr=glCreateProgram(); glAttachShader(pr,vs); glAttachShader(pr,fs); glLinkProgram(pr); glUseProgram(pr);
  GLuint b; glGenBuffers(1,&b); glBindBuffer(GL_ARRAY_BUFFER,b);
  float q[]={-1,-1,1,-1,-1,1,1,1}; glBufferData(GL_ARRAY_BUFFER,sizeof(q),q,GL_STATIC_DRAW);
  glEnableVertexAttribArray(0); glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,0,0);
  glDrawArrays(GL_TRIANGLE_STRIP,0,4);
  float *f=malloc(4*512*512*sizeof(float));
  glReadPixels(0,0,512,512,GL_RGBA,GL_FLOAT,f);
  printf("GL err=0x%x f[0..3]=%.2f %.2f %.2f %.2f f[mid]=%.2f\n",(unsigned)glGetError(),f[0],f[1],f[2],f[3], f[(256*512+256)*4]);
  unsigned char *u=malloc(4*512*512);
  glReadPixels(0,0,512,512,GL_RGBA,GL_UNSIGNED_BYTE,u);
  printf("ubyte err=0x%x u[0..3]=%d %d %d %d u[mid]=%d\n",(unsigned)glGetError(),u[0],u[1],u[2],u[3], u[(256*512+256)*4]);
  return 0;
}
