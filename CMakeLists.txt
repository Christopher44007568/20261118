cmake_minimum_required(VERSION 3.20)
project(clustered_lighting LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_path(VULKAN_INCLUDE_DIR vulkan/vulkan.h
    HINTS "${CMAKE_SOURCE_DIR}/.deps/root/usr/include")
find_library(VULKAN_LIBRARY NAMES vulkan
    HINTS "${CMAKE_SOURCE_DIR}/.deps/root/usr/lib/x86_64-linux-gnu"
          "/usr/lib/x86_64-linux-gnu")
if(NOT VULKAN_LIBRARY)
    find_file(VULKAN_LIBRARY NAMES libvulkan.so.1
        HINTS "${CMAKE_SOURCE_DIR}/.deps/root/usr/lib/x86_64-linux-gnu"
              "/usr/lib/x86_64-linux-gnu")
endif()
find_program(GLSLANG_VALIDATOR NAMES glslangValidator
    HINTS "${CMAKE_SOURCE_DIR}/.deps/root/usr/bin")

if(NOT VULKAN_INCLUDE_DIR OR NOT VULKAN_LIBRARY)
    message(FATAL_ERROR "Vulkan headers/library not found")
endif()
if(NOT GLSLANG_VALIDATOR)
    message(FATAL_ERROR "glslangValidator not found")
endif()

set(SHADER_OUTPUT_DIR "${CMAKE_BINARY_DIR}/shaders")
file(MAKE_DIRECTORY "${SHADER_OUTPUT_DIR}")

function(compile_shader INPUT OUTPUT)
    add_custom_command(
        OUTPUT "${SHADER_OUTPUT_DIR}/${OUTPUT}"
        COMMAND "${GLSLANG_VALIDATOR}" -V --target-env vulkan1.2
                -I"${CMAKE_SOURCE_DIR}/shaders"
                "${CMAKE_SOURCE_DIR}/shaders/${INPUT}"
                -o "${SHADER_OUTPUT_DIR}/${OUTPUT}"
        DEPENDS "${CMAKE_SOURCE_DIR}/shaders/${INPUT}"
                "${CMAKE_SOURCE_DIR}/shaders/scene.glsl"
        VERBATIM)
endfunction()

compile_shader(cluster_build.comp cluster_build.spv)
compile_shader(shade.comp shade.spv)
add_custom_target(shaders ALL
    DEPENDS "${SHADER_OUTPUT_DIR}/cluster_build.spv"
            "${SHADER_OUTPUT_DIR}/shade.spv")

add_executable(clustered_lighting
    src/main.cpp
    src/vulkan_context.cpp
    src/cluster_renderer.cpp
    src/png_writer.cpp)
add_dependencies(clustered_lighting shaders)

target_include_directories(clustered_lighting PRIVATE
    "${CMAKE_SOURCE_DIR}/src"
    "${VULKAN_INCLUDE_DIR}")
target_link_libraries(clustered_lighting PRIVATE
    "${VULKAN_LIBRARY}")
target_compile_definitions(clustered_lighting PRIVATE
    CLUSTER_SHADER_DIR="${SHADER_OUTPUT_DIR}")
target_compile_options(clustered_lighting PRIVATE
    -Wall -Wextra -Wpedantic -Wno-missing-field-initializers)

