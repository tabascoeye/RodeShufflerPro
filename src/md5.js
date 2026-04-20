(function attachMd5(globalObject) {
  const SHIFT_AMOUNTS = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];

  const TABLE = Array.from({ length: 64 }, (_, index) =>
    Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0
  );

  function leftRotate(value, shift) {
    return ((value << shift) | (value >>> (32 - shift))) >>> 0;
  }

  function toUint32(value) {
    return value >>> 0;
  }

  function md5Bytes(input) {
    const source = input instanceof Uint8Array ? input : new Uint8Array(input);
    const bitLength = source.length * 8;
    const paddedLength = (((source.length + 8) >> 6) + 1) * 64;
    const buffer = new Uint8Array(paddedLength);
    const view = new DataView(buffer.buffer);

    buffer.set(source);
    buffer[source.length] = 0x80;
    view.setUint32(paddedLength - 8, bitLength >>> 0, true);
    view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000) >>> 0, true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let offset = 0; offset < paddedLength; offset += 64) {
      const words = new Uint32Array(16);
      for (let index = 0; index < 16; index += 1) {
        words[index] = view.getUint32(offset + index * 4, true);
      }

      let a = a0;
      let b = b0;
      let c = c0;
      let d = d0;

      for (let index = 0; index < 64; index += 1) {
        let f;
        let g;

        if (index < 16) {
          f = (b & c) | (~b & d);
          g = index;
        } else if (index < 32) {
          f = (d & b) | (~d & c);
          g = (5 * index + 1) % 16;
        } else if (index < 48) {
          f = b ^ c ^ d;
          g = (3 * index + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * index) % 16;
        }

        const temp = d;
        d = c;
        c = b;

        const sum = toUint32(a + f + TABLE[index] + words[g]);
        b = toUint32(b + leftRotate(sum, SHIFT_AMOUNTS[index]));
        a = temp;
      }

      a0 = toUint32(a0 + a);
      b0 = toUint32(b0 + b);
      c0 = toUint32(c0 + c);
      d0 = toUint32(d0 + d);
    }

    const digest = new Uint8Array(16);
    const digestView = new DataView(digest.buffer);
    digestView.setUint32(0, a0, true);
    digestView.setUint32(4, b0, true);
    digestView.setUint32(8, c0, true);
    digestView.setUint32(12, d0, true);
    return digest;
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  globalObject.RodeShufflerUtils = {
    bytesToHex,
    md5Bytes
  };
})(window);
