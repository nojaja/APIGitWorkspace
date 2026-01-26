/**
 * SHA-1ハッシュ値を計算して16進文字列で返す
 * @param {string} content - ハッシュ対象の文字列
 * @returns {Promise<string>} SHA-1ハッシュの16進表現
 */
export async function shaOf(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-1', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Git の blob としての SHA-1 ハッシュを計算して16進文字列で返す
 * @param {string} content - blob の中身となる文字列
 * @returns {Promise<string>} SHA-1ハッシュの16進表現（git blob 用）
 */
export async function shaOfGitBlob(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const body = encoder.encode(content)
  const header = encoder.encode(`blob ${body.byteLength}\0`)
  const merged = new Uint8Array(header.length + body.length)
  merged.set(header)
  merged.set(body, header.length)
  const hashBuffer = await crypto.subtle.digest('SHA-1', merged)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}
