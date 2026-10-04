/**
 * Cloudflare voice servers sometimes deliver packets that are entirely zero
 * (or zero except for one byte). Craig drops them; so do we.
 */
export function isMostlyZeroPacket(data: Buffer): boolean {
  if (data.length === 0 || data[0] !== 0) return false;
  let zeros = 0;
  for (const byte of data) if (byte === 0) zeros++;
  return zeros >= data.length - 1;
}

/**
 * Strips an RFC 8285 one-byte-header extension block (profile 0xBEDE) in front of the Opus payload.
 *
 * Per RFC 3550 5.3.1 the 16-bit length that follows the profile counts 32-bit WORDS of extension
 * data (not elements), so the block is exactly `4 + 4 * words` bytes long. Dysnomia does the same
 * (`data.subarray(l * 4)`) and already removes the extension before emitting packets, which makes
 * this a defensive second line. An earlier version walked the length as an element count (as some
 * Craig/discord.js snippets do), which overruns into the payload whenever words > elements.
 */
export function stripRtpExtension(buffer: Buffer): Buffer {
  if (buffer.length > 4 && buffer[0] === 0xbe && buffer[1] === 0xde) {
    const words = buffer.readUInt16BE(2);
    return buffer.subarray(Math.min(4 + words * 4, buffer.length));
  }
  return buffer;
}

const OPUS_SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);

/** The 3-byte Opus frame Discord clients send to signal silence. */
export function isOpusSilence(data: Buffer): boolean {
  return data.equals(OPUS_SILENCE_FRAME);
}
