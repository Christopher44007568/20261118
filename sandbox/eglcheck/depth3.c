#include "platform/egl_app.h"
#include "platform/mat4.h"
#include "platform/mesh.h"
int main(void){
  egl_app_init(256,256);
  GLuint vs=compile_shader(GL_VERTEX_SHADER,
    "#version 300 es\nlayout(location=0) in vec3 p; uniform mat4 mv; uniform mat4 pj; out float ed; void main(){vec4 v=mv*vec4(p,1.0); ed=-v.z; gl_Position=pj*v;}");
  GLuint fs=compile_shader(GL_FRAGMENT_SHADER,
    "#version 300 es\nprecision highp float; in float ed; out vec4 o; void main(){float x=clamp(ed/6.0,0.0,1.0); o=vec4(x,x,x,1.0);}");
  GLuint prog=glCreateProgram(); glAttachShader(prog,vs); glAttachShader(prog,fs); glLinkProgram(prog);
  Mesh m=mesh_create_uv_sphere(16,24);
  Mat4 v=mat4_look_at((Vec3){0,0,3},(Vec3){0,0,0},(Vec3){0,1,0});
  Mat4 pj=mat4_perspective(3.14159f/4.f,1.f,0.1f,100.f);
  glUseProgram(prog);
  glUniformMatrix4fv(glGetUniformLocation(prog,"mv"),1,GL_FALSE,v.m);
  glUniformMatrix4fv(glGetUniformLocation(prog,"pj"),1,GL_FALSE,pj.m);
  glBindVertexArray(m.vao); glEnable(GL_DEPTH_TEST); glEnable(GL_CULL_FACE);
  float px[4];
  for(int t=0;t<2;t++){
    glCullFace(t==0?GL_BACK:GL_FRONT);
    glClearColor(0,0,0,1); glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
    glDrawElements(GL_TRIANGLES,m.indexCount,GL_UNSIGNED_INT,0);
    glReadPixels(128,128,1,1,GL_RGBA,GL_UNSIGNED_BYTE,(void*)0); unsigned char b[4]; glReadPixels(128,128,1,1,GL_RGBA,GL_UNSIGNED_BYTE,b);
    printf("cull %s: eye depth center = %.4f\n", t==0?"BACK (near surface)":"FRONT (far surface)", (double)b[0]/255.0*6.0);
  }
  return 0;
}
