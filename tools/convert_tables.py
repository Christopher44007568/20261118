"""Convert the classic Marching Cubes lookup tables (PyMCubes C++ source)
into a pure-Python module `mcubes_app/mc_tables.py`.

Corner numbering (bit m set when corner value <= isolevel):
    0:(0,0,0) 1:(1,0,0) 2:(1,1,0) 3:(0,1,0)
    4:(0,0,1) 5:(1,0,1) 6:(1,1,1) 7:(0,1,1)
Edge numbering (endpoint corner pairs):
    0:(0,1) 1:(1,2) 2:(2,3) 3:(3,0) 4:(4,5) 5:(5,6)
    6:(6,7) 7:(7,4) 8:(0,4) 9:(1,5) 10:(2,6) 11:(3,7)
"""
import re
import sys

SRC = "/tmp/marchingcubes.cpp"
DST = "mcubes_app/mc_tables.py"


def parse(src):
    text = open(src).read()

    m = re.search(r"edge_table\[256\]\s*=\s*\{(.*?)\};", text, re.S)
    edge_rows = [int(x, 16) for x in re.findall(r"0x[0-9a-fA-F]+", m.group(1))]
    assert len(edge_rows) == 256, len(edge_rows)

    m = re.search(r"triangle_table\[256\]\[16\]\s*=\s*\{(.*?)\};", text, re.S)
    rows = re.findall(r"\{([^{}]+)\}", m.group(1))
    assert len(rows) == 256, len(rows)
    tri_rows = []
    for row in rows:
        vals = [int(v) for v in row.split(",")]
        assert len(vals) == 16
        tri_rows.append(vals)
    return edge_rows, tri_rows


def main():
    edge_rows, tri_rows = parse(SRC)
    with open(DST, "w") as fh:
        fh.write('"""Classic Marching Cubes lookup tables (auto-generated).\n\n')
        fh.write("Source: PyMCubes marchingcubes.cpp (public domain, Paul Bourke tables).\n")
        fh.write('"""\n\n')
        fh.write("EDGE_TABLE = [\n")
        for i in range(0, 256, 8):
            fh.write("    " + ", ".join(f"0x{v:03x}" for v in edge_rows[i:i + 8]) + ",\n")
        fh.write("]\n\n")
        fh.write("TRI_TABLE = [\n")
        for row in tri_rows:
            fh.write("    [" + ", ".join(str(v) for v in row) + "],\n")
        fh.write("]\n")
    print(f"wrote {DST}: edge_table[256], tri_table[256][16]")


if __name__ == "__main__":
    sys.exit(main())
