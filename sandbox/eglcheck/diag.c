#include "platform/egl_app.h"
#include "platform/mat4.h"
#include "platform/mesh.h"
int main(void){
  if(!egl_app_init(256,256)) return 1;
  GLuint vs=compile_shader(GL_VERTEX_SHADER,
    "#version 300 es\nlayout(location=0) in vec3 p; uniform mat4 mvp; void main(){gl_Position=mvp*vec4(p,1.0);}");
  GLuint fs=compile_shader(GL_FRAGMENT_SHADER,
    "#version 300 es\nprecision highp float; out vec4 o; void main(){o=vec4(1.0,0.0,0.0,1.0);}");
  GLuint prog=glCreateProgram(); glAttachShader(prog,vs); glAttachShader(prog,fs); glLinkProgram(prog);
  Mesh m=mesh_create_uv_sphere(16,24);
  Mat4 proj=mat4_perspective(3.14159f/4.f,1.f,0.1f,100.f);
  Mat4 view=mat4_look_at((Vec3){0,0,3},(Vec3){0,0,0},(Vec3){0,1,0});
  Mat4 model=mat4_identity();
  // mvp = proj*view*model (column-major, multiply a*b means a after b)
  Mat4 mvp=mat4_multiply(proj,mat4_multiply(view,model));
  glUseProgram(prog);
  GLint loc=glGetUniformLocation(prog,"mvp");
  glUniformMatrix4fv(loc,1,GL_FALSE,mvp.m);
  glEnable(GL_DEPTH_TEST);
  glClearColor(0,0,0,1); glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
  glBindVertexArray(m.vao);
  glDrawElements(GL_TRIANGLES,m.indexCount,GL_UNSIGNED_INT,0);
  unsigned char px[4];
  glReadPixels(128,128,1,1,GL_RGBA,GL_UNSIGNED_BYTE,px);
  printf("center RGBA=%d %d %d %d\n",px[0],px[1],px[2],px[3]);
  glReadPixels(10,128,1,1,GL_RGBA,GL_UNSIGNED_BYTE,px);
  printf("edge RGBA=%d %d %d %d\n",px[0],px[1],px[2],px[3]);
  printf("indexCount=%d\n",m.indexCount);
  return 0;
}
