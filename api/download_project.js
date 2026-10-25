import { deflateRawSync } from 'zlib';

const crc32 = buffer => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const u16 = value => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};

const u32 = value => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
};

const createZip = files => {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.path, 'utf8');
    const content = Buffer.from(file.content, 'utf8');
    const compressed = deflateRawSync(content);
    const checksum = crc32(content);
    const localHeader = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      u16(20), u16(0), u16(8), u16(0), u16(0),
      u32(checksum), u32(compressed.length), u32(content.length),
      u16(name.length), u16(0), name, compressed
    ]);
    const centralHeader = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      u16(20), u16(20), u16(0), u16(8), u16(0), u16(0),
      u32(checksum), u32(compressed.length), u32(content.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset),
      name
    ]);
    localHeaders.push(localHeader);
    centralHeaders.push(centralHeader);
    offset += localHeader.length;
  }

  const centralDirectory = Buffer.concat(centralHeaders);
  return Buffer.concat([
    ...localHeaders,
    centralDirectory,
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralDirectory.length), u32(offset), u16(0)
  ]);
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  const safeFiles = files
    .filter(file => typeof file?.path === 'string' && typeof file?.content === 'string')
    .map(file => ({
      path: file.path.replace(/^\/+/, ''),
      content: file.content
    }))
    .filter(file => ['index.html', 'style.css', 'script.js'].includes(file.path));

  if (!safeFiles.length) return res.status(400).json({ error: 'No valid project files' });
  const zip = createZip(safeFiles);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="generated-project.zip"');
  return res.status(200).end(zip);
}
