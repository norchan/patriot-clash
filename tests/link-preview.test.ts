import { describe, it, expect } from 'vitest'
import { isBlockedIp, safeFetchUrl } from '@/lib/link-preview'

describe('link-preview SSRF guard', () => {
  it('blocks loopback, private, link-local, metadata, CGNAT IPv4', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.9.9', '192.168.1.1',
      '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1']) {
      expect(isBlockedIp(ip)).toBe(true)
    }
  })
  it('allows normal public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) {
      expect(isBlockedIp(ip)).toBe(false)
    }
  })
  it('blocks IPv6 loopback, link-local, ULA, and v4-mapped private', () => {
    for (const ip of ['::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:10.0.0.1', '::ffff:169.254.169.254']) {
      expect(isBlockedIp(ip)).toBe(true)
    }
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false) // public
  })
  it('rejects non-http(s), credentials, IP-literal private targets', async () => {
    expect(await safeFetchUrl('file:///etc/passwd')).toBeNull()
    expect(await safeFetchUrl('ftp://example.com')).toBeNull()
    expect(await safeFetchUrl('http://user:pass@example.com')).toBeNull()
    expect(await safeFetchUrl('http://127.0.0.1/')).toBeNull()
    expect(await safeFetchUrl('http://169.254.169.254/latest/meta-data')).toBeNull()
    expect(await safeFetchUrl('http://[::1]/')).toBeNull()
    expect(await safeFetchUrl('http://metadata.google.internal/')).toBeNull()
    expect(await safeFetchUrl('not-a-url')).toBeNull()
  })
})
