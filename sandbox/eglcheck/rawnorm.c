#include "platform/egl_app.h"
#include "platform/mat4.h"
#include "platform/mesh.h"
int main(void){
  egl_app_init(64,64);
  GLuint vs=compile_shader(GL_VERTEX_SHADER,
    "#version 300 es\nlayout(location=0) in vec3 p; layout(location=1) in vec3 n; uniform mat4 mvp; out vec3 wn; void main(){wn=n; gl_Position=mvp*vec4(p,1.0);}");
  GLuint fs=compile_shader(GL_FRAGMENT_SHADER,
    "#version 300 es\nprecision highp float; in vec3 wn; out vec4 o; void main(){o=vec4(wn*0.5+0.5,1.0);}");
  GLuint pr=glCreateProgram(); glAttachShader(pr,vs); glAttachShader(pr,fs); glLinkProgram(pr); glUseProgram(pr);
  Mesh m=mesh_create_uv_sphere(8,12);
  Mat4 mvp=mat4_multiply(mat4_perspective(3.14159f/4.f,1.f,0.1f,100.f),
    mat4_multiply(mat4_look_at((Vec3){0,0,3},(Vec3){0,0,0},(Vec3){0,1,0}),mat4_identity()));
  glUniformMatrix4fv(glGetUniformLocation(pr,"mvp"),1,GL_FALSE,mvp.m);
  glBindVertexArray(m.vao); glEnable(GL_DEPTH_TEST); glEnable(GL_CULL_FACE); glCullFace(GL_BACK);
  unsigned char px[4]; glClearColor(0,0,0,1); glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
  glDrawElements(GL_TRIANGLES,m.indexCount,GL_UNSIGNED_INT,0);
  glReadPixels(32,32,1,1,GL_RGBA,GL_UNSIGNED_BYTE,px);
  printf("world normal at center RGB=%d %d %d (B=255 means outward +z)\n",px[0],px[1],px[2]);
  return 0;
}
