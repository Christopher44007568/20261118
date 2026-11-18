CXX ?= g++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra

tangent_lab: src/main.cpp src/render.cpp src/render.h src/mesh.h src/geometry.h \
             src/normalmap.h src/image.h src/linalg.h
	$(CXX) $(CXXFLAGS) -o $@ src/main.cpp src/render.cpp

.PHONY: test clean
test: tangent_lab
	./tangent_lab

clean:
	rm -f tangent_lab out/*.png
