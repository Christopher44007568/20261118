#include "platform/egl_app.h"
#include "platform/mat4.h"
#include "platform/mesh.h"
int main(void){
  egl_app_init(256,256);
  GLuint vs=compile_shader(GL_VERTEX_SHADER,
    "#version 300 es\nlayout(location=0) in vec3 p; uniform mat4 mvp; void main(){gl_Position=mvp*vec4(p,1.0);}");
  GLuint fs=compile_shader(GL_FRAGMENT_SHADER,
    "#version 300 es\nprecision highp float; uniform float shade; out vec4 o; void main(){o=vec4(shade);}");
  GLuint prog=glCreateProgram(); glAttachShader(prog,vs); glAttachShader(prog,fs); glLinkProgram(prog);
  Mesh m=mesh_create_uv_sphere(16,24);
  Mat4 mvp=mat4_multiply(mat4_perspective(3.14159f/4.f,1.f,0.1f,100.f),
    mat4_multiply(mat4_look_at((Vec3){0,0,3},(Vec3){0,0,0},(Vec3){0,1,0}),mat4_identity()));
  glUseProgram(prog); glUniformMatrix4fv(glGetUniformLocation(prog,"mvp"),1,GL_FALSE,mvp.m);
  GLint sh=glGetUniformLocation(prog,"shade");
  glBindVertexArray(m.vao); glEnable(GL_DEPTH_TEST); glEnable(GL_CULL_FACE);
  unsigned char px[256*256*4];
  for(int t=0;t<2;t++){
    glCullFace(t==0?GL_BACK:GL_FRONT);
    glUniform1f(sh, t==0?0.3f:0.8f);
    glClearColor(0,0,0,1); glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
    glDrawElements(GL_TRIANGLES,m.indexCount,GL_UNSIGNED_INT,0);
    glReadPixels(0,0,256,256,GL_RGBA,GL_UNSIGNED_BYTE,px);
    long n=0; long sum=0; for(int i=0;i<256*256;i++) if(px[i*4]){n++;sum+=px[i*4];}
    printf("cull %s: lit=%ld avgShade=%.3f center=%d\n",t==0?"BACK":"FRONT",n,n?(double)sum/n:0, px[(128*256+128)*4]);
  }
  return 0;
}
