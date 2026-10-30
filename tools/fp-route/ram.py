import struct
class RAM:
    def __init__(s,fn='core.bin',base=448): s.d=open(fn,'rb').read(); s.B=base
    def u32(s,a): a&=0xFFFFFF; return struct.unpack('<I',s.d[s.B+a:s.B+a+4])[0]
    def f(s,a): a&=0xFFFFFF; return struct.unpack('<f',s.d[s.B+a:s.B+a+4])[0]
    def u8(s,a): a&=0xFFFFFF; return s.d[s.B+(a^3)]
