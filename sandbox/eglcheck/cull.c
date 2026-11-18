#include "platform/egl_app.h"
int main(void){
  egl_app_init(64,64);
  GLuint vs=compile_shader(GL_VERTEX_SHADER,"#version 300 es\nlayout(location=0) in vec2 p; void main(){gl_Position=vec4(p,0.,1.);}");
  GLuint fs=compile_shader(GL_FRAGMENT_SHADER,"#version 300 es\nprecision highp float; out vec4 o; void main(){o=vec4(1.0);}");
  GLuint prog=glCreateProgram(); glAttachShader(prog,vs); glAttachShader(prog,fs); glLinkProgram(prog); glUseProgram(prog);
  // CCW triangle in clip space
  float v[]={-0.8f,-0.8f, 0.8f,-0.8f, 0.0f,0.8f};
  GLuint b; glGenBuffers(1,&b); glBindBuffer(GL_ARRAY_BUFFER,b); glBufferData(GL_ARRAY_BUFFER,sizeof(v),v,GL_STATIC_DRAW);
  glEnableVertexAttribArray(0); glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,0,0);
  unsigned char px[64*64*4];
  for(int t=0;t<3;t++){
    if(t==0) glDisable(GL_CULL_FACE);
    else { glEnable(GL_CULL_FACE); glCullFace(t==1?GL_BACK:GL_FRONT); }
    glClearColor(0,0,0,1); glClear(GL_COLOR_BUFFER_BIT);
    glDrawArrays(GL_TRIANGLES,0,3);
    glReadPixels(0,0,64,64,GL_RGBA,GL_UNSIGNED_BYTE,px);
    long n=0; for(int i=0;i<64*64;i++) if(px[i*4]) n++;
    printf("test %d lit=%ld\n",t,n);
  }
  return 0;
}
