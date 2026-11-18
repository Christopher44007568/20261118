#include "platform/egl_app.h"
#include "platform/mat4.h"
#include "platform/mesh.h"
int main(void){
  egl_app_init(256,256);
  GLuint vs=compile_shader(GL_VERTEX_SHADER,
    "#version 300 es\nlayout(location=0) in vec3 p; uniform mat4 mvp; out float d; void main(){vec4 c=mvp*vec4(p,1.0);d=c.z;gl_Position=c;}");
  GLuint fs=compile_shader(GL_FRAGMENT_SHADER,
    "#version 300 es\nprecision highp float; in float d; out vec4 o; void main(){o=vec4(d,0.,0.,1.);}");
  GLuint prog=glCreateProgram(); glAttachShader(prog,vs); glAttachShader(prog,fs); glLinkProgram(prog);
  Mesh m=mesh_create_uv_sphere(16,24);
  Mat4 mvp=mat4_multiply(mat4_perspective(3.14159f/4.f,1.f,0.1f,100.f),
    mat4_multiply(mat4_look_at((Vec3){0,0,3},(Vec3){0,0,0},(Vec3){0,1,0}),mat4_identity()));
  glUseProgram(prog); glUniformMatrix4fv(glGetUniformLocation(prog,"mvp"),1,GL_FALSE,mvp.m);
  glBindVertexArray(m.vao); glEnable(GL_DEPTH_TEST); glEnable(GL_CULL_FACE);
  float px[4];
  for(int t=0;t<2;t++){
    glCullFace(t==0?GL_BACK:GL_FRONT);
    glClearColor(0,0,0,1); glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
    glDrawElements(GL_TRIANGLES,m.indexCount,GL_UNSIGNED_INT,0);
    glReadPixels(128,128,1,1,GL_RGBA,GL_FLOAT,px);
    printf("cull %s: NDC z at center = %.4f\n", t==0?"BACK (keep front-facing)":"FRONT (keep back-facing)", px[0]);
  }
  return 0;
}
