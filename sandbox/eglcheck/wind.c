#include "platform/egl_app.h"
#include "platform/mat4.h"
#include "platform/mesh.h"
int main(void){
  egl_app_init(256,256);
  GLuint vs=compile_shader(GL_VERTEX_SHADER,
    "#version 300 es\nlayout(location=0) in vec3 p; uniform mat4 mvp; void main(){gl_Position=mvp*vec4(p,1.0);}");
  GLuint fs=compile_shader(GL_FRAGMENT_SHADER,
    "#version 300 es\nprecision highp float; out vec4 o; void main(){o=vec4(1.0);}");
  GLuint prog=glCreateProgram(); glAttachShader(prog,vs); glAttachShader(prog,fs); glLinkProgram(prog);
  Mesh m=mesh_create_uv_sphere(16,24);
  Mat4 mvp=mat4_multiply(mat4_perspective(3.14159f/4.f,1.f,0.1f,100.f),
    mat4_multiply(mat4_look_at((Vec3){0,0,3},(Vec3){0,0,0},(Vec3){0,1,0}),mat4_identity()));
  glUseProgram(prog); glUniformMatrix4fv(glGetUniformLocation(prog,"mvp"),1,GL_FALSE,mvp.m);
  glBindVertexArray(m.vao); glEnable(GL_DEPTH_TEST); glEnable(GL_CULL_FACE);
  // count rendered pixels by occlusion query
  GLuint q; glGenQueries(1,&q); GLuint SP=0x8914;
  for(int mode=0;mode<2;mode++){
    glCullFace(mode==0?GL_BACK:GL_FRONT);
    glClearColor(0,0,0,1); glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
    glBeginQuery(SP,q);
    glDrawElements(GL_TRIANGLES,m.indexCount,GL_UNSIGNED_INT,0);
    glEndQuery(SP);
    GLuint r=0; glGetQueryObjectuiv(q,GL_QUERY_RESULT,&r);
    printf("cull %s: samples passed = %u\n", mode==0?"BACK (keep front faces)":"FRONT (keep back faces)", r);
  }
  return 0;
}
