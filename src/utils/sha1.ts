// Small synchronous SHA-1 implementation (for browser and Node)
// Source: adapted minimal implementation for demonstration
export function sha1(message: string): string {
  function toHexStr(num: number) {
    let s = '', v
    for (let i = 7; i >= 0; i--) {
      v = (num >>> (i * 4)) & 0x0f
      s += v.toString(16)
    }
    return s
  }

  const msg = unescape(encodeURIComponent(message)) // UTF-8 encode
  const msgLen = msg.length
  const words = [] as number[]
  for (let i = 0; i < msgLen; i++) words[i >> 2] |= (msg.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8)
  words[msgLen >> 2] |= 0x80 << (24 - (msgLen % 4) * 8)
  words[(((msgLen + 8) >> 6) + 1) * 16 - 1] = msgLen * 8

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0

  const w = new Array(80)
  for (let i = 0; i < words.length; i += 16) {
    for (let t = 0; t < 16; t++) w[t] = words[i + t] | 0
    for (let t = 16; t < 80; t++) {
      const tmp = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]
      w[t] = ((tmp << 1) | (tmp >>> 31)) >>> 0
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let t = 0; t < 80; t++) {
      let f: number, k: number
      if (t < 20) { f = (b & c) | (~b & d); k = 0x5a827999 }
      else if (t < 40) { f = b ^ c ^ d; k = 0x6ed9eba1 }
      else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc }
      else { f = b ^ c ^ d; k = 0xca62c1d6 }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + (w[t] >>> 0)) >>> 0
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = temp
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  return toHexStr(h0) + toHexStr(h1) + toHexStr(h2) + toHexStr(h3) + toHexStr(h4)
}
