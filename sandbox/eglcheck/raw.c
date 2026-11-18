#include "platform/mat4.h"
#include <stdio.h>
int main(void){
  Mat4 v=mat4_look_at((Vec3){0,0,3},(Vec3){0,0,0},(Vec3){0,1,0});
  // transform world normal (0,0,1) by mat3(view)
  float n[3]={0,0,1};
  float r[3];
  for(int row=0;row<3;row++)
    r[row]=v.m[0*4+row]*n[0]+v.m[1*4+row]*n[1]+v.m[2*4+row]*n[2];
  printf("view*(0,0,1) = %.1f %.1f %.1f\n",r[0],r[1],r[2]);
  printf("view matrix row2 (m[2],m[6],m[10]) = %.1f %.1f %.1f\n",v.m[2],v.m[6],v.m[10]);
  return 0;
}
