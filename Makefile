CXX ?= g++
CXXFLAGS ?= -O2 -std=c++17 -Wall -Wextra

oit_demo: src/main.cpp src/renderer.h src/scene.h src/png.h
	$(CXX) $(CXXFLAGS) -o $@ src/main.cpp

.PHONY: run clean
run: oit_demo
	mkdir -p artifacts
	./oit_demo

clean:
	rm -f oit_demo
